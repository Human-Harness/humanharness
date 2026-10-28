import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Event } from "@humanharness/runtime";
import { LABEL_MAX, READS_MAX, approxTokens, folderPath, markCompacted, mergeReads, readsOf } from "../src/main/context-record";

type Activity = Extract<Event, { type: "activity" }>;

const base = path.resolve("/work/folder");
const activity = (over: Partial<Activity>): Activity => ({
  type: "activity",
  id: "a1",
  kind: "read",
  detail: "x.md",
  state: "start",
  ...over,
});

describe("approxTokens", () => {
  it("is characters / 4 rounded to 100, at least 100 for any text", () => {
    expect(approxTokens(0)).toBe(0);
    expect(approxTokens(4)).toBe(100);
    expect(approxTokens(1000)).toBe(300);
    expect(approxTokens(25_000)).toBe(6300);
  });
});

describe("folderPath", () => {
  it("relative with forward slashes inside the folder, null outside", () => {
    expect(folderPath(base, path.join(base, "docs", "a.md"))).toBe("docs/a.md");
    expect(folderPath(base, "notes/b.md")).toBe("notes/b.md");
    expect(folderPath(base, base)).toBeNull();
    expect(folderPath(base, path.resolve("/work/other/c.md"))).toBeNull();
    expect(folderPath(base, path.join(base, "..", "folder-x", "d.md"))).toBeNull();
  });
});

describe("readsOf", () => {
  it("turns read and search paths into folder paths, outside files into their name", () => {
    expect(readsOf(activity({ paths: [path.join(base, "a.md"), "/elsewhere/ref.pdf"] }), base)).toEqual([
      { kind: "read", label: "a.md", path: "a.md" },
      { kind: "read", label: "ref.pdf" },
    ]);
    expect(readsOf(activity({ kind: "search", paths: [path.join(base, "src")] }), base)).toEqual([{ kind: "read", label: "src", path: "src" }]);
  });

  it("records a tool by server and name; ignores ends, edits and plain activities", () => {
    expect(readsOf(activity({ kind: "other", tool: { server: "atlassian", name: "getJiraIssue" } }), base)).toEqual([{ kind: "tool", label: "atlassian · getJiraIssue" }]);
    expect(readsOf(activity({ kind: "other", tool: { server: "notes", name: "" } }), base)).toEqual([{ kind: "tool", label: "notes" }]);
    expect(readsOf(activity({ state: "end", paths: [path.join(base, "a.md")] }), base)).toEqual([]);
    expect(readsOf(activity({ kind: "edit", paths: [path.join(base, "a.md")] }), base)).toEqual([]);
    expect(readsOf(activity({}), base)).toEqual([]);
  });

  it("caps labels at 200 characters; a tool without a server is not recorded", () => {
    const long = "n".repeat(300);
    expect(readsOf(activity({ kind: "other", tool: { server: "s", name: long } }), base)[0].label).toHaveLength(LABEL_MAX);
    const [inside] = readsOf(activity({ paths: [path.join(base, `${long}.md`)] }), base);
    expect(inside.label).toHaveLength(LABEL_MAX);
    expect(inside.path).toBe(`${long}.md`);
    expect(readsOf(activity({ paths: [`/elsewhere/${long}.pdf`] }), base)[0].label).toHaveLength(LABEL_MAX);
    expect(readsOf(activity({ kind: "other", tool: { server: "", name: "x" } }), base)).toEqual([]);
  });

  it("takes at most 20 paths of one event", () => {
    const many = Array.from({ length: 30 }, (_, i) => path.join(base, `f${i}.md`));
    expect(readsOf(activity({ paths: many }), base)).toHaveLength(20);
  });
});

describe("mergeReads", () => {
  it("one entry per path or tool, with the first time and a count; a new read clears compacted", () => {
    const first = mergeReads([], [{ kind: "read", label: "a.md", path: "a.md" }, { kind: "tool", label: "data · data_query" }, { kind: "read", label: "a.md", path: "a.md" }], "T1");
    expect(first).toEqual([
      { kind: "read", label: "a.md", path: "a.md", firstAt: "T1", count: 2 },
      { kind: "tool", label: "data · data_query", firstAt: "T1", count: 1 },
    ]);
    const after = mergeReads(markCompacted(first), [{ kind: "read", label: "a.md", path: "a.md" }], "T2");
    expect(after[0]).toEqual({ kind: "read", label: "a.md", path: "a.md", firstAt: "T1", count: 3 });
    expect(after[1].compacted).toBe(true);
  });

  it("keeps at most READS_MAX entries; counts of known ones still grow", () => {
    const full = Array.from({ length: READS_MAX }, (_, i) => ({ kind: "read" as const, label: `f${i}`, path: `f${i}`, firstAt: "T0", count: 1 }));
    const next = mergeReads(full, [{ kind: "read", label: "new", path: "new" }, { kind: "read", label: "f0", path: "f0" }], "T1");
    expect(next).toHaveLength(READS_MAX);
    expect(next[0].count).toBe(2);
    expect(next.some((r) => r.path === "new")).toBe(false);
  });
});
