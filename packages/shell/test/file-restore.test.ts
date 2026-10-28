import { describe, expect, it } from "vitest";
import { restoreFlow } from "../src/preload/file-restore";

const SHA = "c".repeat(40);
const prompt = { path: "a.md", author: { kind: "agent", label: "Spec writer" }, at: "2026-10-28T10:00:00.000Z", kind: "task" };

function invoker(answers: Record<string, unknown>) {
  const calls: string[] = [];
  const invoke = async (channel: string, ...args: unknown[]) => {
    calls.push(`${channel} ${args.join(" ")}`);
    return answers[channel];
  };
  return { invoke, calls };
}

describe("restoreFlow (file-timeline spec §6.3: the core always confirms)", () => {
  it("an invoke that rejects answers failed, as data", async () => {
    const broken = async () => Promise.reject(new Error("no handler"));
    expect(await restoreFlow(broken, async () => true, "a.md", SHA)).toEqual({ refused: "failed" });
    let n = 0;
    const second = async (channel: string) => {
      n++;
      if (channel === "hh:fileRestore") throw new Error("gone");
      return { ok: true, prompt };
    };
    expect(await restoreFlow(second, async () => true, "a.md", SHA)).toEqual({ refused: "failed" });
    expect(n).toBe(2);
  });

  it("prompt, the core's yes, then the go-back", async () => {
    const { invoke, calls } = invoker({ "hh:fileRestorePrompt": { ok: true, prompt }, "hh:fileRestore": { ok: true } });
    const asked: unknown[] = [];
    const r = await restoreFlow(invoke, async (p) => (asked.push(p), true), "a.md", SHA);
    expect(r).toBe("restored");
    expect(asked).toEqual([prompt]);
    expect(calls).toEqual([`hh:fileRestorePrompt a.md ${SHA}`, `hh:fileRestore a.md ${SHA}`]);
  });

  it("no, or no core to ask, or a confirmer that fails: cancelled, nothing restored", async () => {
    for (const confirm of [async () => false, null, async () => Promise.reject(new Error("gone"))]) {
      const { invoke, calls } = invoker({ "hh:fileRestorePrompt": { ok: true, prompt } });
      expect(await restoreFlow(invoke, confirm, "a.md", SHA)).toBe("cancelled");
      expect(calls).toEqual([`hh:fileRestorePrompt a.md ${SHA}`]);
    }
  });

  it("refusals come back as data, before and after the confirmation", async () => {
    const before = invoker({ "hh:fileRestorePrompt": { ok: false, reason: "busy" } });
    expect(await restoreFlow(before.invoke, async () => true, "a.md", SHA)).toEqual({ refused: "busy" });
    const after = invoker({ "hh:fileRestorePrompt": { ok: true, prompt }, "hh:fileRestore": { ok: false, reason: "unsafe" } });
    expect(await restoreFlow(after.invoke, async () => true, "a.md", SHA)).toEqual({ refused: "unsafe" });
    const odd = invoker({ "hh:fileRestorePrompt": "nonsense" });
    expect(await restoreFlow(odd.invoke, async () => true, "a.md", SHA)).toEqual({ refused: "failed" });
  });
});
