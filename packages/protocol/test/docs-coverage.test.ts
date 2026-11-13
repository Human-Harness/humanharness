import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { configKeys, docSources, renderContract, tableKeys, whereDocumented } from "./contract-docs";
import undocumented from "./undocumented.json";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const channels = new Set([...tableKeys("Invoke", root), ...tableKeys("Push", root)]);
const keys = configKeys(root);
const sources = docSources(root);
const gaps = undocumented as string[];

describe("docs name every IPC channel and config key", () => {
  it("has a sorted list of unique names in undocumented.json", () => {
    expect(Array.isArray(gaps)).toBe(true);
    expect(gaps.every((n) => typeof n === "string")).toBe(true);
    expect(gaps).toEqual([...new Set(gaps)].sort());
  });

  it("keeps contract.md as the generator writes it", () => {
    const file = fs.readFileSync(path.join(root, "docs/architecture/contract.md"), "utf8");
    expect(file === renderContract(root), "docs/architecture/contract.md is out of date: run `pnpm docs:gen`.").toBe(true);
  });

  it("documents every channel and config key, or lists it in undocumented.json", () => {
    const missing = [
      ...[...channels].filter((n) => !whereDocumented(n, "channel", sources).length && !gaps.includes(n)).map((n) => ({ n, what: "channels.ts" })),
      ...keys.filter((n) => !whereDocumented(n, "config", sources).length && !gaps.includes(n)).map((n) => ({ n, what: "AppConfig" })),
    ].map(({ n, what }) => `\`${n}\` is in ${what} but no doc names it. Add it to its feature's doc in docs/architecture (or the mod's README).`);
    expect(missing).toEqual([]);
  });

  it("lists in undocumented.json only names that exist and have no doc", () => {
    const stale = gaps
      .filter((n) => {
        const kind = channels.has(n) ? "channel" : keys.includes(n) ? "config" : null;
        return kind === null || whereDocumented(n, kind, sources).length > 0;
      })
      .map((n) => `\`${n}\` is documented now (or gone): remove it from undocumented.json.`);
    expect(stale).toEqual([]);
  });
});
