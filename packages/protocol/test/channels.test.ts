import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const packages = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function sources(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) return d.name === "node_modules" ? [] : sources(p);
    return /\.tsx?$/.test(d.name) ? [p] : [];
  });
}

/** Every "hh:…" string literal in a folder's sources (comments use backticks, so they don't count). */
function literals(dir: string): Set<string> {
  const found = new Set<string>();
  for (const file of sources(dir)) for (const m of fs.readFileSync(file, "utf8").matchAll(/"(hh:[A-Za-z]+)"/g)) found.add(m[1]);
  return found;
}

/** The keys of one interface in channels.ts. */
function tableKeys(name: "Invoke" | "Push"): Set<string> {
  const text = fs.readFileSync(path.join(packages, "protocol/src/channels.ts"), "utf8");
  const body = text.match(new RegExp(`export interface ${name} \\{([\\s\\S]*?)\\n\\}`))?.[1] ?? "";
  return new Set([...body.matchAll(/^\s*"(hh:[A-Za-z]+)"\s*:/gm)].map((m) => m[1]));
}

const invoke = tableKeys("Invoke");
const push = tableKeys("Push");
const table = new Set([...invoke, ...push]);
const main = literals(path.join(packages, "shell/src/main"));
const preload = literals(path.join(packages, "shell/src/preload"));

describe("IPC channel table (replaceable parts §5.3)", () => {
  it("reads both maps", () => {
    expect(invoke.size).toBeGreaterThan(100);
    expect(push.size).toBeGreaterThan(10);
    // hh:scopes is both: the scope list asks it (scopes.list) and main pushes it when the list changes.
    expect([...invoke].filter((c) => push.has(c))).toEqual(["hh:scopes"]);
  });

  it("has a handler or a sender in main for every channel", () => {
    expect([...table].filter((c) => !main.has(c))).toEqual([]);
  });

  it("is used by the preload for every channel", () => {
    expect([...table].filter((c) => !preload.has(c))).toEqual([]);
  });

  it("holds every channel main and the preload name", () => {
    expect([...main, ...preload].filter((c) => !table.has(c))).toEqual([]);
  });
});
