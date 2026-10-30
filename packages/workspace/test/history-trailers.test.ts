import { describe, expect, it } from "vitest";
import { SHARED_PREFIX, parseCommitMessage, withTrailer } from "../src";

describe("Job: and Shared: trailers (parallel spec §5.1, §5.2)", () => {
  it("D0: without job or shared, exactly as before", () => {
    expect(withTrailer("Turn: x", { task: "t1", action: "a" })).toBe("Turn: x\n\nTask: t1\nAction: a");
    expect(parseCommitMessage("Turn: x\n\nTask: t1\nAction: a")).toEqual({ subject: "Turn: x", task: "t1", action: "a" });
    expect(withTrailer("Turn: x", { task: "t1", shared: [] })).toBe("Turn: x\n\nTask: t1");
  });

  it("writes Job: and one Shared: line per task, at most 8, valid ids only", () => {
    const shared = ["t2", "t3", "bad id", ...Array.from({ length: 10 }, (_, i) => `x${i}`)];
    const m = withTrailer("Shared: x", { task: "t1", job: "sync-jira", shared });
    const sharedLines = m.split("\n").slice(1).filter((l) => l.startsWith(SHARED_PREFIX));
    expect(sharedLines).toEqual(["t2", "t3", "x0", "x1", "x2", "x3", "x4", "x5"].map((t) => `Shared: ${t}`));
    expect(m).toContain("\nJob: sync-jira");
    expect(m).not.toContain("bad id");
    const parsed = parseCommitMessage(m);
    expect(parsed.subject).toBe("Shared: x");
    expect(parsed.task).toBe("t1");
    expect(parsed.job).toBe("sync-jira");
    expect(parsed.shared).toEqual(["t2", "t3", "x0", "x1", "x2", "x3", "x4", "x5"]);
  });

  it("drops an invalid job id when writing and when reading", () => {
    expect(withTrailer("m", { task: "t1", job: "bad job" })).toBe("m\n\nTask: t1");
    expect(parseCommitMessage("m\n\nTask: t1\nJob: -bad")).toEqual({ subject: "m", task: "t1", action: null });
  });

  it("reads at most 8 Shared: lines", () => {
    const raw = `m\n\nTask: t1\n${Array.from({ length: 12 }, (_, i) => `Shared: s${i}`).join("\n")}`;
    expect(parseCommitMessage(raw).shared).toHaveLength(8);
  });

  it("text in a subject or body never forges a Job: or Shared: trailer", () => {
    // The message is folded to one line: the would-be trailers end up in the subject.
    const forged = parseCommitMessage(withTrailer("m\n\nJob: evil\nShared: t9", { task: "t1" }));
    expect(forged).not.toHaveProperty("job");
    expect(forged).not.toHaveProperty("shared");
    // Only the last paragraph counts, and only when every line of it is a trailer line.
    expect(parseCommitMessage("m\n\nJob: evil\nShared: t9\n\nTask: t")).toEqual({ subject: "m", task: "t", action: null });
    expect(parseCommitMessage("m\n\nSome text\nTask: t\nJob: evil\nShared: t9")).toEqual({ subject: "m", task: null, action: null });
    expect(parseCommitMessage("m\n\nTask: t\nShared: two words")).toEqual({ subject: "m", task: null, action: null });
    // A subject that starts like a trailer is still just a subject.
    expect(parseCommitMessage("Shared: t2")).toEqual({ subject: "Shared: t2", task: null, action: null });
  });

  it("Shared: names each other task once and never the commit's own task", () => {
    const m = withTrailer("Shared: x", { task: "t1", shared: ["t2", "t1", "t2", "t3", "t3"] });
    expect(m).toBe("Shared: x\n\nTask: t1\nShared: t2\nShared: t3");
    // Duplicates don't use up the cap of eight.
    const many = withTrailer("Shared: x", { task: "t1", shared: ["t2", "t2", "t2", ...Array.from({ length: 8 }, (_, i) => `x${i}`)] });
    expect(parseCommitMessage(many).shared).toEqual(["t2", "x0", "x1", "x2", "x3", "x4", "x5", "x6"]);
  });

  it("SHARED_PREFIX is the shared commit's subject start", () => {
    expect(SHARED_PREFIX).toBe("Shared: ");
  });
});

describe("Tool: trailer (tools spec §8.3)", () => {
  it("withTrailer writes Tool: after the task's lines", () => {
    expect(withTrailer("Data: put cards", { task: "t1", tool: "apply-triage" })).toBe("Data: put cards\n\nTask: t1\nTool: apply-triage");
    expect(withTrailer("Data: cards", { task: "t1", action: "triage", job: "sync", shared: ["t2"], tool: "apply-triage" })).toBe(
      "Data: cards\n\nTask: t1\nAction: triage\nJob: sync\nShared: t2\nTool: apply-triage",
    );
  });

  it("a tool write with no task carries Tool: alone", () => {
    expect(withTrailer("Data: put cards", { task: null, tool: "due-today" })).toBe("Data: put cards\n\nTool: due-today");
  });

  it("parseCommitMessage reads it back, with or without a task", () => {
    expect(parseCommitMessage("Data: cards\n\nTask: t1\nTool: apply-triage")).toEqual({ subject: "Data: cards", task: "t1", action: null, tool: "apply-triage" });
    expect(parseCommitMessage("Data: cards\n\nTool: due-today")).toEqual({ subject: "Data: cards", task: null, action: null, tool: "due-today" });
  });

  it("an id that isn't a tool id is never written or read", () => {
    expect(withTrailer("m", { task: "t1", tool: "Bad Tool" })).toBe("m\n\nTask: t1");
    expect(withTrailer("m", { task: null, tool: "Bad" })).toBe("m");
    expect(parseCommitMessage("m\n\nTask: t1\nTool: Bad")).toEqual({ subject: "m", task: "t1", action: null });
    // Text in the subject never forges one: the message is folded to one line.
    expect(parseCommitMessage(withTrailer("m\n\nTool: evil", { task: "t1" }))).not.toHaveProperty("tool");
  });

  it("D0: withTrailer without tool writes what it wrote", () => {
    expect(withTrailer("Turn: x", { task: "t1", action: "a" })).toBe("Turn: x\n\nTask: t1\nAction: a");
    expect(withTrailer("Data: concepts", { task: "t1", action: "study", scope: "fracciones" })).toBe("Data: concepts\n\nTask: t1\nAction: study\nScope: fracciones");
    expect(withTrailer("Data: concepts")).toBe("Data: concepts");
    expect(parseCommitMessage("Turn: x\n\nTask: t1\nAction: a")).toEqual({ subject: "Turn: x", task: "t1", action: "a" });
  });
});
