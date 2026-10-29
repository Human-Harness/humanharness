import { randomUUID } from "node:crypto";
import { promises as fs, realpath as realpathCb } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { type Bridge, type Launcher, type McpServerSpec, type Rpc, dataServerSpec, devLauncher, hasAgentData, openBridge, openRpc, toolsServerSpec, uiServerSpec } from "@humanharness/blocks";
import type { CommonOptions, ModelProfile, Session, Transport, TurnScope } from "@humanharness/engines";
import { registry as appRegistry } from "@humanharness/engines/registry";
import { type LoadedHarness, type Permissions, type PermissionsOverride, aiStepOf, allBlocks, hasEnginePresets, hasJobs, hasMaterial, hasRecipes, hasTools, narrowPermissions, resolveInHarness } from "@humanharness/harness-sdk";
import { materialServerSpec } from "@humanharness/material/light";
import { History, type HistoryTrailer, ReviewRefused, START, appHistoryKeep, prepareFolder, refreshInstructions, writeInstructions } from "@humanharness/workspace";
import { turnDocuments } from "./documents";
import { type Event, fail } from "./events";
import type { RunningTurn, RuntimeOptions } from "./runtime";
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
  /** ACP: the adapter can't take a scope's linked folders (hatches §3.3, Decision 15). */
  onLinkedUnsupported?: () => void;
  /** Where a step slot makes its own empty folder (tools spec §7.1). Default: the OS temp folder. */
  stepParent?: string;
}

export interface SlotOptions {
  /** Opaque: `"main"` for createRuntime's slot, the task id for a task (part 2), `job:<run>` for a job (part 3). */
  key: string;
  /** The engine session to continue. Default: a new one. */
  session?: Session;
  /** Called when the slot's engine starts a session. */
  onSession?: (session: Session) => void;
  /**
   * A job's slot (Decision 11): its `ui` server gets `HH_JOB=1`. A recipe's AI step (tools spec §7.1, R1): `step`, whose
   * `ui` server serves `job`'s `step_output` alone, MCP only, run in its own empty folder (removed on close) with no turn
   * window and no history commits; Claude engines only for now (refused on ACP). Default: a task's, exactly today's specs.
   */
  kind?: "task" | "job" | "step";
  /** A job's own permissions: only ever narrower than the harness's (spec §8, T5). Ignored for a task's or step's slot. */
  permissions?: PermissionsOverride;
  /** A step slot's job: its `ui` server serves that job's AI step `step_output`. */
  job?: string;
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

/** Each running turn of `ledger`'s folder: its task (its slot key when it has none) and the paths it named or changed. */
async function runningIn(history: History, ledger: TurnLedger): Promise<{ task: string; paths: ReadonlySet<string> }[]> {
  const out: { task: string; paths: ReadonlySet<string> }[] = [];
  for (const w of ledger.running()) {
    const changed = await history.changedSince(w.startDirty);
    out.push({ task: w.task ?? w.key, paths: new Set([...w.edits, ...changed]) });
  }
  return out;
}

/** The folder shared by every slot: prepared once, one history and one ledger (spec §4 table). */
export interface HarnessWorkspace {
  history: History;
  /** Opens a slot; its bridge and sockets open before its transport, as `createRuntime` always did. */
  openSlot(o: SlotOptions): Promise<SessionSlot>;
  /**
   * The history of a tracked linked folder (hatches spec §3.4) by its path, once a turn opened it in this workspace;
   * null otherwise.
   */
  linkedHistory(realPath: string): Promise<History | null>;
  /** `runningPaths` in a tracked linked folder (relative to it), once a turn opened its history here; [] otherwise. */
  linkedRunningPaths(realPath: string): Promise<{ task: string; paths: ReadonlySet<string> }[]>;
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

/** The one stable spelling of a folder's real path: links resolved, the on-disk case (macOS). */
const realNative = promisify(realpathCb.native);

/** `inner` is `outer` or inside it. */
function within(outer: string, inner: string): boolean {
  const rel = path.relative(outer, inner);
  return rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
}

/** The same folder, or one holds the other. */
const overlaps = (a: string, b: string): boolean => within(a, b) || within(b, a);

interface LinkedRepo {
  history: History;
  ledger: TurnLedger;
}

/** The fixed text of a step slot's refusal on an engine other than Claude: safe to show (no engine words, no path). */
export const STEP_CLAUDE_ONLY = "An AI step runs only with Claude for now";

/** openSlot's own refusal of a step slot on an ACP engine; main tells it from any other failure by its class. */
export class StepClaudeOnlyError extends Error {
  constructor() {
    super(STEP_CLAUDE_ONLY);
    this.name = "StepClaudeOnlyError";
  }
}

export async function createWorkspace(opts: WorkspaceOptions): Promise<HarnessWorkspace> {
  const { harness, engine, folder } = opts;
  const launcher = opts.launcher ?? devLauncher();
  const references = opts.references ?? [];

  await prepareFolder(folder, harness.folder.seed ? resolveInHarness(harness, harness.folder.seed) : undefined);
  const base = await fs.readFile(resolveInHarness(harness, harness.instructions), "utf8");
  const blocks = allBlocks(harness);
  const settings = await opts.instructionSettings?.();
  const linked = (await opts.instructionLinked?.()) ?? [];
  const material = opts.material && hasMaterial(harness) ? opts.material : undefined;
  const withMaterial = material ? { material: true } : {};
  const tools = opts.tools && hasTools(harness) ? opts.tools : undefined;
  const review = opts.review && harness.permissions.edit === "folder" ? reviewHandler(opts.review) : undefined;
  // Every harness gets the writing guide; its kinds only when it declares them (document-reader spec D4); the review
  // lines only with the review tools (review spec §4).
  const guide = { kinds: harness.documents?.kinds ?? {}, ...(review ? { review: true } : {}) };
  const generated = await writeInstructions({ folder, base, language: opts.language, blocks, references, engine, writing: guide, ...(settings ? { settings } : {}), ...(linked.length ? { linked } : {}), ...withMaterial });

  // The history skips the app's files under .harness/ (except the notes, the data and, with material, its registry
  // and decisions) and the generated instructions.
  const history = new History(folder, opts.gitdir, [".harness/", ...generated], appHistoryKeep(material !== undefined, hasEnginePresets(harness)));
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

  /** One history and ledger per tracked linked folder, by its real path, opened on the first turn that names it (hatches spec §3.4). */
  const linkedRepos = new Map<string, Promise<LinkedRepo>>();
  // The main folder as given and as its real path: no linked history may overlap it.
  const mainRoots = [...new Set([path.resolve(folder), await realNative(folder)])];
  async function linkedRepo(dir: string, gitdirOf: NonNullable<WorkspaceOptions["linkedGitdir"]>): Promise<LinkedRepo> {
    // A stored link is its real path already: one that now leads elsewhere (swapped for a link) is refused, never followed.
    const real = await realNative(dir);
    if (real !== path.resolve(dir)) throw new Error("A linked folder is no longer at its real path");
    // Checked and set with no await between: two slots opening the same folder share one repo.
    let repo = linkedRepos.get(real);
    if (!repo) {
      // One history per file: a root that is, holds or sits inside the main folder or another linked history's root
      // would let one turn's whole-folder restore undo another's committed work.
      if (mainRoots.some((m) => overlaps(m, real))) throw new Error("A linked folder overlaps the work folder");
      if ([...linkedRepos.keys()].some((k) => overlaps(k, real))) throw new Error("A linked folder overlaps another linked folder");
      repo = (async () => {
        const h = new History(real, await gitdirOf(real), [], []);
        await h.init();
        await h.save(START);
        return { history: h, ledger: new TurnLedger([real]) };
      })();
      linkedRepos.set(real, repo);
      // A failed open is retried by the next turn.
      repo.catch(() => linkedRepos.delete(real));
    }
    return repo;
  }

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
    // A recipe's AI step reaches its step_output and nothing else (tools spec §7.1, R1): none of the sockets below.
    const step = o.kind === "step";
    const engines = opts.registry ?? appRegistry;
    if (step) {
      // Claude only for now (fail closed): an ACP engine's own sandbox can't keep a step from reading (Codex's read-only
      // mode still reads the whole disk and runs read-only shell commands without asking; OpenCode's read, glob, grep
      // and list tools never ask), so injected `## Data` could copy any file into step_output. Lifted only with
      // engine-level hardening.
      if (!engines.adapter(engine).capabilities.noBuiltins) throw new StepClaudeOnlyError();
      if (!o.job) throw new Error("A step slot needs its job");
      const job = harness.jobs && Object.hasOwn(harness.jobs, o.job) ? harness.jobs[o.job] : undefined;
      if (!job || !aiStepOf(job)) throw new Error(`No AI step for job "${o.job}"`);
    }
    const ref: SlotRef = { key: o.key };
    const session: Session = o.session ?? { id: randomUUID(), started: false };
    let emitCurrent: ((e: Event) => void) | null = null;
    const bridge: Bridge = await openBridge((m) => emitCurrent?.({ type: "block", name: m.name, data: m.data }));
    let rpc: Rpc | null = null;
    let materialRpc: Rpc | null = null;
    let reviewRpc: Rpc | null = null;
    let toolsRpc: Rpc | null = null;
    try {
      const data = opts.data;
      if (!step && data && (hasAgentData(harness) || opts.extraData)) rpc = await openRpc((r) => data(r, ref));
      if (!step && material) materialRpc = await openRpc((r) => material.request(r, ref));
      // Task and job slots alike (Decision 9): a job's agent may call the tools too.
      if (!step && tools) toolsRpc = await openRpc((r) => tools.request(r, ref));
      // The review tools ask the person (review spec §4): a task's slot only, never a job's (it can't ask, J1).
      if (!step && review && o.kind !== "job") reviewRpc = await openRpc(review);
    } catch (err) {
      await toolsRpc?.close().catch(() => {});
      await reviewRpc?.close().catch(() => {});
      await materialRpc?.close().catch(() => {});
      await rpc?.close().catch(() => {});
      await bridge.close().catch(() => {});
      throw err;
    }
    // Checked again after the awaits: a second openSlot for the same key may have won meanwhile.
    if (closing || slots.has(o.key)) {
      await toolsRpc?.close().catch(() => {});
      await reviewRpc?.close().catch(() => {});
      await materialRpc?.close().catch(() => {});
      await rpc?.close().catch(() => {});
      await bridge.close().catch(() => {});
      throw new Error(closing ? "The workspace is closing" : `A slot is already open for ${o.key}`);
    }
    // A step's engine never runs in the work folder (R1): Claude would load AGENTS.md (through CLAUDE.md) and a turn there
    // would open a window in the work folder's ledger. Its own empty folder instead, like a system session's: nothing to
    // read, no history, removed on close.
    let stepFolder: string | null = null;
    if (step) {
      try {
        const parent = opts.stepParent ?? os.tmpdir();
        await fs.mkdir(parent, { recursive: true });
        stepFolder = await fs.mkdtemp(path.join(parent, "hh-step-"));
      } catch (err) {
        await bridge.close().catch(() => {});
        throw err;
      }
      // Checked again: the workspace may have started closing during the awaits.
      if (closing) {
        await fs.rm(stepFolder, { recursive: true, force: true }).catch(() => {});
        await bridge.close().catch(() => {});
        throw new Error("The workspace is closing");
      }
    }

    const permissions: Permissions =
      step ? narrowPermissions(harness.permissions, { edit: "none", exec: false, web: false })
      : o.kind === "job" ? narrowPermissions(harness.permissions, o.permissions)
      : harness.permissions;
    // A task or job slot clears HH_STEP so an outer one can't make it a step slot; only with a recipe declared (D0).
    const noStep: Record<string, string> = hasRecipes(harness) ? { HH_STEP: "" } : {};
    const ui = uiServerSpec({ harnessConfig: harness.configPath, bridge, launcher, entry: opts.uiServerEntry, ...(reviewRpc ? { review: reviewRpc } : {}) });
    const transportOptions: CommonOptions = {
      folder: stepFolder ?? folder,
      session,
      mcp: [
        // The engine hands its own env to MCP servers: a task slot clears HH_JOB so an outer one can't make it a job.
        // Only with jobs declared: without them the spec is today's (D0).
        step ? { ...ui, env: { ...ui.env, HH_STEP: o.job as string, HH_JOB: "" } }
        : o.kind === "job" ? { ...ui, env: { ...ui.env, HH_JOB: "1", ...noStep } }
        : hasJobs(harness) ? { ...ui, env: { ...ui.env, HH_JOB: "", ...noStep } }
        : ui,
        ...(rpc ? [dataServerSpec({ harnessConfig: harness.configPath, rpc, launcher, entry: opts.dataServerEntry, ...(opts.extraData ? { extra: opts.extraData.catalogue } : {}) })] : []),
        ...(toolsRpc && tools ? [toolsServerSpec({ catalogue: tools.catalogue, rpc: toolsRpc, launcher, entry: tools.entry })] : []),
        ...(materialRpc ? [materialServerSpec({ rpc: materialRpc, launcher, mode: "person", entry: material?.entry })] : []),
        ...(step ? [] : harnessMcpServers(harness, launcher)),
      ],
      permissions,
      references: step ? [] : references.map((r) => r.path),
      // Claude gets no Read, Glob or Grep, and `--tools ""` turns off every other built-in too (R1). A step slot only
      // opens on an engine that can do this (see openSlotNow): on ACP, mcpOnly refuses only the reads that ask.
      ...(step ? { mcpOnly: true, noBuiltins: true } : {}),
      command: opts.command ?? engines.commandLine(engine),
      env: opts.env,
      onModels: opts.onModels,
      onLinkedUnsupported: opts.onLinkedUnsupported,
      onSessionStarted: (s) => {
        try {
          o.onSession?.(s);
        } catch (err) {
          console.error("Could not record the engine session", err);
        }
      },
    };
    const transport: Transport = engines.createTransport(engine, transportOptions);

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
        await closeAll();
      } finally {
        if (stepFolder) await fs.rm(stepFolder, { recursive: true, force: true }).catch(() => {});
      }
    }

    async function closeAll(): Promise<void> {
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
              try {
                await reviewRpc?.close();
              } finally {
                await toolsRpc?.close();
              }
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
        // A step slot reaches no scope (tools spec §7.1, R1): whatever it is given, no linked folder and no preset.
        const scope = step ? undefined : options.scope;
        // Tracked linked folders (hatches spec §3.4): write folders with no git of their own. None without linkedGitdir (D0).
        const gitdirOf = opts.linkedGitdir;
        const tracked = gitdirOf ? (scope?.linked ?? []).filter((l) => l.tracked && l.mode === "write") : [];
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
        const linkedWindows: { repo: LinkedRepo; w: TurnWindow }[] = [];
        const done = (async () => {
          try {
            // Only when a write is under way: otherwise the window opens before send returns, as always.
            while (writing) await writing.catch(() => false);
            if (controller.signal.aborted || isClosed) {
              emitOnce(fail("cancelled"));
              return;
            }
            // Each tracked linked folder's history is opened before any window: one that can't be opened (gone, moved
            // behind a link, overlapping another history) fails the turn before anything is committed, since its changes
            // could never be undone. Fail closed, never a turn that silently goes untracked.
            const repos: LinkedRepo[] = [];
            for (const p of new Set(tracked.map((l) => l.path))) repos.push(await linkedRepo(p, gitdirOf!));
            // A step's turn runs outside the work folder: no window, no ledger entry, no history commits.
            const win = step ? undefined : await beginTurn(history, ledger, o.key, options.trailer);
            w = win;
            // The same windows and trailer in each tracked linked folder, after the main folder's.
            for (const repo of repos) linkedWindows.push({ repo, w: await beginTurn(repo.history, repo.ledger, o.key, options.trailer) });
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
                  // Each ledger keeps only the paths inside its own folder.
                  if (win && e.type === "activity" && e.edits) {
                    ledger.noteEdits(o.key, e.edits, e.id);
                    // A relative path is the main folder's: linked ledgers get absolute paths only.
                    const absolute = e.edits.filter((p) => path.isAbsolute(p));
                    if (absolute.length > 0) for (const { repo } of linkedWindows) repo.ledger.noteEdits(o.key, absolute, e.id);
                  }
                  if (win && e.type === "activity" && e.state === "end") {
                    ledger.noteEditEnd(o.key, e.id, e.error === true);
                    for (const { repo } of linkedWindows) repo.ledger.noteEditEnd(o.key, e.id, e.error === true);
                  }
                  emitOnce(e);
                }
              },
              controller.signal,
              options.profile,
              scope,
            );
            emitCurrent = null;
            const f = (final ?? { type: "done", ok: false, error: { code: "agent-crashed" } }) as Extract<Event, { type: "done" }>;
            if (!win) {
              emitOnce(f);
              return;
            }
            let a: TurnAttribution | null;
            try {
              a = await endTurn(history, ledger, win, f, message, options.trailer);
            } finally {
              // Even when the main folder's end failed: each linked folder still commits or restores its own turn.
              // Only the main folder's attribution reaches onAttribution; a linked folder's conflicts are logged (Decision 11).
              for (const { repo, w: lw } of linkedWindows) {
                try {
                  const la = await endTurn(repo.history, repo.ledger, lw, f, message, options.trailer);
                  if (la?.conflicts.length) console.error("Conflicting changes in a linked folder", la.conflicts.length);
                } catch (err) {
                  if (repo.ledger.running().includes(lw)) repo.ledger.close(o.key);
                  console.error("Could not record a linked folder's turn", err);
                }
              }
            }
            // A card for each .md a turn that ran alone added or changed (document-reader spec §5.1), between its
            // "Before message" and "Turn: …" commits; none: no event at all. An overlapped turn's commits sit on other
            // tasks' changes, so it shows none.
            if (f.ok && !win.overlapped && win.before && win.after) {
              const documents = await turnDocuments(history, win.before, win.after).catch((err: unknown) => {
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
            for (const { repo, w: lw } of linkedWindows) if (repo.ledger.running().includes(lw)) repo.ledger.close(o.key);
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
        if (isClosed || busy) return;
        busy = true;
        try {
          // AcpTransport.close() keeps the session ({ id, started: true }): the next turn connects and session/loads it (spike PT-S4).
          // ClaudeCliTransport.close() does nothing: it holds no process between turns.
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
    async linkedHistory(dir) {
      const real = await realNative(dir).catch(() => null);
      const repo = real === null ? undefined : linkedRepos.get(real);
      return repo ? (await repo.catch(() => null))?.history ?? null : null;
    },
    async linkedRunningPaths(dir) {
      const real = await realNative(dir).catch(() => null);
      const repo = real === null ? undefined : linkedRepos.get(real);
      const open = repo ? await repo.catch(() => null) : null;
      return open ? runningIn(open.history, open.ledger) : [];
    },
    anyRunning: () => ledger.anyRunning(),
    runningPaths: () => runningIn(history, ledger),
    refreshInstructions() {
      if (closing || ledger.anyRunning()) return Promise.resolve(false);
      const run = async () => {
        // Checked again when its queue turn comes: a turn may have started meanwhile.
        if (ledger.anyRunning()) return false;
        const now = await opts.instructionSettings?.();
        const nowLinked = (await opts.instructionLinked?.()) ?? [];
        // And again after the settings arrive: a turn may have started while they were read. (A refresh under way when
        // close begins still writes: close waits for it.)
        if (ledger.anyRunning()) return false;
        const write = refreshInstructions({ folder, base, language: opts.language, blocks, references, writing: guide, ...(now ? { settings: now } : {}), ...(nowLinked.length ? { linked: nowLinked } : {}), ...withMaterial });
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
      for (const repo of linkedRepos.values()) await (await repo.catch(() => null))?.history.flush();
      const failed = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
      if (failed) throw failed.reason;
    },
  };
}
