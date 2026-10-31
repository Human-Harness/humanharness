import { afterEach, describe, expect, it } from "vitest";
import { LiveIndex, type SearchDoc } from "../src";

const doc = (id: string, text: string): SearchDoc => ({ id, kind: "file", scope: "main", title: id, path: "", text, at: 0, root: "folder" });
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Pseudo-random words, so new ones keep splitting the term tree's edges. */
function words(seed: number, n: number): string {
  let x = seed * 2654435761 + 1;
  const out: string[] = [];
  for (let w = 0; w < n; w++) {
    let s = "";
    const len = 4 + (w % 6);
    for (let c = 0; c < len; c++) {
      x = (x * 1103515245 + 12345) % 2147483648;
      s += "abcdefghijklmnopqrstuvwxyz"[x % 26];
    }
    out.push(s);
  }
  return out.join(" ");
}

describe("LiveIndex while documents keep changing", () => {
  const rejections: unknown[] = [];
  const onRejection = (err: unknown) => rejections.push(err);
  afterEach(() => {
    process.off("unhandledRejection", onRejection);
    rejections.length = 0;
  });

  // `minisearch`'s automatic vacuum walks the term tree in batches with a pause between them; a build's batch applied
  // meanwhile changed the tree under the walk, which threw in main (an unhandled rejection, and no vacuum ever again).
  it("never fails cleaning up behind replaced documents while a batch is applied", async () => {
    process.on("unhandledRejection", onRejection);
    const ix = LiveIndex.empty();
    ix.upsert(Array.from({ length: 3000 }, (_, i) => doc(`d${i}`, words(i, 8))));
    // As the build sends them: the names pass, then the texts replacing them, in one go.
    ix.upsert(Array.from({ length: 3000 }, (_, i) => doc(`d${i}`, words(10_000 + i, 8))));
    ix.remove(Array.from({ length: 100 }, (_, i) => `d${i}`));
    await wait(300);
    expect(rejections).toEqual([]);
    ix.upsert([doc("last", "zzzzunique")]);
    expect(ix.search("zzzzunique").hits.map((h) => h.id)).toEqual(["last"]);
    expect(ix.has("d50")).toBe(false);
  });

  it("compact drops what replaced and removed documents left behind, at once", () => {
    const ix = LiveIndex.empty();
    ix.upsert(Array.from({ length: 300 }, (_, i) => doc(`d${i}`, words(i, 8))));
    ix.upsert(Array.from({ length: 300 }, (_, i) => doc(`d${i}`, words(10_000 + i, 8))));
    ix.remove(["d1", "d2"]);
    expect(ix.dirt).toBeGreaterThan(0);
    ix.compact();
    expect(ix.dirt).toBe(0);
    expect(ix.size).toBe(298);
    expect(ix.search(words(10_003, 8).split(" ")[0]).hits.map((h) => h.id)).toContain("d3");
  });
});
