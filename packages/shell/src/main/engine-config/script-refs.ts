import type { Stats } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { LOADER_NAME } from "./clean";

// Referenced scripts (hatches spec §5.3, threat model E2). A hook command or an MCP server's command or argument may
// name a file in the person's folder or a linked folder (`node ./tools/x.js`); that file joins the scope's hash, or an
// agent could change it after approval and run code nobody approved. Only regular files are hashed.
//
// The check fails closed: when it can't fully account for what a command will run, the command is refused, naming
// it and why. In hook text (shell): any `$` but `$CLAUDE_PROJECT_DIR`, a backquote, a glob, `~`, `cd`, `eval`,
// `xargs`, a leading assignment to a loader variable (`NODE_OPTIONS=…`, also after `env`), a shell reading its input
// or with an option the check doesn't read; `sh -c "…"` (and bash, zsh, dash, with `-o`/`-O` values) is read again.
// Programs that run code from the folder's own config are refused too: package.json scripts (`npm test`, `pnpm build`,
// `yarn x`, `bun run`), build files (`make`, `just`, `cargo`…), `uv run`, and a runner's or `python -m`'s package or
// module when it is local. On disk: any word (bare or a path, each part between `=`, a glued flag's value) naming a
// link, a FIFO, a path through a link, or a link from outside into a root is refused, and so is a folder named as a
// path (a bare word naming a folder is data); a root or folder as an interpreter's script
// (`node .`) or a server's first argument is refused; node's `-r`/`--import`/`--loader`/`--env-file` must name a
// hashed regular file. A root passed as data elsewhere is allowed. The program word itself (found on PATH) is not
// checked unless it is a path. A word that names nothing yet is not a script (Known gaps).

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
/** Shell long options that only set a mode (any other is refused: `--rcfile`, `--init-file` load a file). */
const SHELL_LONG = new Set(["--login", "--noprofile", "--norc", "--posix", "--noediting", "--restricted", "--verbose"]);
/** Words that run the rest of their command as a command: read again as one. */
const WRAPPERS = new Set(["exec", "command", "nohup", "time"]);
const PROJECT_DIR = /\$\{CLAUDE_PROJECT_DIR\}|\$CLAUDE_PROJECT_DIR(?![A-Za-z0-9_])/g;
/** Stands for the folder while a command is split, so the folder's own characters are never read as shell. */
const FOLDER_MARK = "\u0000folder\u0000";
/** Between two simple commands (`;`, `|`, `&`, `(`, `)`, a new line). */
const SEP = "\u0000sep\u0000";
const MAX_NESTING = 3;
const ASSIGNMENT = /^([A-Za-z_][A-Za-z0-9_]*)=/;

/**
 * What a word is to the program that gets it. `arg`: any argument (a root passes: it is data). `script`: the file an
 * interpreter runs, or a server's first argument (a folder or a root runs an index or `main` the hash never saw).
 * `require`: a file node loads first (`-r`, `--import`): it must be a hashed regular file. `module`: a Python module
 * (`python -m X`, `uvx X`): refused when X is local (cwd is on sys.path). `package`: a package a runner (`npx`) fetches:
 * refused when it is a local path or installed in the folder's `node_modules`.
 */
type Role = "arg" | "script" | "require" | "module" | "package";
interface Check {
  word: string;
  role: Role;
}
interface Parsed {
  words: string[];
  checks: Check[];
}

/** Splits shell text into words like a shell would (quotes, backslashes), with SEP between simple commands. */
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
    } else if (";|&()\n".includes(ch)) {
      end();
      tokens.push(SEP);
    } else if (/\s/.test(ch) || "<>".includes(ch)) end();
    else {
      cur += ch;
      started = true;
    }
  }
  if (quote) throw new Error("leaves a quote open, so its words can't be read");
  end();
  return tokens;
}

/** A leading `NAME=value`: refused for a loader variable; its value's parts are checked as words. */
function assignment(word: string, out: Parsed): void {
  const name = ASSIGNMENT.exec(word)![1]!;
  if (LOADER_NAME.test(name)) throw new Error(`sets ${name}, which makes the program load code the approval doesn't cover`);
  const value = word.slice(name.length + 1);
  out.words.push(word);
  if (value !== "") out.checks.push({ word: value, role: "arg" });
}

/** Hook text: every simple command in it, shells' `-c` scripts read again. */
function shellText(text: string, folder: string, depth: number, out: Parsed): void {
  if (depth > MAX_NESTING) throw new Error("nests shells too deep");
  if (text.includes("`")) throw new Error("uses a backquote, so its paths can't be checked");
  const marked = text.replace(PROJECT_DIR, FOLDER_MARK);
  if (marked.includes("$")) throw new Error("uses $ (only $CLAUDE_PROJECT_DIR is understood), so its paths can't be checked");
  if (/[*?[]/.test(marked)) throw new Error("uses a glob (* ? [), so its paths can't be checked");
  const tokens = commandTokens(marked).map((w) => (w === SEP ? w : w.split(FOLDER_MARK).join(folder)));
  const home = tokens.find((w) => w.startsWith("~"));
  if (home) throw new Error(`uses ~ (${home.slice(0, 40)}), so its paths can't be checked`);
  let cur: string[] = [];
  for (const t of [...tokens, SEP]) {
    if (t !== SEP) cur.push(t);
    else if (cur.length > 0) {
      simple(cur, folder, depth, false, out);
      cur = [];
    }
  }
}

/** An interpreter's options (those with a value take the next word, `=value` or a glued value), then its script. */
function interpreter(prog: string, args: string[], out: Parsed): void {
  const words = (from: number, role: Role = "arg") => {
    for (const w of args.slice(from)) out.checks.push({ word: w, role });
  };
  // Options with a value: [names, what the value is]. "inline": code in the command text (no script follows).
  const table: Record<string, Record<string, "require" | "inline" | "arg" | "module">> = {
    node: { "-r": "require", "--require": "require", "--import": "require", "--loader": "require", "--experimental-loader": "require", "--env-file": "require", "--env-file-if-exists": "require", "-e": "inline", "--eval": "inline", "-p": "inline", "--print": "inline" },
    python: { "-c": "inline", "-m": "module", "-X": "arg", "-W": "arg" },
    ruby: { "-e": "inline", "-I": "arg", "-r": "arg" },
    perl: { "-e": "inline", "-E": "inline", "-I": "arg", "-M": "module", "-m": "module" },
    deno: {},
    bun: {},
  };
  const name = prog === "python3" ? "python" : prog;
  const opts = table[name]!;
  let i = 0;
  if (name === "deno" && args[0] === "run") i = 1;
  for (; i < args.length; i++) {
    const w = args[i]!;
    if (w === "--") {
      i++;
      break;
    }
    if (w === "-") throw new Error(`${prog} reads its script from its input`);
    if (!w.startsWith("-")) break;
    // `--name=value`, `-Xvalue` (glued short flag), or `--name value`.
    const eq = w.startsWith("--") ? w.indexOf("=") : -1;
    const key = eq > 0 ? w.slice(0, eq) : w.startsWith("--") ? w : w.slice(0, 2);
    const kind = Object.hasOwn(opts, key) ? opts[key] : undefined;
    if (kind === undefined) {
      // A flag of its own; a glued short flag's value is still checked as a word.
      if (!w.startsWith("--") && w.length > 2) out.checks.push({ word: w.slice(2), role: "arg" });
      if (eq > 0) out.checks.push({ word: w.slice(eq + 1), role: "arg" });
      continue;
    }
    let value: string | undefined;
    if (eq > 0) value = w.slice(eq + 1);
    else if (!w.startsWith("--") && w.length > 2) value = w.slice(2);
    else value = args[++i];
    if (value === undefined) throw new Error(`${prog} ${key} has no value`);
    if (kind === "require") out.checks.push({ word: value, role: "require" });
    else if (kind === "arg") out.checks.push({ word: value, role: "arg" });
    else if (kind === "module") out.checks.push({ word: value, role: "module" });
    if (kind === "inline" || kind === "module") {
      words(i + 1);
      return;
    }
  }
  if (i < args.length) {
    out.checks.push({ word: args[i]!, role: "script" });
    words(i + 1);
  }
}

const INTERPRETERS = new Set(["node", "python", "python3", "deno", "bun", "ruby", "perl"]);

// Programs that run code from the folder's own config files (package.json scripts, a Makefile, pyproject.toml, a
// local module), which the hash never covers: refused (E2). A config that needs one wraps it in a plain script file.
/** Refused whatever they are asked: they read a build file in the folder. */
const CONFIG_RUNNERS = new Set(["make", "gmake", "just", "rake", "gradle", "gradlew", "mvn", "mvnw", "ant", "task", "invoke", "nox", "tox", "scons", "ninja", "cargo"]);
/** Refused with these subcommands. */
const CONFIG_SUBS: Record<string, ReadonlySet<string>> = {
  npm: new Set(["run", "run-script", "rum", "urn", "test", "tst", "t", "start", "restart", "stop", "explore"]),
  go: new Set(["run", "test", "generate"]),
  deno: new Set(["task"]),
  uv: new Set(["run"]),
  poetry: new Set(["run"]),
  pipenv: new Set(["run"]),
  hatch: new Set(["run"]),
  pdm: new Set(["run"]),
  rye: new Set(["run"]),
  composer: new Set(["run", "run-script", "exec"]),
};
/** pnpm, yarn and bun run a package.json script by its bare name: only these subcommands run none. */
const PM_SAFE = new Set(["install", "i", "add", "remove", "rm", "uninstall", "update", "up", "upgrade", "list", "ls", "info", "view", "why", "outdated", "audit", "help", "version", "init", "link", "unlink", "pm", "store", "config", "cache", "whoami", "login", "logout", "publish", "pack", "build", "create", "import", "licenses", "patch"]);
/** Package runners and the subcommand that makes one (`npm exec`): what they fetch is outside the hash (a hint). */
const PACKAGE_RUNNERS: Record<string, ReadonlySet<string> | null> = { npx: null, bunx: null, pnpx: null, npm: new Set(["exec", "x"]), pnpm: new Set(["dlx"]), yarn: new Set(["dlx"]), bun: new Set(["x"]) };
const LOCAL_CONFIG = "runs code from the folder's own config (package.json scripts, a build file, a local module) the approval doesn't cover; wrap it in a plain script file";

/** The first word of `args` that is not an option. */
const subcommand = (args: readonly string[]) => args.find((a) => !a.startsWith("-"));

/** A package runner's package (`npx -y pkg args…`, `--package pkg`): checked as a `package`, the rest as words. */
function packageRunner(args: string[], from: number, out: Parsed): void {
  let i = from;
  for (; i < args.length && args[i]!.startsWith("-"); i++) {
    const w = args[i]!;
    if (w === "-p" || w === "--package") out.checks.push({ word: args[++i] ?? "", role: "package" });
    else if (w.startsWith("--package=")) out.checks.push({ word: w.slice("--package=".length), role: "package" });
    else if (w === "--") {
      i++;
      break;
    }
  }
  if (i < args.length) out.checks.push({ word: args[i]!, role: "package" });
  for (const w of args.slice(i + 1)) out.checks.push({ word: w, role: "arg" });
}

/** A shell's options, then its `-c` script (read again) or its script file. Anything else is refused. */
function shell(prog: string, args: string[], folder: string, depth: number, out: Parsed): void {
  let i = 0;
  let withC = false;
  for (; i < args.length; i++) {
    const w = args[i]!;
    if (w === "--") {
      i++;
      break;
    }
    if (w === "-" || !/^[-+]./.test(w)) break;
    if (w.startsWith("--")) {
      if (!SHELL_LONG.has(w)) throw new Error(`runs ${prog} with ${w}, which the check doesn't read`);
      continue;
    }
    const flags = w.slice(1);
    for (let k = 0; k < flags.length; k++) {
      const f = flags[k]!;
      if (f === "o" || f === "O") {
        if (k !== flags.length - 1 || i + 1 >= args.length) throw new Error(`runs ${prog} with ${w}, which the check doesn't read`);
        i++;
      } else if (f === "c") withC = true;
      else if (f === "s") throw new Error(`runs ${prog} reading commands from its input`);
    }
  }
  if (withC) {
    const script = args[i];
    if (script === undefined) throw new Error(`runs ${prog} -c without a script`);
    shellText(script, folder, depth + 1, out);
    for (const w of args.slice(i + 1)) out.checks.push({ word: w, role: "arg" });
    return;
  }
  if (i >= args.length || args[i] === "-") throw new Error(`runs ${prog} reading commands from its input`);
  out.checks.push({ word: args[i]!, role: "script" });
  for (const w of args.slice(i + 1)) out.checks.push({ word: w, role: "arg" });
}

/** One simple command: leading assignments, the program, its arguments by what the program makes of them. */
function simple(argv: string[], folder: string, depth: number, server: boolean, out: Parsed): void {
  let i = 0;
  while (i < argv.length && ASSIGNMENT.test(argv[i]!)) assignment(argv[i++]!, out);
  if (i >= argv.length) return;
  out.words.push(...argv.slice(i));
  const program = argv[i]!;
  const prog = path.basename(program);
  const args = argv.slice(i + 1);
  // The program itself is found on PATH; one named by a path is a script.
  if (program.includes("/")) out.checks.push({ word: program, role: "script" });
  if (FOLDER_CHANGES.has(prog)) throw new Error(`changes folder (${prog}), so its paths can't be placed`);
  if (prog === "eval") throw new Error("uses eval, so what it runs can't be checked");
  if (prog === "xargs") throw new Error("runs xargs, which takes its command from its input");
  if (WRAPPERS.has(prog)) {
    if (args.length === 0 || args[0]!.startsWith("-")) throw new Error(`runs ${prog} in a form the check doesn't read`);
    simple(args, folder, depth, server, out);
    return;
  }
  if (prog === "env") {
    let j = 0;
    for (; j < args.length && args[j]!.startsWith("-"); j++) {
      if (args[j] === "-i" || args[j] === "-" || args[j] === "--ignore-environment") continue;
      if (args[j] === "-u") {
        j++;
        continue;
      }
      throw new Error(`runs env with ${args[j]}, which the check doesn't read`);
    }
    simple(args.slice(j), folder, depth, server, out);
    return;
  }
  if (prog === "source" || prog === ".") {
    if (args.length === 0) throw new Error(`runs ${prog} without a file`);
    out.checks.push({ word: args[0]!, role: "script" });
    for (const w of args.slice(1)) out.checks.push({ word: w, role: "arg" });
    return;
  }
  if (SHELLS.has(prog)) return shell(prog, args, folder, depth, out);
  if (CONFIG_RUNNERS.has(prog)) throw new Error(`runs ${prog}, which ${LOCAL_CONFIG}`);
  const sub = subcommand(args);
  const runner = Object.hasOwn(PACKAGE_RUNNERS, prog) ? PACKAGE_RUNNERS[prog] : undefined;
  if (runner === null) return packageRunner(args, 0, out);
  if (runner && sub !== undefined && runner.has(sub)) return packageRunner(args, args.indexOf(sub) + 1, out);
  if (Object.hasOwn(CONFIG_SUBS, prog) && sub !== undefined && CONFIG_SUBS[prog]!.has(sub)) throw new Error(`runs ${prog} ${sub}, which ${LOCAL_CONFIG}`);
  if (prog === "uvx" || (prog === "uv" && sub === "tool" && args[args.indexOf(sub) + 1] === "run")) {
    const from = prog === "uvx" ? 0 : args.indexOf("run") + 1;
    for (let i = from; i < args.length; i++) {
      const w = args[i]!;
      if (w === "--from" || w === "--with") out.checks.push({ word: args[++i] ?? "", role: "module" });
      else if (w.startsWith("--from=") || w.startsWith("--with=")) out.checks.push({ word: w.slice(w.indexOf("=") + 1), role: "module" });
      else if (!w.startsWith("-")) {
        out.checks.push({ word: w, role: "module" });
        for (const a of args.slice(i + 1)) out.checks.push({ word: a, role: "arg" });
        return;
      }
    }
    return;
  }
  if (prog === "pnpm" || prog === "yarn" || (prog === "bun" && sub !== undefined && !/[./]/.test(sub))) {
    // A bare name runs the package.json script of that name.
    if (sub !== undefined && !PM_SAFE.has(sub)) throw new Error(`runs ${prog} ${sub}, which ${LOCAL_CONFIG}`);
    args.forEach((w) => out.checks.push({ word: w, role: "arg" }));
    return;
  }
  if (INTERPRETERS.has(prog)) return interpreter(prog, args, out);
  args.forEach((w, k) => out.checks.push({ word: w, role: server && k === 0 ? "script" : "arg" }));
}

function parse(command: ScriptCommand, folder: string): Parsed {
  const out: Parsed = { words: [], checks: [] };
  if (typeof command === "string") shellText(command, folder, 0, out);
  else simple([...command], folder, 0, true, out);
  const change = out.words.find((w) => FOLDER_CHANGES.has(w));
  if (change) throw new Error(`changes folder (${change}), so its paths can't be placed`);
  return out;
}

/**
 * Every word `command` runs, with `sh -c` scripts read again and `$CLAUDE_PROJECT_DIR` as `folder`. Throws naming the
 * problem when what it runs can't be fully accounted for (another `$`, a backquote, a glob, `~`, `cd`, `eval`, a
 * loader variable, a shell reading its input, an option the check doesn't read): such a command is refused. A server's
 * arguments are taken as they are (no shell reads them), except a shell's `-c` script.
 */
export function commandWords(command: ScriptCommand, folder: string): string[] {
  return parse(command, folder).words;
}

/** The places a word may name: itself, a glued short flag's value (`-r./x`), every part between `=` (`--config=./a`). */
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

/** A token that reads as a path (`./x`, `a/b`, `/x`, `..`). */
const pathLike = (t: string) => t.startsWith(".") || t.includes("/") || t.includes(path.sep);
const exists = (p: string) => fs.lstat(p).then(() => true, () => false);

/** The folders a runner searches from `folder`: it, each folder above it, and the linked roots. */
function searchDirs(folder: string, roots: Root[]): string[] {
  const dirs: string[] = [];
  for (let d = path.resolve(folder); ; d = path.dirname(d)) {
    dirs.push(d);
    if (path.dirname(d) === d) break;
  }
  return [...dirs, ...roots.flatMap((r) => [r.lex, r.real])];
}

/** A Python module or package spec that is local: a path, or `X.py` / `X/` in the folder or a root (on sys.path). */
async function localModule(spec: string, folder: string, roots: Root[]): Promise<{ path: string; why: string } | null> {
  const why = "is a local module: python puts the folder on its path, so it runs code the approval doesn't cover";
  if (spec === "" || pathLike(spec) || spec.startsWith("file:")) return { path: path.resolve(folder, spec), why };
  const name = spec.split(/[.=<>!~[@\s]/)[0]!;
  for (const d of [path.resolve(folder), ...roots.flatMap((r) => [r.lex, r.real])]) {
    for (const p of [path.join(d, `${name}.py`), path.join(d, name)]) if (await exists(p)) return { path: p, why };
  }
  return null;
}

/** A package a runner fetches that is local: a path, or installed in a `node_modules` it searches. */
async function localPackage(spec: string, folder: string, roots: Root[]): Promise<{ path: string; why: string } | null> {
  const why = "is a local package: the runner would run the folder's own copy, which the approval doesn't cover";
  if (spec === "" || spec.startsWith(".") || spec.startsWith("/") || /^(file|link|portal|git\+file):/.test(spec)) return { path: path.resolve(folder, spec), why };
  // `@scope/name@1.2` → name `@scope/name`, bin `name`.
  const at = spec.indexOf("@", 1);
  const name = at > 0 ? spec.slice(0, at) : spec;
  const bin = name.slice(name.lastIndexOf("/") + 1);
  for (const d of searchDirs(folder, roots)) {
    for (const p of [path.join(d, "node_modules", ".bin", bin), path.join(d, "node_modules", name)]) if (await exists(p)) return { path: p, why };
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
 * sorted; `issues`, every word that names something else inside them (a link, a folder, a FIFO, a path through a link,
 * a link from outside into them), a root or folder as an interpreter's script, or a node `-r` value that is not such a
 * file. Relative paths are taken from `folder`, the engine's working folder. A word that names nothing yet is not a
 * script (Known gaps). Throws as `commandWords` does: check each command with it first.
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
    for (const { word, role } of parse(command, o.folder).checks) {
      if (role === "module" || role === "package") {
        const local = await (role === "module" ? localModule(word, o.folder, roots) : localPackage(word, o.folder, roots));
        if (local) issue(local.path, local.why);
        continue;
      }
      for (const t of role === "require" ? [word] : candidates(word)) {
        const p = path.isAbsolute(t) ? path.resolve(t) : path.resolve(o.folder, t);
        const st = await fs.lstat(p).catch(() => null);
        if (!st) {
          if (role === "require") issue(p, "is not a script file in the folder (node loads it first)");
          continue;
        }
        const kind = await classify(p, st, roots);
        if (kind === "file") files.add(p);
        else if (kind === "outside") {
          if (role === "require") issue(p, "is outside the folder (node loads it first)");
        } else if (kind === "root") {
          if (role !== "arg") issue(p, "is a folder: the program would run a file in it the approval doesn't cover");
        } else if (kind === "is a folder" && role === "arg") {
          // A folder as data is refused only when named as a path (`ls ./dir`); a bare word (`npm test`) passes.
          if (pathLike(t)) issue(p, kind);
        }
        else issue(p, kind === "is a folder" ? "is a folder: the program would run a file in it the approval doesn't cover" : kind);
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
