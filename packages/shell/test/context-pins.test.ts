import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { PIN_INLINE_MAX_BYTES, saveContext } from "@humanharness/workspace";
import { checkPinPath, pinShapeOk, pinnedContext } from "../src/main/context-pins";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "hh-pins-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
const AT = "2026-10-28T10:00:00.000Z";

function folder(files: Record<string, string | Buffer>): string {
  const base = fs.mkdtempSync(path.join(root, "b-"));
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(base, rel)), { recursive: true });
    fs.writeFileSync(path.join(base, rel), content);
  }
  return base;
}

describe("where a pin may point (§4.2)", () => {
  it("the folder, and under .harness/ only the notes; never .claude/ or a shape the reader refuses", () => {
    expect(pinShapeOk("docs/conventions.md")).toBe(true);
    expect(pinShapeOk(".harness/notes/q-x.md")).toBe(true);
    expect(pinShapeOk(".harness/tasks.json")).toBe(false);
    expect(pinShapeOk(".claude/settings.json")).toBe(false);
    expect(pinShapeOk("../out.md")).toBe(false);
    expect(pinShapeOk("/etc/hosts")).toBe(false);
  });

  it("never .git (at any depth), in any case, and only plain segments (no way around a prefix)", () => {
    expect(pinShapeOk(".git/config")).toBe(false);
    expect(pinShapeOk("sub/.git/config")).toBe(false);
    expect(pinShapeOk(".GIT/config")).toBe(false);
    expect(pinShapeOk(".Claude/settings.json")).toBe(false);
    expect(pinShapeOk(".Harness/tasks.json")).toBe(false);
    expect(pinShapeOk("docs/../.harness/tasks.json")).toBe(false);
    expect(pinShapeOk("./.git/config")).toBe(false);
    expect(pinShapeOk("docs//a.md")).toBe(false);
    expect(pinShapeOk(".harness/notes/")).toBe(false);
  });

  it("checks the file: inside, there, text; a link out is outside", async () => {
    const outside = folder({ "secret.md": "s" });
    const base = folder({ "a.md": "hello", "img.png": Buffer.from([1, 2, 3]), "nul.txt": Buffer.from([65, 0, 66]) });
    fs.symlinkSync(path.join(outside, "secret.md"), path.join(base, "link.md"));
    expect(await checkPinPath(base, "a.md", { text: true })).toMatchObject({ ok: true, size: 5 });
    expect(await checkPinPath(base, "gone.md", { text: true })).toEqual({ ok: false, reason: "missing" });
    expect(await checkPinPath(base, "img.png", { text: true })).toEqual({ ok: false, reason: "binary" });
    expect(await checkPinPath(base, "nul.txt", { text: true })).toEqual({ ok: false, reason: "binary" });
    expect(await checkPinPath(base, "img.png", { text: false })).toMatchObject({ ok: true });
    expect(await checkPinPath(base, "link.md", { text: true })).toEqual({ ok: false, reason: "outside" });
    expect(await checkPinPath(base, "../x.md", { text: true })).toEqual({ ok: false, reason: "outside" });
  });

  it("a link inside the folder to the app's files or to .git is outside too", async () => {
    const base = folder({ ".harness/tasks.json": "{}", ".git/config": "[core]", ".harness/notes/q.md": "# Q" });
    fs.symlinkSync(path.join(base, ".harness", "tasks.json"), path.join(base, "tasks.md"));
    fs.symlinkSync(path.join(base, ".git", "config"), path.join(base, "config.md"));
    fs.symlinkSync(path.join(base, ".harness", "notes", "q.md"), path.join(base, "q.md"));
    expect(await checkPinPath(base, "tasks.md", { text: true })).toEqual({ ok: false, reason: "outside" });
    expect(await checkPinPath(base, "config.md", { text: false })).toEqual({ ok: false, reason: "outside" });
    expect(await checkPinPath(base, "q.md", { text: true })).toMatchObject({ ok: true });
  });

  it("a name that can't sit in the prompt (a backtick, a line break) is its own refusal, not 'outside'", async () => {
    const base = folder({ "a`b.md": "x" });
    expect(await checkPinPath(base, "a`b.md", { text: true })).toEqual({ ok: false, reason: "bad-name" });
    expect(await checkPinPath(base, "a\nb.md", { text: false })).toEqual({ ok: false, reason: "bad-name" });
  });
});

describe("pinnedContext (§4.2, §6)", () => {
  it("scope pins then app pins, whole within the budget, the rest as titles; missing and binary skipped; exclusions joined", async () => {
    const base = folder({ "conv.md": "Use pnpm.", "arch.md": `# Architecture\n${"x".repeat(20_000)}`, "img.png": Buffer.from([0]) });
    await saveContext(base, "fracciones", { version: 1, pinned: [{ path: "conv.md", at: AT }, { path: "gone.md", at: AT }], excluded: [{ note: ".harness/notes/fracciones/a.md", at: AT }] });
    await saveContext(base, "_app", { version: 1, pinned: [{ path: "arch.md", at: AT }, { path: "img.png", at: AT }], excluded: [{ note: ".harness/notes/_app/b.md", at: AT }] });
    const ctx = await pinnedContext(base, ["fracciones", "_app"], 3000);
    expect(ctx.pinned).toContain("### conv.md");
    expect(ctx.pinned).toContain("Use pnpm.");
    expect(ctx.pinned).toContain("- Architecture → arch.md");
    expect(ctx.pinned).not.toContain("xxxxx");
    expect(ctx.items.map((i) => [i.id, i.kind, i.scope])).toEqual([
      ["pin:fracciones:conv.md", "pinned", "fracciones"],
      ["pin:_app:arch.md", "pinned-title", "_app"],
    ]);
    expect([...ctx.excluded]).toEqual([".harness/notes/fracciones/a.md", ".harness/notes/_app/b.md"]);
  });

  it("a hand-edited pin of the app's files never enters", async () => {
    const base = folder({ ".harness/tasks.json": '{"secret":1}' });
    await saveContext(base, "main", { version: 1, pinned: [{ path: ".harness/tasks.json", at: AT }], excluded: [] });
    const ctx = await pinnedContext(base, ["main"], 3000);
    expect(ctx).toEqual({ pinned: "", items: [], excluded: new Set() });
  });

  it("a file over 1 MB enters as its title whatever the budget", async () => {
    const base = folder({ "big.log": `# Big\n${"y".repeat(PIN_INLINE_MAX_BYTES)}` });
    await saveContext(base, "main", { version: 1, pinned: [{ path: "big.log", at: AT }], excluded: [] });
    const ctx = await pinnedContext(base, ["main"], 1_000_000);
    expect(ctx.items[0].kind).toBe("pinned-title");
    expect(ctx.pinned).toContain("- Big → big.log");
  });

  it("D0: no file, nothing at all", async () => {
    const ctx = await pinnedContext(folder({}), ["main"], 3000);
    expect(ctx).toEqual({ pinned: "", items: [], excluded: new Set() });
  });
});
