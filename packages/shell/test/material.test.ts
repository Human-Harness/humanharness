import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { hasMaterial } from "@humanharness/harness-sdk";
import { type ConvertRunner, MAX_BYTES, MaterialStore, workerRunner } from "@humanharness/material";
import { DATA_PREFIX, MATERIAL_KEEP, NOTES_PREFIX } from "@humanharness/workspace";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type MaterialDeps, MaterialService } from "../src/main/material";

let root: string;
let base: string;
let picked: string[] | null;
const sent: [string, unknown][] = [];
const changes: string[] = [];
let service: MaterialService;

const deps = (over: Partial<MaterialDeps> = {}): MaterialDeps => ({
  material: { accepts: ["text", "pdf", "web"], grounding: { default: "mixed", personCanChange: true }, budget: { indexTokens: 600 } },
  base: async () => base,
  scopeOk: async (s) => s === "fractions",
  pickFiles: async () => picked,
  fetchLink: async () => ({ ok: false }),
  send: (channel, value) => void sent.push([channel, value]),
  provider: async () => "Anthropic",
  window: async () => null,
  afterChange: async (scope, what) => void changes.push(`${scope}: ${what}`),
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
    const fixed = new MaterialService(deps({ material: { accepts: ["text"], grounding: { default: "strict", personCanChange: false }, budget: { indexTokens: 600 } } }));
    expect(await fixed.setGrounding("fractions", "mixed")).toEqual({ ok: false, reason: "invalid" });
  });

  it("confirm checks its source id; an answer that doesn't apply is invalid", async () => {
    expect(await service.confirm("fractions", "../x", {})).toEqual({ ok: false, reason: "unknown-source" });
    expect(await service.confirm("fractions", "nothing", {})).toEqual({ ok: false, reason: "invalid" });
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

describe("D0", () => {
  it("a harness without material keeps today's keep list", () => {
    const keep = (h: { material?: unknown }) => [NOTES_PREFIX, DATA_PREFIX, ...(hasMaterial(h) ? [MATERIAL_KEEP] : [])];
    expect(keep({})).toEqual([NOTES_PREFIX, DATA_PREFIX]);
    expect(keep({ material: {} })).toContain(MATERIAL_KEEP);
  });
});
