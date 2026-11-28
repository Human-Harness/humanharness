// The documents mod's main: the app channels and pushes of the reader, reviews and the file timeline, under the names the
// window already calls, and the agent's side.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { CoreMainCtx, CoreSender } from "@humanharness/mod-sdk/core";
import { History } from "@humanharness/workspace";
import { afterAll, describe, expect, it, vi } from "vitest";
import mod from "../src/main";

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "hh-docs-mod-")));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
fs.writeFileSync(path.join(root, "plan.md"), "# Plan\n");

type Fn = (...args: unknown[]) => unknown;
const SENDER: CoreSender = { id: 7 };

/** Runs the mod's main on a fake core ctx; `folder` is what `ctx.app.documents.folder()` answers. */
function run(
  folder: { base: string; roots(): Promise<string[]> } | null = { base: root, roots: async () => [root] },
  canEdit = true,
  parts: { documents?: Record<string, unknown>; history?: Record<string, unknown> } = {},
) {
  const channels = new Map<string, Fn>();
  const hooks = new Map<string, Fn>();
  const pushed: [string, unknown][] = [];
  const hook = (name: string) => (fn: Fn) => (hooks.set(name, fn), () => void hooks.delete(name));
  mod.main!({
    app: {
      documents: {
        folder: async () => folder,
        canEdit: () => canEdit,
        kinds: () => ({}),
        busy: () => false,
        blocked: () => null,
        openTask: async () => null,
        history: async () => null,
        actionLabel: () => "A question",
        diffWorker: () => "/app/out/main/diff-worker.js",
        ...parts.documents,
      },
      history: { ...parts.history },
    },
    tasks: { running: async () => null },
    handle: (name: string, fn: Fn) => (channels.set(name, (_sender, ...args) => fn(...args)), () => {}),
    handleFrom: (name: string, fn: Fn) => (channels.set(name, fn), () => {}),
    push: (name: string, value: unknown) => void pushed.push([name, value]),
    on: { instructions: hook("instructions"), agentTools: hook("agentTools"), historyCommit: hook("historyCommit"), windowClosed: hook("windowClosed"), folderChanged: hook("folderChanged"), dispose: hook("dispose") },
  } as unknown as CoreMainCtx<unknown> as never);
  const call = async (name: string, ...args: unknown[]) => channels.get(name)!(SENDER, ...args);
  return { channels, hooks, pushed, call };
}

const FILES = ["hh:fileDiff", "hh:fileRestore", "hh:fileTimeline"];
const REVIEW = ["Answer", "Approve", "ApprovedText", "Comment", "EditDraft", "Reopen", "Send", "Summaries", "View"].map((name) => `hh:review${name}`);
const OPTIONS = ["A", "B"].map((label) => ({ label, text: label }));
const INFO = { canEdit: true, folder: root, documentKinds: {} };
const toolsOf = (m: ReturnType<typeof run>) => m.hooks.get("agentTools")!(INFO) as { name: string; handle(args: Record<string, unknown>): Promise<unknown> }[];

describe("the documents mod's main", () => {
  it("is the mod `documents`", () => {
    expect(mod.id).toBe("documents");
  });

  it("answers the reader's, the reviews' and the file timeline's channels under their names", async () => {
    const m = run();
    expect([...m.channels.keys()].sort()).toEqual(["hh:documentsExist", ...FILES, "hh:readDocument", "hh:readImage", ...REVIEW, "hh:unwatchDocument", "hh:watchDocument"]);
    expect(await m.call("hh:readDocument", "plan.md")).toMatchObject({ ok: true, text: "# Plan\n" });
    expect(await m.call("hh:readImage", "plan.md")).toBeNull();
    expect(await m.call("hh:documentsExist", ["plan.md", "no.md"])).toEqual([true, false]);
  });

  it("before setup, answers each in the shape its caller handles", async () => {
    const m = run(null);
    expect(await m.call("hh:readDocument", "plan.md")).toEqual({ ok: false, reason: "not-ready" });
    expect(await m.call("hh:readImage", "a.png")).toBeNull();
    expect(await m.call("hh:documentsExist", ["plan.md"])).toEqual([false]);
    expect(await m.call("hh:watchDocument", "plan.md")).toBeNull();
  });

  it("pushes a change of a watched document, until the folder changes: then the watch ends and is said", async () => {
    const m = run();
    const id = (await m.call("hh:watchDocument", "plan.md")) as number;
    expect(typeof id).toBe("number");
    fs.writeFileSync(path.join(root, "plan.md"), "# Plan\n");
    await vi.waitFor(() => expect(m.pushed).toContainEqual(["hh:documentChanged", id]), { timeout: 5000 });
    m.pushed.length = 0;
    await m.hooks.get("folderChanged")!();
    expect(m.pushed).toEqual([["hh:documentWatchEnded", id]]);
  });

  it("windowClosed ends that window's watches only", async () => {
    const m = run();
    const id = (await m.call("hh:watchDocument", "plan.md")) as number;
    await m.hooks.get("windowClosed")!(8);
    expect(m.pushed).toEqual([]);
    await m.hooks.get("windowClosed")!(SENDER.id);
    expect(m.pushed).toEqual([["hh:documentWatchEnded", id]]);
  });

  it("an unwatch by its window ends the watch without saying so", async () => {
    const m = run();
    const id = await m.call("hh:watchDocument", "plan.md");
    await m.call("hh:unwatchDocument", id);
    await m.hooks.get("folderChanged")!();
    expect(m.pushed).toEqual([]);
  });

  it("going off ends every watch", async () => {
    const m = run();
    const id = await m.call("hh:watchDocument", "plan.md");
    await m.hooks.get("dispose")!();
    expect(m.pushed).toEqual([["hh:documentWatchEnded", id]]);
  });

  it("a review change, the agent's or the person's, is pushed; both go through one service", async () => {
    const m = run();
    const ask = toolsOf(m).find((t) => t.name === "ask_in_document")!;
    await ask.handle({ path: "plan.md", quote: "# Plan", question: "Which?", options: OPTIONS });
    expect(m.pushed).toEqual([["hh:reviewChanged", "plan.md"]]);
    expect(await m.call("hh:reviewView", "plan.md")).toMatchObject({ ok: true, review: { comments: [{ author: "agent" }] } });
  });

  it('with edit "none", every review channel answers not-ready', async () => {
    const m = run(undefined, false);
    expect(await m.call("hh:reviewView", "plan.md")).toEqual({ ok: false, reason: "not-ready" });
    expect(await m.call("hh:reviewSummaries", ["plan.md"])).toEqual([null]);
  });

  /** A folder with a history in which `a.md` has two versions; `first` is the older one's commit. */
  async function versioned() {
    const dir = fs.mkdtempSync(path.join(root, "v-"));
    const work = path.join(dir, "work");
    fs.mkdirSync(work);
    const history = new History(work, path.join(dir, "history.git"), [".harness/"]);
    await history.init();
    await history.save("Start");
    fs.writeFileSync(path.join(work, "a.md"), "one\n");
    const first = (await history.save("Turn: write", { task: "t1", action: "spec" }))!;
    fs.writeFileSync(path.join(work, "a.md"), "two\n");
    await history.save("Turn: edit", { task: "t2", action: "spec" });
    return { work, history, first };
  }
  const folderOf = (work: string) => ({ base: work, roots: async () => [work] });

  it("the timeline and its diffs read the app's folder and history", async () => {
    const { work, history, first } = await versioned();
    const m = run(folderOf(work), true, { documents: { history: async () => history, actionLabel: () => "Spec writer" } });
    expect(await m.call("hh:fileTimeline", "a.md")).toMatchObject({ ok: true, entries: [{ author: { label: "Spec writer" } }, { to: first }] });
    expect(await m.call("hh:fileTimeline", "../a.md")).toEqual({ ok: false, reason: "outside" });
    // The in-app diff runs in the worker the app names; there is none here, so a Markdown diff shows as plain lines.
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await m.call("hh:fileDiff", "a.md", first, "current")).toMatchObject({ ok: true, kind: "text", same: false });
    vi.restoreAllMocks();
  });

  type Guard = (write: (h: History) => Promise<unknown>) => Promise<void>;
  type RestoreService = { restorePrompt(f: unknown, c: unknown): Promise<unknown>; restore(f: unknown, c: unknown, guard: Guard): Promise<unknown> };

  it.each([["busy", { busy: () => true }], ["blocked", { blocked: () => "The engine is changing" }]])("while the app is %s, the service refuses a go-back", async (_, held) => {
    const { work, history, first } = await versioned();
    const m = run(folderOf(work), true, {
      documents: { history: async () => history, ...held },
      history: { restoreFile: async (_s: unknown, file: unknown, commit: unknown, service: RestoreService) => service.restorePrompt(file, commit) },
    });
    expect(await m.call("hh:fileRestore", "a.md", first)).toEqual({ ok: false, reason: "busy" });
  });

  it("a go-back is the core's: it gets the asking window and the service, which writes through the core's guard only", async () => {
    const { work, history, first } = await versioned();
    const calls: unknown[][] = [];
    let guarded = 0;
    let yes = false;
    const restoreFile = async (sender: unknown, file: unknown, commit: unknown, service: RestoreService) => {
      calls.push([sender, file, commit]);
      expect(await service.restorePrompt(file, commit)).toMatchObject({ ok: true, prompt: { path: "a.md" } });
      if (!yes) return { ok: false, reason: "cancelled" };
      return service.restore(file, commit, async (write) => {
        guarded++;
        await write(history);
      });
    };
    const m = run(folderOf(work), true, { documents: { history: async () => history }, history: { restoreFile } });
    expect(await m.call("hh:fileRestore", "a.md", first)).toEqual({ ok: false, reason: "cancelled" });
    expect(fs.readFileSync(path.join(work, "a.md"), "utf8")).toBe("two\n");
    yes = true;
    expect(await m.call("hh:fileRestore", "a.md", first)).toEqual({ ok: true });
    expect(fs.readFileSync(path.join(work, "a.md"), "utf8")).toBe("one\n");
    expect(guarded).toBe(1);
    expect(calls).toEqual([[SENDER, "a.md", first], [SENDER, "a.md", first]]);
  });

  it("pushes the paths of each commit, or null as the core says it", async () => {
    const m = run();
    await m.hooks.get("historyCommit")!(["a.md", "b.md"]);
    await m.hooks.get("historyCommit")!(null);
    expect(m.pushed).toEqual([
      ["hh:fileCommits", ["a.md", "b.md"]],
      ["hh:fileCommits", null],
    ]);
  });

  it("without the app (a headless run) registers the agent's side alone, which works in the runtime's folder", async () => {
    const hooks = new Map<string, Fn>();
    const folder = fs.mkdtempSync(path.join(root, "run-"));
    fs.writeFileSync(path.join(folder, "notes.md"), "# Notes\n");
    mod.main!({ tasks: { running: async () => ({ id: "t9", scope: "main" }) }, on: { instructions: (fn: Fn) => void hooks.set("instructions", fn), agentTools: (fn: Fn) => void hooks.set("agentTools", fn) } } as never);
    expect([...hooks.keys()]).toEqual(["instructions", "agentTools"]);
    const tools = hooks.get("agentTools")!({ canEdit: true, folder, documentKinds: {} }) as { handle(args: Record<string, unknown>): Promise<unknown> }[];
    await tools[0].handle({ path: "notes.md", quote: "# Notes", question: "Which?", options: OPTIONS });
    const record = fs.readdirSync(path.join(folder, ".harness", "reviews"), { recursive: true }).map(String).find((f) => f.endsWith(".json"))!;
    expect(JSON.parse(fs.readFileSync(path.join(folder, ".harness", "reviews", record), "utf8"))).toMatchObject({ task: "t9" });
  });
});
