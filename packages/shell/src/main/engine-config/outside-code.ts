import path from "node:path";
import { commandWords, type ScriptCommand } from "./script-refs";

// Code the approval doesn't cover (hatches spec §5.3, E2's limit). The hash holds the engine folder and the scripts its
// commands name, never what those load in turn: a script's imports, a package a runner fetches (`npx`, `uvx`), a
// module `python -m` finds. The approval screen says so next to each such command and script. A hint for the person,
// not a boundary: false positives are fine, and a script can always load code in ways no pattern sees.

/** Programs that fetch or find a package to run (`npx x`, `uvx x`), alone or with their first argument. */
const RUNNERS = new Set(["npx", "pnpx", "bunx", "uvx", "pipx"]);
const RUNNER_VERBS: Record<string, ReadonlySet<string>> = {
  npm: new Set(["exec", "x"]),
  pnpm: new Set(["dlx", "exec"]),
  yarn: new Set(["dlx", "exec"]),
  bun: new Set(["x"]),
  uv: new Set(["run", "tool"]),
  deno: new Set(["run"]),
};

/** True when the words run a package runner, `python -m`, something in `node_modules/.bin`, or a URL. */
function runsPackages(words: readonly string[]): boolean {
  return words.some((w, i) => {
    const name = path.basename(w);
    if (RUNNERS.has(name)) return true;
    if (Object.hasOwn(RUNNER_VERBS, name) && RUNNER_VERBS[name]!.has(words[i + 1] ?? "")) return true;
    if (/^python[0-9.]*$/.test(name) && words[i + 1] === "-m") return true;
    return w.includes("node_modules/.bin/") || /^https?:\/\//i.test(w);
  });
}

/** A command (a hook's shell text, or a server's program and arguments) that may run code outside its approval. */
export function commandLoadsOtherCode(command: ScriptCommand): boolean {
  try {
    return runsPackages(commandWords(command, ""));
  } catch {
    // Its words can't be read for sure (the config is refused for it anyway): say so rather than nothing.
    return true;
  }
}

// JavaScript/TypeScript (`import x from`, `import(`, `require(`), Python (`import x`, `from x import`), shell
// (`source x`, `. x`), Ruby and Perl (`require`, `load`, `use`), and any package runner named in the text.
// Each pattern runs on one line at a time with only `[ \t]` around its words, never `\s` under `m`: a newline-only
// script would make `^\s*` try every start against every newline after it (quadratic, seconds on 64 KB).
const IMPORTS = [
  /(^|[ \t;])import[ \t]*[ \t{*"'(]/,
  /(^|[ \t;])import$/,
  /\brequire(_relative)?[ \t]*[("']/,
  /^[ \t]*from[ \t]+\S+[ \t]+import[ \t]/,
  /^[ \t]*(source|\.)[ \t]+\S/,
  /^[ \t]*(use|load)[ \t]+\S/,
  /\b(npx|pnpx|bunx|uvx|pipx)[ \t]/,
];

/**
 * A script's text loads other code (an import, a `source`, a package runner), or its `#!` line finds the interpreter
 * on PATH (`#!/usr/bin/env node`: a shim or a folder on PATH may answer). Linear in the text's length.
 */
export function importsOtherCode(text: string): boolean {
  if (/^#![ \t]*\/usr\/bin\/env[ \t]/.test(text)) return true;
  return text.split(/\r?\n|\r/).some((line) => IMPORTS.some((re) => re.test(line)));
}
