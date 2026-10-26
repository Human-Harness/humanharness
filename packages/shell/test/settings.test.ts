import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { SETTINGS_COLLECTION, dataCollections, settingsSchema, z } from "@humanharness/harness-sdk";
import type { SettingsState } from "@humanharness/ui/client";
import { APP_SCOPE, DataStore, runDataRequest } from "@humanharness/workspace";
import { DataUnavailable } from "../src/main/data-requests";
import { SettingsController } from "../src/main/settings";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "hh-settings-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

const settings = settingsSchema.parse({
  tab: "How I learn",
  fields: {
    tone: { schema: z.enum(["patient", "demanding"]), default: "patient", control: "segmented", label: "Tone", agent: "Use a {{value}} tone." },
    hintAfter: { schema: z.number().int().min(1).max(5), default: 2, control: "number", label: "Hint after", agent: "Hint after {{value}} tries." },
    nickname: { schema: z.string().max(40), default: "", control: "text", label: "Nickname" },
  },
});

function setup(opts: { taskOpen?: boolean } = {}) {
  const base = fs.mkdtempSync(path.join(root, "s-"));
  const store = new DataStore(base, dataCollections({ data: {}, settings }));
  let taskOpen = opts.taskOpen ?? false;
  let failRefresh = false;
  const log: string[] = [];
  const pushed: SettingsState[] = [];
  const ctl: SettingsController = new SettingsController({
    settings,
    store: async () => store,
    write: (request) => runDataRequest(store, request, { who: "person", scope: APP_SCOPE }),
    taskOpen: async () => taskOpen,
    whenNoTask: async (fn) => {
      if (taskOpen) return false;
      await fn();
      return true;
    },
    // A runtime's refresh asks the controller for the sentences, as createRuntime and refreshInstructions do, then writes.
    refresh: async () => {
      log.push("refresh");
      await ctl.sentences();
      if (failRefresh) throw new Error("disk full");
      return true;
    },
    changed: (s) => void pushed.push(s),
    log: (message) => void log.push(`log:${message}`),
  });
  store.onChange((c) => {
    if (c.collection === SETTINGS_COLLECTION) void ctl.changed();
  });
  const file = path.join(base, ".harness", "data", "_app", "settings.json");
  return {
    ctl,
    log,
    pushed,
    file,
    stored: () => JSON.parse(fs.readFileSync(file, "utf8")) as unknown,
    task: (open: boolean) => void (taskOpen = open),
    failRefresh: (fail: boolean) => void (failRefresh = fail),
  };
}

describe("SettingsController", () => {
  it("answers every field's value, the defaults when nothing is stored, nothing pending", async () => {
    const t = setup();
    expect(await t.ctl.state()).toEqual({ values: { tone: "patient", hintAfter: 2, nickname: "" }, pending: [] });
    expect(fs.existsSync(t.file)).toBe(false);
  });

  it("stores only what differs from the default; back to the default removes it, and the file when empty", async () => {
    const t = setup();
    expect(await t.ctl.set("tone", "demanding")).toEqual({ ok: true, state: { values: { tone: "demanding", hintAfter: 2, nickname: "" }, pending: [] } });
    expect(t.stored()).toEqual({ tone: "demanding" });
    await t.ctl.set("hintAfter", 4);
    expect(t.stored()).toEqual({ tone: "demanding", hintAfter: 4 });
    await t.ctl.set("tone", "patient");
    expect(t.stored()).toEqual({ hintAfter: 4 });
    await t.ctl.set("hintAfter", 2);
    expect(fs.existsSync(t.file)).toBe(false);
  });

  it("refuses an unknown or inherited name and an invalid value, as data", async () => {
    const t = setup();
    expect(await t.ctl.set("nope", 1)).toEqual({ ok: false, message: "Unknown setting" });
    expect(await t.ctl.set("toString", 1)).toEqual({ ok: false, message: "Unknown setting" });
    const r = await t.ctl.set("hintAfter", 9);
    expect(r.ok).toBe(false);
    expect(r.ok ? "" : r.message).toMatch(/5/);
    expect(fs.existsSync(t.file)).toBe(false);
  });

  it("a file broken by hand reads as the defaults and refuses writes with the store's message", async () => {
    const t = setup();
    fs.mkdirSync(path.dirname(t.file), { recursive: true });
    fs.writeFileSync(t.file, "{");
    expect((await t.ctl.state()).values.tone).toBe("patient");
    const r = await t.ctl.set("tone", "demanding");
    expect(r).toMatchObject({ ok: false, message: expect.stringContaining("changed by hand") });
  });

  it("a harness update that narrows a field never locks the person out: that field falls back, the rest stay", async () => {
    const t = setup();
    fs.mkdirSync(path.dirname(t.file), { recursive: true });
    fs.writeFileSync(t.file, JSON.stringify({ tone: "removed-value", nickname: "x" }));
    expect((await t.ctl.state()).values).toEqual({ tone: "patient", hintAfter: 2, nickname: "x" });
    expect(await t.ctl.set("hintAfter", 4)).toMatchObject({ ok: true, state: { values: { tone: "patient", hintAfter: 4, nickname: "x" } } });
    expect(t.stored()).toEqual({ nickname: "x", hintAfter: 4 });
    fs.writeFileSync(t.file, JSON.stringify({ tone: "removed-value" }));
    expect(await t.ctl.reset()).toMatchObject({ ok: true });
    expect(fs.existsSync(t.file)).toBe(false);
  });

  it("a write refused because turns are blocked says why", async () => {
    const base = fs.mkdtempSync(path.join(root, "s-"));
    const store = new DataStore(base, dataCollections({ data: {}, settings }));
    const ctl = new SettingsController({
      settings,
      store: async () => store,
      write: () => Promise.reject(new DataUnavailable("Going back to an earlier point")),
      taskOpen: async () => false,
      whenNoTask: async () => true,
      refresh: async () => true,
      changed: () => undefined,
      log: () => undefined,
    });
    expect(await ctl.set("tone", "demanding")).toEqual({ ok: false, message: "Going back to an earlier point" });
    expect(await ctl.reset()).toEqual({ ok: false, message: "Going back to an earlier point" });
  });

  it("reset deletes the stored record", async () => {
    const t = setup();
    await t.ctl.set("tone", "demanding");
    expect(await t.ctl.reset()).toEqual({ ok: true, state: { values: { tone: "patient", hintAfter: 2, nickname: "" }, pending: [] } });
    expect(fs.existsSync(t.file)).toBe(false);
  });

  it("with no task open, a change rewrites AGENTS.md at once and tells the window", async () => {
    const t = setup();
    await t.ctl.set("tone", "demanding");
    await t.ctl.idle();
    expect(t.log).toEqual(["refresh"]);
    expect(t.pushed.at(-1)).toEqual({ values: { tone: "demanding", hintAfter: 2, nickname: "" }, pending: [] });
  });

  it("with a task open, it waits: agent fields are pending until betweenTasks applies them (D4)", async () => {
    const t = setup({ taskOpen: true });
    // The runtime started with the defaults.
    expect(await t.ctl.sentences()).toEqual(["Use a patient tone.", "Hint after 2 tries."]);
    const r = await t.ctl.set("hintAfter", 4);
    expect(r).toMatchObject({ ok: true, state: { pending: ["hintAfter"] } });
    // A UI-only field applies at once: never pending.
    expect(await t.ctl.set("nickname", "Ana")).toMatchObject({ ok: true, state: { pending: ["hintAfter"] } });
    await t.ctl.idle();
    expect(t.log).toEqual([]);
    t.task(false);
    await t.ctl.betweenTasks();
    expect(t.log).toEqual(["refresh"]);
    expect(t.pushed.at(-1)?.pending).toEqual([]);
    // Nothing stale any more: the next session's start rewrites nothing.
    await t.ctl.betweenTasks();
    expect(t.log).toEqual(["refresh"]);
  });

  it("a failed rewrite stays stale and is tried again between tasks", async () => {
    const t = setup();
    t.failRefresh(true);
    await t.ctl.set("tone", "demanding");
    await t.ctl.idle();
    expect(t.log).toEqual(["refresh", "log:Could not rewrite AGENTS.md with the settings"]);
    t.failRefresh(false);
    await t.ctl.betweenTasks();
    expect(t.log.filter((l) => l === "refresh")).toHaveLength(2);
  });

  it("a failed rewrite keeps what the last AGENTS.md held: the change stays pending", async () => {
    const t = setup({ taskOpen: true });
    await t.ctl.sentences();
    await t.ctl.set("hintAfter", 4);
    t.task(false);
    t.failRefresh(true);
    await t.ctl.betweenTasks();
    t.task(true);
    expect((await t.ctl.state()).pending).toEqual(["hintAfter"]);
  });

  it("the sentences follow the stored values; forget drops what the last AGENTS.md held", async () => {
    const t = setup({ taskOpen: true });
    await t.ctl.set("tone", "demanding");
    expect(await t.ctl.sentences()).toEqual(["Use a demanding tone.", "Hint after 2 tries."]);
    await t.ctl.set("hintAfter", 3);
    expect((await t.ctl.state()).pending).toEqual(["hintAfter"]);
    t.ctl.forget();
    expect((await t.ctl.state()).pending).toEqual([]);
  });

  it("forget tells the window: an open sheet drops its Pending marks after Move folder", async () => {
    const t = setup({ taskOpen: true });
    await t.ctl.sentences();
    await t.ctl.set("hintAfter", 4);
    await t.ctl.idle();
    expect(t.pushed.at(-1)?.pending).toEqual(["hintAfter"]);
    t.ctl.forget();
    await t.ctl.idle();
    expect(t.pushed.at(-1)).toEqual({ values: { tone: "patient", hintAfter: 4, nickname: "" }, pending: [] });
  });

  it("a whenNoTask that fails is logged, never an unhandled rejection; betweenTasks still applies", async () => {
    const base = fs.mkdtempSync(path.join(root, "s-"));
    const store = new DataStore(base, dataCollections({ data: {}, settings }));
    const log: string[] = [];
    const ctl = new SettingsController({
      settings,
      store: async () => store,
      write: (request) => runDataRequest(store, request, { who: "person", scope: APP_SCOPE }),
      taskOpen: async () => false,
      whenNoTask: () => Promise.reject(new Error("The app is closing")),
      refresh: async () => {
        log.push("refresh");
        return true;
      },
      changed: () => undefined,
      log: (message) => void log.push(`log:${message}`),
    });
    await expect(ctl.changed()).resolves.toBeUndefined();
    expect(log).toEqual(["log:Could not apply the settings"]);
    await ctl.betweenTasks();
    expect(log).toEqual(["log:Could not apply the settings", "refresh"]);
  });
});

describe("SettingsController: mode settings (harness-settings spec §6)", () => {
  const modes = {
    socratic: {
      label: "Socratic",
      settings: {
        questions: { schema: z.enum(["few", "many"]), default: "few", control: "segmented" as const, label: "Questions", agent: "Ask {{value}} questions." },
      },
    },
    feynman: { label: "Feynman" },
  };
  function modeSetup() {
    const base = fs.mkdtempSync(path.join(root, "m-"));
    const store = new DataStore(base, dataCollections({ data: {}, settings, modes }));
    const ctl = new SettingsController({
      settings,
      modes,
      store: async () => store,
      write: (request) => runDataRequest(store, request, { who: "person", scope: APP_SCOPE }),
      taskOpen: async () => true,
      whenNoTask: async () => false,
      refresh: async () => true,
      changed: () => {},
    });
    const file = path.join(base, ".harness", "data", "_app", "settings.json");
    return { ctl, file, stored: () => JSON.parse(fs.readFileSync(file, "utf8")) as unknown };
  }

  it("saves one under modes.<mode>, reads it under its key, fills the mode's sentences, and is never pending", async () => {
    const t = modeSetup();
    // AGENTS.md was written (a task is open), so a changed top-level setting would be pending; a mode setting never is.
    await t.ctl.sentences();
    expect(await t.ctl.set("socratic.questions", "many")).toMatchObject({ ok: true, state: { values: { tone: "patient", "socratic.questions": "many" }, pending: [] } });
    expect(t.stored()).toEqual({ modes: { socratic: { questions: "many" } } });
    expect(await t.ctl.modeSentences("socratic")).toEqual(["Ask many questions."]);
    expect(await t.ctl.modeSentences("feynman")).toEqual([]);
    await t.ctl.set("socratic.questions", "few");
    expect(fs.existsSync(t.file)).toBe(false);
  });

  it("refuses an unknown key and a value its schema refuses", async () => {
    const t = modeSetup();
    expect(await t.ctl.set("socratic.nope", "x")).toEqual({ ok: false, message: "Unknown setting" });
    expect(await t.ctl.set("feynman.questions", "few")).toEqual({ ok: false, message: "Unknown setting" });
    expect((await t.ctl.set("socratic.questions", "lots")).ok).toBe(false);
    expect(fs.existsSync(t.file)).toBe(false);
  });
});
