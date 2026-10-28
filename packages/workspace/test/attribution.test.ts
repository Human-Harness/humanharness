import { describe, expect, it } from "vitest";
import { attribute, conflictsOf } from "../src";

const set = (...p: string[]) => new Set(p);

describe("attribute (parallel spec §5.2, Decision 4, T2)", () => {
  it("no overlap: every changed path is owned", () => {
    expect(attribute({ changed: ["b", "a"], overlapped: false, ownEdits: set(), others: [] })).toEqual({
      owned: ["a", "b"],
      shared: [],
      with: [],
      left: [],
    });
  });
  it("overlap: own edits owned; another running turn's edits left; the rest shared with every running turn", () => {
    const r = attribute({
      changed: ["a", "b", "c"],
      overlapped: true,
      ownEdits: set("a"),
      others: [
        { task: "t3", edits: set() },
        { task: "t2", edits: set("b") },
      ],
    });
    expect(r).toEqual({ owned: ["a"], shared: ["c"], with: ["t2", "t3"], left: ["b"] });
  });
  it("a path both turns named belongs to the one ending (its conflict is reported apart)", () => {
    const r = attribute({ changed: ["a"], overlapped: true, ownEdits: set("a"), others: [{ task: "t2", edits: set("a") }] });
    expect(r).toEqual({ owned: ["a"], shared: [], with: [], left: [] });
  });
  it("overlapped but every other turn already ended: nothing left to share with, all owned", () => {
    expect(attribute({ changed: ["a", "c"], overlapped: true, ownEdits: set("a"), others: [] })).toEqual({
      owned: ["a", "c"],
      shared: [],
      with: [],
      left: [],
    });
  });
  it("a shell write no edit event named (Codex heredoc, PT-S3) is shared, never an error", () => {
    const r = attribute({
      changed: ["notes/out.md"],
      overlapped: true,
      ownEdits: set(),
      others: [{ task: "t2", edits: set() }],
    });
    expect(r).toEqual({ owned: [], shared: ["notes/out.md"], with: ["t2"], left: [] });
  });
  it("other turns with the same task are named once in `with`", () => {
    const r = attribute({
      changed: ["x"],
      overlapped: true,
      ownEdits: set(),
      others: [
        { task: "t2", edits: set() },
        { task: "t2", edits: set() },
      ],
    });
    expect(r.with).toEqual(["t2"]);
  });
  it("a changed path listed twice counts once", () => {
    expect(attribute({ changed: ["a", "a"], overlapped: false, ownEdits: set(), others: [] }).owned).toEqual(["a"]);
  });
  it("only canonical folder-relative paths count: other spellings land in no list (T2)", () => {
    const odd = ["", ".", "/a.md", "./a.md", "sub/../a.md", "../out.md", "a\\b.md", "dir/", "a//b.md"];
    for (const overlapped of [false, true]) {
      const r = attribute({
        changed: [...odd, "a.md"],
        overlapped,
        ownEdits: set(...odd),
        others: [{ task: "t2", edits: set(...odd) }],
      });
      const all = [...r.owned, ...r.shared, ...r.left];
      expect(all).toEqual(["a.md"]);
    }
  });
});

describe("conflictsOf (parallel spec §5.3)", () => {
  const commits = [
    { sha: "2", task: "t2", paths: ["spec.md", "x.md"] },
    { sha: "1", task: "t1", paths: ["spec.md"] },
    { sha: "0", task: null, paths: ["y.md"] },
  ];
  it("a path another task's commit changed since the turn's start", () => {
    expect(conflictsOf(["spec.md", "y.md", "z.md"], commits, "t1")).toEqual([{ path: "spec.md", tasks: ["t2"] }]);
  });
  it("without an own task every task's commit counts, newest first", () => {
    expect(conflictsOf(["spec.md"], commits, undefined)).toEqual([{ path: "spec.md", tasks: ["t2", "t1"] }]);
  });
  it("a task with several commits on the path is named once", () => {
    const twice = [...commits, { sha: "3", task: "t2", paths: ["spec.md"] }];
    expect(conflictsOf(["spec.md"], twice, "t1")).toEqual([{ path: "spec.md", tasks: ["t2"] }]);
  });
  it("non-canonical paths never report a conflict", () => {
    expect(conflictsOf(["./spec.md", "/spec.md", "spec.md/"], commits, "t1")).toEqual([]);
  });
  it("results are sorted by path and each path reported once", () => {
    const two = [{ sha: "1", task: "t2", paths: ["b.md", "a.md"] }];
    expect(conflictsOf(["b.md", "a.md", "b.md"], two, "t1")).toEqual([
      { path: "a.md", tasks: ["t2"] },
      { path: "b.md", tasks: ["t2"] },
    ]);
  });
});
