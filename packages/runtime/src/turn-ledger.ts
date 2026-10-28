import fs from "node:fs";
import path from "node:path";
import { type DirtyState, isCanonicalPath } from "@humanharness/workspace";

/** One running turn's window (parallel spec §5.2). */
export interface TurnWindow {
  readonly key: string;
  /** The task the turn belongs to (its trailer's `task`), when it has one. */
  readonly task: string | undefined;
  /** No other turn ran when it opened: it takes today's `Before message` snapshot (Decision 2). */
  readonly alone: boolean;
  /** Another turn existed at some moment of this one. */
  overlapped: boolean;
  /** The snapshot it starts from: its `Before message` commit, or the queue head. */
  before: string | null;
  /** Opened beside another turn: the dirty paths then. Null for a window that was alone (its snapshot covers them). */
  startDirty: DirtyState | null;
  /** Folder-relative paths its edit events named, in Unicode NFC (`samePath`). */
  readonly edits: Set<string>;
}

/**
 * The one spelling two names of the same file share before they are compared: macOS may name a file NFD while an
 * engine reports it NFC (or the reverse).
 */
export const samePath = (p: string): string => p.normalize("NFC");

/**
 * At most this many paths in one window's `edits`: past it, a turn records no more. A path no turn named counts as
 * shared (spec §5.2), so a turn over the cap only shares more, never owns another's path.
 */
export const MAX_EDITS = 10_000;

/** The turns running in one folder now (parallel spec §5.2). Opening and closing are synchronous: no await between check and mark. */
export class TurnLedger {
  private readonly open_ = new Map<string, TurnWindow>();

  /**
   * `roots`: the folder as given first, then its real path. Engines report either (spike PT-S1/PT-S3: Claude names the
   * real path, `/private/var/…` for `/var/…`; Codex the folder as given), so an edit path inside any root counts.
   */
  constructor(private readonly roots: readonly string[]) {}

  /** A ledger for `folder`, accepting both the given and the real form of its paths. */
  static forFolder(folder: string): TurnLedger {
    const given = path.resolve(folder);
    const real = fs.realpathSync(given);
    return new TurnLedger(real === given ? [given] : [given, real]);
  }

  /** Opens `key`'s window; every window already open is now overlapped, and so is the new one when any was. */
  open(key: string, task?: string): TurnWindow {
    if (this.open_.has(key)) throw new Error(`A turn is already open for ${key}`);
    const alone = this.open_.size === 0;
    for (const w of this.open_.values()) w.overlapped = true;
    const w: TurnWindow = { key, task, alone, overlapped: !alone, before: null, startDirty: null, edits: new Set() };
    this.open_.set(key, w);
    return w;
  }

  /** Closes `key`'s window; returns the windows still running (they may own or share its paths). */
  close(key: string): TurnWindow[] {
    this.open_.delete(key);
    return [...this.open_.values()];
  }

  anyRunning(): boolean {
    return this.open_.size > 0;
  }

  running(): TurnWindow[] {
    return [...this.open_.values()];
  }

  /**
   * Records the paths an edit event of `key`'s turn named, as canonical folder-relative paths. Only paths inside the
   * folder (by any of its roots) count; the folder itself, `..` escapes, absolute outsiders and any name git couldn't
   * track by that spelling are dropped (T3). A key with no open window is ignored; past `MAX_EDITS` paths, so is the rest.
   */
  noteEdits(key: string, paths: readonly string[]): void {
    const w = this.open_.get(key);
    if (!w) return;
    for (const p of paths) {
      if (w.edits.size >= MAX_EDITS) return;
      const rel = this.relative(p);
      if (rel !== null) w.edits.add(rel);
    }
  }

  private relative(p: string): string | null {
    // A relative path resolves against the folder as given (the first root). Both sides in NFC: a folder named NFD
    // and an engine reporting NFC (or the reverse) still match.
    const name = samePath(p);
    for (const given of this.roots) {
      const root = samePath(given);
      const rel = path.relative(root, path.resolve(root, name));
      if (rel === "" || rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) continue;
      const posix = rel.split(path.sep).join("/");
      return isCanonicalPath(posix) ? posix : null;
    }
    return null;
  }
}
