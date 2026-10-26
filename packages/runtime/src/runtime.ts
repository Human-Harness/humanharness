import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { type Bridge, type Launcher, type McpServerSpec, type Rpc, dataServerSpec, devLauncher, hasAgentData, openBridge, openRpc, uiServerSpec } from "@humanharness/blocks";
import type { Effort, EngineDef, ModelChoice, ModelProfile } from "@humanharness/engines";
import { type Language, type LoadedHarness, allBlocks, resolveInHarness } from "@humanharness/harness-sdk";
import {
  BEFORE_MESSAGE,
  DATA_PREFIX,
  History,
  type HistoryTrailer,
  NOTES_PREFIX,
  type ReferenceFolder,
  START,
  STOPPED_PREFIX,
  TURN_PREFIX,
  UNDO_PREFIX,
  prepareFolder,
  writeInstructions,
} from "@humanharness/workspace";
import { AcpTransport } from "./acp";
import { ClaudeCliTransport } from "./claude-cli";
import type { Event } from "./events";
import type { Session, Transport, TransportOptions } from "./transport";

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
  history: History;
  close(): Promise<void>;
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
  const generated = await writeInstructions({ folder, base, language: opts.language, blocks: allBlocks(harness), references, engine });

  // The history skips the app's files under .harness/ (except the notes and the data) and the generated instructions.
  const history = new History(folder, opts.gitdir, [".harness/", ...generated], [NOTES_PREFIX, DATA_PREFIX]);
  await history.init();
  await history.save(START);

  let emitCurrent: ((e: Event) => void) | null = null;
  const session: Session = opts.session ?? { id: randomUUID(), started: false };
  const bridge: Bridge = await openBridge((m) => emitCurrent?.({ type: "block", name: m.name, data: m.data }));
  let rpc: Rpc | null = null;
  try {
    if (opts.data && hasAgentData(harness)) rpc = await openRpc(opts.data);
    return await buildRuntime(bridge, rpc);
  } catch (err) {
    await rpc?.close().catch(() => {});
    await bridge.close().catch(() => {});
    throw err;
  }

  async function buildRuntime(bridge: Bridge, rpc: Rpc | null): Promise<HarnessRuntime> {
    const transportOptions: TransportOptions = {
      folder,
      session,
      mcp: [
        uiServerSpec({ harnessConfig: harness.configPath, bridge, launcher, entry: opts.uiServerEntry }),
        ...(rpc ? [dataServerSpec({ harnessConfig: harness.configPath, rpc, launcher, entry: opts.dataServerEntry })] : []),
        ...harnessMcpServers(harness, launcher),
      ],
      permissions: harness.permissions,
      references: references.map((r) => r.path),
      sessionMode:
        engine.transport.kind === "acp"
          ? engine.transport.modes?.[harness.permissions.edit === "folder" ? "edit" : "readOnly"]
          : undefined,
      minAdapterVersion: engine.transport.kind === "acp" ? engine.transport.minAdapterVersion : undefined,
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
            if (f.type === "done" && f.ok) await history.save(`${TURN_PREFIX}${message.slice(0, 60)}`, options.trailer);
            else if (f.type === "done" && f.error.code === "agent-crashed") await history.restore(before, `${UNDO_PREFIX}the turn did not finish`, options.trailer);
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
      async close() {
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
            await rpc?.close();
          }
        }
      },
    };
  }
}
