import { realpath } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import type { LinkedFolderDecl } from "@humanharness/harness-sdk";
import type { TurnScope } from "@humanharness/runtime";
import { type LinkedFolderEntry, type LinkedFolderLine, type ScopeEntry, type ScopeStore, isScopeId, linkedFolderLines } from "@humanharness/workspace";
import { checkLink, isGitRepo } from "./linked-folders";
import { type LinkSigning, linkChecker } from "./linked-ipc";

/** realpath(3): the case on disk on macOS, the spelling a link is stored with. */
const realpathNative = promisify(realpath.native);

/** The entries of `scope` whose key the manifest still declares, with today's mode and label. */
function current(entries: ScopeEntry[], scope: string | null, decl: Record<string, LinkedFolderDecl>): (LinkedFolderEntry & { label: string })[] {
  if (scope === null || !isScopeId(scope)) return [];
  const s = entries.find((e) => e.id === scope && !e.archived);
  return (s?.linked ?? [])
    .filter((l) => Object.hasOwn(decl, l.key))
    .map((l) => ({ ...l, mode: decl[l.key].mode, label: decl[l.key].label }));
}

/**
 * What a turn of a task in `scope` reaches (L5), from entries already checked (`ScopeAccess.usable`): undefined when
 * nothing, so the turn's options are today's (D0). A read folder is never tracked (Decision 2), whatever was stored.
 */
export function scopeAccessFor(entries: ScopeEntry[], scope: string, decl: Record<string, LinkedFolderDecl>): TurnScope | undefined {
  const linked = current(entries, scope, decl).map((l) => ({ path: l.path, mode: l.mode, tracked: l.mode === "write" && l.tracked }));
  return linked.length > 0 ? { linked } : undefined;
}

/** The managed section's "Folders of this scope" lines for `scope` (none for no scope). */
export function linkedLines(entries: ScopeEntry[], scope: string | null, decl: Record<string, LinkedFolderDecl>): LinkedFolderLine[] {
  return current(entries, scope, decl).map((l) => ({ key: l.key, label: l.label, path: l.path, mode: l.mode }));
}

/** Board mode's first-message section (Decision 6): the same text the managed section would show; "" for none. */
export function linkedSection(lines: LinkedFolderLine[]): string {
  return lines.length > 0 ? linkedFolderLines(lines).join("\n") : "";
}

/**
 * Marks the signed write links of `scope` whose git state no longer matches `tracked` (Decision 13): the person
 * confirms in Scope settings. One already marked is left alone; a read link is never tracked, so never checked. Only
 * the links `signed` keeps are looked at: a hand-written path is never read (L8). True when one was marked.
 */
export async function checkGitChanges(
  store: Pick<ScopeStore, "list" | "markGitChanged">,
  scope: string,
  isGit: (dir: string) => Promise<boolean>,
  signed: (s: ScopeEntry) => LinkedFolderEntry[],
): Promise<boolean> {
  const s = (await store.list()).find((e) => e.id === scope && !e.archived);
  if (!s?.linked?.length) return false;
  let marked = false;
  for (const l of signed(s)) {
    if (l.mode !== "write" || l.gitChanged) continue;
    if ((await isGit(l.path)) === l.tracked) {
      await store.markGitChanged(scope, l.key, l.path);
      marked = true;
    }
  }
  return marked;
}

export interface ScopeAccessDeps {
  /** The manifest's declarations (keys looked up with Object.hasOwn only). */
  linkedFolders: Record<string, LinkedFolderDecl>;
  /** The open base's scope registry. */
  store(): Promise<ScopeStore>;
  /** The open base's profile id; "" without profiles. */
  profile(): Promise<string>;
  /** Every other profile's registry, by id; [] without profiles. */
  otherStores(): Promise<{ profile: string; store: ScopeStore }[]>;
  /** Home, the base and, with profiles, the app's folder. */
  context(): Promise<{ home: string; folder: string; root?: string }>;
  /** The reference folders the agent gets. */
  references(): Promise<string[]>;
  /** The tag key and live set (`linkedSigning(userData)`, the IPC's own). */
  signing: LinkSigning;
  /** Where a dropped link is said, once. Default: console.error. */
  log?(message: string): void;
}

// As the picker's (linked-ipc.ts): without case, on the safe side.
const insideOf = (child: string, parent: string) => {
  const c = path.resolve(child).toLowerCase();
  const p = path.resolve(parent).toLowerCase();
  return c === p || c.startsWith(p.endsWith(path.sep) ? p : p + path.sep);
};

export type ScopeAccess = ReturnType<typeof createScopeAccess>;

/**
 * A scope's linked folders as a turn, AGENTS.md or a first message may use them, read afresh each time. A stored link
 * counts only when the app signed it for this profile and scope and its nonce is live (L1), it still resolves to the
 * very path stored (a folder later swapped for a link, or gone, is dropped), and the picker's refusals still pass it
 * with today's context (L2: home, the folder, the app's folder, references, the other scopes' and profiles' write
 * folders). A dropped link is said once in the log and never fails the turn: the turn runs without it.
 */
export function createScopeAccess(d: ScopeAccessDeps) {
  const decl = d.linkedFolders;
  const told = new Set<string>();
  const drop = (profile: string, scope: string, l: LinkedFolderEntry, why: string) => {
    const id = JSON.stringify([profile, scope, l.key, l.path, why]);
    if (told.has(id)) return;
    told.add(id);
    (d.log ?? console.error)(`A linked folder of scope ${scope} is left out (${why}): ${l.path}`);
  };

  /** The registry with only `scope`'s entry, its links cut to the usable ones. [] when it has none. */
  async function usable(scope: string | null): Promise<ScopeEntry[]> {
    if (scope === null || !isScopeId(scope)) return [];
    const store = await d.store();
    const all = await store.list();
    const s = all.find((e) => e.id === scope && !e.archived);
    // No link stored: nothing else is read, not even the key (a harness's scope without links runs as today).
    if (!s?.linked?.length) return [];
    const profile = await d.profile();
    const signed = await linkChecker(d.signing);
    const mine = signed(s, profile).filter((l) => Object.hasOwn(decl, l.key));
    if (mine.length === 0) return [];
    const others = await Promise.all((await d.otherStores()).map(async (o) => ({ profile: o.profile, list: await o.store.list().catch(() => [] as ScopeEntry[]) })));
    const otherScopesWrite = [
      ...all.filter((e) => e.id !== s.id).flatMap((e) => signed(e, profile)),
      ...others.flatMap((o) => o.list.flatMap((e) => signed(e, o.profile))),
    ]
      .filter((l) => l.mode === "write")
      .map((l) => l.path);
    const ctx = await d.context();
    const refs = await Promise.all((await d.references()).map((r) => realpathNative(r).catch(() => r)));
    const kept: LinkedFolderEntry[] = [];
    for (const [i, l] of mine.entries()) {
      const mode = decl[l.key].mode;
      const checked = await checkLink(l.path, {
        ...ctx,
        sameScope: mine.filter((_, j) => j !== i).map((x) => x.path),
        otherScopesWrite,
        mode,
        // A folder that gained or lost git waits for the person (Decision 13): not a reason to drop it here.
        history: "auto",
      }).catch(() => ({ refused: "not-folder" as const }));
      if ("refused" in checked) {
        drop(profile, scope, l, checked.refused);
        continue;
      }
      // Still the very folder linked: the real path (the case on disk) equals the stored one.
      const real = await realpathNative(l.path).catch(() => null);
      if (real !== l.path) {
        drop(profile, scope, l, "moved");
        continue;
      }
      // A reference's read-only rules would win over a write link's (a reference added since).
      if (mode === "write" && refs.some((r) => insideOf(real, r))) {
        drop(profile, scope, l, "reference");
        continue;
      }
      kept.push(l);
    }
    return kept.length > 0 ? [{ ...s, linked: kept }] : [];
  }

  return {
    /** The turn's `TurnScope` for a task in `scope` (L5: the task's own scope, never the open one); undefined: none. */
    access: async (scope: string): Promise<TurnScope | undefined> => scopeAccessFor(await usable(scope), scope, decl),
    /** AGENTS.md's lines for `scope` (the open one), or none. */
    lines: async (scope: string | null): Promise<LinkedFolderLine[]> => linkedLines(await usable(scope), scope, decl),
    /** Board mode's first-message section for a task in `scope`; "" for none. */
    section: async (scope: string): Promise<string> => linkedSection(linkedLines(await usable(scope), scope, decl)),
    /** The registry with only `scope`'s entry, its links cut to the usable ones (undo, the History panel). */
    entries: (scope: string | null): Promise<ScopeEntry[]> => usable(scope),
    /** Decision 13's check, when the scope opens and when Scope settings opens: its signed links only. */
    checkGit: async (scope: string): Promise<boolean> => {
      if (!isScopeId(scope)) return false;
      const store = await d.store();
      const s = (await store.list()).find((e) => e.id === scope);
      if (!s?.linked?.length) return false;
      const profile = await d.profile();
      const signed = await linkChecker(d.signing);
      return checkGitChanges(store, scope, isGitRepo, (e) => signed(e, profile));
    },
  };
}

/**
 * `refresh` for `LinkedInstructions`: the runtime's `refreshInstructions` answers false both when the text was already
 * right and when a running turn refused it; `busy` tells them apart (a turn that refused the write is still running).
 */
export async function refreshUnlessBusy(refresh: () => Promise<boolean>, busy: () => boolean): Promise<boolean> {
  const wrote = await refresh();
  if (!wrote && busy()) throw new Error("A turn is running: AGENTS.md waits for a gap");
  return wrote;
}

/**
 * AGENTS.md's "Folders of this scope" between tasks (as the settings', harness-settings D4): a link change or a scope
 * switch marks it stale, it is rewritten once no task is open, and `betweenTasks` retries whatever a running turn
 * refused. Nothing is lost while a turn runs. Never rejects.
 */
export class LinkedInstructions {
  private stale = false;
  /** The scope the AGENTS.md now on disk lists (undefined: not written by this process yet). */
  private written: string | null | undefined = undefined;
  /** While a refresh runs: the scope it read, written only once the refresh ended without a refusal. */
  private reading: { scope: string | null | undefined } | null = null;

  constructor(
    private readonly d: {
      whenNoTask(fn: () => Promise<void>): Promise<boolean>;
      /**
       * The runtime's (or board's) refresh, peek only: true when it wrote, false when the text was already right; throws
       * when a running turn refused it (never false then: the change would be taken as written).
       */
      refresh(): Promise<boolean>;
      /** The open scope now. */
      openScope(): Promise<string | null>;
      log?(message: string, err?: unknown): void;
    },
  ) {}

  /**
   * The runtime read the lines for `scope`. At create that is what AGENTS.md lists; during a refresh, only once the
   * refresh ended without a refusal (a turn that started meanwhile keeps the old text, and the switch stays to do).
   */
  read(scope: string | null): void {
    if (this.reading) this.reading.scope = scope;
    else this.written = scope;
  }

  /** A link changed or the scope opened: rewritten once no task is open, else between tasks. */
  async changed(): Promise<void> {
    this.stale = true;
    await this.d.whenNoTask(() => this.apply()).catch((err: unknown) => this.log("Could not rewrite AGENTS.md's linked folders", err));
  }

  /** TaskManager's `betweenTasks`: a stale change, or an open scope other than the one listed, is written now. */
  async betweenTasks(): Promise<void> {
    if (!this.stale) {
      const open = await this.d.openScope().catch(() => this.written);
      if (this.written === undefined || open === this.written) return;
      this.stale = true;
    }
    await this.apply();
  }

  private async apply(): Promise<void> {
    if (!this.stale) return;
    this.stale = false;
    const reading: { scope: string | null | undefined } = { scope: undefined };
    this.reading = reading;
    try {
      await this.d.refresh();
      if (reading.scope !== undefined) this.written = reading.scope;
    } catch (err) {
      this.stale = true;
      this.log("Could not rewrite AGENTS.md's linked folders", err);
    } finally {
      if (this.reading === reading) this.reading = null;
    }
  }

  private log(message: string, err?: unknown): void {
    (this.d.log ?? console.error)(message, err);
  }
}
