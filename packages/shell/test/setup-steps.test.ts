import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { type HarnessSetupStep, defineHarness, z } from "@humanharness/harness-sdk";
import type { SettingsResult, SetupStepsState } from "@humanharness/ui/client";
import { APP_SCOPE, DataStore, runDataRequest } from "@humanharness/workspace";
import { SetupSteps } from "../src/main/setup-steps";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "hh-steps-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

const NOW = "2026-10-27T10:00:00.000Z";
const harness = defineHarness({
  id: "tutor",
  name: "Tutor",
  core: "^0.1.0",
  engines: ["claude"],
  folder: { suggested: "Documents/Tutor" },
  instructions: "./AGENTS.md",
  permissions: { edit: "none", exec: false, web: false },
  blocks: {},
  actions: { conocerte: { label: "Get to know you", prompt: "t.md", cost: "light" } },
  data: { profile: { scoped: false, single: true, schema: z.object({ name: z.string().min(1), goal: z.string().min(3) }), agent: "write" } },
  settings: { tab: "How I learn", fields: { tone: { schema: z.enum(["patient", "demanding"]), default: "patient", control: "segmented", label: "Tone" } } },
  setup: [
    { id: "conocerte", kind: "interview", label: "Get to know you", action: "conocerte", writes: "profile", required: true },
    { id: "estilo", kind: "form", label: "How the AI talks", settings: ["tone"] },
    { id: "goal", kind: "form", label: "Your goal", collection: "profile", fields: ["goal"] },
    { id: "ready", kind: "component", label: "Ready check", component: "ReadyStep", required: true },
  ],
  author: "t",
});

function setup(
  opts: { steps?: HarnessSetupStep[]; base?: string | null; ranBefore?: boolean | (() => Promise<boolean>); settingFails?: boolean; writeFails?: boolean } = {},
) {
  const folder = opts.base === null ? null : (opts.base ?? fs.mkdtempSync(path.join(root, "f-")));
  const store = folder ? new DataStore(folder, harness.data) : null;
  const pushed: SetupStepsState[] = [];
  const settingSets: { field: string; value: unknown }[] = [];
  const values: Record<string, unknown> = { tone: "patient" };
  let open: string | undefined;
  let quitting = false;
  const ctl = new SetupSteps({
    steps: opts.steps ?? harness.setup!,
    data: harness.data,
    settings: harness.settings,
    base: async () => folder,
    store: async () => store,
    write: async (request) => {
      if (opts.writeFails) throw new Error("disk full");
      return runDataRequest(store!, request, { who: "person", scope: APP_SCOPE });
    },
    setSetting: async (field, value): Promise<SettingsResult> => {
      if (opts.settingFails) return { ok: false, message: "Not now" };
      settingSets.push({ field, value });
      values[field] = value;
      return { ok: true, state: { values, pending: [] } };
    },
    settingValues: async () => values,
    openAction: async () => open,
    ranBefore: async () => (typeof opts.ranBefore === "function" ? opts.ranBefore() : (opts.ranBefore ?? false)),
    quitting: () => quitting,
    changed: (s) => void pushed.push(s),
    now: () => new Date(NOW),
  });
  const file = () => (folder ? JSON.parse(fs.readFileSync(path.join(folder, ".harness", "setup.json"), "utf8")) : null);
  return { ctl, store, folder, pushed, settingSets, file, setOpen: (a?: string) => (open = a), quit: () => (quitting = true) };
}

const person = { who: "person" as const, scope: APP_SCOPE };

describe("SetupSteps: state", () => {
  it("a fresh folder: every step missing, the required ones blocking; nothing is written by a read", async () => {
    const t = setup();
    expect(await t.ctl.state()).toEqual({ steps: { conocerte: "missing", estilo: "missing", goal: "missing", ready: "missing" }, blocking: ["conocerte", "ready"] });
    expect(fs.existsSync(path.join(t.folder!, ".harness", "setup.json"))).toBe(false);
  });

  it("before the app is set up: all missing, and every change is refused", async () => {
    const t = setup({ base: null });
    expect((await t.ctl.state()).steps.conocerte).toBe("missing");
    expect(await t.ctl.complete("ready")).toEqual({ ok: false, reason: "not-ready" });
  });

  it("a folder that ran tasks before these steps existed counts as set up, with no step seen yet (spec §8 Q3)", async () => {
    const t = setup({ ranBefore: true });
    expect((await t.ctl.state()).blocking).toEqual([]);
    expect(t.file()).toEqual({ version: 1, steps: {}, finishedAt: NOW, known: [] });
  });

  it("a setup.json it can't read (EACCES) reads as empty, and nothing ever saves over it", async () => {
    const t = setup({ ranBefore: true });
    const file = path.join(t.folder!, ".harness", "setup.json");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const text = `${JSON.stringify({ version: 1, steps: { ready: { state: "done", at: NOW }, estilo: { state: "skipped", at: NOW } } })}\n`;
    fs.writeFileSync(file, text);
    fs.chmodSync(file, 0o000);
    const logs: unknown[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((m: unknown) => void logs.push(m));
    try {
      expect((await t.ctl.state()).steps.ready).toBe("missing");
      await t.store!.put("profile", { name: "Sofi", goal: "Pass" }, person);
      expect(await t.ctl.complete("ready")).toEqual({ ok: false, reason: "not-ready" });
      expect(await t.ctl.complete("conocerte")).toEqual({ ok: false, reason: "not-ready" });
      expect(await t.ctl.skip("goal")).toEqual({ ok: false, reason: "not-ready" });
      expect(await t.ctl.submit("goal", { goal: "Pass maths" })).toEqual({ ok: false, reason: "not-ready" });
      expect((await t.ctl.finish()).steps.ready).toBe("missing");
      await t.ctl.acknowledge();
    } finally {
      spy.mockRestore();
      fs.chmodSync(file, 0o644);
    }
    expect(fs.readFileSync(file, "utf8")).toBe(text);
    // The form's write didn't happen either: the step's state couldn't be kept.
    expect(await t.store!.get("profile", undefined, person)).toEqual({ name: "Sofi", goal: "Pass" });
    expect(logs.every((m) => m === "Could not read setup.json")).toBe(true);
    expect(t.pushed).toEqual([]);
  });

  it("state() waits for a change in flight, so its backfill never lands over a new mark", async () => {
    // state() looks at the folder first and slowly: unserialized, its backfill would be saved after the mark.
    let calls = 0;
    const t = setup({ ranBefore: async () => (calls++ === 0 ? new Promise((r) => setTimeout(() => r(true), 50)) : true) });
    const [, done] = await Promise.all([t.ctl.state(), t.ctl.complete("ready")]);
    expect(done.ok).toBe(true);
    expect(t.file().steps.ready?.state).toBe("done");
    expect((await t.ctl.state()).steps.ready).toBe("done");
  });
});

describe("SetupSteps: a form", () => {
  it("over a collection: shows the stored fields, merges the answer into the record through the person's write, and is done", async () => {
    const t = setup();
    expect(await t.ctl.values("goal")).toEqual({});
    await t.store!.put("profile", { name: "Sofi", goal: "Pass" }, person);
    expect(await t.ctl.values("goal")).toEqual({ goal: "Pass" });
    const r = await t.ctl.submit("goal", { goal: "Pass maths", name: "Hacked" });
    expect(r).toEqual({ ok: true, state: expect.objectContaining({ steps: expect.objectContaining({ goal: "done" }) }) });
    expect(await t.store!.get("profile", undefined, person)).toEqual({ name: "Sofi", goal: "Pass maths" });
    expect(t.file().steps.goal).toEqual({ state: "done", at: NOW });
    expect(t.pushed.at(-1)?.steps.goal).toBe("done");
  });

  it("over a collection: a field the schema refuses comes back by field; a record the store refuses as a whole", async () => {
    const t = setup();
    expect(await t.ctl.submit("goal", { goal: "no" })).toEqual({ ok: false, reason: "invalid", errors: [{ path: "goal", message: expect.any(String) }] });
    // No name yet: the merged record fails the collection's schema.
    const whole = await t.ctl.submit("goal", { goal: "Pass maths" });
    expect(whole).toEqual({ ok: false, reason: "invalid", errors: [{ path: "", message: expect.any(String) }] });
    expect(fs.existsSync(path.join(t.folder!, ".harness", "setup.json"))).toBe(false);
    expect(await t.ctl.submit("goal", "goal")).toEqual({ ok: false, reason: "invalid", errors: [{ path: "", message: "Expected the form's fields" }] });
  });

  it("over a collection: a write that fails for another reason comes back as a reason, not a throw", async () => {
    const t = setup({ writeFails: true });
    const logs: unknown[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((m: unknown) => void logs.push(m));
    expect(await t.ctl.submit("goal", { goal: "Pass maths" })).toEqual({
      ok: false,
      reason: "invalid",
      errors: [{ path: "", message: "Something went wrong with the data" }],
    });
    spy.mockRestore();
    expect(logs).toEqual(["Could not save the setup form"]);
    expect((await t.ctl.state()).steps.goal).toBe("missing");
  });

  it("over settings: shows their values, saves each through the settings controller, and is done", async () => {
    const t = setup();
    expect(await t.ctl.values("estilo")).toEqual({ tone: "patient" });
    expect((await t.ctl.submit("estilo", { tone: "demanding" })).ok).toBe(true);
    expect(t.settingSets).toEqual([{ field: "tone", value: "demanding" }]);
    const failing = setup({ settingFails: true });
    expect(await failing.ctl.submit("estilo", { tone: "demanding" })).toEqual({ ok: false, reason: "invalid", errors: [{ path: "tone", message: "Not now" }] });
  });

  it("complete is not how a form ends", async () => {
    expect(await setup().ctl.complete("goal")).toEqual({ ok: false, reason: "unknown" });
  });
});

describe("SetupSteps: an interview (spec §3: the task closed and the record passes its schema)", () => {
  it("is refused while its task is open, and with no record; done once both hold", async () => {
    const t = setup();
    t.setOpen("conocerte");
    expect(await t.ctl.complete("conocerte")).toEqual({ ok: false, reason: "open" });
    t.setOpen(undefined);
    expect(await t.ctl.complete("conocerte")).toEqual({ ok: false, reason: "incomplete" });
    await t.store!.put("profile", { name: "Sofi", goal: "Pass maths" }, person);
    const r = await t.ctl.complete("conocerte");
    expect(r.ok && r.state.blocking).toEqual(["ready"]);
  });

  it("another task being open doesn't matter", async () => {
    const t = setup();
    await t.store!.put("profile", { name: "Sofi", goal: "Pass maths" }, person);
    t.setOpen("practice");
    expect((await t.ctl.complete("conocerte")).ok).toBe(true);
  });
});

describe("SetupSteps: components, skip, unknown ids", () => {
  it("a component's done marks it done", async () => {
    const t = setup();
    expect((await t.ctl.complete("ready")).ok).toBe(true);
    expect(t.file().steps.ready.state).toBe("done");
  });

  it("skip: refused for a required step; remembered for a skippable one; a done step stays done", async () => {
    const t = setup();
    expect(await t.ctl.skip("conocerte")).toEqual({ ok: false, reason: "required" });
    expect((await t.ctl.skip("estilo")).ok).toBe(true);
    expect(t.file().steps.estilo.state).toBe("skipped");
    await t.ctl.submit("estilo", { tone: "demanding" });
    expect((await t.ctl.skip("estilo")).ok).toBe(true);
    expect(t.file().steps.estilo.state).toBe("done");
  });

  it("refuses ids it doesn't know, of any type, and everything while quitting", async () => {
    const t = setup();
    for (const id of ["gone", "constructor", 3, null]) {
      expect(await t.ctl.complete(id)).toEqual({ ok: false, reason: "unknown" });
      expect(await t.ctl.skip(id)).toEqual({ ok: false, reason: "unknown" });
      expect(await t.ctl.submit(id, {})).toEqual({ ok: false, reason: "unknown" });
      expect(await t.ctl.values(id)).toEqual({});
    }
    t.quit();
    expect(await t.ctl.complete("ready")).toEqual({ ok: false, reason: "not-ready" });
  });
});

describe("SetupSteps: finish and acknowledge (spec §8 Q3)", () => {
  it("All set records the time and the steps seen; a step an update adds doesn't block until Settings shows it", async () => {
    const t = setup();
    await t.store!.put("profile", { name: "Sofi", goal: "Pass maths" }, person);
    await t.ctl.complete("conocerte");
    await t.ctl.complete("ready");
    await t.ctl.finish();
    expect(t.file()).toMatchObject({ finishedAt: NOW, known: ["conocerte", "estilo", "goal", "ready"] });
    // The harness updates: a new required step.
    const extra: HarnessSetupStep = { id: "cuentas", kind: "component", label: "Accounts", component: "AccountsStep", required: true };
    const later = setup({ base: t.folder, steps: [...harness.setup!, extra] });
    expect(await later.ctl.state()).toMatchObject({ steps: { cuentas: "missing" }, blocking: [] });
    expect((await later.ctl.acknowledge()).blocking).toEqual(["cuentas"]);
    expect(later.file().known).toEqual(["conocerte", "estilo", "goal", "ready", "cuentas"]);
  });

  it("finish keeps the first time; acknowledge with nothing new writes nothing", async () => {
    const t = setup();
    await t.ctl.finish();
    const first = fs.statSync(path.join(t.folder!, ".harness", "setup.json")).mtimeMs;
    await t.ctl.acknowledge();
    expect(fs.statSync(path.join(t.folder!, ".harness", "setup.json")).mtimeMs).toBe(first);
  });
});
