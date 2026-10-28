import type { Launcher } from "@humanharness/blocks";
import type { Effort, EngineDef, ModelChoice } from "@humanharness/engines";
import type { Language, LoadedHarness } from "@humanharness/harness-sdk";
import type { History, LinkedFolderLine, ReferenceFolder } from "@humanharness/workspace";
import type { Event } from "./events";
import type { Session } from "./transport";
import { type HarnessWorkspace, type SessionSlot, type SlotSendOptions, createWorkspace } from "./workspace";

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
   * Plugin collections the agent reads (plugins spec §3.2): the catalogue file the `data` server reads, which starts
   * it even when the harness has no collection for the agent (with `data`). Absent: no change (D0).
   */
  extraData?: { catalogue: string };
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
  /**
   * The open scope's linked folders for AGENTS.md (hatches spec §3.3), asked when the runtime starts and on every
   * `refreshInstructions`. Absent: none (D0).
   */
  instructionLinked?: () => Promise<LinkedFolderLine[]>;
  /**
   * The gitdir of a tracked linked folder's history (hatches spec §3.4), from its real path (`fs.realpath.native`);
   * asked when a turn first opens that folder's history in this runtime. Absent: linked folders are never tracked (D0).
   */
  linkedGitdir?: (realPath: string) => string | Promise<string>;
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
  send(message: string, emit: (e: Event) => void, options?: SlotSendOptions): RunningTurn;
  /** Ends the engine session (Codex: `session/close`); the next turn starts a new one. Not while a turn runs. */
  endSession(): Promise<void>;
  /**
   * Rewrites AGENTS.md with the settings as they are now, when its text changed (spec §5). Only between tasks: the
   * next session reads it, a running one keeps what it started with (D4). True when it wrote; false while a turn runs or once closing.
   * The caller must not run it while another runtime is being created on the same folder.
   */
  refreshInstructions(): Promise<boolean>;
  history: History;
  /** A tracked linked folder's history (hatches spec §3.4) once a turn opened it; null otherwise. */
  linkedHistory?(realPath: string): Promise<History | null>;
  close(): Promise<void>;
}

export { REVIEW_FAILED, reviewHandler } from "./workspace";

/** A workspace with exactly one slot, `"main"` (parallel spec §4): the CLI's `humanharness run` and the shell's runtime. */
export async function createRuntime(opts: RuntimeOptions): Promise<HarnessRuntime> {
  const { data, material, session, onSession, ...rest } = opts;
  const ws = await createWorkspace({
    ...rest,
    ...(data ? { data: (request: unknown) => data(request) } : {}),
    ...(material ? { material: { request: (request: unknown) => material.request(request), ...(material.entry !== undefined ? { entry: material.entry } : {}) } } : {}),
  });
  let slot: SessionSlot;
  try {
    slot = await ws.openSlot({ key: "main", ...(session ? { session } : {}), ...(onSession ? { onSession } : {}) });
  } catch (err) {
    await ws.close().catch(() => {});
    throw err;
  }
  return runtimeOnSlot(ws, slot);
}

/**
 * A workspace and one of its slots in `HarnessRuntime`'s shape: the turns run on the slot, the history and AGENTS.md
 * are the workspace's, and closing closes the workspace (every slot). `createRuntime`'s, and the shell's `single` mode's
 * (jobs without `parallel`: the task's `"main"` slot, job slots beside it).
 */
export function runtimeOnSlot(ws: HarnessWorkspace, slot: SessionSlot): HarnessRuntime {
  return {
    history: ws.history,
    linkedHistory: (realPath) => ws.linkedHistory(realPath),
    send: (message, emit, options) => slot.send(message, emit, options),
    endSession: () => slot.endSession(),
    refreshInstructions: () => ws.refreshInstructions(),
    close: () => ws.close(),
  };
}
