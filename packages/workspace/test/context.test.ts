import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  CONTEXT_PREFIX,
  PIN_INLINE_MAX_BYTES,
  PINS_MAX,
  cleanContext,
  contextFile,
  fenceFor,
  loadContext,
  pinBlock,
  pinTitleLine,
  pinnedSection,
  pinsLayout,
  saveContext,
  titleOf,
} from "../src";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "hh-ctx-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
const AT = "2026-10-28T10:00:00.000Z";

describe("the context file", () => {
  it("lives at .harness/context/<scope>.json", () => {
    expect(CONTEXT_PREFIX).toBe(".harness/context/");
    expect(contextFile("/b", "main")).toBe(path.join("/b", ".harness", "context", "main.json"));
    expect(contextFile("/b", "_app")).toBe(path.join("/b", ".harness", "context", "_app.json"));
    expect(() => contextFile("/b", "../x")).toThrow();
  });

  it("is cleaned field by field: bad shapes, duplicates and the overflow are dropped", () => {
    const raw = {
      version: 1,
      pinned: [{ path: "a.md", at: AT }, { path: "a.md", at: AT }, { path: "../out.md", at: AT }, { path: "b.md", at: "never" }, { path: 3 }, "x"],
      excluded: [{ note: ".harness/notes/q-x.md", at: AT }, { note: "/abs.md", at: AT }],
    };
    expect(cleanContext(raw)).toEqual({ version: 1, pinned: [{ path: "a.md", at: AT }], excluded: [{ note: ".harness/notes/q-x.md", at: AT }] });
    expect(cleanContext({ version: 2 })).toEqual({ version: 1, pinned: [], excluded: [] });
    const many = { version: 1, pinned: Array.from({ length: PINS_MAX + 5 }, (_, i) => ({ path: `f${i}.md`, at: AT })), excluded: [] };
    expect(cleanContext(many).pinned).toHaveLength(PINS_MAX);
  });

  it("missing or broken reads as empty; save writes atomically and an empty file is removed", async () => {
    const base = fs.mkdtempSync(path.join(root, "b-"));
    expect(await loadContext(base, "main")).toEqual({ version: 1, pinned: [], excluded: [] });
    fs.mkdirSync(path.join(base, ".harness", "context"), { recursive: true });
    fs.writeFileSync(contextFile(base, "main"), "{not json");
    expect(await loadContext(base, "main")).toEqual({ version: 1, pinned: [], excluded: [] });
    await saveContext(base, "main", { version: 1, pinned: [{ path: "a.md", at: AT }], excluded: [] });
    expect(await loadContext(base, "main")).toEqual({ version: 1, pinned: [{ path: "a.md", at: AT }], excluded: [] });
    expect(fs.readdirSync(path.join(base, ".harness", "context"))).toEqual(["main.json"]);
    await saveContext(base, "main", { version: 1, pinned: [], excluded: [] });
    expect(fs.existsSync(contextFile(base, "main"))).toBe(false);
  });
});

describe("pinsLayout (§4.2 budget)", () => {
  const pin = (p: string, size: number | null, binary = false) => ({ scope: "main", path: p, at: AT, size, binary });

  it("whole in pin order while they fit; the first that doesn't fit and every later one are title only", () => {
    const views = pinsLayout([pin("a.md", 4000), pin("b.md", 12_000), pin("c.md", 400)], 3000);
    expect(views.map((v) => [v.path, v.state, v.tokens])).toEqual([
      ["a.md", "full", 1000],
      ["b.md", "title", 3000],
      ["c.md", "title", 100],
    ]);
  });

  it("missing and binary are skipped; over 1 MB is always title only and spends nothing", () => {
    const views = pinsLayout([pin("gone.md", null), pin("img.png", 10, true), pin("big.log", PIN_INLINE_MAX_BYTES + 1), pin("a.md", 400)], 3000);
    expect(views.map((v) => v.state)).toEqual(["missing", "binary", "title", "full"]);
  });
});

describe("the pinned section", () => {
  it("fences a file one backtick longer than its longest run", () => {
    expect(fenceFor("plain")).toBe("```");
    expect(fenceFor("a ```` b ``` c")).toBe("`````");
  });

  it("titles a file by its first # heading in 2 KB, else its name", () => {
    expect(titleOf("intro\n# Conventions\nbody", "docs/conv.md")).toBe("Conventions");
    expect(titleOf("## Not a title", "docs/conv.md")).toBe("conv.md");
    expect(titleOf(`${"x".repeat(3000)}\n# Late`, "a/late.md")).toBe("late.md");
  });

  it("writes whole pins under their path, then the titles with how to open them; nothing for nothing", () => {
    const text = pinnedSection([pinBlock("conventions.md", "Use pnpm.")], [pinTitleLine("Architecture", "docs/arch.md")]);
    expect(text).toBe(
      [
        "## Pinned by the person",
        "",
        "### conventions.md",
        "",
        "```",
        "Use pnpm.",
        "```",
        "",
        "### Also pinned",
        "- Architecture → docs/arch.md",
        "",
        "Open these with your read tool when you need them.",
      ].join("\n"),
    );
    expect(pinnedSection([], [])).toBe("");
  });
});
