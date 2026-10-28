import { describe, expect, it } from "vitest";
import { askFile, restoreFlow } from "../src/preload/file-restore";

const SHA = "c".repeat(40);

function invoker(answers: Record<string, unknown>) {
  const calls: string[] = [];
  const invoke = async (channel: string, ...args: unknown[]) => {
    calls.push(`${channel} ${args.join(" ")}`);
    return answers[channel];
  };
  return { invoke, calls };
}

describe("restoreFlow (main confirms every file go-back natively)", () => {
  it("one call to main; its answer becomes restored, cancelled or a refusal", async () => {
    const done = invoker({ "hh:fileRestore": { ok: true } });
    expect(await restoreFlow(done.invoke, "a.md", SHA)).toBe("restored");
    expect(done.calls).toEqual([`hh:fileRestore a.md ${SHA}`]);
    const no = invoker({ "hh:fileRestore": { ok: false, reason: "cancelled" } });
    expect(await restoreFlow(no.invoke, "a.md", SHA)).toBe("cancelled");
    const busy = invoker({ "hh:fileRestore": { ok: false, reason: "busy" } });
    expect(await restoreFlow(busy.invoke, "a.md", SHA)).toEqual({ refused: "busy" });
  });

  it("an invoke that rejects, or an odd answer, is failed, as data", async () => {
    const broken = async () => Promise.reject(new Error("no handler"));
    expect(await restoreFlow(broken, "a.md", SHA)).toEqual({ refused: "failed" });
    const odd = invoker({ "hh:fileRestore": "nonsense" });
    expect(await restoreFlow(odd.invoke, "a.md", SHA)).toEqual({ refused: "failed" });
  });
});

describe("askFile (files.timeline and files.diff answer data, never a throw)", () => {
  it("passes main's answer through, and a rejected invoke answers failed", async () => {
    const { invoke, calls } = invoker({ "hh:fileTimeline": { ok: true, entries: [] } });
    expect(await askFile(invoke, "hh:fileTimeline", "a.md")).toEqual({ ok: true, entries: [] });
    expect(calls).toEqual(["hh:fileTimeline a.md"]);
    const broken = async () => Promise.reject(new Error("no handler"));
    expect(await askFile(broken, "hh:fileDiff", "a.md", null, "current")).toEqual({ ok: false, reason: "failed" });
  });
});
