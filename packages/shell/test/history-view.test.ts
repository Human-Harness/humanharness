import { describe, expect, it } from "vitest";
import type { HistoryTask } from "@humanharness/workspace";
import { RESTORE_POINT, RESTORE_TASK } from "@humanharness/ui/client";
import { historyView, isSha } from "../src/main/history-view";

const at = (iso: string) => new Date(iso);
const entry = (sha: string, message: string, task: string | null = "t1") => ({ sha, message, date: at("2026-10-13T10:00:00.000Z"), task, action: null });

describe("historyView", () => {
  it("sends dates as ISO strings and the title of the note the task saved", () => {
    const groups: HistoryTask[] = [
      {
        taskId: "t1",
        actionId: "plan",
        start: "a".repeat(40),
        end: "b".repeat(40),
        date: at("2026-10-13T10:00:00.000Z"),
        changes: [{ path: "plan.md", kind: "modified" }],
        entries: [entry("b".repeat(40), "Note: The week"), entry("c".repeat(40), "Turn: plan it")],
      },
      {
        taskId: null,
        actionId: null,
        start: null,
        end: "a".repeat(40),
        date: at("2026-10-13T09:00:00.000Z"),
        changes: [],
        entries: [entry("a".repeat(40), "Note: old untagged note", null)],
      },
    ];
    expect(historyView(groups)).toEqual([
      {
        taskId: "t1",
        actionId: "plan",
        start: "a".repeat(40),
        end: "b".repeat(40),
        date: "2026-10-13T10:00:00.000Z",
        noteTitle: "The week",
        changes: [{ path: "plan.md", kind: "modified" }],
        entries: [
          { sha: "b".repeat(40), message: "Note: The week", date: "2026-10-13T10:00:00.000Z" },
          { sha: "c".repeat(40), message: "Turn: plan it", date: "2026-10-13T10:00:00.000Z" },
        ],
      },
      {
        taskId: null,
        actionId: null,
        start: null,
        end: "a".repeat(40),
        date: "2026-10-13T09:00:00.000Z",
        changes: [],
        entries: [{ sha: "a".repeat(40), message: "Note: old untagged note", date: "2026-10-13T10:00:00.000Z" }],
      },
    ]);
  });

  it("accepts only full commit ids from the window", () => {
    expect(isSha("a".repeat(40))).toBe(true);
    expect(isSha("abc")).toBe(false);
    expect(isSha(`${"a".repeat(39)}Z`)).toBe(false);
    expect(isSha(42)).toBe(false);
  });

  it("names the two restores in English (the raw git data)", () => {
    expect(RESTORE_POINT).toBe("Went back to an earlier point");
    expect(RESTORE_TASK).toBe("Went back to before the task");
  });
});
