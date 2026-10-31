import ignore, { type Ignore } from "ignore";

/**
 * The `.gitignore` files of one root (the root's and nested ones; never the global one), checked from the root down.
 * Any file that ignores a path wins: a `!pattern` re-includes only within its own file (plan deviation 16).
 */
export class GitIgnore {
  private readonly rules: { dir: string; ig: Ignore }[] = [];

  /** `dir`: the folder holding the file, relative to the root ("" for the root). */
  add(dir: string, text: string): void {
    this.rules.push({ dir, ig: ignore().add(text) });
  }

  get empty(): boolean {
    return this.rules.length === 0;
  }

  ignored(rel: string, isDir: boolean): boolean {
    for (const r of this.rules) {
      if (r.dir !== "" && !rel.startsWith(`${r.dir}/`)) continue;
      const sub = r.dir === "" ? rel : rel.slice(r.dir.length + 1);
      if (r.ig.ignores(isDir ? `${sub}/` : sub)) return true;
    }
    return false;
  }
}
