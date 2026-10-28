import { Buffer } from "node:buffer";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { main } from "../src/main";
import { shellDir } from "../src/paths";
import { buildPlugin } from "../src/plugin-build";
import { pluginContext, runSource } from "../src/plugin-run";
import { fixtureTransport, parseFixture } from "@humanharness/harness-sdk/plugin-fixtures";
import { P12_NOTE, fixtureSecrets, readFixtures, testPlugin } from "../src/plugin-test";
import { memoryIo, tempRoot } from "./helpers";

const CONFIG = `import { definePlugin, z } from "@humanharness/harness-sdk";

export default definePlugin({
  id: "mini",
  name: "Mini",
  version: "0.1.0",
  harness: "*",
  permissions: { hosts: ["api.example.com"], exec: [{ cmd: "gh", args: ["api", "*"] }], secrets: [{ id: "tok", label: "Token" }] },
  sources: [{ id: "queues", ttl: 900 }, { id: "clock", ttl: 900 }],
  data: { queues: { key: "id", agent: "read", schema: z.object({ id: z.string(), size: z.number() }) } },
  settings: { fields: { limit: { label: "Limit", control: "number", schema: z.number().int().min(1).max(50), default: 7 } } },
  panels: [{ id: "main", title: "Mini" }],
  chips: [{ id: "count" }],
});
`;

const BACKEND = `import { definePluginBackend } from "@humanharness/harness-sdk/plugin-backend";

export default definePluginBackend({
  sources: {
    async queues(ctx) {
      await ctx.log("info", "globals: " + [typeof fetch, typeof globalThis.fetch, typeof process, typeof globalThis.require, typeof Buffer].join(" "));
      const res = await ctx.fetch("https://api.example.com/queues?page=1", { headers: { Authorization: "Bearer {{secret:tok}}" } });
      const out = await ctx.exec("gh", ["api", "user"]);
      const { limit } = await ctx.settings.get();
      await ctx.data.replaceAll("queues", res.json().map((q) => ({ id: q.id, size: q.size + Number(out.stdout) })));
      await ctx.attention.raise({ key: "big-c", severity: "warn", title: "Queue c is big (limit " + limit + ")" });
      await ctx.chip.set("count", { text: "3 queues" });
      console.log("done", { n: 3 });
    },
    async clock(ctx) {
      await ctx.log("info", "now " + new Date().toISOString() + " " + new Date(Date.now()).toISOString());
    },
  },
});
`;

const PANEL = `export default function Main() {
  return <p>Mini</p>;
}
`;

const QUEUES = { kind: "fetch", request: { method: "GET", url: "https://api.example.com/queues?page=1" }, response: { status: 200, headers: {}, text: '[{"id":"a","size":1},{"id":"b","size":2},{"id":"c","size":3}]' } };
const GH = { kind: "exec", request: { cmd: "gh", args: ["api", "*"] }, response: { code: 0, stdout: "10", stderr: "" } };

let root: string;
let cleanup: () => void;
let built: string;

function writeFiles(dir: string, files: Record<string, string>) {
  for (const [name, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), text);
  }
}

/** A copy of the built plugin with these fixtures (fixtures sit beside dist/, so no rebuild). */
function withFixtures(name: string, fixtures: Record<string, unknown>): string {
  const dir = path.join(root, name);
  fs.cpSync(path.join(built, "dist"), path.join(dir, "dist"), { recursive: true });
  writeFiles(dir, Object.fromEntries(Object.entries(fixtures).map(([f, v]) => [`fixtures/${f}`, typeof v === "string" ? v : JSON.stringify(v)])));
  return dir;
}

const good = () => withFixtures(`good-${Math.random().toString(36).slice(2)}`, { "queues/001.json": QUEUES, "queues/002.json": GH });

beforeAll(async () => {
  ({ root, cleanup } = tempRoot("hh-plugin-test-"));
  built = path.join(root, "mini");
  writeFiles(built, { "plugin.config.ts": CONFIG, "backend.ts": BACKEND, "panels/main.tsx": PANEL });
  await buildPlugin(built);
}, 60_000);
afterAll(() => cleanup());

async function cli(dir: string, ...args: string[]) {
  const { io, out, err } = memoryIo(dir);
  const code = await main(["plugin", "test", ...args], io);
  return { code, out: out(), err: err() };
}

describe("humanharness plugin test", () => {
  it("prints the P12 note first, then the records, the attention item and the chip, and exits 0", async () => {
    const { code, out } = await cli(good(), "--source", "queues");
    expect(out.split("\n")[0]).toBe(P12_NOTE);
    expect(out).toContain("queues: ok");
    expect(out).toContain("queues: 3 records (a, b, c)");
    expect(out).toContain("[warn] big-c: Queue c is big (limit 7)");
    expect(out).toContain("count: 3 queues");
    expect(out).toContain('console.log: done {"n":3}');
    expect(code).toBe(0);
  });

  it("the stored records are what the backend wrote through the fixture transport", async () => {
    const [r] = await testPlugin(good(), { source: "queues" });
    expect(r).toMatchObject({ ok: true, writes: { queues: { count: 3, keys: ["a", "b", "c"] } }, attention: [{ key: "big-c", severity: "warn" }], chips: { count: "3 queues" } });
  });

  it("a request with no fixture fails that source with 'No fixture for GET …' and exits 1", async () => {
    const dir = withFixtures("missing", { "queues/002.json": GH });
    const { code, out } = await cli(dir);
    expect(out).toContain("queues: FAILED:");
    expect(out).toContain("No fixture for GET https://api.example.com/queues?page=1");
    expect(out).toContain("clock: ok");
    expect(code).toBe(1);
  });

  it("the backend's context has no fetch, process, require or Buffer, and the report logs what it saw", async () => {
    const [r] = await testPlugin(good(), { source: "queues" });
    expect(r.log).toContain("info: globals: undefined undefined undefined undefined undefined");
  });

  it("never calls the live fetch", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network"));
    try {
      const reports = await testPlugin(good());
      expect(reports.map((r) => r.ok)).toEqual([true, true]);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it("--json prints one JSON document on stdout (the P12 note goes to stderr)", async () => {
    const { code, out, err } = await cli(good(), "--json");
    expect(err).toContain(P12_NOTE);
    const parsed = JSON.parse(out) as { reports: { source: string; ok: boolean }[] };
    expect(parsed.reports.map((r) => [r.source, r.ok])).toEqual([
      ["queues", true],
      ["clock", true],
    ]);
    expect(code).toBe(0);
  });

  it("--now fixes the backend's clock", async () => {
    const { out } = await cli(good(), "--source", "clock", "--now", "2026-01-02T03:04:05Z");
    expect(out).toContain("info: now 2026-01-02T03:04:05.000Z 2026-01-02T03:04:05.000Z");
  });

  it("refuses a bad --now, an unknown --source and a plugin that isn't built", async () => {
    expect((await cli(good(), "--now", "soon")).code).toBe(2);
    const unknown = await cli(good(), "--source", "nope");
    expect(unknown.code).not.toBe(0);
    expect(unknown.err).toContain('"nope" is not a source of mini');
    const empty = path.join(root, "empty");
    fs.mkdirSync(empty, { recursive: true });
    const none = await cli(empty);
    expect(none.code).not.toBe(0);
    expect(none.err).toContain("dist/plugin.json is missing");
  });

  it("skips a fixture that isn't a valid exchange, with a warning in the log", async () => {
    const dir = withFixtures("bad", { "queues/001.json": QUEUES, "queues/002.json": GH, "queues/003.json": "{not json" });
    const skipped: string[] = [];
    expect(await readFixtures(dir, "queues", skipped)).toHaveLength(2);
    expect(skipped[0]).toMatch(/^fixtures\/queues\/003\.json skipped/);
    const [r] = await testPlugin(dir, { source: "queues" });
    expect(r.ok).toBe(true);
    expect(r.log[0]).toMatch(/^warn: fixtures\/queues\/003\.json skipped/);
  });

  it("an undeclared host is refused by the broker, as in the app", async () => {
    const dir = withFixtures("host", { "queues/001.json": QUEUES, "queues/002.json": GH });
    const backend = path.join(dir, "dist", "backend.js");
    fs.writeFileSync(backend, fs.readFileSync(backend, "utf8").replace("https://api.example.com/queues", "https://evil.example.org/queues"));
    const [r] = await testPlugin(dir, { source: "queues" });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/evil\.example\.org/);
  });

  it("a log line or error holding the key in a form the fixtures echo is hidden in the printed report", async () => {
    const key = "fixture-tok";
    const forms = [Buffer.from(key).toString("hex"), [...key].map((c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`).join(""), Buffer.from(`x${key}`).toString("base64")];
    const dir = withFixtures("echo", { "queues/001.json": { ...QUEUES, response: { ...QUEUES.response, text: forms.join(" ") } } });
    const backend = path.join(dir, "dist", "backend.js");
    const code = fs.readFileSync(backend, "utf8");
    const patched = code.replace(/await ctx\.fetch\([^;]*;/, (call) => `${call} await ctx.log("info", res.text()); console.log(res.text()); throw new Error(res.text());`);
    expect(patched).not.toBe(code);
    fs.writeFileSync(backend, patched);
    const { code: exit, out } = await cli(dir, "--source", "queues");
    expect(exit).toBe(1);
    expect(out).toContain("(a line held a key; not shown)");
    for (const form of forms) expect(out).not.toContain(form);
  });
});

describe("runSource", () => {
  it("a key reaches the request as fixture-<id> in a fixture run", async () => {
    const dir = good();
    const sent: (string | null)[] = [];
    const fixtures = fixtureTransport([parseFixture({ ...QUEUES, request: { ...QUEUES.request, headers: { Authorization: "Bearer fixture-tok" } } }), parseFixture(GH)]);
    const r = await runSource({
      dir,
      source: "queues",
      transport: {
        fetch: (async (url: string, init?: RequestInit) => {
          sent.push(new Headers(init?.headers).get("authorization"));
          return fixtures.fetch(url, init);
        }) as typeof fetch,
        run: fixtures.run as never,
      },
      secrets: fixtureSecrets,
    });
    expect(r.ok).toBe(true);
    expect(sent).toEqual(["Bearer fixture-tok"]);
  });

  it("the run's temp data folder is gone after a failed run", async () => {
    const dir = good();
    const fixtures = fixtureTransport([parseFixture(QUEUES)]);
    let cwd = "";
    const r = await runSource({
      dir,
      source: "queues",
      transport: {
        fetch: fixtures.fetch as typeof fetch,
        run: (async (_file: string, _args: string[], o: { cwd: string }) => {
          cwd = o.cwd;
          fs.writeFileSync(path.join(cwd, "left.txt"), "x");
          throw new Error("gh failed");
        }) as never,
      },
      secrets: fixtureSecrets,
    });
    expect(r.ok).toBe(false);
    // exec's cwd is <temp>/exec, beside the data in <temp>/base.
    expect(path.basename(path.dirname(cwd))).toMatch(/^hh-plugin-run-/);
    expect(fs.existsSync(path.dirname(cwd))).toBe(false);
  });

  it("stops a run over its time limit", async () => {
    const dir = withFixtures("slow", {});
    const backend = path.join(dir, "dist", "backend.js");
    fs.writeFileSync(backend, `export default { sources: { queues: () => new Promise((r) => setTimeout(r, 5000)), clock: async () => {} } };\n`);
    const r = await runSource({ dir, source: "queues", transport: { fetch: globalThis.fetch, run: (() => Promise.reject(new Error("no"))) as never }, secrets: async () => ({}), runLimitMs: 50 });
    expect(r).toMatchObject({ ok: false, error: "The sync took longer than 0.05 s" });
  });
});

describe("the two ctx builders", () => {
  /** Every function of a ctx by its path, and the broker call (and argument count) it makes. */
  async function shapeOf(ctx: Record<string, unknown>, calls: [string, unknown[]][]) {
    const shape: Record<string, string> = {};
    const walk = async (o: Record<string, unknown>, prefix: string) => {
      for (const k of Object.keys(o).sort()) {
        const v = o[k];
        if (typeof v === "function") {
          const before = calls.length;
          const result = await (v as (...a: unknown[]) => Promise<unknown>)("a1", "a2", "a3");
          const [name, args] = calls[before] ?? ["(none)", []];
          shape[`${prefix}${k}`] = `${name}/${args.length}`;
          // What a backend reads off a response: its keys, their types and what text() and json() give.
          if (name === "fetch") {
            const r = result as Record<string, unknown> & { text(): unknown; json(): unknown };
            shape[`${prefix}${k}()`] = JSON.stringify([Object.keys(r).sort().map((key) => `${key}:${typeof r[key]}`), r.headers, r.text(), r.json()]);
          }
        } else if (v && typeof v === "object") await walk(v as Record<string, unknown>, `${prefix}${k}.`);
      }
    };
    await walk(ctx, "");
    return shape;
  }

  const RESPONSE = { url: "https://api.example.com/x", status: 200, ok: true, headers: { "content-type": "application/json" }, text: '{"n":1}' };
  const answer = (name: string) => ({ ok: true as const, value: name === "fetch" ? RESPONSE : null });

  it("plugin-run's ctx and the host script's contextOf have the same methods making the same calls", async () => {
    const ours: [string, unknown[]][] = [];
    const runShape = await shapeOf(
      pluginContext(async (name, args) => {
        ours.push([name, args]);
        return answer(name);
      }) as unknown as Record<string, unknown>,
      ours,
    );

    const theirs: [string, unknown[]][] = [];
    // biome-ignore lint/suspicious/noExplicitAny: the host script is plain JS
    const { runHost } = (await import(pathToFileURL(path.join(shellDir(), "resources", "plugin-host.mjs")).href)) as { runHost: any };
    let hostCtx: Record<string, unknown> | undefined;
    const commands = [{ kind: "run", runId: "r", source: "s" }];
    let release: () => void = () => {};
    const ran = new Promise<void>((r) => (release = r));
    void runHost(
      async (method: string, args: { name: string; args: unknown[] }) => {
        if (method === "next") {
          const c = commands.shift();
          if (c) return c;
          throw new Error("closed");
        }
        if (method === "ctx") {
          theirs.push([args.name, args.args]);
          return answer(args.name);
        }
        return null;
      },
      async () => ({
        default: {
          sources: {
            s: async (ctx: Record<string, unknown>) => {
              hostCtx = ctx;
              release();
            },
          },
        },
      }),
    );
    await ran;
    const hostShape = await shapeOf(hostCtx!, theirs);
    expect(Object.keys(runShape).length).toBe(15);
    expect(runShape["fetch()"]).toBe(JSON.stringify([["headers:object", "json:function", "ok:boolean", "status:number", "text:function", "url:string"], RESPONSE.headers, RESPONSE.text, { n: 1 }]));
    expect(runShape).toEqual(hostShape);
  });
});
