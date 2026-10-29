import { describe, expect, it } from "vitest";
import { type TimelineCommit, classifyCommit, groupTimeline, namedPath } from "../src/file-timeline";

const DOC = "specs/filter.md";
let n = 0;
/** A commit of the file, `minute` minutes after 10:00; `blob` null: the file is not there. */
function c(subject: string, opts: { task?: string; action?: string; tool?: string; blob?: string | null; minute?: number } = {}): TimelineCommit {
  n++;
  const id = n.toString(16).padStart(40, "0");
  return {
    id,
    parent: (n - 1).toString(16).padStart(40, "0"),
    subject,
    task: opts.task ?? null,
    action: opts.action ?? null,
    at: new Date(Date.UTC(2026, 9, 28, 10, opts.minute ?? n)).toISOString(),
    blob: opts.blob === undefined ? `b${n}` : opts.blob,
    ...(opts.tool ? { tool: opts.tool } : {}),
  };
}
const label = (id: string | null) => (id === "spec" ? "Spec writer" : id === null ? "A question" : id);

describe("namedPath", () => {
  it("reads the path an answer or an approval names, and nothing else", () => {
    expect(namedPath(`Answer: ${DOC} · Size only?`)).toBe(DOC);
    expect(namedPath(`Approved: ${DOC}`)).toBe(DOC);
    expect(namedPath("Answer: no separator")).toBeNull();
    expect(namedPath("Approved: ../out.md")).toBeNull();
    expect(namedPath("Turn: write it")).toBeNull();
  });
});

describe("classifyCommit", () => {
  it("goes by subject before trailer", () => {
    expect(classifyCommit(c(`Answer: ${DOC} · q`, { task: "t1" }), DOC).kind).toBe("answers");
    expect(classifyCommit(c(`Approved: ${DOC}`, { task: "t1" }), DOC).kind).toBe("approval");
    expect(classifyCommit(c("Undo: the turn did not finish", { task: "t1" }), DOC).kind).toBe("goBack");
    expect(classifyCommit(c(`Go back: ${DOC} to v1`), DOC).kind).toBe("goBack");
    expect(classifyCommit(c("Went back to an earlier point"), DOC).kind).toBe("goBack");
    expect(classifyCommit(c("Went back to before the task"), DOC).kind).toBe("goBack");
    expect(classifyCommit(c("Start"), DOC).kind).toBe("outside");
    expect(classifyCommit(c("Before message", { task: "t1" }), DOC).kind).toBe("outside");
    expect(classifyCommit(c("Approved: other.md", { task: "t1" }), DOC).kind).toBe("outside");
    expect(classifyCommit(c("Turn: write", { task: "t1", action: "spec" }), DOC).kind).toBe("task");
    expect(classifyCommit(c("Material: added a.pdf"), DOC).kind).toBe("outside");
  });
});

describe("groupTimeline", () => {
  it("one entry per task, newest first; turns, notes and data writes of one task merge", () => {
    const commits = [
      c("Start"),
      c("Turn: write the spec", { task: "t1", action: "spec" }),
      c("Note: Filter", { task: "t1", action: "spec" }),
      c("Turn: a question", { task: "t2" }),
    ];
    const entries = groupTimeline(commits, DOC, label);
    expect(entries.map((e) => [e.kind, e.author.label, e.commits.length])).toEqual([
      ["task", "A question", 1],
      ["task", "Spec writer", 2],
      ["outside", "Outside the app", 1],
    ]);
    const spec = entries[1];
    expect(spec.from).toBe(commits[1].parent);
    expect(spec.to).toBe(commits[2].id);
    expect(spec.at).toBe(commits[2].at);
    expect(spec.label).toBe("2 changes");
    expect(spec.author).toEqual({ kind: "agent", label: "Spec writer", task: "t1", action: "spec" });
    expect(spec.commits.map((x) => x.subject)).toEqual(["Note: Filter", "Turn: write the spec"]);
  });

  it("a task split by answers is two entries; answers merge and are unapproved until an approval follows", () => {
    const entries = groupTimeline(
      [
        c("Turn: write", { task: "t1", action: "spec" }),
        c(`Answer: ${DOC} · q1`, { task: "t1" }),
        c(`Answer: ${DOC} · q2`, { task: "t1" }),
        c("Turn: edit", { task: "t1", action: "spec" }),
        c(`Answer: ${DOC} · q3`, { task: "t1" }),
      ],
      DOC,
      label,
    );
    expect(entries.map((e) => [e.kind, e.commits.length, e.unapproved ?? false])).toEqual([
      ["answers", 1, true],
      ["task", 1, false],
      ["answers", 2, true],
      ["task", 1, false],
    ]);
    expect(entries[2].label).toBe("Your answers (2)");
    expect(entries[2].author).toEqual({ kind: "person", label: "You" });
  });

  it("approvals are numbered v1, v2…; answers before an approval are approved", () => {
    const entries = groupTimeline(
      [c(`Answer: ${DOC} · q`, { task: "t1" }), c(`Approved: ${DOC}`, { task: "t1" }), c("Turn: edit", { task: "t1" }), c(`Approved: ${DOC}`, { task: "t1" })],
      DOC,
      label,
    );
    expect(entries.map((e) => [e.kind, e.version, e.label])).toEqual([
      ["approval", 2, "v2 approved"],
      ["task", undefined, "1 change"],
      ["approval", 1, "v1 approved"],
      ["answers", undefined, "Your answers (1)"],
    ]);
    expect(entries[3].unapproved).toBeUndefined();
  });

  it("a go-back names what it went back to by blob: an approval's version, else a time, else nothing", () => {
    const commits = [
      c("Turn: write", { task: "t1", blob: "A" }),
      c(`Approved: ${DOC}`, { task: "t1", blob: "A" }),
      c("Turn: edit", { task: "t1", blob: "B" }),
      c(`Go back: ${DOC} to v1`, { blob: "A" }),
      c("Turn: again", { task: "t2", blob: "C" }),
      c("Went back to an earlier point", { blob: "B" }),
      c("Went back to before the task", { blob: "Z" }),
    ];
    const [unknown, toTime, , toV1] = groupTimeline(commits, DOC, label);
    expect(toV1.back).toEqual({ version: 1 });
    expect(toV1.label).toBe("Went back to v1");
    expect(toTime.back).toEqual({ at: commits[2].at });
    expect(unknown.back).toBeUndefined();
    expect(unknown.label).toBe("Went back to an earlier version");
    expect(toV1.author).toEqual({ kind: "person", label: "You" });
  });

  it("a crash undo belongs to the task's agent", () => {
    const [undo] = groupTimeline([c("Turn: write", { task: "t1", action: "spec" }), c("Undo: the turn did not finish", { task: "t1", action: "spec" })], DOC, label);
    expect(undo.kind).toBe("goBack");
    expect(undo.author).toEqual({ kind: "agent", label: "Spec writer", task: "t1", action: "spec" });
  });

  it("a deleted file: the last entry says Deleted", () => {
    const [gone, before] = groupTimeline([c("Turn: write", { task: "t1" }), c("Turn: remove", { task: "t2", blob: null })], DOC, label);
    expect(gone.deleted).toBe(true);
    expect(gone.label).toBe("Deleted");
    expect(before.deleted).toBeUndefined();
  });

  it("each entry carries the file's blob id at its last commit; none when deleted", () => {
    const [gone, edit] = groupTimeline([c("Turn: write", { task: "t1", blob: "A" }), c("Turn: remove", { task: "t2", blob: null })], DOC, label);
    expect(edit.blob).toBe("A");
    expect(gone.blob).toBeUndefined();
  });

  it("an answer to a document whose name holds the separator is still its answer", () => {
    const odd = "notes/a · b.md";
    expect(classifyCommit(c(`Answer: ${odd} · Size only?`, { task: "t1" }), odd).kind).toBe("answers");
    expect(classifyCommit(c(`Answer: ${odd} · Size only?`, { task: "t1" }), "notes/a · c.md").kind).toBe("outside");
  });

  it("answers are unapproved only after the last approval, in one pass", () => {
    const commits = [c("Turn: write", { task: "t1" })];
    for (let i = 0; i < 5000; i++) commits.push(c(`Answer: ${DOC} · q${i}`), c("Turn: edit", { task: `t${i + 2}` }));
    commits.push(c(`Approved: ${DOC}`), c(`Answer: ${DOC} · late`));
    const t0 = performance.now();
    const entries = groupTimeline(commits, DOC, label);
    expect(performance.now() - t0).toBeLessThan(2000);
    expect(entries[0]).toMatchObject({ kind: "answers", unapproved: true });
    expect(entries.filter((e) => e.unapproved)).toHaveLength(1);
  });

  it("the first commit of the history has no parent", () => {
    const first = { ...c("Start"), parent: null };
    expect(groupTimeline([first], DOC, label)[0].from).toBeNull();
  });
});

describe("a tool's commits (tools spec §8.3)", () => {
  it("an entry whose commit has Tool: shows the tool's id as the author", () => {
    const entries = groupTimeline([c("Data: cards", { tool: "due-today" }), c("Data: cards", { task: "t1", action: "spec", tool: "apply-triage" })], DOC, label);
    expect(entries.map((e) => [e.kind, e.author])).toEqual([
      ["task", { kind: "tool", label: "apply-triage", tool: "apply-triage", task: "t1", action: "spec" }],
      ["task", { kind: "tool", label: "due-today", tool: "due-today" }],
    ]);
  });

  it("a tool's commits don't merge with the task's own turns", () => {
    const entries = groupTimeline([c("Turn: a", { task: "t1", action: "spec" }), c("Data: cards", { task: "t1", action: "spec", tool: "apply-triage" }), c("Turn: b", { task: "t1", action: "spec" })], DOC, label);
    expect(entries.map((e) => e.author.kind)).toEqual(["agent", "tool", "agent"]);
  });

  it("D0: without Tool: the author is as before", () => {
    const entries = groupTimeline([c("Turn: a", { task: "t1", action: "spec" }), c("Data: cards")], DOC, label);
    expect(entries.map((e) => e.author)).toEqual([{ kind: "outside", label: "Outside the app" }, { kind: "agent", label: "Spec writer", task: "t1", action: "spec" }]);
  });
});
