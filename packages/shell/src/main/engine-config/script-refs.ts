import fs from "node:fs/promises";
import path from "node:path";

// Referenced scripts (hatches spec §5.3, threat model E2). A hook command or an MCP server's command or argument may
// name a file in the person's folder or a linked folder (`node ./tools/x.js`); that file joins the scope's hash, or an
// agent could change it after approval and run code nobody approved. Only regular files count: a symlink, a folder, a
// path outside the roots (after resolving every parent link) or a path that does not exist is not a script.

/** Splits a command like a shell would for words: quotes, backslashes, and `;|&<>()` and backquotes as separators. */
export function commandTokens(command: string): string[] {
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
    } else if (/\s/.test(ch) || ";|&<>()`".includes(ch)) end();
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

/** The places a token may name: itself, and a flag's value after `=` (`--config=./a.json`). */
function candidates(token: string): string[] {
  const out = [token];
  const eq = token.indexOf("=");
  if (eq > 0) out.push(token.slice(eq + 1));
  return out.filter((t) => t !== "" && !t.startsWith("~") && !t.startsWith("$"));
}

/**
 * The files `commands` name inside `folder` or a linked folder, absolute, sorted and unique. A string is a hook command
 * (split into words); a list is a server's command and arguments, already words. Relative paths are taken from
 * `folder`, the engine's working folder.
 */
export async function scriptRefs(
  commands: ReadonlyArray<string | readonly string[]>,
  o: { folder: string; linked: readonly string[] },
): Promise<string[]> {
  const roots = (await Promise.all([o.folder, ...o.linked].map(realOrNull))).filter((r): r is string => r !== null);
  const found = new Set<string>();
  const seen = new Set<string>();
  for (const command of commands) {
    const words = typeof command === "string" ? commandTokens(command) : command;
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
        if (!st.isFile()) continue;
        const real = await realOrNull(p);
        if (real !== null && roots.some((r) => inside(real, r))) found.add(p);
      }
    }
  }
  return [...found].sort();
}
