import { promises as fs } from "node:fs";
import { refusedShape } from "@humanharness/harness-sdk/documents";
import type { ContextGetResult, ContextPick, ContextRefusal, ContextResult, ExcludedView, TaskContext } from "@humanharness/ui/client";
import {
  APP_SCOPE,
  CONTEXT_CHANGE_PREFIX,
  type ContextFile,
  EXCLUDED_MAX,
  type HistoryTrailer,
  MAIN_SCOPE,
  PINS_MAX,
  isScopeId,
  loadContext,
  notesPrefix,
  saveContext,
} from "@humanharness/workspace";
import { checkPinPath, pinnedContext, pinsOf } from "./context-pins";
import { folderPath } from "./context-record";
import type { CurrentTask } from "./task-store";
import type { PersonContext } from "./task-manager";
import { addablePath } from "./task-prompts";

export interface ContextDeps {
  /** The agent's working folder (the active profile's); null when the app isn't set up. */
  base(): Promise<string | null>;
  scoped(): boolean;
  /** A registered, open scope. */
  scopeExists(id: string): Promise<boolean>;
  /** Tokens of pinned text a new task gets whole (`pinnedBudget`). */
  budget(): Promise<number>;
  /** The open task's record (`TaskManager.contextRecord`). */
  record(taskId: string): Promise<(Pick<CurrentTask, "id" | "start" | "startTokens" | "reads"> & { scope: string }) | null>;
  /** The open task's id, to refresh its panel after a pin changes. */
  openTask(): Promise<string | null>;
  /** Note path → title, for the excluded notes still there. */
  noteTitles(scope: string): Promise<Map<string, string>>;
  history(): Promise<{ save(message: string, trailer?: HistoryTrailer): Promise<unknown> } | null>;
  trailer(): Promise<HistoryTrailer | undefined>;
  /** Why writes can't run now (a restore, a move, an engine change), or null. */
  blocked(): string | null;
  /** `TaskManager.addContext(...).accepted`. */
  add(taskId: string, file: string): Promise<ContextResult>;
  /** The system dialog at `base`: the absolute file picked, or null. */
  pickFile(base: string): Promise<string | null>;
  /** The task's panel must refresh (`hh:context`). */
  changed(taskId: string): void;
}

const no = (reason: ContextRefusal): { ok: false; reason: ContextRefusal } => ({ ok: false, reason });

/** A path as a commit subject shows it: as it is, or quoted when a hand-edited file left an odd character in it. */
const shown = (p: string): string => (addablePath(p) ? p : JSON.stringify(p));

type Change = { file: ContextFile; message: string } | { ok: false; reason: ContextRefusal } | null;

/**
 * The person's side of the context panel (context-panel spec §4, §5.2). Every answer is data. Every path and note is
 * checked here, when the action runs, whatever the window sent (a start item's path comes from the hand-editable
 * tasks.json). Writes run one at a time across every scope (`saveContext` loads, changes and saves with no lock), each
 * with one `Context: …` commit carrying the open task's trailer, and are refused while turns are held.
 */
export class ContextService {
  private writes: Promise<unknown> = Promise.resolve();
  /** The dialog open now: one at a time. */
  private picking: Promise<ContextPick> | null = null;

  constructor(private readonly d: ContextDeps) {}

  /** The scopes whose pins a task in `scope` gets: its own, then `_app` (scoped harnesses, outside `_app`). */
  private scopesFor(scope: string): string[] {
    return this.d.scoped() && scope !== APP_SCOPE ? [scope, APP_SCOPE] : [scope];
  }

  /** `main` without scopes; `_app` or an open scope with them. */
  private async scopeOk(scope: unknown): Promise<boolean> {
    if (!this.d.scoped()) return scope === MAIN_SCOPE;
    if (scope === APP_SCOPE) return true;
    return isScopeId(scope) && (await this.d.scopeExists(scope));
  }

  async get(taskId: unknown): Promise<ContextGetResult> {
    if (typeof taskId !== "string") return no("no-task");
    const base = await this.d.base();
    if (!base) return no("not-ready");
    const record = await this.d.record(taskId);
    if (!record) return no("no-task");
    const scopes = this.scopesFor(record.scope);
    const budget = await this.d.budget();
    const excluded: ExcludedView[] = [];
    for (const scope of scopes) {
      const titles = await this.d.noteTitles(scope).catch(() => new Map<string, string>());
      for (const e of (await loadContext(base, scope)).excluded) {
        const title = titles.get(e.note);
        excluded.push({ scope, note: e.note, at: e.at, ...(title !== undefined ? { title } : {}) });
      }
    }
    const start = record.start ?? [];
    const reads = record.reads ?? [];
    const context: TaskContext = {
      task: record.id,
      scope: record.scope,
      scoped: this.d.scoped(),
      start,
      ...(record.startTokens !== undefined ? { startTokens: record.startTokens } : {}),
      reads,
      compacted: start.some((i) => i.compacted) || reads.some((r) => r.compacted),
      pins: await pinsOf(base, scopes, budget),
      excluded,
      budget,
    };
    return { ok: true, context };
  }

  /** What a new task in `scope` gets from the person (the task manager's `personContext`). */
  async personContext(scope: string): Promise<PersonContext> {
    const base = await this.d.base();
    if (!base) return { pinned: "", items: [], excluded: new Set() };
    return pinnedContext(base, this.scopesFor(scope), await this.d.budget());
  }

  /** A text file in the folder (never the app's files, `.git` or a reference folder) joins `scope`'s pins. */
  pin(scope: unknown, rel: unknown): Promise<ContextResult> {
    return this.write(scope, async (base, s) => {
      const check = await checkPinPath(base, rel, { text: true });
      if (!check.ok) return no(check.reason);
      const file = await loadContext(base, s);
      if (file.pinned.some((p) => p.path === rel)) return null;
      if (file.pinned.length >= PINS_MAX) return no("full");
      file.pinned.push({ path: rel as string, at: new Date().toISOString() });
      return { file, message: `pinned ${rel as string}` };
    });
  }

  /** Any pin the file holds may go (nothing is read), even one a hand edit left with an odd name. */
  unpin(scope: unknown, rel: unknown): Promise<ContextResult> {
    return this.write(scope, async (base, s) => {
      if (refusedShape(rel)) return no("outside");
      const file = await loadContext(base, s);
      const kept = file.pinned.filter((p) => p.path !== rel);
      if (kept.length === file.pinned.length) return null;
      return { file: { ...file, pinned: kept }, message: `unpinned ${shown(rel as string)}` };
    });
  }

  exclude(scope: unknown, note: unknown): Promise<ContextResult> {
    return this.write(scope, async (base, s) => {
      if (!this.isNoteOf(s, note)) return no("not-a-note");
      if (!addablePath(note)) return no("bad-name");
      const file = await loadContext(base, s);
      if (file.excluded.some((e) => e.note === note)) return null;
      if (file.excluded.length >= EXCLUDED_MAX) return no("full");
      file.excluded.push({ note, at: new Date().toISOString() });
      return { file, message: `excluded ${note}` };
    });
  }

  include(scope: unknown, note: unknown): Promise<ContextResult> {
    return this.write(scope, async (base, s) => {
      if (!this.isNoteOf(s, note)) return no("not-a-note");
      const file = await loadContext(base, s);
      const kept = file.excluded.filter((e) => e.note !== note);
      if (kept.length === file.excluded.length) return null;
      return { file: { ...file, excluded: kept }, message: `included ${shown(note)}` };
    });
  }

  /**
   * The system dialog at the folder; the picked file comes back as a folder path, checked like an "Add now". One dialog
   * at a time: a pick while one is open is refused (`busy`).
   */
  pick(): Promise<ContextPick> {
    if (this.picking) return Promise.resolve(no("busy"));
    const picking = this.pickNow().finally(() => {
      this.picking = null;
    });
    this.picking = picking;
    return picking;
  }

  private async pickNow(): Promise<ContextPick> {
    const base = await this.d.base();
    if (!base) return no("not-ready");
    const abs = await this.d.pickFile(base);
    if (abs === null) return { ok: false, reason: "cancelled" };
    // The dialog may answer with the folder's real path (`/private/var/…` for `/var/…`).
    const real = await fs.realpath(base).catch(() => base);
    const rel = folderPath(base, abs) ?? folderPath(real, abs);
    if (rel === null) return no("outside");
    const check = await checkPinPath(base, rel, { text: false });
    return check.ok ? { ok: true, path: rel } : no(check.reason);
  }

  /**
   * "Add now" (§4.1): any file inside the folder (an image or a PDF too: the agent may read it), checked here like a
   * pin but for binary; only then the task manager, which checks only that the path fits the prompt.
   */
  async add(taskId: unknown, rel: unknown): Promise<ContextResult> {
    if (typeof taskId !== "string") return no("no-task");
    const base = await this.d.base();
    if (!base) return no("not-ready");
    const check = await checkPinPath(base, rel, { text: false });
    if (!check.ok) return no(check.reason);
    // The task manager refuses by rejecting only when the operation can't run: while the app closes (or turns are
    // held), that is the person's "busy", not a failure.
    return this.d.add(taskId, rel as string).catch((err: unknown) => {
      if (this.d.blocked()) return no("busy");
      throw err;
    });
  }

  /** A note directly in `scope`'s notes folder: `<prefix><slug>.md`, nothing deeper. */
  private isNoteOf(scope: string, note: unknown): note is string {
    if (refusedShape(note)) return false;
    const prefix = notesPrefix(this.d.scoped(), scope);
    const n = note as string;
    if (!n.startsWith(prefix) || !n.endsWith(".md")) return false;
    const name = n.slice(prefix.length);
    return name.length > 3 && !name.includes("/");
  }

  /**
   * One write: the scope checked, turns not held, then `change` (null: nothing to do, still `ok`), the file saved, one
   * commit, the panel told. Serial: a write starts once the one before it ended, whatever its scope.
   */
  private write(scope: unknown, change: (base: string, scope: string) => Promise<Change>): Promise<ContextResult> {
    const run = async (): Promise<ContextResult> => {
      if (!(await this.scopeOk(scope))) return no("unknown-scope");
      const s = scope as string;
      if (this.d.blocked()) return no("busy");
      const base = await this.d.base();
      if (!base) return no("not-ready");
      const result = await change(base, s);
      if (result === null) return { ok: true };
      if ("ok" in result) return result;
      const trailer = await this.d.trailer();
      const history = await this.d.history();
      await saveContext(base, s, result.file);
      try {
        await history?.save(`${CONTEXT_CHANGE_PREFIX}${result.message}`, trailer);
      } catch (err) {
        console.error("Could not record the context change in the history", err);
      }
      const open = await this.d.openTask().catch(() => null);
      if (open) this.d.changed(open);
      return { ok: true };
    };
    const next = this.writes.then(run, run);
    this.writes = next.catch(() => undefined);
    return next;
  }
}
