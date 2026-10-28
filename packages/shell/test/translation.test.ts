import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { LanguageState } from "@humanharness/ui/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TranslationCache } from "../src/main/translation-cache";
import { type Runner, TranslationService } from "../src/main/translation";

let dir: string;
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const CORE = { "chat.send": "Send", "home.start": "Start {{name}}", "notes.keyPoints_one": "{{count}} key point", "notes.keyPoints_other": "{{count}} key points", "legal.engine.accept": "I accept" };
const HARNESS = { title: "Notes" };
const batchOf = (p: string) => JSON.parse(/<batch>\n([\s\S]*)\n<\/batch>/.exec(p)![1]) as { forms: string[]; strings: Record<string, unknown> };

/** A runner that answers each prompt's batch with `answer(batch)` through `handle`, as the engine would. */
function runner(answer: (batch: Record<string, unknown>, forms: string[]) => Record<string, unknown> | null, fail?: number): Runner & { prompts: string[] } {
  const prompts: string[] = [];
  const run: Runner = async ({ next, handle, onTurn, signal }) => {
    for (let i = 0; ; i++) {
      if (signal.aborted) return { ok: false, turns: i, error: { code: "cancelled" } };
      const p = await next(i);
      if (p === null) return { ok: true, turns: i };
      prompts.push(p);
      if (fail === i) {
        await onTurn({ ok: false, error: { code: "out-of-quota" } }, i);
        return { ok: false, turns: i + 1, error: { code: "out-of-quota" } };
      }
      const { forms, strings } = batchOf(p);
      const a = answer(strings, forms);
      if (a) await handle({ op: "save", strings: a }).catch(() => undefined);
      await onTurn({ ok: true }, i);
    }
  };
  return Object.assign(run, { prompts });
}

const pseudo = (b: Record<string, unknown>, forms: string[]) =>
  Object.fromEntries(Object.entries(b).map(([k, v]) => [k, typeof v === "string" ? `~${v}` : Object.fromEntries(forms.map((f) => [f, `~${(v as Record<string, string>).other}`]))]));

function make(o: { language?: string; run?: Runner; available?: true | "no-engine" | "mock"; batchSize?: number; core?: Record<string, string>; cache?: (dir: string) => TranslationCache; prepare?: () => Promise<{ engineName: string; run: Runner } | null> } = {}) {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "hh-translation-"));
  let saved = o.language ?? "en";
  const sent: LanguageState[] = [];
  const svc = new TranslationService({
    cache: o.cache ? o.cache(dir) : new TranslationCache(dir),
    core: o.core ?? CORE,
    tone: "warm",
    language: async () => saved,
    saveLanguage: async (tag) => void (saved = tag),
    available: async () => o.available ?? true,
    prepare: o.prepare ?? (async () => (o.run ? { engineName: "Claude", run: o.run } : null)),
    engineName: async () => "Claude",
    send: (s) => void sent.push(s),
    batchSize: o.batchSize ?? 2,
  });
  return { svc, sent, saved: () => saved, dir };
}

describe("TranslationService (language spec §4–§6, §9)", () => {
  it("D0: English needs nothing and writes nothing", async () => {
    const t = make();
    expect(await t.svc.state(HARNESS)).toMatchObject({ language: "en", cached: [], missing: 0, canTranslate: true, run: null });
    expect(await t.svc.choose("en", HARNESS)).toEqual({ ok: true, language: "en", strings: {} });
    expect(fs.existsSync(path.join(t.dir, "locales"))).toBe(false);
  });

  it("an English variant counts as English: nothing missing, nothing to translate", async () => {
    const t = make({ language: "en-GB", run: runner(pseudo) });
    expect(await t.svc.state(HARNESS)).toMatchObject({ language: "en-GB", missing: 0 });
    expect(await t.svc.translate("en-GB", HARNESS)).toEqual({ ok: false, reason: "invalid" });
    expect(await t.svc.strings("en-GB", HARNESS)).toEqual({});
  });

  it("a language without a translation needs the notice first", async () => {
    const t = make();
    expect(await t.svc.choose("es", HARNESS)).toEqual({ ok: false, reason: "needs-translation" });
    expect(t.saved()).toBe("en");
  });

  it("translates in batches, skips legal keys, sends plural forms, then saves and switches", async () => {
    const r = runner(pseudo);
    const t = make({ run: r });
    expect(await t.svc.translate("pl", HARNESS)).toEqual({ ok: true });
    await t.svc.settled();
    expect(r.prompts).toHaveLength(2);
    expect(r.prompts.join("\n")).not.toContain("legal.");
    expect(r.prompts[0]).toContain("Polish");
    expect(r.prompts[0]).toContain("few, many, one, other");
    expect(t.saved()).toBe("pl");
    expect(t.sent.at(-1)).toMatchObject({ language: "pl", missing: 0, run: { tag: "pl", status: "done", done: 2, total: 2 } });
    const strings = await t.svc.strings("pl", HARNESS);
    expect(strings).toMatchObject({ "core:chat.send": "~Send", "core:notes.keyPoints_few": "~{{count}} key points", "harness:title": "~Notes" });
    expect(Object.keys(strings).some((k) => k.includes("legal."))).toBe(false);
    expect(await t.svc.choose("pl", HARNESS)).toMatchObject({ ok: true, language: "pl" });
  });

  it("a key that fails is sent once more in a later batch; failing again it stays English", async () => {
    const r = runner((b, f) => ({ ...pseudo(b, f), ...(Object.hasOwn(b, "core:home.start") ? { "core:home.start": "Empezar" } : {}) }));
    const t = make({ run: r });
    await t.svc.translate("es", HARNESS);
    await t.svc.settled();
    expect(r.prompts.filter((p) => p.includes("core:home.start"))).toHaveLength(2);
    expect(t.saved()).toBe("es");
    expect((await t.svc.strings("es", HARNESS))["core:home.start"]).toBeUndefined();
    expect(await t.svc.state(HARNESS)).toMatchObject({ missing: 0 });
  });

  it("refuses keys it didn't send and saves outside a batch", async () => {
    let handleRef: ((r: unknown) => Promise<unknown>) | null = null;
    const r: Runner = async ({ next, handle, onTurn }) => {
      handleRef = handle;
      const p = (await next(0))!;
      await expect(handle({ op: "save", strings: { "core:not.sent": "x" } })).resolves.toMatch(/not in this batch/);
      await expect(handle({ op: "nope" })).rejects.toThrow();
      await handle({ op: "save", strings: pseudo(batchOf(p).strings, ["one", "other"]) });
      await onTurn({ ok: true }, 0);
      return { ok: false, turns: 1, error: { code: "cancelled" } };
    };
    const t = make({ run: r, batchSize: 100 });
    await t.svc.translate("es", HARNESS);
    await t.svc.settled();
    await expect(handleRef!({ op: "save", strings: { "core:chat.send": "x" } })).rejects.toThrow(/No batch/);
  });

  it("bounds a save: at most 150 keys read, refusals capped, unsafe keys never stored", async () => {
    let answer = "";
    const r: Runner = async ({ next, handle, onTurn }) => {
      await next(0);
      const junk = Object.fromEntries(Array.from({ length: 400 }, (_, i) => [`core:junk.${i}`, "x"]));
      answer = String(await handle({ op: "save", strings: { "core:__proto__": "x", ...junk, "core:chat.send": "~Send" } }));
      await onTurn({ ok: true }, 0);
      return { ok: false, turns: 1, error: { code: "cancelled" } };
    };
    const t = make({ run: r, batchSize: 100 });
    await t.svc.translate("es", HARNESS);
    await t.svc.settled();
    expect(answer.length).toBeLessThan(3000);
    // The key past the first 150 was never read.
    expect(answer).toMatch(/^Saved 0\./);
    const file = JSON.parse(fs.readFileSync(path.join(t.dir, "locales", "es.json"), "utf8"));
    expect(Object.keys(file.entries)).toEqual([]);
  });

  it("a cut run keeps what was saved, doesn't switch, and resumes where it stopped", async () => {
    const first = runner(pseudo, 1);
    const t = make({ run: first });
    await t.svc.translate("es", HARNESS);
    await t.svc.settled();
    expect(t.saved()).toBe("en");
    expect(t.sent.at(-1)!.run).toMatchObject({ status: "failed", reason: "quota", done: 1 });
    const left = (await t.svc.state(HARNESS))!;
    expect(left.cached).toEqual([{ tag: "es", complete: false }]);
    const second = runner(pseudo);
    (t.svc as unknown as { d: { prepare: unknown } }).d.prepare = async () => ({ engineName: "Claude", run: second });
    await t.svc.translate("es", HARNESS);
    await t.svc.settled();
    expect(second.prompts.join("\n")).not.toContain("core:chat.send");
    expect(t.saved()).toBe("es");
  });

  it("refuses: a bad or RTL tag, English, a second run, no engine, mock mode", async () => {
    let release!: () => void;
    const slow: Runner = async ({ next, onTurn }) => {
      await next(0);
      await new Promise<void>((r) => (release = r));
      await onTurn({ ok: true }, 0);
      return { ok: true, turns: 1 };
    };
    const t = make({ run: slow });
    for (const bad of ["he", "../x", 3, "en"]) expect(await t.svc.translate(bad as string, HARNESS)).toEqual({ ok: false, reason: "invalid" });
    expect(await t.svc.translate("es", HARNESS)).toEqual({ ok: true });
    expect(await t.svc.translate("fr", HARNESS)).toEqual({ ok: false, reason: "busy" });
    expect(await t.svc.choose("en", HARNESS)).toEqual({ ok: false, reason: "busy" });
    // The run reaches its first turn only after loading the cache: wait for it before letting it end.
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    release();
    await t.svc.settled();
    fs.rmSync(dir, { recursive: true, force: true });
    expect(await make({ available: "mock" }).svc.translate("es", HARNESS)).toEqual({ ok: false, reason: "mock" });
    fs.rmSync(dir, { recursive: true, force: true });
    expect(await make({ available: "no-engine" }).svc.translate("es", HARNESS)).toEqual({ ok: false, reason: "no-engine" });
    fs.rmSync(dir, { recursive: true, force: true });
    // Ready by the cheap check, but the engine can't run after all: still "no-engine" (spec §3).
    expect(await make().svc.translate("es", HARNESS)).toEqual({ ok: false, reason: "no-engine" });
  });

  it("cancel and stop end the run with what was saved", async () => {
    const t = make({ run: runner(pseudo), batchSize: 1 });
    await t.svc.translate("es", HARNESS);
    await t.svc.cancel();
    await t.svc.settled();
    expect(t.sent.at(-1)!.run?.status).toBe("cancelled");
    expect(t.saved()).toBe("en");
  });

  it("a cache write that fails ends the run as failed, keeps the language and tells the agent no path", async () => {
    class Broken extends TranslationCache {
      override save(): Promise<void> {
        return Promise.reject(new Error("EACCES: permission denied, open '/secret/userData/locales/es.json'"));
      }
    }
    const answers: unknown[] = [];
    const r = runner((b, f) => pseudo(b, f));
    const spy: Runner = (o) => r({ ...o, handle: async (q) => answers.push(await o.handle(q)) });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const t = make({ run: spy, cache: (d) => new Broken(d) });
    await t.svc.translate("es", HARNESS);
    await t.svc.settled();
    vi.restoreAllMocks();
    expect(t.sent.at(-1)!.run).toMatchObject({ status: "failed", reason: "engine" });
    expect(t.saved()).toBe("en");
    expect(r.prompts).toHaveLength(1);
    expect(answers).toEqual(["The app could not store this batch. Stop now."]);
  });

  it("a turn that times out (code cancelled, no stop asked) is failed, not cancelled", async () => {
    const r: Runner = async ({ next, onTurn }) => {
      await next(0);
      await onTurn({ ok: false, error: { code: "cancelled" } }, 0);
      return { ok: false, turns: 1, error: { code: "cancelled" } };
    };
    const t = make({ run: r });
    await t.svc.translate("es", HARNESS);
    await t.svc.settled();
    expect(t.sent.at(-1)!.run).toMatchObject({ status: "failed", reason: "engine" });
  });

  it("a cancel while the engine is being prepared is not lost: the run never starts", async () => {
    let ready!: (v: { engineName: string; run: Runner }) => void;
    const run = vi.fn<Runner>(async () => ({ ok: true, turns: 0 }));
    const t = make({ prepare: () => new Promise((r) => (ready = r)) });
    const started = t.svc.translate("es", HARNESS);
    await vi.waitFor(() => expect(ready).toBeTypeOf("function"));
    await t.svc.cancel();
    ready({ engineName: "Claude", run });
    expect(await started).toEqual({ ok: false, reason: "failed" });
    await t.svc.settled();
    expect(run).not.toHaveBeenCalled();
    expect(t.saved()).toBe("en");
  });

  it("a key answered twice in one turn is refused the second time, with the reason", async () => {
    const answers: unknown[] = [];
    const r: Runner = async ({ next, handle, onTurn }) => {
      await next(0);
      answers.push(await handle({ op: "save", strings: { "core:chat.send": "~Send" } }));
      answers.push(await handle({ op: "save", strings: { "core:chat.send": "~Send again" } }));
      await onTurn({ ok: true }, 0);
      return { ok: false, turns: 1, error: { code: "cancelled" } };
    };
    const t = make({ run: r, batchSize: 100 });
    await t.svc.translate("es", HARNESS);
    await t.svc.settled();
    expect(answers).toEqual(["Saved 1.", "Saved 0. Not kept: core:chat.send (already answered)."]);
  });

  it("a runner that throws ends the run as failed, never as done", async () => {
    const t = make({
      run: async () => {
        throw new Error("boom");
      },
    });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    await t.svc.translate("es", HARNESS);
    await t.svc.settled();
    expect(t.sent.at(-1)!.run).toMatchObject({ status: "failed", reason: "engine" });
    expect(t.saved()).toBe("en");
    vi.restoreAllMocks();
  });

  it("caps a run at 60 batches", async () => {
    const core = Object.fromEntries(Array.from({ length: 200 }, (_, i) => [`k.k${i}`, `Text ${i}`]));
    const r = runner(pseudo);
    const t = make({ run: r, batchSize: 1, core });
    await t.svc.translate("es", {});
    await t.svc.settled();
    expect(r.prompts).toHaveLength(60);
    expect(t.sent.at(-1)!.run).toMatchObject({ status: "done", done: 60, total: 60 });
  });

  it("after an update, changed English is missing again and never sent without asking", async () => {
    const t = make({ run: runner(pseudo) });
    await t.svc.translate("es", HARNESS);
    await t.svc.settled();
    expect((await t.svc.state({ title: "My notes" }))!.missing).toBe(1);
    expect((await t.svc.strings("es", { title: "My notes" }))["harness:title"]).toBeUndefined();
  });
});
