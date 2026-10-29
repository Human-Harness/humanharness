import type { Stats } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

// Referenced scripts (hatches spec §5.3, threat model E2). A hook command or an MCP server's command or argument may
// name a file in the person's folder or a linked folder (`node ./tools/x.js`); that file joins the scope's hash, or an
// agent could change it after approval and run code nobody approved. Only regular files are hashed. A path-like word
// naming a symlink, a folder or a path through a link inside a root is refused by the reader (it could be retargeted
// or filled after approval); a path outside the roots, or one that does not exist yet, is not a script.
//
// A hook command is shell text, so the words it runs can hide behind shell features. `sh -c "…"` (and bash, zsh,
// dash) is read again as a command; `$CLAUDE_PROJECT_DIR` is the folder. Anything whose paths can't be placed for
// sure is refused instead: any other `$`, a backquote, a glob (`*`, `?`, `[`) or a change of folder (`cd`).

/** Splits a command like a shell would for words: quotes, backslashes, and `;|&<>()` as separators. */
function commandTokens(command: string): string[] {
  const tokens: string[] = [];
  let cur = "";
  let started = false;
  let quote: '"' | "'" | null = null;
  const end = () => {
    if (started) tokens.push(cur);
    cur = "";
    started = false;
  };
  for (let i = 0; i < command.length; i++) {
    const ch = command[i]!;
    if (quote === "'") {
      if (ch === "'") quote = null;
      else cur += ch;
    } else if (quote === '"') {
      if (ch === '"') quote = null;
      else if (ch === "\\" && i + 1 < command.length && '"\\$`'.includes(command[i + 1]!)) cur += command[++i];
      else cur += ch;
    } else if (ch === "'" || ch === '"') {
      quote = ch;
      started = true;
    } else if (ch === "\\" && i + 1 < command.length) {
      cur += command[++i];
      started = true;
    } else if (/\s/.test(ch) || ";|&<>()".includes(ch)) end();
    else {
      cur += ch;
      started = true;
    }
  }
  end();
  return tokens;
}

// macOS file systems are usually case-insensitive: compare without case to stay on the safe side (as clean.ts).
const norm = (p: string) => path.resolve(p).toLowerCase();
const inside = (child: string, parent: string) => {
  const c = norm(child);
  const p = norm(parent);
  return c === p || c.startsWith(p.endsWith(path.sep) ? p : p + path.sep);
};

async function realOrNull(p: string): Promise<string | null> {
  try {
    return await fs.realpath(p);
  } catch {
    return null;
  }
}

/** A command: a hook's shell text, or a server's program and arguments (run without a shell). */
export type ScriptCommand = string | readonly string[];

const SHELLS = new Set(["sh", "bash", "zsh", "dash"]);
const FOLDER_CHANGES = new Set(["cd", "pushd", "popd"]);
const PROJECT_DIR = /\$\{CLAUDE_PROJECT_DIR\}|\$CLAUDE_PROJECT_DIR(?![A-Za-z0-9_])/g;
/** Stands for the folder while a command is split, so the folder's own characters are never read as shell. */
const FOLDER_MARK = "\u0000folder\u0000";
const MAX_NESTING = 3;

/** The scripts a shell runs with `-c` (`sh -c "…"`, `bash -lc '…'`) among `words`. */
function shellScripts(words: readonly string[]): string[] {
  const scripts: string[] = [];
  for (let i = 0; i < words.length; i++) {
    if (!SHELLS.has(path.basename(words[i]!))) continue;
    let j = i + 1;
    let withC = false;
    for (; j < words.length && words[j]!.startsWith("-") && words[j] !== "-" && words[j] !== "--"; j++) {
      if (!words[j]!.startsWith("--") && words[j]!.includes("c")) withC = true;
    }
    if (words[j] === "--") j++;
    if (withC && j < words.length) scripts.push(words[j]!);
  }
  return scripts;
}

function shellWords(text: string, folder: string, depth: number): string[] {
  if (depth > MAX_NESTING) throw new Error("nests shells too deep");
  if (text.includes("`")) throw new Error("uses a backquote, so its paths can't be checked");
  const marked = text.replace(PROJECT_DIR, FOLDER_MARK);
  if (marked.includes("$")) throw new Error("uses $ (only $CLAUDE_PROJECT_DIR is understood), so its paths can't be checked");
  if (/[*?[]/.test(marked)) throw new Error("uses a glob (* ? [), so its paths can't be checked");
  const words = commandTokens(marked).map((w) => w.split(FOLDER_MARK).join(folder));
  return withShellScripts(words, folder, depth);
}

function withShellScripts(words: string[], folder: string, depth: number): string[] {
  const all = [...words];
  for (const script of shellScripts(words)) all.push(...shellWords(script, folder, depth + 1));
  const change = all.find((w) => FOLDER_CHANGES.has(w));
  if (change) throw new Error(`changes folder (${change}), so its paths can't be placed`);
  return all;
}

/**
 * Every word `command` runs, with `sh -c` scripts read again and `$CLAUDE_PROJECT_DIR` as `folder`. Throws naming the
 * problem when its paths can't be placed for sure (another `$`, a backquote, a glob, `cd`): such a command is refused.
 * A server's arguments are taken as they are (no shell reads them), except a shell's `-c` script.
 */
export function commandWords(command: ScriptCommand, folder: string): string[] {
  return typeof command === "string" ? shellWords(command, folder, 0) : withShellScripts([...command], folder, 0);
}

/** The places a token may name: itself, and a flag's value after `=` (`--config=./a.json`). */
function candidates(token: string): string[] {
  const out = [token];
  const eq = token.indexOf("=");
  if (eq > 0) out.push(token.slice(eq + 1));
  return out.filter((t) => t !== "" && !t.startsWith("~"));
}

type Root = { lex: string; real: string };

/** The folder and its linked folders, as given and with links resolved; one that is gone is left out. */
async function rootsOf(o: { folder: string; linked: readonly string[] }): Promise<Root[]> {
  const all = await Promise.all([o.folder, ...o.linked].map(async (r) => ({ lex: path.resolve(r), real: await realOrNull(r) })));
  return all.filter((r): r is Root => r.real !== null);
}

/**
 * What the existing entry `p` (lstat `st`) is to the hash: outside every root, a root itself (data, never a script),
 * a regular file inside one (hashed), or else why it can't be hashed (E2, E8): a link (the agent could retarget it
 * after approval, or edit what it points to), a folder (the code it loads is not named), a path through a link.
 */
async function classify(p: string, st: Stats, roots: Root[]): Promise<"outside" | "root" | "file" | string> {
  const lexRoot = roots.find((r) => inside(p, r.lex));
  if (lexRoot && norm(p) === norm(lexRoot.lex)) return "root";
  const parent = await realOrNull(path.dirname(p));
  if (parent === null) return "outside";
  // The entry itself, its folders' links resolved but not its own.
  const entry = path.join(parent, path.basename(p));
  if (lexRoot && norm(entry) !== norm(path.join(lexRoot.real, path.relative(lexRoot.lex, p)))) return "is reached through a symbolic link";
  if (!roots.some((r) => inside(entry, r.real))) return "outside";
  if (roots.some((r) => norm(r.real) === norm(entry))) return "root";
  if (st.isSymbolicLink()) return "is a symbolic link";
  if (st.isDirectory()) return "is a folder";
  return st.isFile() ? "file" : "is not a regular file";
}

/** A token that reads as a path (`./x`, `a/b`, `/x`, `..`): only those name a link or a folder to refuse. */
const pathLike = (t: string) => t.startsWith(".") || t.includes("/") || t.includes(path.sep);

/**
 * The files `commands` name inside `folder` or a linked folder, absolute, sorted and unique. A string is a hook command
 * (split into words); a list is a server's command and arguments, already words. Relative paths are taken from
 * `folder`, the engine's working folder. A path-like word naming an entry inside that is not a plain regular file (a
 * link, a folder, a path through a link) is listed too, so the reader refuses it (`scriptProblem`) and a pin's check
 * fails. Throws as `commandWords` does: check each command with it first.
 */
export async function scriptRefs(
  commands: ReadonlyArray<ScriptCommand>,
  o: { folder: string; linked: readonly string[] },
): Promise<string[]> {
  const roots = await rootsOf(o);
  const found = new Set<string>();
  const seen = new Set<string>();
  for (const command of commands) {
    const words = commandWords(command, o.folder);
    for (const word of words) {
      for (const t of candidates(word)) {
        const p = path.isAbsolute(t) ? path.resolve(t) : path.resolve(o.folder, t);
        if (seen.has(p)) continue;
        seen.add(p);
        let st;
        try {
          st = await fs.lstat(p);
        } catch {
          continue;
        }
        const kind = await classify(p, st, roots);
        if (kind === "file" || (kind !== "outside" && kind !== "root" && pathLike(t))) found.add(p);
      }
    }
  }
  return [...found].sort();
}

/** Why `p` (one of `scriptRefs`'s) can't be hashed as a script, or null when it is a regular file it may hash. */
export async function scriptProblem(p: string, o: { folder: string; linked: readonly string[] }): Promise<string | null> {
  const st = await fs.lstat(p).catch(() => null);
  if (!st) return null;
  const kind = await classify(p, st, await rootsOf(o));
  return kind === "file" || kind === "outside" || kind === "root" ? null : kind;
}
