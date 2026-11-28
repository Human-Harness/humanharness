import { describe, expect, it } from "vitest";
import { FILE_CHANNELS, fileHandlers } from "../src/main/file-ipc";
import type { FileTimelineService } from "../src/main/file-timeline";

describe("file timeline IPC handlers", () => {
  it("forward every call; a throw, sync or async, answers failed", async () => {
    const calls: unknown[][] = [];
    const svc = {
      timeline: async (...a: unknown[]) => (calls.push(["timeline", ...a]), { ok: true, entries: [] }),
      diff: () => {
        throw new Error("sync boom");
      },
    } as unknown as FileTimelineService;
    const h = fileHandlers(svc);
    expect(Object.keys(h).sort()).toEqual([...FILE_CHANNELS].sort());
    // The go-back is not here: main's native confirmation guards it (go-back.ts).
    expect(FILE_CHANNELS).not.toContain("hh:fileRestore");
    expect(await h["hh:fileTimeline"]("a.md")).toEqual({ ok: true, entries: [] });
    expect(await h["hh:fileDiff"]("a.md", null, "current")).toEqual({ ok: false, reason: "failed" });
    expect(calls).toEqual([["timeline", "a.md"]]);
  });
});
