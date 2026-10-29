import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { type Bridge, type Launcher, type McpServerSpec, type Rpc, dataServerSpec, devLauncher, hasAgentData, openBridge, openRpc, uiServerSpec } from "@humanharness/blocks";
import type { Effort, EngineDef, ModelChoice, ModelProfile } from "@humanharness/engines";
import { type Language, type LoadedHarness, allBlocks, hasMaterial, resolveInHarness } from "@humanharness/harness-sdk";
import { materialServerSpec } from "@humanharness/material/light";
import {
  BEFORE_MESSAGE,
  History,
  type HistoryTrailer,
  type ReferenceFolder,
  ReviewRefused,
  START,
  STOPPED_PREFIX,
  TURN_PREFIX,
  UNDO_PREFIX,
  appHistoryKeep,
  prepareFolder,
  refreshInstructions,
  writeInstructions,
} from "@humanharness/workspace";
import { AcpTransport } from "@humanharness/engines/registry";
import { ClaudeCliTransport } from "./claude-cli";
import { turnDocuments } from "./documents";
import type { Event } from "./events";
import { type Session, type Transport, type TransportOptions, acpFields } from "./transport";

export interface RuntimeOptions {
  /** Built `ui` MCP server entry (app). Defaults to the TS source (dev). */
  uiServerEntry?: string;
  /** Built `data` MCP server entry (app). Defaults to the TS source (dev). */
  dataServerEntry?: string;
  /**
   * Answers the agent's data tools (spec §4.4): the caller runs each request as the agent, in the running task's
   * scope. Without it, or without collections the agent may see, there is no `data` server (D2).
   */
  data?: (request: unknown) => Promise<unknown>;
  /**
   * Answers the `material` server's tools (material spec §9) for the running task; `entry` is the built server (app),
   * defaulting to the TS source (dev). Only with `material` in the manifest; absent: no `material` server, no Material
   * part in AGENTS.md, the same history keep list (D0).
   */
  material?: { request: (request: unknown) => Promise<unknown>; entry?: string };
  /**
   * Answers the agent's review tools (review spec §4) in the person's folder. Used only when the harness's agent may edit
   * the folder; absent, or `permissions.edit: "none"`: no tools and no review lines in AGENTS.md (D0).
   */
  review?: (request: unknown) => Promise<unknown>;
  harness: LoadedHarness;
  engine: EngineDef;
  /** The user's visible folder. */
  folder: string;
  /** Where the hidden history lives (outside `folder`). */
  gitdir: string;
  language: Language;
  /** How to run Node for MCP servers. Defaults to tsx (development). */
  launcher?: Launcher;
  /** Override the engine's CLI command (tests, dev). */
  command?: string[];
  /** Extra CLI environment (tests, dev). Never credentials. */
  env?: Record<string, string>;
  /** Folders the agent may read but never change (absolute paths), with the label `AGENTS.md` shows. */
  references?: ReferenceFolder[];
  /**
   * The harness's settings as sentences for AGENTS.md (harness-settings spec §5), asked when the runtime starts and
   * on every `refreshInstructions`. Absent: no settings section (D0).
   */
  instructionSettings?: () => Promise<string[]>;
  /** The engine session to continue (the dev CLI). Default: a new one. */
  session?: Session;
  /** Called when the engine starts a session. */
  onSession?: (session: Session) => void;
  /** ACP engines: the models and efforts the agent offered (saved for Settings › Modelos). */
  onModels?: (offer: { models: ModelChoice[]; efforts: Effort[] }) => void;
}

export interface RunningTurn {
  cancel(): void;
  done: Promise<void>;
}

export interface HarnessRuntime {
  /**
   * Runs one turn; `options.profile` is the task's model profile (every turn of a task gets the same one) and
   * `options.trailer` the task its history commits belong to.
   */
  send(message: string, emit: (e: Event) => void, options?: { profile?: ModelProfile; trailer?: HistoryTrailer }): RunningTurn;
  /** Ends the engine session (Codex: `session/close`); the next turn starts a new one. Not while a turn runs. */
  endSession(): Promise<void>;
  /**
   * Rewrites AGENTS.md with the settings as they are now, when its text changed (spec §5). Only between tasks: the
   * next session reads it, a running one keeps what it started with (D4). True when it wrote; false once closing.
   * The caller must not run it while another runtime is being created on the same folder.
   */
  refreshInstructions(): Promise<boolean>;
  history: History;
  close(): Promise<void>;
}

/** What the agent reads when a review request fails for a reason other than the app's own refusal. */
export const REVIEW_FAILED = "The app could not do that. Nothing was saved; do not retry in a loop.";

/**
 * The review channel's handler: the rpc sends any thrown message to the agent, so only a `ReviewRefused` keeps its
 * text (written for the agent); any other error (a file system error naming paths) becomes `REVIEW_FAILED`.
 */
export function reviewHandler(handle: (request: unknown) => Promise<unknown>): (request: unknown) => Promise<unknown> {
  return async (request) => {
    try {
      return await handle(request);
    } catch (err) {
      if (err instanceof ReviewRefused) throw new Error(err.message);
      console.error("A review request failed", err);
      throw new Error(REVIEW_FAILED);
    }
  };
}

function harnessMcpServers(harness: LoadedHarness, launcher: Launcher): McpServerSpec[] {
  return harness.mcp.map((rel, i) => ({
    name: i === 0 ? harness.id : `${harness.id}-${i + 1}`,
    command: launcher.command,
    args: [...launcher.args, resolveInHarness(harness, rel)],
    env: { ...launcher.env },
  }));
}

export async function createRuntime(opts: RuntimeOptions): Promise<HarnessRuntime> {
  const { harness, engine, folder } = opts;
  const launcher = opts.launcher ?? devLauncher();
  const references = opts.references ?? [];

  await prepareFolder(folder, harness.folder.seed ? resolveInHarness(harness, harness.folder.seed) : undefined);
  const base = await fs.readFile(resolveInHarness(harness, harness.instructions), "utf8");
  const blocks = allBlocks(harness);
  const settings = await opts.instructionSettings?.();
  const material = opts.material && hasMaterial(harness) ? opts.material : undefined;
  const withMaterial = material ? { material: true } : {};
  const review = opts.review && harness.permissions.edit === "folder" ? reviewHandler(opts.review) : undefined;
  // Every harness gets the writing guide; its kinds only when it declares them (document-reader spec D4); the review
  // lines only with the review tools (review spec §4).
  const writing = { kinds: harness.documents?.kinds ?? {}, ...(review ? { review: true } : {}) };
  const generated = await writeInstructions({ folder, base, language: opts.language, blocks, references, engine, writing, ...(settings ? { settings } : {}), ...withMaterial });

  // The history skips the app's files under .harness/ (except the notes, the data and, with material, its registry
  // and decisions) and the generated instructions.
  const history = new History(folder, opts.gitdir, [".harness/", ...generated], appHistoryKeep(material !== undefined));
  await history.init();
  await history.save(START);

  let emitCurrent: ((e: Event) => void) | null = null;
  const session: Session = opts.session ?? { id: randomUUID(), started: false };
  const bridge: Bridge = await openBridge((m) => emitCurrent?.({ type: "block", name: m.name, data: m.data }));
  let rpc: Rpc | null = null;
  let materialRpc: Rpc | null = null;
  let reviewRpc: Rpc | null = null;
  try {
    if (opts.data && hasAgentData(harness)) rpc = await openRpc(opts.data);
    if (material) materialRpc = await openRpc(material.request);
    if (review) reviewRpc = await openRpc(review);
    return await buildRuntime(bridge, rpc, materialRpc, reviewRpc);
  } catch (err) {
    await reviewRpc?.close().catch(() => {});
    await materialRpc?.close().catch(() => {});
    await rpc?.close().catch(() => {});
    await bridge.close().catch(() => {});
    throw err;
  }

  async function buildRuntime(bridge: Bridge, rpc: Rpc | null, materialRpc: Rpc | null, reviewRpc: Rpc | null): Promise<HarnessRuntime> {
    const transportOptions: TransportOptions = {
      folder,
      session,
      mcp: [
        uiServerSpec({ harnessConfig: harness.configPath, bridge, launcher, entry: opts.uiServerEntry, ...(reviewRpc ? { review: reviewRpc } : {}) }),
        ...(rpc ? [dataServerSpec({ harnessConfig: harness.configPath, rpc, launcher, entry: opts.dataServerEntry })] : []),
        ...(materialRpc ? [materialServerSpec({ rpc: materialRpc, launcher, mode: "person", entry: material?.entry })] : []),
        ...harnessMcpServers(harness, launcher),
      ],
      permissions: harness.permissions,
      references: references.map((r) => r.path),
      ...acpFields(engine, harness.permissions.edit),
      command: opts.command ?? (engine.transport.kind === "claude-cli" ? [engine.transport.binary] : engine.transport.command),
      env: opts.env,
      onModels: opts.onModels,
      onSessionStarted: (s) => {
        try {
          opts.onSession?.(s);
        } catch (err) {
          console.error("Could not record the engine session", err);
        }
      },
    };
    const transport: Transport =
      engine.transport.kind === "claude-cli" ? new ClaudeCliTransport(transportOptions) : new AcpTransport(transportOptions);

    let busy = false;
    let current: { controller: AbortController; done: Promise<void> } | null = null;
    // Refreshes run one at a time, and close waits for the last one: once closed, this runtime never writes AGENTS.md.
    let closing = false;
    let refreshing: Promise<boolean> = Promise.resolve(false);

    return {
      history,
      send(message, emit, options = {}) {
        if (busy) throw new Error("A turn is already running");
        busy = true;
        const controller = new AbortController();
        let doneEmitted = false;
        const emitOnce = (e: Event) => {
          if (e.type === "done") {
            if (doneEmitted) return;
            doneEmitted = true;
          }
          emit(e);
        };
        const done = (async () => {
          try {
            const before = (await history.save(BEFORE_MESSAGE, options.trailer)) ?? (await history.last())!;
            let final: Event | undefined;
            emitCurrent = emitOnce;
            await transport.turn(
              message,
              (e) => {
                if (final) return;
                if (e.type === "done") final = e;
                else emitOnce(e);
              },
              controller.signal,
              options.profile,
            );
            emitCurrent = null;
            const f: Event = final ?? { type: "done", ok: false, error: { code: "agent-crashed" } };
            if (f.type === "done" && f.ok) {
              const after = await history.save(`${TURN_PREFIX}${message.slice(0, 60)}`, options.trailer);
              // A card for each .md the turn added or changed (document-reader spec §5.1); none: no event at all.
              if (after) {
                const documents = await turnDocuments(history, before, after).catch((err: unknown) => {
                  console.error("Could not list the turn's documents", err);
                  return [];
                });
                if (documents.length > 0) emitOnce({ type: "documents", documents });
              }
            } else if (f.type === "done" && f.error.code === "agent-crashed") await history.restore(before, `${UNDO_PREFIX}the turn did not finish`, options.trailer);
            else await history.save(`${STOPPED_PREFIX}${message.slice(0, 60)}`, options.trailer);
            emitOnce(f);
          } catch (err) {
            emitOnce({ type: "done", ok: false, error: { code: "agent-crashed", detail: err instanceof Error ? err.message : String(err) } });
          } finally {
            emitCurrent = null;
            busy = false;
          }
        })();
        current = { controller, done };
        return { cancel: () => controller.abort(), done };
      },
      async endSession() {
        if (busy) throw new Error("A turn is already running");
        // Held while the session closes, so a turn cannot start halfway through.
        busy = true;
        try {
          await transport.endSession();
        } finally {
          busy = false;
        }
      },
      refreshInstructions() {
        if (closing) return Promise.resolve(false);
        const run = async () => {
          const now = await opts.instructionSettings?.();
          return refreshInstructions({ folder, base, language: opts.language, blocks, references, writing, ...(now ? { settings: now } : {}), ...withMaterial });
        };
        refreshing = refreshing.catch(() => false).then(run);
        return refreshing;
      },
      async close() {
        closing = true;
        await refreshing.catch(() => {});
        if (current) {
          current.controller.abort();
          await current.done;
        }
        try {
          await transport.close();
        } finally {
          try {
            await bridge.close();
          } finally {
            try {
              await rpc?.close();
            } finally {
              try {
                await materialRpc?.close();
              } finally {
                await reviewRpc?.close();
              }
            }
          }
          // The file index waits for a quiet moment: write it now (it never throws).
          await history.flush();
        }
      },
    };
  }
}
