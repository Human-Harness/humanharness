import type { Stats } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { USER_NPMRC } from "../user-npmrc";

// Referenced scripts (hatches spec §5.3, threat model E2). A hook command or an MCP server's command may run a file
// in the person's folder or a linked folder (`node ./tools/x.js`); that file joins the scope's hash, or an agent could
// change it after approval and run code nobody approved.
//
// A denylist of shell forms can't be completed (comments, heredocs, reserved words, option values, programs that run
// code from their arguments or the folder's config…), so commands follow a strict allowlist grammar and anything else
// is refused:
// - a hook (shell text) is one simple command of plain words: no `; | & < > ( ) { } # ` ! \ * ? [ ~`, no control
//   character, no `$` but `"$CLAUDE_PROJECT_DIR"/…` (quoted, so sh neither splits nor globs it) starting a word, no
//   leading `VAR=`; a word may be wrapped whole in quotes. A hook runs in the session's current folder, which follows
//   the agent's `cd`: its script and every path-like argument must be absolute (`"$CLAUDE_PROJECT_DIR"/…` is). Codex
//   sets no CLAUDE_PROJECT_DIR: there, absolute paths only;
// - its shape is `<interpreter> <script> [args…]` or `<script> [args…]`: the interpreter is node, python3, python,
//   bash or sh (any case), bare or in /usr/bin, /bin, /usr/local/bin, /opt/homebrew/bin, with no options; without one
//   the script is a path (it has a `/`: a bare word is a program on PATH or a shell builtin) and starts with an allowed
//   `#!` line; the script is a regular file in the folder or a linked folder (hashed); an argument naming anything
//   there must be a regular file (hashed): a root, a folder, a link or a FIFO is refused;
// - a stdio server takes the same shape (relative paths from the folder, the engines' working folder), or a remote
//   package: `npx [-y] <npm name>[@version] [args…]` or `uvx <PyPI name>[==version] [args…]`, refused when the package
//   is local or the folders hold config the runner reads (`.npmrc`, `node_modules`; `uv.toml`, `pyproject.toml`…); only
//   there may an argument be a root. Its env values follow the arguments' rule (a root refused too).

/**
 * A command: a Claude hook's shell text; a Codex hook's (`{ codex }`); a server's program and arguments, run without a
 * shell (`argv`, with its `env`, or the bare list).
 */
export type ScriptCommand =
  | string
  | readonly string[]
  | { readonly codex: string }
  | { readonly argv: readonly string[]; readonly env?: Readonly<Record<string, string>> };

const FORM = "a hook or server must run a plain script file: <interpreter> <script> [args]";
const INTERPRETERS = new Set(["node", "python3", "python", "bash", "sh"]);
const INTERPRETER_DIRS = new Set(["/usr/bin", "/bin", "/usr/local/bin", "/opt/homebrew/bin"]);
const WORDS_MAX = 64;
const COMMAND_MAX = 4096;
/** Stands for the folder while a hook is split, so the folder's own characters are never read as shell. */
const FOLDER_MARK = "\u0000folder\u0000";
// `"$CLAUDE_PROJECT_DIR"` or `"${CLAUDE_PROJECT_DIR}"` starting a word, followed by `/`.
const PROJECT_DIR = /(^|[ \t])"\$(?:CLAUDE_PROJECT_DIR|\{CLAUDE_PROJECT_DIR\})"(?=\/)/g;
/** Every C0 control character but tab, and DEL: refused before anything else (NUL would pass for the folder mark). */
const CONTROL = /[\u0000-\u0008\u000a-\u001f\u007f]/;
/** Shell syntax a hook may not use: everything that runs, redirects, groups, expands or comments. */
const FORBIDDEN = /[;|&<>(){}#`!$\\*?[~]/;
const NPM_NAME = /^(@[a-z0-9][a-z0-9-._~]*\/)?[a-z0-9][a-z0-9-._~]*(@[A-Za-z0-9._^~-]+)?$/;
const PYPI_NAME = /^[A-Za-z0-9]([A-Za-z0-9._-]*[A-Za-z0-9])?(==[A-Za-z0-9._+!-]+)?$/;
/** What npx reads from a folder or any folder above it: its config and the packages (and `.bin`) installed there. */
const NPM_CONFIG = [".npmrc", "node_modules"];
/** What uvx reads from a folder or any folder above it: its config, a project, a pinned Python, a lock. */
const UV_CONFIG = ["uv.toml", "pyproject.toml", ".python-version", "uv.lock"];

/**
 * What a word is to the command. `interp`: the interpreter (not inside a root). `script`: the file it runs (a hashed
 * regular file); `direct` also needs an allowed `#!` line. `arg`: any argument; `env`: an env value (a root refused).
 */
type Role = "interp" | "script" | "direct" | "arg" | "env" | "npm" | "pypi";
interface Parsed {
  words: string[];
  checks: { word: string; role: Role }[];
  /** A remote-package server: an argument may be a root (a filesystem server's folder). */
  remote: boolean;
}

const refuse = (why: string): never => {
  throw new Error(`${why}: ${FORM}`);
};

/** The command as the screen and the refusals show it. */
export function commandText(command: ScriptCommand): string {
  if (typeof command === "string") return command;
  if ("codex" in command) return command.codex;
  return ("argv" in command ? command.argv : command).join(" ");
}

/** A hook's words: plain, or wrapped whole in single or double quotes. */
function hookWords(text: string, folder: string, codex: boolean): string[] {
  if (text.length > COMMAND_MAX) refuse(`is over ${COMMAND_MAX / 1024} KB`);
  if (CONTROL.test(text)) refuse("uses a control character");
  if (codex && text.includes("CLAUDE_PROJECT_DIR")) refuse("uses $CLAUDE_PROJECT_DIR, which Codex doesn't set: write the absolute path");
  const marked = text.replace(PROJECT_DIR, (_m, lead: string) => `${lead}"${FOLDER_MARK}"`);
  if (marked.includes("CLAUDE_PROJECT_DIR")) refuse('uses $CLAUDE_PROJECT_DIR other than as "$CLAUDE_PROJECT_DIR"/path (sh would split and glob it)');
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

/** The places an argument may name: itself, a glued short flag's value (`-c./x`), every part between `=`, `,` or `:`, each without a leading `@`. */
function candidates(word: string): string[] {
  const glued = /^-[^-]./.test(word) ? [word.slice(2)] : [];
  const parts = /[=,:]/.test(word) ? word.split(/[=,:]/) : [];
  const all = [word, ...glued, ...parts];
  return [...new Set([...all, ...all.filter((t) => t.startsWith("@")).map((t) => t.slice(1))])].filter((t) => t !== "");
}

/** A word a hook would read relative to its working folder: it has a `/` or starts with `.`, and is not absolute. */
const relativePath = (t: string) => (t.includes("/") || t.startsWith(".")) && !path.isAbsolute(t);

/**
 * In a hook, the script and every path-like part of an argument must be absolute: a hook runs in the session's current
 * folder, which follows the agent's `cd`.
 */
function anchorHook(words: readonly string[], scriptAt: number, codex: boolean): void {
  const fix = (t: string) => (codex ? "write its absolute path (Codex sets no CLAUDE_PROJECT_DIR)" : `write "$CLAUDE_PROJECT_DIR"/${t.replace(/^(\.\/)+/, "")}`);
  const why = (t: string) => `names ${JSON.stringify(t.slice(0, 60))} relative to the hook's working folder, which follows the agent's cd; ${fix(t)}`;
  const script = words[scriptAt]!;
  if (!path.isAbsolute(script)) refuse(why(script));
  for (const w of words.slice(scriptAt + 1)) {
    // A word with parts (`--c=/x`, `-c./x`, `a,b`, `@./x`) is checked by its parts; a plain word as itself.
    const parts = candidates(w).filter((t) => t !== w);
    for (const t of parts.length > 0 ? parts : [w]) if (relativePath(t)) refuse(why(t));
  }
}

/** The grammar: `<interpreter> <script> [args]`, `<script> [args]`, or (servers) a remote npx/uvx package. */
function parse(command: ScriptCommand, folder: string): Parsed {
  const hook = typeof command === "string" || "codex" in command;
  const codex = typeof command !== "string" && "codex" in command;
  let words: string[];
  let env: Readonly<Record<string, string>> = {};
  if (typeof command === "string") words = hookWords(command, folder, false);
  else if ("codex" in command) words = hookWords(command.codex, folder, true);
  else {
    const argv = "argv" in command ? command.argv : command;
    env = "argv" in command ? (command.env ?? {}) : {};
    words = [...argv];
    if (words.length === 0) refuse("is empty");
    if (words.length > WORDS_MAX) refuse(`has over ${WORDS_MAX} words`);
    if (words.reduce((n, w) => n + w.length, 0) > COMMAND_MAX) refuse(`is over ${COMMAND_MAX / 1024} KB`);
    if (words.some((w) => /[\u0000-\u001f\u007f]/.test(w))) refuse("uses a control character");
    if (Object.values(env).some((v) => /[\u0000-\u001f\u007f]/.test(v))) refuse("uses a control character in env");
  }
  const out: Parsed = { words, checks: [], remote: false };
  const rest = (from: number) => {
    for (const w of words.slice(from)) out.checks.push({ word: w, role: "arg" });
    for (const v of Object.values(env)) out.checks.push({ word: v, role: "env" });
  };
  const first = words[0]!;
  const interpreter = interpreterOf(first);
  if (interpreter) {
    const script = words[1];
    if (script === undefined) refuse(`runs ${interpreter} without a script`);
    if (script!.startsWith("-")) refuse(`gives ${interpreter} an option (${script!.slice(0, 40)})`);
    if (hook) anchorHook(words, 1, codex);
    out.checks.push({ word: first, role: "interp" });
    out.checks.push({ word: script!, role: "script" });
    rest(2);
    return out;
  }
  if (!hook && first === "npx") {
    const at = words[1] === "-y" || words[1] === "--yes" ? 2 : 1;
    const pkg = words[at];
    if (pkg === undefined || !NPM_NAME.test(pkg)) refuse(`runs npx with ${pkg === undefined ? "no package" : JSON.stringify(pkg.slice(0, 60))}, not a remote npm package`);
    out.remote = true;
    // npx is `#!/usr/bin/env node`: the node PATH finds runs it.
    out.checks.push({ word: "npx", role: "interp" }, { word: "node", role: "interp" }, { word: pkg!, role: "npm" });
    rest(at + 1);
    return out;
  }
  if (!hook && first === "uvx") {
    const pkg = words[1];
    if (pkg === undefined || !PYPI_NAME.test(pkg)) refuse(`runs uvx with ${pkg === undefined ? "no package" : JSON.stringify(pkg.slice(0, 60))}, not a remote PyPI package`);
    out.remote = true;
    // uvx may run a Python it finds on PATH.
    out.checks.push({ word: "uvx", role: "interp" }, { word: "python3", role: "interp" }, { word: "python", role: "interp" }, { word: pkg!, role: "pypi" });
    rest(2);
    return out;
  }
  // `<script> [args]`: a path to the file it runs. A bare word is a program on PATH or a shell builtin, never the file.
  if (!first.includes("/")) refuse(`runs ${JSON.stringify(first.slice(0, 40))}, which is not a path to a script (write ./${first.slice(0, 40)} for a file)`);
  if (hook) anchorHook(words, 0, codex);
  out.checks.push({ word: first, role: "direct" });
  rest(1);
  return out;
}

/**
 * Every word `command` runs, `$CLAUDE_PROJECT_DIR` as `folder`. Throws naming the problem when the command doesn't
 * fit the grammar (see above): such a command is refused.
 */
export function commandWords(command: ScriptCommand, folder: string): string[] {
  return parse(command, folder).words;
}

/** How many bytes of a script the `#!` check reads: more than any kernel takes for the line (macOS reads 512). */
export const SHEBANG_READ = 1024;
/** The longest `#!` line accepted, in bytes. */
const SHEBANG_MAX = 127;
const SHEBANG_RULE = "#!/usr/bin/env node, python3, python, bash or sh, or such an interpreter's system path, no options";

/**
 * A script's `#!` line, judged on its first bytes (`SHEBANG_READ` of them or more): the interpreter it names and
 * whether `/usr/bin/env` finds it on PATH, or why it is not allowed. Only `#!/usr/bin/env <interpreter>` or
 * `#!<interpreter's absolute path>` (in a system folder), with no options, the line ended by `\n` within 127 bytes and
 * holding no tab or `\r` (a kernel may split on them, or keep them in the name).
 */
export function readShebang(head: Buffer | string): { interpreter: string; viaEnv: boolean } | { problem: string } {
  const data = typeof head === "string" ? Buffer.from(head, "utf8") : head;
  const end = data.subarray(0, SHEBANG_MAX + 1).indexOf(0x0a);
  if (end < 0) return { problem: data.length > SHEBANG_MAX ? `has a #! line over ${SHEBANG_MAX} bytes (${SHEBANG_RULE})` : `starts with no #! line ended by a new line (${SHEBANG_RULE})` };
  const line = data.subarray(0, end).toString("latin1");
  const bad = { problem: `starts with no allowed #! line (${SHEBANG_RULE})` };
  if (/[\t\r]/.test(line)) return bad;
  const m = /^#! *(\S+)(?: (\S+))? *$/.exec(line);
  if (!m) return bad;
  if (m[1] === "/usr/bin/env") return m[2] !== undefined && INTERPRETERS.has(m[2]) ? { interpreter: m[2], viaEnv: true } : bad;
  return m[2] === undefined && INTERPRETER_DIRS.has(path.dirname(m[1]!)) && INTERPRETERS.has(path.basename(m[1]!)) ? { interpreter: m[1]!, viaEnv: false } : bad;
}

/** Why a script's `#!` line is not allowed (`readShebang`), or null. */
export function shebangProblem(head: Buffer | string): string | null {
  const r = readShebang(head);
  return "problem" in r ? r.problem : null;
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

/** `dir` and every folder above it, to /. */
function ancestors(dir: string): string[] {
  const out: string[] = [];
  for (let d = path.resolve(dir); ; d = path.dirname(d)) {
    out.push(d);
    if (path.dirname(d) === d) return out;
  }
}

/**
 * The first of `names` that exists (lstat only, never read) in the folder, a linked folder, or any folder above them:
 * config a package runner reads, so what it runs would follow the folder. The person's own npm config file (`USER_NPMRC`) is theirs.
 */
async function runnerConfig(names: readonly string[], folder: string, roots: Root[]): Promise<string | null> {
  const dirs = new Set([folder, ...roots.flatMap((r) => [r.lex, r.real])].flatMap(ancestors));
  for (const d of dirs) {
    for (const n of names) {
      const p = path.join(d, n);
      if (p !== USER_NPMRC && (await exists(p))) return p;
    }
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

/**
 * Where scripts are looked for: the folder (relative paths, `$CLAUDE_PROJECT_DIR`), its linked folders, and the PATH
 * the engines and their hooks and servers get (`searchPath`, already cleaned of relative entries). Without
 * `searchPath`, a bare program is not looked up.
 */
export interface ScanOptions {
  folder: string;
  linked: readonly string[];
  searchPath?: string;
}

/** The first executable regular file `name` names on `searchPath` (absolute entries only), or null. */
async function firstOnPath(name: string, searchPath: string): Promise<string | null> {
  for (const d of searchPath.split(":")) {
    if (!path.isAbsolute(d)) continue;
    const p = path.join(d, name);
    try {
      await fs.access(p, fs.constants.X_OK);
      if ((await fs.stat(p)).isFile()) return p;
    } catch {
      // not here
    }
  }
  return null;
}

/**
 * Why the program `word` (an interpreter, `npx`, `uvx`; bare or absolute) is not allowed, or null: the file that would
 * run (its path, or the first match on `o.searchPath`) lies inside the folder or a linked folder, where an agent can
 * write it.
 */
export async function interpreterProblem(word: string, o: ScanOptions, roots?: Root[]): Promise<{ path: string; why: string } | null> {
  const found = path.isAbsolute(word) ? word : o.searchPath !== undefined ? await firstOnPath(word, o.searchPath) : null;
  if (!found) return null;
  const rs = roots ?? (await rootsOf(o));
  const real = (await realOrNull(found)) ?? found;
  if (!rs.some((r) => inside(found, r.lex) || inside(found, r.real) || inside(real, r.real))) return null;
  return { path: found, why: path.isAbsolute(word) ? "is an interpreter inside the folder or a linked folder" : `is the ${word} found first on PATH, and it is inside the folder or a linked folder` };
}

/** A word that names something the hash can't cover: the path, why, and the command that names it. */
export interface ScriptIssue {
  path: string;
  why: string;
  command: string;
}

/**
 * What `commands` run from `folder` and its linked folders: `files`, the regular files they name (hashed), absolute,
 * sorted; `issues`, what can't be hashed: a script that is not a regular file in a root, an argument or env value naming a root, a folder, a link or a FIFO there (a root passes only as a
 * remote-package server's argument), a remote package that is local or whose runner would read the folders' config, an
 * interpreter inside a root. Relative paths are taken from `folder`, the engines' working folder. Throws as
 * `commandWords` does: check each command with it first. A script run directly also needs an allowed `#!` line: that is
 * checked on the bytes hashed (`directScripts`, `shebangProblem`), never on a read of its own.
 */
export async function scanScripts(
  commands: ReadonlyArray<ScriptCommand>,
  o: ScanOptions,
): Promise<{ files: string[]; issues: ScriptIssue[] }> {
  const roots = await rootsOf(o);
  const files = new Set<string>();
  const issues = new Map<string, ScriptIssue>();
  for (const command of commands) {
    const shown = commandText(command);
    const issue = (p: string, why: string) => {
      if (!issues.has(p)) issues.set(p, { path: p, why, command: shown.length > 120 ? `${shown.slice(0, 120)}…` : shown });
    };
    const parsed = parse(command, o.folder);
    for (const { word, role } of parsed.checks) {
      if (role === "npm") {
        const found = await runnerConfig(NPM_CONFIG, o.folder, roots);
        if (found) issue(found, "is npm config or packages npx would use: the server could run the folder's code, which the approval doesn't cover");
        continue;
      }
      if (role === "pypi") {
        const found = (await runnerConfig(UV_CONFIG, o.folder, roots)) ?? (await localModule(word, o.folder, roots));
        if (found) issue(found, "is a Python project, config or module uvx would use: the server could run the folder's code, which the approval doesn't cover");
        continue;
      }
      if (role === "interp") {
        const why = await interpreterProblem(word, o, roots);
        if (why) issue(why.path, why.why);
        continue;
      }
      if (role === "script" || role === "direct") {
        const p = path.resolve(o.folder, word);
        const st = await fs.lstat(p).catch(() => null);
        const kind = st ? await classify(p, st, roots) : "missing";
        if (kind !== "file") {
          issue(p, kind === "missing" || kind === "outside" ? "is not a script file in the folder or a linked folder" : kind === "root" ? "is a folder" : kind);
          continue;
        }
        files.add(p);
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
          if (!parsed.remote || role === "env") issue(p, "is a folder");
        } else issue(p, kind);
      }
    }
  }
  for (const p of issues.keys()) files.delete(p);
  return { files: [...files].sort(), issues: [...issues.values()].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)) };
}

/**
 * The scripts `commands` run directly (no interpreter: their `#!` line picks it), absolute from `folder`, with the
 * command that names each. Commands outside the grammar are left out (they are refused anyway).
 */
export function directScripts(commands: ReadonlyArray<ScriptCommand>, folder: string): { path: string; command: string }[] {
  const out: { path: string; command: string }[] = [];
  for (const command of commands) {
    let parsed: Parsed;
    try {
      parsed = parse(command, folder);
    } catch {
      continue;
    }
    const shown = commandText(command);
    for (const { word, role } of parsed.checks) {
      if (role === "direct") out.push({ path: path.resolve(folder, word), command: shown.length > 120 ? `${shown.slice(0, 120)}…` : shown });
    }
  }
  return out;
}

/**
 * The paths `commands` name that join the hash or are refused (`scanScripts`'s files and issues), sorted and unique:
 * what a pin's check and a snapshot's load compare with the approved list, so a path refused now never matches.
 */
export async function scriptRefs(commands: ReadonlyArray<ScriptCommand>, o: ScanOptions): Promise<string[]> {
  const { files, issues } = await scanScripts(commands, o);
  return [...new Set([...files, ...issues.map((i) => i.path)])].sort();
}
