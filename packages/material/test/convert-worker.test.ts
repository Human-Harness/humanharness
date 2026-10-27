import { describe, expect, it } from "vitest";
import { type ConvertRunner, MaterialRefused, convertFile, convertInWorker, limitRunner, measureFile, workerRunner } from "../src";
import { body, makePdf } from "./make-pdf";

const worker = (name: string) => new URL(`./workers/${name}.mjs`, import.meta.url);
const md = Buffer.from(`# Title\n\n${"Some words in a sentence. ".repeat(80)}\n\n## Next\n\nMore text.`);

describe("convertInWorker: every converter runs off the calling thread", () => {
  it("converts and measures like the converters themselves", async () => {
    const job = { type: "md", data: md, name: "a.md" } as const;
    expect(await convertInWorker({ op: "convert", ...job })).toEqual(await convertFile("md", md, { name: "a.md" }));
    expect(await convertInWorker({ op: "measure", ...job })).toEqual(await measureFile("md", md, "a.md"));
    const pdf = makePdf([body(["Page one."]), body(["Page two."]), []]);
    expect(await convertInWorker({ op: "measure", type: "pdf", data: pdf, name: "b.pdf" })).toEqual({ pages: 3, textPages: 2, checked: 3, tokens: 1000 });
    const range = await convertInWorker({ op: "convert", type: "pdf", data: pdf, name: "b.pdf", pageRange: [2, 2] });
    expect(range.blocks.map((b) => b.md)).toEqual(["Page two."]);
  });

  it("a converter's refusal comes back with its reason", async () => {
    const err = await convertInWorker({ op: "convert", type: "docx", data: Buffer.from("PK\u0003\u0004 broken"), name: "x.docx" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MaterialRefused);
    expect(err).toMatchObject({ reason: "unreadable" });
  });

  it("a worker that runs out of heap is a refusal, and this process lives on", async () => {
    const err = await convertInWorker({ op: "convert", type: "md", data: md, name: "a.md" }, { entry: worker("oom"), heapMb: 16 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MaterialRefused);
    expect(err).toMatchObject({ reason: "too-big" });
    // Still alive: another conversion works.
    expect((await convertInWorker({ op: "convert", type: "md", data: md, name: "a.md" })).blocks.length).toBeGreaterThan(0);
  });

  it("a worker that takes too long is stopped and refused", async () => {
    const t = Date.now();
    await expect(convertInWorker({ op: "measure", type: "md", data: md, name: "a.md" }, { entry: worker("hang"), timeoutMs: 300 })).rejects.toMatchObject({ reason: "too-big" });
    expect(Date.now() - t).toBeLessThan(5000);
  });

  it("a crash or an answer it can't trust is unreadable", async () => {
    await expect(convertInWorker({ op: "measure", type: "md", data: md, name: "throw" }, { entry: worker("odd") })).rejects.toMatchObject({ reason: "unreadable" });
    await expect(convertInWorker({ op: "measure", type: "md", data: md, name: "odd" }, { entry: worker("odd") })).rejects.toMatchObject({ reason: "unreadable" });
  });

  it("workerRunner binds the options", async () => {
    const runner = workerRunner({ entry: worker("hang"), timeoutMs: 200 });
    await expect(runner.convert("md", md, { name: "a.md" })).rejects.toMatchObject({ reason: "too-big" });
  });
});

describe("limitRunner: a few conversions at a time", () => {
  it("runs at most `n` jobs at once, in order, and a refusal frees its place", async () => {
    let running = 0;
    let most = 0;
    const order: string[] = [];
    const slow = (name: string) =>
      new Promise<never>((_, reject) => {
        running++;
        most = Math.max(most, running);
        order.push(name);
        setTimeout(() => {
          running--;
          reject(new MaterialRefused("unreadable"));
        }, 20);
      });
    const inner: ConvertRunner = { convert: (_t, _b, o) => slow(o.name), measure: (_t, _b, name) => slow(name) };
    const runner = limitRunner(inner, 2);
    const jobs = ["a", "b", "c", "d", "e"].map((n, i) => (i % 2 ? runner.measure("md", md, n) : runner.convert("md", md, { name: n })));
    const results = await Promise.allSettled(jobs);
    expect(results.every((r) => r.status === "rejected")).toBe(true);
    expect(most).toBe(2);
    expect(order).toEqual(["a", "b", "c", "d", "e"]);
  });
});
