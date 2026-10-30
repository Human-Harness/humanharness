import { createI18n } from "@humanharness/i18n";
import type { FileRestorePrompt, HistoryTaskView } from "@humanharness/protocol";
import { describe, expect, it, vi } from "vitest";
import { CANCELLED, GO_BACK_CHANNELS, type GoBackAsk, type GoBackDeps, askNatively, dialogSafe, goBackHandlers, goBackText } from "../src/main/go-back";

const SHA = (c: string) => c.repeat(40);
const NOW = Date.parse("2026-10-28T12:00:00.000Z");

const group = (taskId: string | null, date: string, o: Partial<HistoryTaskView> = {}): HistoryTaskView => ({
  taskId,
  actionId: taskId === null ? null : "plan",
  start: taskId === null ? null : SHA("0"),
  end: SHA("e"),
  date,
  changes: [{ path: "a.md", kind: "modified" }],
  entries: [{ sha: SHA(taskId?.at(-1) ?? "f"), message: "Turn: x", date }],
  ...o,
});
// Newest first, as the History panel gets them: t3 (another scope) and t2 came after t1.
const groups: HistoryTaskView[] = [
  group("t3", "2026-10-28T11:00:00.000Z", { scopeId: "other", changes: [] }),
  group("t2", "2026-10-28T10:00:00.000Z", { actionId: null }),
  group("t1", "2026-10-28T09:00:00.000Z", { changes: [{ path: "a.md", kind: "modified" }, { path: "b.md", kind: "added" }] }),
  group(null, "2026-10-28T08:00:00.000Z"),
];
const actions = { plan: { label: "Plan the week" } };
const prompt: FileRestorePrompt = { path: "specs/a.md", author: { kind: "agent", label: "Spec writer", action: "spec" }, at: "2026-10-28T11:40:00.000Z", kind: "task" };

async function english() {
  const i18n = await createI18n("en");
  return (key: string, values?: Record<string, unknown>) => String(i18n.t(key, values ?? {}));
}

describe("goBackText (what main's dialog says)", () => {
  it("a file: which file, whose version and when; the rest of the folder stays", async () => {
    const t = await english();
    expect(goBackText(t, { kind: "file", prompt }, actions, "en", NOW)).toEqual({
      message: "Go back to this version?",
      detail: "Go back specs/a.md to how it was after Spec writer (20 minutes ago)? The rest of the folder doesn't change.",
      yes: "Go back",
      cancel: "Cancel",
    });
    const approval = goBackText(t, { kind: "file", prompt: { ...prompt, kind: "approval", version: 2 } }, actions, "en", NOW);
    expect(approval.detail).toBe("Go back specs/a.md to v2, the version you approved (20 minutes ago)? The rest of the folder doesn't change.");
  });

  it("the whole folder: says so, and names the later tasks it undoes too", async () => {
    const t = await english();
    expect(goBackText(t, { kind: "point", later: [] }, actions, "en")).toEqual({
      message: "Go back the whole folder to this point?",
      detail: "Files changed after it will be undone.",
      yes: "Go back",
      cancel: "Cancel",
    });
    const text = goBackText(t, { kind: "point", later: groups.slice(0, 2) }, actions, "en");
    expect(text.detail).toBe(
      ["Files changed after it will be undone. This also undoes 2 later tasks.", "", "• Plan the week · 0 files changed", "• A question · 1 file changed"].join("\n"),
    );
  });

  it("a task: by its name; with later tasks, lists it first", async () => {
    const t = await english();
    const alone = goBackText(t, { kind: "task", task: groups[0], later: [] }, actions, "en");
    expect(alone.message).toBe("Undo “Plan the week”?");
    expect(alone.detail).toBe("Everything it changed in your files will be undone.");
    const withLater = goBackText(t, { kind: "task", task: groups[2], later: [groups[1]] }, {}, "en");
    // An action the harness no longer has is "A task".
    expect(withLater.message).toBe("Undo “A task”?");
    expect(withLater.detail.split("\n")).toEqual([
      "Everything it changed in your files will be undone. This also undoes 1 later task.",
      "",
      "• A task · 2 files changed",
      "• A question · 1 file changed",
    ]);
  });

  it("a newline or a right-to-left override in a name can't reshape the dialog's text", async () => {
    const t = await english();
    const file = goBackText(t, { kind: "file", prompt: { ...prompt, path: "a\nGo back? Yes.md" } }, actions, "en", NOW);
    expect(file.detail).toContain("Go back a�Go back? Yes.md to how it was");
    expect(file.detail.split("\n")).toHaveLength(1);
    const author = goBackText(t, { kind: "file", prompt: { ...prompt, author: { ...prompt.author, label: "Spec‮writer " } } }, actions, "en", NOW);
    expect(author.detail).toContain("after Spec�writer� (");
    const named = goBackText(t, { kind: "task", task: groups[0], later: [] }, { plan: { label: "Plan⁦ the‏ week\r" } }, "en");
    expect(named.message).toBe("Undo “Plan� the� week�”?");
  });

  it("a long name is shortened in the middle", async () => {
    const t = await english();
    const long = `specs/${"a".repeat(300)}/end.md`;
    const file = goBackText(t, { kind: "file", prompt: { ...prompt, path: long } }, actions, "en", NOW);
    const shown = /Go back (.*) to how it was/.exec(file.detail)?.[1] ?? "";
    expect(shown.length).toBeLessThanOrEqual(160);
    expect(shown.startsWith("specs/aaa")).toBe(true);
    expect(shown.endsWith("a/end.md")).toBe(true);
    expect(shown).toContain("…");
    const named = goBackText(t, { kind: "task", task: groups[0], later: [] }, { plan: { label: "x".repeat(200) } }, "en");
    expect(named.message.length).toBeLessThanOrEqual(80 + "Undo “”?".length);
    expect(named.message).toContain("…");
  });

  it("dialogSafe keeps ordinary text as it is", () => {
    expect(dialogSafe("Plan the week · ñandú 日本", 80)).toBe("Plan the week · ñandú 日本");
    expect(dialogSafe("abcdefghij", 5)).toBe("ab…ij");
  });

  it("lists at most ten tasks", async () => {
    const t = await english();
    const many = Array.from({ length: 12 }, (_, i) => group(`t${i}`, "2026-10-28T10:00:00.000Z"));
    const lines = goBackText(t, { kind: "point", later: many }, actions, "en").detail.split("\n");
    expect(lines.filter((l) => l.startsWith("•"))).toHaveLength(10);
    expect(lines.at(-1)).toBe("…");
  });

  it("speaks the person's language when the core has its strings", async () => {
    const i18n = await createI18n("es", {}, { "core:goBack.yes": "Volver", "core:goBack.cancel": "Cancelar" });
    const text = goBackText((k, v) => String(i18n.t(k, v ?? {})), { kind: "point", later: [] }, actions, "es");
    expect([text.yes, text.cancel]).toEqual(["Volver", "Cancelar"]);
  });
});

describe("askNatively (the native dialog)", () => {
  const text = { message: "M", detail: "D", yes: "Go back", cancel: "Cancel" };
  function fakeDialog(response: number) {
    const calls: unknown[][] = [];
    const dialog = {
      showMessageBox: async (...args: unknown[]) => {
        calls.push(args);
        return { response };
      },
    };
    return { dialog, calls };
  }

  it("a sheet on the asking window; Cancel is the default and the cancel id; only Go back says yes", async () => {
    const yes = fakeDialog(0);
    expect(await askNatively(yes.dialog, "window", text)).toBe(true);
    expect(yes.calls).toEqual([
      ["window", { type: "question", message: "M", detail: "D", buttons: ["Go back", "Cancel"], defaultId: 1, cancelId: 1, noLink: true }],
    ]);
    expect(await askNatively(fakeDialog(1).dialog, "window", text)).toBe(false);
  });

  it("without a window, an app-modal dialog", async () => {
    const { dialog, calls } = fakeDialog(1);
    expect(await askNatively(dialog, null, text)).toBe(false);
    expect(calls[0]).toHaveLength(1);
  });
});

describe("goBackHandlers (every go-back asks first)", () => {
  function deps(answer: boolean, o: Partial<GoBackDeps<string>> = {}) {
    const asks: { sender: string; ask: GoBackAsk }[] = [];
    const done: string[] = [];
    const d: GoBackDeps<string> = {
      confirm: async (sender, ask) => (asks.push({ sender, ask }), answer),
      blocked: () => false,
      groups: async () => groups,
      restorePoint: async (sha) => void done.push(`point ${sha}`),
      restoreTask: async (id) => void done.push(`task ${id}`),
      file: {
        restorePrompt: async (file) => (file === "busy.md" ? { ok: false, reason: "busy" } : { ok: true, prompt }),
        restore: async (file, commit) => (done.push(`file ${file} ${commit}`), { ok: true }),
      },
      ...o,
    };
    return { h: goBackHandlers(d), asks, done };
  }

  it("hh:restore: a valid commit id that no listed point has asks nothing", async () => {
    const { h, asks, done } = deps(true);
    await expect(h["hh:restore"]("win", SHA("9"))).rejects.toThrow("Invalid point");
    expect(asks).toEqual([]);
    expect(done).toEqual([]);
  });

  it("while a turn, a task operation or a hold blocks going back, the folder and task go-backs ask nothing", async () => {
    const { h, asks, done } = deps(true, { blocked: () => true });
    await expect(h["hh:restore"]("win", SHA("1"))).rejects.toThrow();
    await expect(h["hh:restoreTask"]("win", "t2")).rejects.toThrow();
    expect(asks).toEqual([]);
    expect(done).toEqual([]);
  });

  it("a yes is cancelled when more later tasks appeared while the dialog was open", async () => {
    let current = groups.slice(1);
    const { h, done } = deps(true, {
      groups: async () => current,
      confirm: async () => {
        current = groups;
        return true;
      },
    });
    expect(await h["hh:restoreTask"]("win", "t2")).toEqual(CANCELLED);
    expect(await h["hh:restore"]("win", SHA("1"))).toEqual({ ok: true });
    expect(done).toEqual([`point ${SHA("1")}`]);
  });

  it("one go-back dialog at a time: a second one while it is open answers cancelled", async () => {
    let answer: (yes: boolean) => void = () => undefined;
    const opened: GoBackAsk[] = [];
    const { h, done } = deps(true, { confirm: (_s, ask) => (opened.push(ask), new Promise<boolean>((r) => (answer = r))) });
    const first = h["hh:restoreTask"]("win", "t2");
    await new Promise((r) => setTimeout(r, 0));
    expect(await h["hh:restore"]("win", SHA("1"))).toEqual(CANCELLED);
    expect(await h["hh:fileRestore"]("win", "specs/a.md", SHA("b"))).toEqual(CANCELLED);
    expect(opened).toHaveLength(1);
    answer(true);
    expect(await first).toEqual({ ok: true });
    expect(done).toEqual(["task t2"]);
    // Closed: the next one asks again.
    const next = h["hh:restore"]("win", SHA("1"));
    await new Promise((r) => setTimeout(r, 0));
    answer(false);
    expect(await next).toEqual(CANCELLED);
    expect(opened).toHaveLength(2);
  });

  it("covers the three go-backs", () => {
    expect(Object.keys(deps(true).h).sort()).toEqual([...GO_BACK_CHANNELS].sort());
  });

  it("hh:restore: confirmed goes back; cancelled answers cancelled and changes nothing", async () => {
    const yes = deps(true);
    expect(await yes.h["hh:restore"]("win", SHA("1"))).toEqual({ ok: true });
    expect(yes.done).toEqual([`point ${SHA("1")}`]);
    // t1's point: every later task, whatever its scope, is named.
    expect(yes.asks).toEqual([{ sender: "win", ask: { kind: "point", later: [groups[0], groups[1]] } }]);
    const no = deps(false);
    expect(await no.h["hh:restore"]("win", SHA("1"))).toEqual(CANCELLED);
    expect(no.done).toEqual([]);
  });

  it("hh:restoreTask: confirmed goes back; cancelled answers cancelled and changes nothing", async () => {
    const yes = deps(true);
    expect(await yes.h["hh:restoreTask"]("win", "t2")).toEqual({ ok: true });
    expect(yes.done).toEqual(["task t2"]);
    expect(yes.asks).toEqual([{ sender: "win", ask: { kind: "task", task: groups[1], later: [groups[0]] } }]);
    const no = deps(false);
    expect(await no.h["hh:restoreTask"]("win", "t2")).toEqual(CANCELLED);
    expect(no.done).toEqual([]);
  });

  it("hh:restoreTask with taskGroups (linked folders): the task and its later tasks come from them, not the panel's", async () => {
    // t9 changed only a linked folder, after t2: the panel's groups never name it.
    const linkedOnly = group("t9", "2026-10-28T11:59:00.000Z");
    const taskGroups = vi.fn(async (_id: string) => [linkedOnly, ...groups]);
    const yes = deps(true, { taskGroups });
    expect(await yes.h["hh:restoreTask"]("win", "t2")).toEqual({ ok: true });
    expect(yes.asks[0].ask).toEqual({ kind: "task", task: groups[1], later: [linkedOnly, groups[0]] });
    expect(taskGroups).toHaveBeenCalledWith("t2");
    // A task only in a linked history can be undone.
    expect(await yes.h["hh:restoreTask"]("win", "t9")).toEqual({ ok: true });
    expect(yes.done).toEqual(["task t2", "task t9"]);
  });

  it("hh:fileRestore: confirmed goes back; cancelled answers cancelled and changes nothing", async () => {
    const yes = deps(true);
    expect(await yes.h["hh:fileRestore"]("win", "specs/a.md", SHA("b"))).toEqual({ ok: true });
    expect(yes.done).toEqual([`file specs/a.md ${SHA("b")}`]);
    expect(yes.asks).toEqual([{ sender: "win", ask: { kind: "file", prompt } }]);
    const no = deps(false);
    expect(await no.h["hh:fileRestore"]("win", "specs/a.md", SHA("b"))).toEqual(CANCELLED);
    expect(no.done).toEqual([]);
  });

  it("bad input and refusals ask nothing", async () => {
    const { h, asks, done } = deps(true);
    await expect(h["hh:restore"]("win", "nope")).rejects.toThrow("Invalid point");
    await expect(h["hh:restoreTask"]("win", 42)).rejects.toThrow("Invalid task");
    await expect(h["hh:restoreTask"]("win", "x".repeat(201))).rejects.toThrow("Invalid task");
    // The group outside any task has no "before" to go back to.
    await expect(h["hh:restoreTask"]("win", "missing")).rejects.toThrow("Nothing to go back to");
    expect(await h["hh:fileRestore"]("win", "busy.md", SHA("b"))).toEqual({ ok: false, reason: "busy" });
    expect(asks).toEqual([]);
    expect(done).toEqual([]);
  });

  it("a file go-back that throws, or a confirm that fails, answers failed as data", async () => {
    const { h } = deps(true);
    const broken = goBackHandlers<string>({
      ...{ blocked: () => false, groups: async () => [], restorePoint: async () => undefined, restoreTask: async () => undefined },
      confirm: async () => {
        throw new Error("gone");
      },
      file: { restorePrompt: async () => ({ ok: true, prompt }), restore: async () => ({ ok: true }) },
    });
    expect(await broken["hh:fileRestore"]("win", "specs/a.md", SHA("b"))).toEqual({ ok: false, reason: "failed" });
    expect(await h["hh:fileRestore"]("win", "specs/a.md", SHA("b"))).toEqual({ ok: true });
  });
});
