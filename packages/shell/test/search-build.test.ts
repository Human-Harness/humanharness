import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SearchDoc } from "@humanharness/search";
import { type BuildJob, type BuildMessage, build } from "../src/main/search/build";
import { workerBuild } from "../src/main/search/runner";

let root: string;
const put = (rel: string, text: string | Buffer = "x") => {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "hh-search-build-"));
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

const job = (o: Partial<BuildJob> = {}): BuildJob => ({ roots: [{ key: "folder", path: root }], scoped: false, known: {}, chats: {}, ...o });
async function run(j: BuildJob) {
  const msgs: BuildMessage[] = [];
  await build(j, (m) => msgs.push(m));
  const docs = new Map<string, SearchDoc>();
  for (const m of msgs) {
    if (m.type === "names" || m.type === "docs") for (const d of m.docs) docs.set(d.id, d);
    if (m.type === "removed") for (const id of m.ids) docs.delete(id);
  }
  const done = msgs.at(-1);
  if (done?.type !== "done") throw new Error("no done");
  return { msgs, docs, done };
}

describe("build (§4.3)", () => {
  it("first build: names first, then texts, then done with how each file went", async () => {
    put("docs/guide.md", "# Guide\nthe context window");
    put("pic.png", Buffer.from([0, 1, 2]));
    put("big.txt", "a".repeat(2 * 1024 * 1024));
    put("keys.txt", `AKIAABCDEFGHIJKLMNOP\nharmless words`);
    put(".harness/notes/n.md", `---\ntitle: Engines\n---\nbudget\nghp_${"A".repeat(36)}`);
    const { msgs, docs, done } = await run(job());
    expect(msgs[0].type).toBe("names");
    expect(docs.get("file:folder/docs/guide.md")?.text).toContain("context window");
    expect(done.files["folder/docs/guide.md"].how).toBe("text");
    expect(done.files["folder/pic.png"].how).toBe("name-only");
    expect(done.files["folder/big.txt"].how).toBe("name-only");
    expect(done.files["folder/keys.txt"].how).toBe("skipped:secret-shaped");
    expect(docs.get("file:folder/keys.txt")?.text).toBe("");
    const note = docs.get("note:.harness/notes/n.md");
    expect(note?.title).toBe("Engines");
    expect(note?.text).toContain("budget");
    expect(note?.text).not.toContain("ghp_");
  });

  it("a reconcile reads only what changed and drops what is gone", async () => {
    put("a.md", "alpha");
    put("b.md", "beta");
    const first = await run(job());
    fs.rmSync(path.join(root, "b.md"));
    put("a.md", "alpha changed text");
    fs.utimesSync(path.join(root, "a.md"), new Date(), new Date(Date.now() + 5000));
    put("c.md", "gamma");
    const { msgs, done } = await run(job({ known: first.done.files, chats: first.done.chats }));
    expect(msgs.some((m) => m.type === "names")).toBe(false);
    const changed = msgs.flatMap((m) => (m.type === "docs" ? m.docs.map((d) => d.id) : []));
    expect(changed.sort()).toEqual(["file:folder/a.md", "file:folder/c.md"]);
    expect(msgs.some((m) => m.type === "removed" && m.ids.includes("file:folder/b.md"))).toBe(true);
    expect(Object.keys(done.files).sort()).toEqual(["folder/a.md", "folder/c.md"]);
  });

  it("a commit's paths only: re-reads those, drops the missing ones", async () => {
    put("a.md", "alpha");
    const first = await run(job());
    put("new.md", "fresh");
    fs.rmSync(path.join(root, "a.md"));
    const { docs, done, msgs } = await run(job({ known: first.done.files, only: ["new.md", "a.md"] }));
    expect(docs.get("file:folder/new.md")?.text).toBe("fresh");
    expect(msgs.some((m) => m.type === "removed" && m.ids.includes("file:folder/a.md"))).toBe(true);
    expect(Object.keys(done.files)).toEqual(["folder/new.md"]);
  });

  it("the folder first, then reference folders, up to the file cap", async () => {
    const ref = fs.mkdtempSync(path.join(os.tmpdir(), "hh-search-ref-"));
    try {
      put("a.md");
      put("b.md");
      fs.writeFileSync(path.join(ref, "r.md"), "ref");
      const { done } = await run(job({ roots: [{ key: "folder", path: root }, { key: "ref:docs", path: ref }], limits: { files: 2, textBytes: 1024 * 1024, totalText: 1e9 } }));
      expect(Object.keys(done.files).sort()).toEqual(["folder/a.md", "folder/b.md"]);
      expect(done.truncated).toBe(true);
    } finally {
      fs.rmSync(ref, { recursive: true, force: true });
    }
  });

  it("over the total text cap, the largest files go name-only", async () => {
    put("small.md", "s".repeat(10));
    put("large.md", "l".repeat(100));
    const { done } = await run(job({ limits: { files: 100, textBytes: 1024 * 1024, totalText: 50 } }));
    expect(done.files["folder/large.md"].how).toBe("skipped:total-cap");
    expect(done.files["folder/small.md"].how).toBe("text");
  });

  it("chats: entry by entry, from the stored offset on; a shorter file starts over", async () => {
    const entry = (id: string, text: string) => `${JSON.stringify({ id, role: "user", text, at: "2026-10-30T10:00:00.000Z" })}\n`;
    put(".harness/chats/main.jsonl", entry("u1", "first question"));
    const first = await run(job());
    expect(first.docs.has("chat:.harness/chats/main.jsonl#u1")).toBe(true);
    fs.appendFileSync(path.join(root, ".harness/chats/main.jsonl"), `${entry("u2", "second question")}{"partial`);
    const second = await run(job({ known: first.done.files, chats: first.done.chats }));
    expect([...second.docs.keys()].filter((k) => k.startsWith("chat:"))).toEqual(["chat:.harness/chats/main.jsonl#u2"]);
    expect(second.done.chats[".harness/chats/main.jsonl"].ids).toEqual(["chat:.harness/chats/main.jsonl#u1", "chat:.harness/chats/main.jsonl#u2"]);
    put(".harness/chats/main.jsonl", entry("u9", "after a switch"));
    const third = await run(job({ known: second.done.files, chats: second.done.chats }));
    expect(third.msgs.some((m) => m.type === "removed" && m.ids.includes("chat:.harness/chats/main.jsonl#u1"))).toBe(true);
    expect(third.done.chats[".harness/chats/main.jsonl"].ids).toEqual(["chat:.harness/chats/main.jsonl#u9"]);
  });
});

describe("workerBuild", () => {
  it("runs the build in a worker thread and settles true", async () => {
    put("a.md", "alpha");
    const msgs: BuildMessage[] = [];
    const { done } = workerBuild()(job(), (m) => msgs.push(m));
    expect(await done).toBe(true);
    expect(msgs.at(-1)?.type).toBe("done");
  });
});
