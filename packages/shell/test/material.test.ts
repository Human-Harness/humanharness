import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { hasMaterial } from "@humanharness/harness-sdk";
import { type ConvertRunner, ConvertStopped, type Job, MAX_BYTES, MaterialStore, STAGES, workerRunner } from "@humanharness/material";
import { DATA_PREFIX, MATERIAL_KEEP, NOTES_PREFIX } from "@humanharness/workspace";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type MaterialDeps, MaterialService } from "../src/main/material";
import { MaterialJobs } from "../src/main/material-jobs";

// The real review stage; some tests below put a stand-in in its place.
const realReview = STAGES.review;

let root: string;
let base: string;
let picked: string[] | null;
const sent: [string, unknown][] = [];
const changes: string[] = [];
const trashed: string[] = [];
let service: MaterialService;

const stageFields = { fragmentKinds: ["explanation"], sheet: { sections: [{ id: "terms", label: "Key terms", prompt: "List them." }], maxTokens: 800 }, tiers: {} };

const deps = (over: Partial<MaterialDeps> = {}): MaterialDeps => ({
  material: { accepts: ["text", "pdf", "web"], grounding: { default: "mixed", personCanChange: true }, budget: { indexTokens: 600 }, ...stageFields },
  base: async () => base,
  scopeOk: async (s) => s === "fractions",
  pickFiles: async () => picked,
  fetchLink: async () => ({ ok: false }),
  send: (channel, value) => void sent.push([channel, value]),
  provider: async () => "Anthropic",
  window: async () => null,
  afterChange: async (scope, what) => void changes.push(`${scope}: ${what}`),
  trash: async (file) => void trashed.push(file),
  ...over,
});

const write = (name: string, text: string) => {
  const file = path.join(root, name);
  fs.writeFileSync(file, text);
  return file;
};

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "hh-mat-"));
  base = path.join(root, "anna");
  fs.mkdirSync(base);
  picked = null;
  sent.length = 0;
  changes.length = 0;
  trashed.length = 0;
  service = new MaterialService(deps());
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe("MaterialService", () => {
  it("adds a picked file to the scope, in the base, and sends the scope's view", async () => {
    picked = [write("Fractions.md", `# Fractions\n\n${"A fraction names a part. ".repeat(40)}`)];
    expect(await service.add("fractions")).toEqual({ ok: true, added: ["fractions"], refused: [] });
    expect(fs.existsSync(path.join(base, "material", "fractions", "Fractions.md"))).toBe(true);
    const view = await service.list("fractions");
    expect(view).toMatchObject({ scope: "fractions", grounding: { mode: "mixed", canChange: true }, provider: "Anthropic", window: null });
    expect(view.sources[0]).toMatchObject({ id: "fractions", name: "Fractions.md", status: "validating", stage: "review", failed: false });
    expect(view.sources[0].fragments).toBeGreaterThan(0);
    expect(sent.at(-1)).toEqual(["hh:materialStatus", view]);
    expect(changes).toEqual(["fractions: added fractions"]);
  });

  it("refused files come back with their message; nothing is kept", async () => {
    picked = [write("song.mp3", "ID3....")];
    const r = await service.add("fractions");
    expect(r).toEqual({ ok: true, added: [], refused: [{ name: "song.mp3", message: expect.any(String) }] });
    expect(r.ok && r.refused[0].message.length).toBeGreaterThan(0);
    expect(fs.existsSync(path.join(base, "material"))).toBe(false);
    expect(changes).toEqual([]);
  });

  it("a file past the size limit is refused without being read", async () => {
    const file = write("huge.txt", "");
    fs.truncateSync(file, MAX_BYTES + 1);
    picked = [file];
    expect(await service.add("fractions")).toMatchObject({ ok: true, added: [], refused: [{ name: "huge.txt" }] });
    expect(fs.existsSync(path.join(base, "material"))).toBe(false);
  });

  it("unknown scopes, `_app` and a cancelled dialog", async () => {
    expect(await service.add("other")).toEqual({ ok: false, reason: "unknown-scope" });
    expect(await service.add("_app")).toEqual({ ok: false, reason: "unknown-scope" });
    expect(await service.add("../x")).toEqual({ ok: false, reason: "unknown-scope" });
    expect(await service.add("fractions")).toEqual({ ok: true, added: [], refused: [] });
    const notReady = new MaterialService(deps({ base: async () => null }));
    expect(await notReady.add("fractions")).toEqual({ ok: false, reason: "not-ready" });
  });

  it("a link is fetched, kept as its page and read with its url", async () => {
    const html = `<html><body><nav>Menu item</nav><article><h1>Halves</h1>${"<p>Half of a whole is one of two equal parts.</p>".repeat(12)}</article></body></html>`;
    const linked = new MaterialService(
      deps({ fetchLink: async (u) => ({ ok: true, name: "example-org-halves.html", data: Buffer.from(html), url: u, fetchedAt: "2026-10-27T00:00:00.000Z" }) }),
    );
    expect(await linked.addLink("fractions", "https://example.org/halves")).toEqual({ ok: true, added: ["example-org-halves"], refused: [] });
    const view = await linked.list("fractions");
    expect(view.sources[0]).toMatchObject({ name: "example-org-halves.html", url: "https://example.org/halves", status: "validating" });
    expect(await service.addLink("fractions", "https://example.org/x")).toEqual({ ok: false, reason: "fetch" });
    expect(await service.addLink("fractions", 42)).toEqual({ ok: false, reason: "fetch" });
  });

  it("a profile switch changes the base: each profile sees its own material", async () => {
    picked = [write("a.md", "# A\n\nText.")];
    await service.add("fractions");
    base = path.join(root, "ben");
    fs.mkdirSync(base);
    expect((await service.list("fractions")).sources).toEqual([]);
  });

  it("the grounding mode is per scope, and only when the person may change it", async () => {
    expect(await service.setGrounding("fractions", "strict")).toEqual({ ok: true });
    expect((await service.list("fractions")).grounding.mode).toBe("strict");
    expect(await service.setGrounding("fractions", "loose" as never)).toEqual({ ok: false, reason: "invalid" });
    const fixed = new MaterialService(deps({ material: { accepts: ["text"], grounding: { default: "strict", personCanChange: false }, budget: { indexTokens: 600 }, ...stageFields } }));
    expect(await fixed.setGrounding("fractions", "mixed")).toEqual({ ok: false, reason: "invalid" });
  });

  it("confirm checks its source id; an answer that doesn't apply is invalid", async () => {
    expect(await service.confirm("fractions", "../x", {})).toEqual({ ok: false, reason: "unknown-source" });
    expect(await service.confirm("fractions", "nothing", {})).toEqual({ ok: false, reason: "invalid" });
  });

  it("a full review: confirming it reviews every fragment, without converting again", async () => {
    picked = [write("Fractions.md", `# Fractions\n\n${"A fraction names a part. ".repeat(40)}`)];
    await service.add("fractions");
    const store = new MaterialStore(base, "fractions");
    const before = (await store.source("fractions"))!.fragments;
    await store.patch("fractions", (s) => {
      const { stage: _s, ...rest } = s;
      return { ...rest, status: "pending", notice: "full-review", reviewQueue: ["x"] };
    });
    expect((await service.list("fractions")).sources[0]).toMatchObject({ status: "pending", notice: "full-review", asks: [] });
    // Converting would go through the runner: one that refuses everything shows it didn't.
    const strict = new MaterialService(deps({ runner: { convert: () => Promise.reject(new Error("no")), measure: () => Promise.reject(new Error("no")) } }));
    expect(await strict.confirm("fractions", "fractions", {})).toEqual({ ok: true });
    const s = (await store.source("fractions"))!;
    expect(s).toMatchObject({ status: "validating", stage: "review", fullReview: true, fragments: before });
    expect(s.notice).toBeUndefined();
    expect(s.reviewQueue).toBeUndefined();
  });

  it("decide: the person's answer to a question; anything else is refused", async () => {
    picked = [write("Fractions.md", `# Fractions\n\n${"A fraction names a part. ".repeat(40)}`)];
    await service.add("fractions");
    const store = new MaterialStore(base, "fractions");
    await store.patch("fractions", (s) => ({ ...s, status: "needs-person", asks: [{ question: "Use it?", choices: ["use", "remove"] }] }));
    expect((await service.list("fractions")).sources[0].asks).toEqual([{ question: "Use it?", choices: ["use", "remove"] }]);
    expect(await service.decide("fractions", "fractions", null, "nope")).toEqual({ ok: false, reason: "invalid" });
    expect(await service.decide("fractions", "fractions", "../x", "use")).toEqual({ ok: false, reason: "invalid" });
    expect(await service.decide("fractions", "../x", null, "use")).toEqual({ ok: false, reason: "unknown-source" });
    expect(await service.decide("fractions", "fractions", null, "keep")).toEqual({ ok: false, reason: "invalid" });
    expect(await service.decide("fractions", "fractions", null, "use")).toEqual({ ok: true });
    expect((await store.source("fractions"))?.status).toBe("ready");
    expect(changes.at(-1)).toBe("fractions: decided fractions");
    await store.patch("fractions", (s) => ({ ...s, status: "needs-person", asks: [{ question: "Use it?", choices: ["use", "remove"] }] }));
    expect(await service.decide("fractions", "fractions", null, "remove")).toEqual({ ok: true });
    expect(trashed).toEqual([path.join(base, "material", "fractions", "Fractions.md")]);
    expect((await service.list("fractions")).sources).toEqual([]);
  });

  it("the original of a source or a fragment, only inside the scope's folder", async () => {
    picked = [write("Fractions.md", `# Fractions\n\n${"A fraction names a part. ".repeat(40)}`)];
    await service.add("fractions");
    const kept = path.join(base, "material", "fractions", "Fractions.md");
    expect(await service.originalOf("fractions", "fractions")).toBe(kept);
    expect(await service.originalOf("fractions", "fractions-001")).toBe(kept);
    expect(await service.originalOf("fractions", "../../etc")).toBeNull();
    expect(await service.originalOf("other", "fractions")).toBeNull();
  });

  it("conversions share one runner that runs a few at a time", async () => {
    let running = 0;
    let most = 0;
    const real = workerRunner();
    const counted = async <T>(job: () => Promise<T>): Promise<T> => {
      running++;
      most = Math.max(most, running);
      try {
        return await job();
      } finally {
        running--;
      }
    };
    const counting: ConvertRunner = {
      convert: (...a) => counted(() => real.convert(...a)),
      measure: (...a) => counted(() => real.measure(...a)),
    };
    const limited = new MaterialService(deps({ runner: counting }));
    picked = ["a", "b", "c"].map((n) => write(`${n}.md`, `# ${n}\n\nText about ${n}.`));
    await Promise.all([limited.add("fractions"), limited.add("fractions")]);
    expect(most).toBeLessThanOrEqual(2);
    expect((await limited.list("fractions")).sources).toHaveLength(6);
  });

  it("a source left converting by an earlier run is converted again the first time its base is opened", async () => {
    const store = new MaterialStore(base, "fractions");
    const original = await store.addOriginal("left.md", Buffer.from(`# Left\n\n${"Some text. ".repeat(30)}`));
    await store.update(() => [
      {
        id: "left",
        scope: "fractions",
        path: original,
        hash: "x",
        type: "md",
        family: "text",
        pages: 1,
        sizeBytes: 10,
        skippedPages: [],
        status: "converting",
        issues: [],
        fixes: [],
        estimate: 0,
        used: 0,
        fragments: [],
        addedAt: "2026-10-27T00:00:00.000Z",
      },
    ]);
    const fresh = new MaterialService(deps());
    await fresh.settle();
    const view = await fresh.list("fractions");
    expect(view.sources[0]).toMatchObject({ id: "left", status: "validating", stage: "review" });
    expect(view.sources[0].fragments).toBeGreaterThan(0);
    expect(sent.some(([channel]) => channel === "hh:materialStatus")).toBe(true);
    expect(changes).toEqual(["fractions: processed left"]);
  });
});

describe("stopping conversions (closeRuntime, a profile switch)", () => {
  it("a conversion under way stops; nothing is recorded; the source resumes on its base's next use", async () => {
    const real = workerRunner();
    let hold = true;
    let stopped = 0;
    let release: (() => void) | null = null;
    const runner: ConvertRunner = {
      measure: real.measure,
      convert: (...a) =>
        hold
          ? new Promise((_, reject) => {
              release = () => reject(new ConvertStopped());
            })
          : real.convert(...a),
      stop: () => {
        stopped++;
        release?.();
      },
    };
    const svc = new MaterialService(deps({ runner }));
    picked = [write("a.md", `# A\n\n${"Some text. ".repeat(30)}`)];
    const adding = svc.add("fractions");
    while (!release) await new Promise((r) => setTimeout(r, 5));
    await svc.stop();
    expect(stopped).toBe(1);
    expect(await adding).toEqual({ ok: true, added: ["a"], refused: [] });
    expect(changes).toEqual([]);
    expect(await new MaterialStore(base, "fractions").source("a")).toMatchObject({ status: "converting" });
    // Another profile meanwhile, then back: the base is looked at afresh and the source converts.
    hold = false;
    const anna = base;
    base = path.join(root, "ben");
    fs.mkdirSync(base);
    await svc.settle();
    base = anna;
    await svc.settle();
    expect((await svc.list("fractions")).sources[0]).toMatchObject({ id: "a", status: "validating", stage: "review" });
    expect(changes).toEqual(["fractions: processed a"]);
  });

  it("a stop is not a lasting state: work asked for afterwards converts", async () => {
    let converts = 0;
    const real = workerRunner();
    const runner: ConvertRunner = { measure: real.measure, convert: (...a) => (converts++, real.convert(...a)) };
    const svc = new MaterialService(deps({ runner }));
    await svc.stop();
    picked = [write("a.md", `# A\n\n${"Some text. ".repeat(30)}`)];
    expect(await svc.add("fractions")).toMatchObject({ ok: true, added: ["a"] });
    expect(converts).toBe(1);
  });
});

describe("AI stages (material spec §10)", () => {
  const job = { scope: "fractions", source: "a", stage: "review" as const };
  let applied: boolean;
  let answer: boolean;
  beforeEach(() => {
    applied = false;
    answer = true;
    STAGES.review = {
      tools: ["material_review"],
      prompt: async () => "Review a.",
      accept: async (_name, args, state) => {
        state.answers.push(args);
        return "Saved.";
      },
      apply: async (store, j, state) => {
        applied = state.answers.length > 0 && answer;
        if (applied) await store.patch(j.source!, (s) => ({ ...s, status: "ready", stage: undefined }));
        return applied;
      },
    };
  });
  afterEach(() => {
    delete STAGES.review;
  });

  const seed = async () => {
    const store = new MaterialStore(base, "fractions");
    await store.update(() => [
      {
        id: "a",
        scope: "fractions",
        path: "a.md",
        hash: "x",
        type: "md",
        family: "text",
        pages: 1,
        sizeBytes: 1,
        skippedPages: [],
        status: "validating",
        stage: "review",
        issues: [],
        fixes: [],
        estimate: 0,
        used: 0,
        fragments: [],
        addedAt: "2026-10-27T00:00:00.000Z",
      },
    ]);
    return store;
  };

  it("finds the next job in the base, runs its session with the stage's tools, and applies its answers", async () => {
    await seed();
    const calls: unknown[] = [];
    const svc = new MaterialService(
      deps({
        runStage: async (j, prompt, tools, handle) => {
          calls.push([j, prompt, tools]);
          expect(await handle({ op: "material_review", verdict: "good" })).toBe("Saved.");
          await expect(handle({ op: "material_label" })).rejects.toThrow("Unknown request");
          return { ok: true };
        },
      }),
    );
    expect(await svc.nextJob()).toEqual(job);
    await svc.runJob(job, new AbortController().signal);
    expect(calls).toEqual([[job, "Review a.", ["material_review"]]]);
    expect(applied).toBe(true);
    expect(sent.at(-1)?.[0]).toBe("hh:materialStatus");
    expect(await svc.nextJob()).toBeNull();
  });

  it("a failed session marks the source; Try again sends it back; a stopped one changes nothing", async () => {
    await seed();
    let ok = false;
    const kicks: number[] = [];
    const svc = new MaterialService(
      deps({
        runStage: async (_j, _p, _t, handle) => {
          await handle({ op: "material_review" });
          return { ok };
        },
        kick: () => void kicks.push(1),
      }),
    );
    const stop = new AbortController();
    stop.abort();
    await svc.runJob(job, stop.signal);
    expect(await svc.nextJob()).toEqual(job);
    await svc.runJob(job, new AbortController().signal);
    expect((await svc.list("fractions")).sources[0]).toMatchObject({ status: "ready", failed: true });
    // Not retried on its own: the scope's sheet is next (no stage registered for it, so it waits).
    expect(await svc.nextJob()).toEqual({ scope: "fractions", stage: "sheet" });
    expect(await svc.retry("fractions", "nothing")).toEqual({ ok: false, reason: "unknown-source" });
    expect(await svc.retry("fractions", "a")).toEqual({ ok: true });
    expect(kicks).toHaveLength(1);
    ok = true;
    await svc.runJob(job, new AbortController().signal);
    expect((await svc.list("fractions")).sources[0]).toMatchObject({ status: "ready", failed: false });
  });

  it("a job no stage can run yet is stepped past: the queue settles instead of looping", async () => {
    await seed();
    delete STAGES.review;
    const svc = new MaterialService(deps({ runStage: async () => ({ ok: true }) }));
    let nexts = 0;
    const jobs = new MaterialJobs<Job>({ idle: () => true, next: () => (nexts++, svc.nextJob()), run: (j, signal) => svc.runJob(j, signal), pollMs: 2 });
    jobs.kick();
    await jobs.settled();
    expect(nexts).toBe(2);
    // Still waiting at its stage, for when the stage exists (the next kick).
    expect((await svc.list("fractions")).sources[0]).toMatchObject({ status: "validating", stage: "review" });
    svc.resetFailures();
    expect(await svc.nextJob()).toEqual(job);
  });

  it("an answer that leaves the source at its stage is not run again until a kick", async () => {
    await seed();
    answer = false;
    STAGES.review!.apply = async () => true;
    let runs = 0;
    const svc = new MaterialService(
      deps({
        runStage: async () => {
          runs++;
          return { ok: true };
        },
      }),
    );
    const jobs = new MaterialJobs<Job>({ idle: () => true, next: () => svc.nextJob(), run: (j, signal) => svc.runJob(j, signal), pollMs: 2 });
    jobs.kick();
    await jobs.settled();
    expect(runs).toBe(1);
  });

  it("a scope stage that fails is skipped until the next kick", async () => {
    const store = await seed();
    await store.update(() => []);
    await store.setStale("sheet");
    STAGES.sheet = { tools: [], prompt: async () => "Sheet.", accept: async () => "", apply: async () => true };
    try {
      const svc = new MaterialService(deps({ runStage: async () => ({ ok: false }) }));
      const sheet = { scope: "fractions", stage: "sheet" as const };
      expect(await svc.nextJob()).toEqual(sheet);
      await svc.runJob(sheet, new AbortController().signal);
      expect(await svc.nextJob()).toBeNull();
      svc.resetFailures();
      expect(await svc.nextJob()).toEqual(sheet);
    } finally {
      delete STAGES.sheet;
    }
  });
});

describe("the review stage in the queue (material spec §6.2)", () => {
  const review = realReview;
  beforeEach(() => {
    STAGES.review = review;
  });

  it("a review in two batches runs both in one kick, then waits for labelling", async () => {
    const store = new MaterialStore(base, "fractions");
    const ids = Array.from({ length: 25 }, (_, i) => `a-${String(i + 1).padStart(3, "0")}`);
    await store.update(() => [
      { id: "a", scope: "fractions", path: "a.md", hash: "x", type: "md", family: "text", pages: 1, sizeBytes: 1, skippedPages: [], status: "validating", stage: "review", fullReview: true, issues: [], fixes: [], estimate: 0, used: 0, fragments: [], addedAt: "2026-10-27T00:00:00.000Z" },
    ]);
    await store.writeFragments(
      "a",
      ids.map((id) => ({ meta: { id, source: "a.md", location: "lines 1", path: "A", summary: "", keywords: [], tokens: 10, items: [], checks: "ok", validated: "not-reviewed" }, md: `Text of ${id}.` })),
    );
    let runs = 0;
    const svc = new MaterialService(
      deps({
        runStage: async (_j, prompt, tools, handle) => {
          runs++;
          expect(tools).toEqual(["material_review"]);
          const batch = [...prompt.matchAll(/^\[(a-\d{3})\]/gm)].map((m) => m[1]);
          await handle({ op: "material_review", verdict: "good", fragments: batch.map((id) => ({ id, decision: "ok" })), issues: [] });
          return { ok: true };
        },
      }),
    );
    const jobs = new MaterialJobs<Job>({ idle: () => true, next: () => svc.nextJob(), run: (j, signal) => svc.runJob(j, signal), pollMs: 2 });
    jobs.kick();
    await jobs.settled();
    expect(runs).toBe(2);
    expect(await store.source("a")).toMatchObject({ status: "validating", stage: "label", verdict: "good" });
    expect((await store.readFragment("a-025"))?.meta.validated).toBe("sample");
  });
});

describe("D0", () => {
  it("a harness without material keeps today's keep list", () => {
    const keep = (h: { material?: unknown }) => [NOTES_PREFIX, DATA_PREFIX, ...(hasMaterial(h) ? [MATERIAL_KEEP] : [])];
    expect(keep({})).toEqual([NOTES_PREFIX, DATA_PREFIX]);
    expect(keep({ material: {} })).toContain(MATERIAL_KEEP);
  });
});
