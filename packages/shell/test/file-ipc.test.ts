import { describe, expect, it } from "vitest";
import { FILE_CHANNELS, fileHandlers } from "../src/main/file-ipc";
import type { FileTimelineService } from "../src/main/file-timeline";

describe("file timeline IPC handlers", () => {
  it("forward every call; a throw, sync or async, answers failed", async () => {
    const calls: unknown[][] = [];
    const svc = {
      timeline: async (...a: unknown[]) => (calls.push(["timeline", ...a]), { ok: true, entries: [] }),
      diff: async () => {
        throw new Error("boom");
      },
      restorePrompt: () => {
        throw new Error("sync boom");
      },
      restore: async (...a: unknown[]) => (calls.push(["restore", ...a]), { ok: true }),
    } as unknown as FileTimelineService;
    const h = fileHandlers(svc);
    expect(Object.keys(h).sort()).toEqual([...FILE_CHANNELS].sort());
    expect(await h["hh:fileTimeline"]("a.md")).toEqual({ ok: true, entries: [] });
    expect(await h["hh:fileDiff"]("a.md", null, "current")).toEqual({ ok: false, reason: "failed" });
    expect(await h["hh:fileRestorePrompt"]("a.md", "x")).toEqual({ ok: false, reason: "failed" });
    expect(await h["hh:fileRestore"]("a.md", "c".repeat(40))).toEqual({ ok: true });
    expect(calls).toEqual([
      ["timeline", "a.md"],
      ["restore", "a.md", "c".repeat(40)],
    ]);
  });
});
