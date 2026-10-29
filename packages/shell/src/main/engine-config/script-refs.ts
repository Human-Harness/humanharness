import type { Stats } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

// Referenced scripts (hatches spec §5.3, threat model E2). A hook command or an MCP server's command may run a file
// in the person's folder or a linked folder (`node ./tools/x.js`); that file joins the scope's hash, or an agent could
// change it after approval and run code nobody approved.
//
// A denylist of shell forms can't be completed (comments, heredocs, reserved words, option values, programs that run
// code from their arguments or the folder's config…), so commands follow a strict allowlist grammar and anything else
// is refused:
// - a hook (shell text) is one simple command of plain words: no `; | & < > ( ) { } # ` ! \ * ? [ ~`, no new line, no
//   `$` but a leading `$CLAUDE_PROJECT_DIR` on a path word, no leading `VAR=`; a word may be wrapped whole in quotes;
// - its shape is `<interpreter> <script> [args…]` or `<script> [args…]`: the interpreter is node, python3, python,
//   bash or sh (any case), bare or in /usr/bin, /bin, /usr/local/bin, /opt/homebrew/bin, with no options; the script is
//   a regular file in the folder or a linked folder (hashed); an argument naming anything there must be a regular
//   file (hashed): a root, a folder, a link or a FIFO is refused;
// - a stdio server takes the same shape, or a remote package: `npx [-y] <npm name>[@version] [args…]` or
//   `uvx <PyPI name>[==version] [args…]`, refused when the package is local; only there may an argument be a root.

/** A command: a hook's shell text, or a server's program and arguments (run without a shell). */
export type ScriptCommand = string | readonly string[];

const FORM = "a hook or server must run a plain script file: <interpreter> <script> [args]";
const INTERPRETERS = new Set(["node", "python3", "python", "bash", "sh"]);
const INTERPRETER_DIRS = new Set(["/usr/bin", "/bin", "/usr/local/bin", "/opt/homebrew/bin"]);
const WORDS_MAX = 64;
const COMMAND_MAX = 4096;
/** Stands for the folder while a hook is split, so the folder's own characters are never read as shell. */
const FOLDER_MARK = "\u0000folder\u0000";
// A leading `$CLAUDE_PROJECT_DIR` (also `${…}`, or quoted whole) on a word, followed by `/`, a quote, a space or the end.
const PROJECT_DIR = /(^|[ \t])(?:"\$CLAUDE_PROJECT_DIR"|"\$\{CLAUDE_PROJECT_DIR\}"|(")?(?:\$\{CLAUDE_PROJECT_DIR\}|\$CLAUDE_PROJECT_DIR(?![A-Za-z0-9_])))(?=[/" \t]|$)/g;
/** Shell syntax a hook may not use: everything that runs, redirects, groups, expands or comments. */
const FORBIDDEN = /[;|&<>(){}#`!$\\*?[~\n\r\u0001-\u0008\u000b-\u001f\u007f]/;
const NPM_NAME = /^(@[a-z0-9][a-z0-9-._~]*\/)?[a-z0-9][a-z0-9-._~]*(@[A-Za-z0-9._^~-]+)?$/;
const PYPI_NAME = /^[A-Za-z0-9]([A-Za-z0-9._-]*[A-Za-z0-9])?(==[A-Za-z0-9._+!-]+)?$/;

/** What a word is to the command. `script`: the file it runs (must be a hashed regular file). `arg`: any argument. */
type Role = "script" | "arg" | "npm" | "pypi";
interface Parsed {
  words: string[];
  checks: { word: string; role: Role }[];
  /** A remote-package server: an argument may be a root (a filesystem server's folder). */
  remote: boolean;
}

const refuse = (why: string): never => {
  throw new Error(`${why}: ${FORM}`);
};

/** A hook's words: plain, or wrapped whole in single or double quotes. */
function hookWords(text: string, folder: string): string[] {
  if (text.length > COMMAND_MAX) refuse(`is over ${COMMAND_MAX / 1024} KB`);
  const marked = text.replace(PROJECT_DIR, (_m, lead: string, quote?: string) => `${lead}${quote ?? ""}${FOLDER_MARK}`);
  const bad = FORBIDDEN.exec(marked);
  if (bad) refuse(`uses ${JSON.stringify(bad[0])}`);
  const words: string[] = [];
  let i = 0;
  while (i < marked.length) {
    const ch = marked[i]!;
    if (ch === " " || ch === "\t") {
      i++;
      continue;
    }
    let word: string;
    if (ch === "'" || ch === '"') {
      const end = marked.indexOf(ch, i + 1);
      if (end < 0) refuse("leaves a quote open");
      word = marked.slice(i + 1, end);
      i = end + 1;
      // `"$CLAUDE_PROJECT_DIR"/tools/x.js`: the quoted folder, then the rest of the path.
      if (word === FOLDER_MARK && marked[i] === "/") {
        let j = i;
        while (j < marked.length && !" \t'\"".includes(marked[j]!)) j++;
        word += marked.slice(i, j);
        i = j;
      }
      if (i < marked.length && marked[i] !== " " && marked[i] !== "\t") refuse("joins a quoted word to another");
    } else {
      let j = i;
      while (j < marked.length && marked[j] !== " " && marked[j] !== "\t") j++;
      word = marked.slice(i, j);
      if (word.includes("'") || word.includes('"')) refuse("quotes part of a word");
      i = j;
    }
    words.push(word);
    if (words.length > WORDS_MAX) refuse(`has over ${WORDS_MAX} words`);
  }
  if (words.length === 0) refuse("is empty");
  // The marker only ever starts a word (PROJECT_DIR); anywhere else, refused.
  if (words.some((w) => w.lastIndexOf(FOLDER_MARK) > 0)) refuse("uses $CLAUDE_PROJECT_DIR inside a word");
  if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0]!)) refuse("sets a variable");
  return words.map((w) => w.split(FOLDER_MARK).join(folder));
}

/** The interpreter `word` names, lowercased, or null: a bare name, or an absolute path in a system folder. */
function interpreterOf(word: string): string | null {
  const name = path.basename(word).toLowerCase();
  if (!INTERPRETERS.has(name)) return null;
  if (!word.includes("/")) return name;
  return path.isAbsolute(word) && INTERPRETER_DIRS.has(path.dirname(word)) ? name : null;
}

/** The grammar: `<interpreter> <script> [args]`, `<script> [args]`, or (servers) a remote npx/uvx package. */
function parse(command: ScriptCommand, folder: string): Parsed {
  let words: string[];
  if (typeof command === "string") words = hookWords(command, folder);
  else {
    words = [...command];
    if (words.length === 0) refuse("is empty");
    if (words.length > WORDS_MAX) refuse(`has over ${WORDS_MAX} words`);
    if (words.reduce((n, w) => n + w.length, 0) > COMMAND_MAX) refuse(`is over ${COMMAND_MAX / 1024} KB`);
    if (words.some((w) => /[\u0000-\u001f\u007f]/.test(w))) refuse("uses a control character");
  }
  const out: Parsed = { words, checks: [], remote: false };
  const args = (from: number) => {
    for (const w of words.slice(from)) out.checks.push({ word: w, role: "arg" });
  };
  const first = words[0]!;
  const interpreter = interpreterOf(first);
  if (interpreter) {
    const script = words[1];
    if (script === undefined) refuse(`runs ${interpreter} without a script`);
    if (script!.startsWith("-")) refuse(`gives ${interpreter} an option (${script!.slice(0, 40)})`);
    out.checks.push({ word: script!, role: "script" });
    args(2);
    return out;
  }
  if (typeof command !== "string" && first === "npx") {
    const at = words[1] === "-y" || words[1] === "--yes" ? 2 : 1;
    const pkg = words[at];
    if (pkg === undefined || !NPM_NAME.test(pkg)) refuse(`runs npx with ${pkg === undefined ? "no package" : JSON.stringify(pkg.slice(0, 60))}, not a remote npm package`);
    out.remote = true;
    out.checks.push({ word: pkg!, role: "npm" });
    args(at + 1);
    return out;
  }
  if (typeof command !== "string" && first === "uvx") {
    const pkg = words[1];
    if (pkg === undefined || !PYPI_NAME.test(pkg)) refuse(`runs uvx with ${pkg === undefined ? "no package" : JSON.stringify(pkg.slice(0, 60))}, not a remote PyPI package`);
    out.remote = true;
    out.checks.push({ word: pkg!, role: "pypi" });
    args(2);
    return out;
  }
  // `<script> [args]`: the first word is the file it runs (a bare program name on PATH is no such file: refused below).
  out.checks.push({ word: first, role: "script" });
  args(1);
  return out;
}

/**
 * Every word `command` runs, `$CLAUDE_PROJECT_DIR` as `folder`. Throws naming the problem when the command doesn't
 * fit the grammar (see above): such a command is refused.
 */
export function commandWords(command: ScriptCommand, folder: string): string[] {
  return parse(command, folder).words;
}

// macOS file systems are usually case- and normalization-insensitive: compare without either (as clean.ts).
const norm = (p: string) => path.resolve(p).normalize("NFC").toLowerCase();
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

const exists = (p: string) => fs.lstat(p).then(() => true, () => false);

/** The places an argument may name: itself, a glued short flag's value (`-c./x`), every part between `=`. */
function candidates(word: string): string[] {
  const glued = /^-[^-]./.test(word) ? [word.slice(2)] : [];
  return [...new Set([word, ...glued, ...(word.includes("=") ? word.split("=") : [])])].filter((t) => t !== "");
}

type Root = { lex: string; real: string };

/** The folder and its linked folders, as given and with links resolved; one that is gone is left out. */
async function rootsOf(o: { folder: string; linked: readonly string[] }): Promise<Root[]> {
  const all = await Promise.all([o.folder, ...o.linked].map(async (r) => ({ lex: path.resolve(r), real: await realOrNull(r) })));
  return all.filter((r): r is Root => r.real !== null);
}

/**
 * What the existing entry `p` (lstat `st`) is to the hash: outside every root, a root itself, a regular file inside one
 * (hashed), or else why it can't be hashed (E2, E8): a link (the agent could retarget it after approval, or edit what
 * it points to), a folder (the code it loads is not named), a path through a link, a link from outside into a root.
 */
async function classify(p: string, st: Stats, roots: Root[]): Promise<"outside" | "root" | "file" | string> {
  const lexRoot = roots.find((r) => inside(p, r.lex));
  if (lexRoot && norm(p) === norm(lexRoot.lex)) return "root";
  const parent = await realOrNull(path.dirname(p));
  if (parent === null) return "outside";
  // The entry itself, its folders' links resolved but not its own.
  const entry = path.join(parent, path.basename(p));
  if (lexRoot && norm(entry) !== norm(path.join(lexRoot.real, path.relative(lexRoot.lex, p)))) return "is reached through a symbolic link";
  if (!lexRoot) {
    // Named from outside: a link (here or in a parent) that lands in a root is the agent's to retarget or edit.
    const full = (await realOrNull(p)) ?? entry;
    if (roots.some((r) => inside(full, r.real)) && (norm(full) !== norm(p) || st.isSymbolicLink())) return "is a link into the folder";
  }
  if (!roots.some((r) => inside(entry, r.real))) return "outside";
  if (roots.some((r) => norm(r.real) === norm(entry))) return "root";
  if (st.isSymbolicLink()) return "is a symbolic link";
  if (st.isDirectory()) return "is a folder";
  return st.isFile() ? "file" : "is not a regular file";
}

/** The folders npx searches from `folder` (it and each folder above it) and the linked roots. */
function searchDirs(folder: string, roots: Root[]): string[] {
  const dirs: string[] = [];
  for (let d = path.resolve(folder); ; d = path.dirname(d)) {
    dirs.push(d);
    if (path.dirname(d) === d) break;
  }
  return [...dirs, ...roots.flatMap((r) => [r.lex, r.real])];
}

/** An npm package installed where npx would find it first (`node_modules/.bin/<bin>`, `node_modules/<name>`). */
async function localPackage(spec: string, folder: string, roots: Root[]): Promise<string | null> {
  const at = spec.indexOf("@", 1);
  const name = at > 0 ? spec.slice(0, at) : spec;
  const bin = name.slice(name.lastIndexOf("/") + 1);
  for (const d of searchDirs(folder, roots)) {
    for (const p of [path.join(d, "node_modules", ".bin", bin), path.join(d, "node_modules", name)]) if (await exists(p)) return p;
  }
  return null;
}

/** A PyPI package that names a local module (`X.py`, `X/`) in the folder or a root (uvx puts the folder on sys.path). */
async function localModule(spec: string, folder: string, roots: Root[]): Promise<string | null> {
  const name = spec.split("==")[0]!;
  for (const d of [path.resolve(folder), ...roots.flatMap((r) => [r.lex, r.real])]) {
    for (const n of new Set([name, name.replace(/[-.]/g, "_")])) {
      for (const p of [path.join(d, `${n}.py`), path.join(d, n)]) if (await exists(p)) return p;
    }
  }
  return null;
}

/** A word that names something the hash can't cover: the path, why, and the command that names it. */
export interface ScriptIssue {
  path: string;
  why: string;
  command: string;
}

/**
 * What `commands` run from `folder` and its linked folders: `files`, the regular files they name (hashed), absolute,
 * sorted; `issues`, what can't be hashed: a script that is not a regular file in a root, an argument naming a root, a
 * folder, a link or a FIFO there (a root passes only for a remote-package server), a remote package that is local.
 * Relative paths are taken from `folder`, the engine's working folder. Throws as `commandWords` does: check each
 * command with it first.
 */
export async function scanScripts(
  commands: ReadonlyArray<ScriptCommand>,
  o: { folder: string; linked: readonly string[] },
): Promise<{ files: string[]; issues: ScriptIssue[] }> {
  const roots = await rootsOf(o);
  const files = new Set<string>();
  const issues = new Map<string, ScriptIssue>();
  for (const command of commands) {
    const shown = typeof command === "string" ? command : command.join(" ");
    const issue = (p: string, why: string) => {
      if (!issues.has(p)) issues.set(p, { path: p, why, command: shown.length > 120 ? `${shown.slice(0, 120)}…` : shown });
    };
    const parsed = parse(command, o.folder);
    for (const { word, role } of parsed.checks) {
      if (role === "npm" || role === "pypi") {
        const local = await (role === "npm" ? localPackage(word, o.folder, roots) : localModule(word, o.folder, roots));
        if (local) issue(local, "is a local package: the server would run the folder's own copy, which the approval doesn't cover");
        continue;
      }
      if (role === "script") {
        const p = path.resolve(o.folder, word);
        const st = await fs.lstat(p).catch(() => null);
        const kind = st ? await classify(p, st, roots) : "missing";
        if (kind === "file") files.add(p);
        else issue(p, kind === "missing" || kind === "outside" ? "is not a script file in the folder or a linked folder" : kind === "root" ? "is a folder" : kind);
        continue;
      }
      for (const t of candidates(word)) {
        const p = path.resolve(o.folder, t);
        const st = await fs.lstat(p).catch(() => null);
        if (!st) continue;
        const kind = await classify(p, st, roots);
        if (kind === "file") files.add(p);
        else if (kind === "outside") continue;
        else if (kind === "root") {
          if (!parsed.remote) issue(p, "is a folder");
        } else issue(p, kind);
      }
    }
  }
  for (const p of issues.keys()) files.delete(p);
  return { files: [...files].sort(), issues: [...issues.values()].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)) };
}

/**
 * The paths `commands` name that join the hash or are refused (`scanScripts`'s files and issues), sorted and unique:
 * what a pin's check and a snapshot's load compare with the approved list, so a path refused now never matches.
 */
export async function scriptRefs(commands: ReadonlyArray<ScriptCommand>, o: { folder: string; linked: readonly string[] }): Promise<string[]> {
  const { files, issues } = await scanScripts(commands, o);
  return [...new Set([...files, ...issues.map((i) => i.path)])].sort();
}
