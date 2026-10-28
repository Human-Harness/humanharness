import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { type Bridge, type Launcher, type McpServerSpec, type Rpc, dataServerSpec, devLauncher, hasAgentData, openBridge, openRpc, uiServerSpec } from "@humanharness/blocks";
import type { ModelProfile } from "@humanharness/engines";
import { type LoadedHarness, type Permissions, type PermissionsOverride, allBlocks, hasJobs, hasMaterial, narrowPermissions, resolveInHarness } from "@humanharness/harness-sdk";
import { materialServerSpec } from "@humanharness/material/light";
import { History, type HistoryTrailer, ReviewRefused, START, appHistoryKeep, prepareFolder, refreshInstructions, writeInstructions } from "@humanharness/workspace";
import { AcpTransport } from "./acp";
import { ClaudeCliTransport } from "./claude-cli";
import { turnDocuments } from "./documents";
import { type Event, fail } from "./events";
import type { RunningTurn, RuntimeOptions } from "./runtime";
import { type Session, type Transport, type TransportOptions, type TurnScope, acpFields } from "./transport";
import { type TurnAttribution, beginTurn, endTurn } from "./turn-commit";
import { TurnLedger, type TurnWindow } from "./turn-ledger";

/** Which slot a data or material request came from: decided by the socket it arrived on, never by the request (Decision 9). */
export interface SlotRef {
  key: string;
}

/** `createRuntime`'s options without the per-slot ones; the data and material handlers also get the asking slot. */
export interface WorkspaceOptions extends Omit<RuntimeOptions, "session" | "onSession" | "data" | "material"> {
  /** Answers the agent's data tools; `slot` is the slot whose socket the request came on. */
  data?: (request: unknown, slot: SlotRef) => Promise<unknown>;
  /** Answers the `material` server's tools for the asking slot; `entry` as in `RuntimeOptions`. */
  material?: { request: (request: unknown, slot: SlotRef) => Promise<unknown>; entry?: string };
}

export interface SlotOptions {
  /** Opaque: `"main"` for createRuntime's slot, the task id for a task (part 2), `job:<run>` for a job (part 3). */
  key: string;
  /** The engine session to continue. Default: a new one. */
  session?: Session;
  /** Called when the slot's engine starts a session. */
  onSession?: (session: Session) => void;
  /** A job's slot (Decision 11): its `ui` server gets `HH_JOB=1`. Default: a task's, exactly today's specs. */
  kind?: "task" | "job";
  /** A job's own permissions: only ever narrower than the harness's (spec §8, T5). Ignored for a task's slot. */
  permissions?: PermissionsOverride;
}

export interface SlotSendOptions {
  /** The task's model profile (every turn of a task gets the same one). */
  profile?: ModelProfile;
  /** The task the turn's history commits belong to. */
  trailer?: HistoryTrailer;
  /** After an overlapped turn's commits: what it owned, shared and collided with (spec §5.3). Not called for a turn that ran alone. */
  onAttribution?: (a: TurnAttribution) => void;
  /** The task's scope: linked folders (hatches). Absent: none (D0). */
  scope?: TurnScope;
}

/** One open task's (or job run's) engine connection (spec §4). One turn at a time. */
export interface SessionSlot {
  readonly key: string;
  send(message: string, emit: (e: Event) => void, options?: SlotSendOptions): RunningTurn;
  isBusy(): boolean;
  /** Ends the engine session (Codex: `session/close`); the next turn starts a new one. Not while a turn runs. */
  endSession(): Promise<void>;
  /** Idle (Decision 10): closes an ACP adapter process, keeping the session id; the next turn reconnects and loads it. Claude: nothing. */
  sleep(): Promise<void>;
  /** Cancels a running turn, waits for it, and closes the transport and sockets. Frees the slot's key. */
  close(): Promise<void>;
}

/** The folder shared by every slot: prepared once, one history and one ledger (spec §4 table). */
export interface HarnessWorkspace {
  history: History;
  /** Opens a slot; its bridge and sockets open before its transport, as `createRuntime` always did. */
  openSlot(o: SlotOptions): Promise<SessionSlot>;
  /** A turn runs in some slot. */
  anyRunning(): boolean;
  /**
   * Each running turn's task (its slot key when it has none) and the paths it touched so far: the ones its edit tools
   * named and the ones that changed in the folder since it began (parallel spec §5.3, P2). An undo by paths is refused
   * on any of them.
   */
  runningPaths(): Promise<{ task: string; paths: ReadonlySet<string> }[]>;
  /**
   * Rewrites AGENTS.md with the settings as they are now, when its text changed (harness-settings spec §5), and only
   * while no slot runs a turn (parallel spec §10, Decision 12). True when it wrote; false while a turn runs or once
   * closing. The caller must not run it while another workspace is being created on the same folder.
   */
  refreshInstructions(): Promise<boolean>;
  /** Closes every slot (each cancels its turn first); never writes AGENTS.md afterwards. */
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

export async function createWorkspace(opts: WorkspaceOptions): Promise<HarnessWorkspace> {
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
  const guide = { kinds: harness.documents?.kinds ?? {}, ...(review ? { review: true } : {}) };
  const generated = await writeInstructions({ folder, base, language: opts.language, blocks, references, engine, writing: guide, ...(settings ? { settings } : {}), ...withMaterial });

  // The history skips the app's files under .harness/ (except the notes, the data and, with material, its registry
  // and decisions) and the generated instructions.
  const history = new History(folder, opts.gitdir, [".harness/", ...generated], appHistoryKeep(material !== undefined));
  await history.init();
  await history.save(START);

  const ledger = TurnLedger.forFolder(folder);
  const slots = new Map<string, SessionSlot>();
  // Refreshes run one at a time, and close waits for the last one: once closed, this workspace never writes AGENTS.md.
  let closing = false;
  let refreshing: Promise<boolean> = Promise.resolve(false);
  // The AGENTS.md write under way (after a refresh's last anyRunning check): a turn sent meanwhile waits for it, so it
  // never opens with the file replaced right after.
  let writing: Promise<boolean> | null = null;

  // Opens under way: close waits for each, so none still holds a socket once close resolves.
  const opening = new Set<Promise<unknown>>();

  function openSlot(o: SlotOptions): Promise<SessionSlot> {
    const open = openSlotNow(o);
    const settled = open.catch(() => {});
    opening.add(settled);
    void settled.finally(() => opening.delete(settled));
    return open;
  }

  async function openSlotNow(o: SlotOptions): Promise<SessionSlot> {
    if (closing) throw new Error("The workspace is closing");
    if (slots.has(o.key)) throw new Error(`A slot is already open for ${o.key}`);
    const ref: SlotRef = { key: o.key };
    const session: Session = o.session ?? { id: randomUUID(), started: false };
    let emitCurrent: ((e: Event) => void) | null = null;
    const bridge: Bridge = await openBridge((m) => emitCurrent?.({ type: "block", name: m.name, data: m.data }));
    let rpc: Rpc | null = null;
    let materialRpc: Rpc | null = null;
    let reviewRpc: Rpc | null = null;
    try {
      const data = opts.data;
      if (data && (hasAgentData(harness) || opts.extraData)) rpc = await openRpc((r) => data(r, ref));
      if (material) materialRpc = await openRpc((r) => material.request(r, ref));
      // The review tools ask the person (review spec §4): a task's slot only, never a job's (it can't ask, J1).
      if (review && o.kind !== "job") reviewRpc = await openRpc(review);
    } catch (err) {
      await reviewRpc?.close().catch(() => {});
      await materialRpc?.close().catch(() => {});
      await rpc?.close().catch(() => {});
      await bridge.close().catch(() => {});
      throw err;
    }
    // Checked again after the awaits: a second openSlot for the same key may have won meanwhile.
    if (closing || slots.has(o.key)) {
      await reviewRpc?.close().catch(() => {});
      await materialRpc?.close().catch(() => {});
      await rpc?.close().catch(() => {});
      await bridge.close().catch(() => {});
      throw new Error(closing ? "The workspace is closing" : `A slot is already open for ${o.key}`);
    }

    const permissions: Permissions = o.kind === "job" ? narrowPermissions(harness.permissions, o.permissions) : harness.permissions;
    const ui = uiServerSpec({ harnessConfig: harness.configPath, bridge, launcher, entry: opts.uiServerEntry, ...(reviewRpc ? { review: reviewRpc } : {}) });
    const transportOptions: TransportOptions = {
      folder,
      session,
      mcp: [
        // The engine hands its own env to MCP servers: a task slot clears HH_JOB so an outer one can't make it a job.
        // Only with jobs declared: without them the spec is today's (D0).
        o.kind === "job" ? { ...ui, env: { ...ui.env, HH_JOB: "1" } } : hasJobs(harness) ? { ...ui, env: { ...ui.env, HH_JOB: "" } } : ui,
        ...(rpc ? [dataServerSpec({ harnessConfig: harness.configPath, rpc, launcher, entry: opts.dataServerEntry, ...(opts.extraData ? { extra: opts.extraData.catalogue } : {}) })] : []),
        ...(materialRpc ? [materialServerSpec({ rpc: materialRpc, launcher, mode: "person", entry: material?.entry })] : []),
        ...harnessMcpServers(harness, launcher),
      ],
      permissions,
      references: references.map((r) => r.path),
      ...acpFields(engine, permissions.edit),
      command: opts.command ?? (engine.transport.kind === "claude-cli" ? [engine.transport.binary] : engine.transport.command),
      env: opts.env,
      onModels: opts.onModels,
      onSessionStarted: (s) => {
        try {
          o.onSession?.(s);
        } catch (err) {
          console.error("Could not record the engine session", err);
        }
      },
    };
    const transport: Transport =
      engine.transport.kind === "claude-cli" ? new ClaudeCliTransport(transportOptions) : new AcpTransport(transportOptions);

    let busy = false;
    let current: { controller: AbortController; done: Promise<void> } | null = null;
    let closed: Promise<void> | null = null;
    // Set before closeSlot's first await: a closed slot never runs a turn again (an ACP transport would reconnect).
    let isClosed = false;

    async function closeSlot(): Promise<void> {
      isClosed = true;
      if (current) {
        current.controller.abort();
        await current.done;
      }
      slots.delete(o.key);
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
      }
    }

    const slot: SessionSlot = {
      key: o.key,
      isBusy: () => busy,
      send(message, emit, options = {}) {
        if (isClosed) throw new Error("The slot is closed");
        if (busy) throw new Error("A turn is already running");
        // One slot per task: windows of the same task are left out of each other's `others`, so two at once would own
        // each other's paths. Checked against the ledger before any await, like the window it guards.
        const task = options.trailer?.task;
        if (task !== undefined && ledger.running().some((w) => w.task === task)) throw new Error(`A turn of task ${task} is already running`);
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
        // The window this turn opened: only that one is closed on failure, never another live window under this key.
        let w: TurnWindow | undefined;
        const done = (async () => {
          try {
            // Only when a write is under way: otherwise the window opens before send returns, as always.
            while (writing) await writing.catch(() => false);
            if (controller.signal.aborted || isClosed) {
              emitOnce(fail("cancelled"));
              return;
            }
            w = await beginTurn(history, ledger, o.key, options.trailer);
            let final: Event | undefined;
            emitCurrent = emitOnce;
            await transport.turn(
              message,
              (e) => {
                if (final) return;
                if (e.type === "done") final = e;
                else {
                  // `edits` is a hint for attribution (spec §5.2); a path no turn named counts as shared.
                  // An edit that ended without an error surely wrote its paths (conflicts, spec §5.3).
                  if (e.type === "activity" && e.edits) ledger.noteEdits(o.key, e.edits, e.id);
                  if (e.type === "activity" && e.state === "end") ledger.noteEditEnd(o.key, e.id, e.error === true);
                  emitOnce(e);
                }
              },
              controller.signal,
              options.profile,
              options.scope,
            );
            emitCurrent = null;
            const f = (final ?? { type: "done", ok: false, error: { code: "agent-crashed" } }) as Extract<Event, { type: "done" }>;
            const a = await endTurn(history, ledger, w, f, message, options.trailer);
            // A card for each .md a turn that ran alone added or changed (document-reader spec §5.1), between its
            // "Before message" and "Turn: …" commits; none: no event at all. An overlapped turn's commits sit on other
            // tasks' changes, so it shows none.
            if (f.ok && !w.overlapped && w.before && w.after) {
              const documents = await turnDocuments(history, w.before, w.after).catch((err: unknown) => {
                console.error("Could not list the turn's documents", err);
                return [];
              });
              if (documents.length > 0) emitOnce({ type: "documents", documents });
            }
            if (a && options.onAttribution) {
              try {
                options.onAttribution(a);
              } catch (err) {
                console.error("An attribution listener failed", err);
              }
            }
            emitOnce(f);
          } catch (err) {
            // A no-op when beginTurn or endTurn already closed the window; nothing when beginTurn opened none.
            if (w && ledger.running().includes(w)) ledger.close(o.key);
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
        if (isClosed) throw new Error("The slot is closed");
        if (busy) throw new Error("A turn is already running");
        // Held while the session closes, so a turn cannot start halfway through.
        busy = true;
        try {
          await transport.endSession();
        } finally {
          busy = false;
        }
      },
      async sleep() {
        if (isClosed || busy || engine.transport.kind !== "acp") return;
        busy = true;
        try {
          // AcpTransport.close() keeps the session ({ id, started: true }): the next turn connects and session/loads it (spike PT-S4).
          await transport.close();
        } finally {
          busy = false;
        }
      },
      close() {
        closed ??= closeSlot();
        return closed;
      },
    };
    slots.set(o.key, slot);
    return slot;
  }

  return {
    history,
    openSlot,
    anyRunning: () => ledger.anyRunning(),
    async runningPaths() {
      const out: { task: string; paths: ReadonlySet<string> }[] = [];
      for (const w of ledger.running()) {
        const changed = await history.changedSince(w.startDirty);
        out.push({ task: w.task ?? w.key, paths: new Set([...w.edits, ...changed]) });
      }
      return out;
    },
    refreshInstructions() {
      if (closing || ledger.anyRunning()) return Promise.resolve(false);
      const run = async () => {
        // Checked again when its queue turn comes: a turn may have started meanwhile.
        if (ledger.anyRunning()) return false;
        const now = await opts.instructionSettings?.();
        // And again after the settings arrive: a turn may have started while they were read. (A refresh under way when
        // close begins still writes: close waits for it.)
        if (ledger.anyRunning()) return false;
        const write = refreshInstructions({ folder, base, language: opts.language, blocks, references, writing: guide, ...(now ? { settings: now } : {}), ...withMaterial });
        writing = write;
        try {
          return await write;
        } finally {
          writing = null;
        }
      };
      refreshing = refreshing.catch(() => false).then(run);
      return refreshing;
    },
    async close() {
      closing = true;
      await refreshing.catch(() => {});
      // An open past its last `closing` check registers its slot before it settles; any other one closes its sockets.
      await Promise.all(opening);
      const results = await Promise.allSettled([...slots.values()].map((s) => s.close()));
      // The file index waits for a quiet moment: write it now (it never throws).
      await history.flush();
      const failed = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
      if (failed) throw failed.reason;
    },
  };
}
