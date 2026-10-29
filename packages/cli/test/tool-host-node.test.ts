import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { runFile } from "@humanharness/shell/plugins";
import { type CliToolsOptions, TOOL_P12_NOTE, cliTools, nodeToolHost, toolContext } from "../src/tool-host-node";
import { buildTools } from "../src/tool-build";

// The terminal's tool host (tools spec §11; slice 5 threat row A1): the built tools of test/fixtures/tools-mini run
// through the app's own registry and broker, in a vm context with plugin-run.ts's globals and nothing more. Every
// fetch goes to a fake transport: api.example.test is never asked.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const MINI = path.resolve(HERE, "fixtures/tools-mini");
const DIST = path.join(MINI, "dist");
const KEY = "k-123";

/** A transport that answers every fetch with the request's authorization header echoed, and records each request. */
function echoTransport() {
  const seen: { url: string; authorization: string | null }[] = [];
  const transport = {
    fetch: (async (input: string | URL | Request, init?: RequestInit) => {
      const authorization = new Headers(init?.headers).get("authorization");
      seen.push({ url: String(input), authorization });
      return new Response(`you sent ${authorization ?? "nothing"}`, { status: 200 });
    }) as typeof fetch,
    run: (async () => {
      throw new Error("No command in these tests");
    }) as unknown as typeof runFile,
  };
  return { seen, transport };
}

let folder: string;
let open: { close(): void }[] = [];

beforeAll(() => {
  folder = fs.mkdtempSync(path.join(os.tmpdir(), "hh-tool-host-node-"));
  return () => fs.rmSync(folder, { recursive: true, force: true });
});

afterEach(() => {
  for (const t of open) t.close();
  open = [];
});

function tools(o: Partial<CliToolsOptions> = {}) {
  const { transport } = echoTransport();
  const t = cliTools({
    root: MINI,
    transport: () => transport,
    secrets: async (ids) => Object.fromEntries(ids.map((id) => [id, KEY])),
    allowHost: async () => true,
    data: async () => {
      throw new Error("No data in these tests");
    },
    folder: { base: folder, references: [] },
    ...o,
  });
  open.push(t);
  return t;
}

/** Every file under `dir`, relative with "/", sorted. */
function files(dir: string, rel = ""): string[] {
  return fs
    .readdirSync(path.join(dir, rel), { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? files(dir, path.posix.join(rel, e.name)) : [path.posix.join(rel, e.name)]))
    .sort();
}

describe("the terminal's tool host (tools spec §11, A1)", () => {
  it("runs a built tool and answers through the real registry", async () => {
    const t = tools();
    expect(await t.registry.call({ tool: "echo", args: { a: 1 }, caller: "ui", scope: null })).toEqual({ ok: true, result: { a: 1 } });
    expect(t.entries).toHaveLength(1);
    expect(t.entries[0]).toMatchObject({ tool: "echo", caller: "ui", ok: true, args: { a: 1 }, result: { a: 1 } });
  });

  it("params are checked before the tool runs", async () => {
    const t = tools();
    const answer = await t.registry.call({ tool: "echo", args: { a: "x" }, caller: "ui", scope: null });
    expect(answer.ok).toBe(false);
    expect(answer.ok === false && answer.error).toMatch(/^a: /);
  });

  it("an unknown tool is refused as in the app", async () => {
    const t = tools();
    expect(await t.registry.call({ tool: "nope", args: {}, caller: "ui", scope: null })).toEqual({ ok: false, error: 'Unknown tool "nope"' });
  });

  it("the tool's ctx.fetch goes through the broker: a declared host with the key substituted, through the given transport", async () => {
    const { seen, transport } = echoTransport();
    const asked: string[][] = [];
    const t = tools({
      transport: (tool) => {
        expect(tool).toBe("fetcher");
        return transport;
      },
      secrets: async (ids) => {
        asked.push(ids);
        return Object.fromEntries(ids.map((id) => [id, KEY]));
      },
    });
    const answer = await t.registry.call({ tool: "fetcher", args: {}, caller: "ui", scope: null });
    expect(seen).toEqual([{ url: "https://api.example.test/x", authorization: `Bearer ${KEY}` }]);
    expect(asked.flat().every((id) => id === "api")).toBe(true);
    // The reply echoes the key: the answer and the trace hide it.
    expect(answer.ok).toBe(true);
    expect(JSON.stringify(answer)).not.toContain(KEY);
    expect(JSON.stringify(t.entries)).not.toContain(KEY);
    expect(t.entries[0]!.accesses).toEqual([{ kind: "fetch", target: "https://api.example.test/x", allowed: true }]);
  });

  it("an undeclared host is refused as in the app", async () => {
    const { seen, transport } = echoTransport();
    const t = tools({ transport: () => transport });
    const answer = await t.registry.call({ tool: "fetcher", args: { url: "https://evil.example.test/y" }, caller: "ui", scope: null });
    expect(answer).toEqual({ ok: false, error: "evil.example.test is not declared in uses.hosts" });
    expect(seen).toEqual([]);
    expect(t.entries[0]!.accesses).toEqual([{ kind: "fetch", target: "https://evil.example.test/y", allowed: false }]);
  });

  it("a host the caller's check refuses is never fetched", async () => {
    const { seen, transport } = echoTransport();
    const t = tools({ transport: () => transport, allowHost: async () => false });
    const answer = await t.registry.call({ tool: "fetcher", args: {}, caller: "ui", scope: null });
    expect(answer.ok).toBe(false);
    expect(seen).toEqual([]);
  });

  it("the tool sees no process, require, fetch or Buffer global", async () => {
    const t = tools();
    expect(await t.registry.call({ tool: "escape", args: {}, caller: "ui", scope: null })).toEqual({
      ok: true,
      result: { process: "undefined", require: "undefined", fetch: "undefined", Buffer: "undefined" },
    });
  });

  it("ctx.summary and ctx.requestAi exist (slice 4) and requestAi is refused outside a post call", async () => {
    const t = tools();
    expect(await t.registry.call({ tool: "ai", args: {}, caller: "ui", scope: null })).toEqual({
      ok: true,
      result: { summary: "function", requestAi: "function", refused: "ToolRefused: ctx.requestAi is only for the step right after a job's AI step" },
    });
  });

  it("a job's post-step call gets the tool's summary line and AI request", async () => {
    const t = tools();
    expect(await t.registry.call({ tool: "ai", args: {}, caller: "job", scope: null, job: "j", run: "r", post: true })).toEqual({
      ok: true,
      result: { summary: "function", requestAi: "function", refused: "" },
      summary: "one line",
      requestAi: { input: { more: true } },
    });
  });

  it("a tool that runs past its timeout fails", async () => {
    const t = tools();
    expect(await t.registry.call({ tool: "wait", args: {}, caller: "ui", scope: null })).toEqual({ ok: false, error: "wait took longer than 1 s" });
  }, 10_000);

  it("the committed dist is fresh", async () => {
    const built = await buildTools(MINI, { write: false });
    expect(files(DIST)).toEqual([...built.files.keys()].sort());
    for (const [name, content] of built.files) expect(fs.readFileSync(path.join(DIST, name)).equals(Buffer.from(content)), name).toBe(true);
    expect(Object.keys(built.json.tools).sort()).toEqual(["ai", "echo", "escape", "fetcher", "wait"]);
  }, 120_000);

  it("TOOL_P12_NOTE is the note printed before tool code runs", () => {
    expect(TOOL_P12_NOTE).toBe("Note: tool code runs in this Node process, not in the app's sandbox. Run only tools you trust.");
  });
});

/**
 * A root whose dist/tools/<id>.js is each given ES module, as `build` writes a bundle (no SDK needed: the host only
 * wants a default export with `run`). The host alone, without the registry, so its own guards are what answers.
 */
function bundles(modules: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(folder, "bundles-"));
  fs.mkdirSync(path.join(dir, "dist", "tools"), { recursive: true });
  for (const [id, code] of Object.entries(modules)) fs.writeFileSync(path.join(dir, "dist", "tools", `${id}.js`), code);
  return dir;
}

function host(root: string) {
  const h = nodeToolHost(root, { ctx: async () => ({ ok: true, value: null }) });
  open.push(h);
  return h;
}

const call = (tool: string) => ({ callId: "c1", tool, args: {}, scope: null });

describe("the terminal host's own time limits (M2, M4)", () => {
  it("a tool stuck in a synchronous loop is stopped by the vm limit", async () => {
    const h = host(bundles({ spin: "export default { run() { for (;;) {} } };\n" }));
    // Without the vm limit the loop holds the event loop and no timer can answer: this test would time out.
    expect(await h.call(call("spin"), 200)).toEqual({ ok: false, error: "spin took longer than 0.2 s" });
  }, 10_000);

  it("a tool that never settles is answered by the host's own timer", async () => {
    const h = host(bundles({ hang: "export default { run: () => new Promise(() => {}) };\n" }));
    expect(await h.call(call("hang"), 200)).toEqual({ ok: false, error: "hang took longer than 0.2 s" });
  }, 10_000);

  it("a bundle stuck while it loads is stopped, and stays failed", async () => {
    const h = host(bundles({ stuck: "for (;;) {}\nexport default { run: () => 1 };\n" }));
    expect(await h.call(call("stuck"), 200)).toEqual({ ok: false, error: "stuck took longer than 0.2 s to load" });
    expect(await h.call(call("stuck"), 200)).toEqual({ ok: false, error: "stuck took longer than 0.2 s to load" });
  }, 10_000);

  it("a summary stuck in a loop gives no summary, and the call still answers", async () => {
    const h = host(bundles({ sum: "export default { run: async () => 7, summary() { for (;;) {} } };\n" }));
    expect(await h.call(call("sum"), 200)).toEqual({ ok: true, value: 7 });
  }, 10_000);

  it("a summary is still given when it ends in time", async () => {
    const h = host(bundles({ sum: "export default { run: async () => 7, summary: (v) => `seven: ${v}` };\n" }));
    expect(await h.call(call("sum"), 1000)).toEqual({ ok: true, value: 7, summary: "seven: 7" });
  });

  it("close() answers a call still running and clears its timer", async () => {
    const h = host(bundles({ hang: "export default { run: () => new Promise(() => {}) };\n" }));
    const cleared: unknown[] = [];
    const real = globalThis.clearTimeout;
    const pending = h.call(call("hang"), 60_000);
    // Let the bundle load and the call start.
    await new Promise((r) => setTimeout(r, 300));
    globalThis.clearTimeout = ((t: NodeJS.Timeout) => {
      cleared.push(t);
      real(t);
    }) as typeof clearTimeout;
    try {
      h.close();
    } finally {
      globalThis.clearTimeout = real;
    }
    expect(await pending).toEqual({ ok: false, error: "Tools stopped" });
    expect(cleared.length).toBeGreaterThan(0);
  }, 10_000);
});

describe("the two tool ctx builders (M3)", () => {
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
          if (name === "fetch") {
            const r = result as Record<string, unknown> & { text(): unknown; json(): unknown };
            shape[`${prefix}${k}()`] = JSON.stringify([Object.keys(r).sort().map((key) => `${key}:${typeof r[key]}`), r.headers, r.text(), r.json()]);
          }
        } else if (v && typeof v === "object") await walk(v as Record<string, unknown>, `${prefix}${k}.`);
        else shape[`${prefix}${k}`] = JSON.stringify(v);
      }
    };
    await walk(ctx, "");
    return shape;
  }

  const RESPONSE = { url: "https://api.example.com/x", status: 200, ok: true, headers: { "content-type": "application/json" }, text: '{"n":1}' };
  const answer = (name: string) => ({ ok: true as const, value: name === "fetch" ? RESPONSE : null });
  const INPUTS = { one: { a: [1, 2] } };

  it("toolContext and resources/tool-host.mjs's contextOf have the same methods making the same calls", async () => {
    const ours: [string, unknown[]][] = [];
    const ourCtx = toolContext(
      async (name, args) => {
        ours.push([name, args]);
        return answer(name);
      },
      "s1",
      INPUTS,
    ) as unknown as Record<string, unknown>;
    const ourShape = await shapeOf(ourCtx, ours);

    const theirs: [string, unknown[]][] = [];
    // biome-ignore lint/suspicious/noExplicitAny: the host script is plain JS
    const { runHost } = (await import(pathToFileURL(path.resolve(HERE, "../../shell/resources/tool-host.mjs")).href)) as { runHost: any };
    let hostCtx: Record<string, unknown> | undefined;
    const commands = [{ kind: "call", callId: "c1", tool: "t", args: {}, scope: "s1", inputs: INPUTS }];
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
      ["t"],
      async () => ({
        default: {
          run: async (_args: unknown, ctx: Record<string, unknown>) => {
            hostCtx = ctx;
            release();
          },
        },
      }),
    );
    await ran;
    const hostShape = await shapeOf(hostCtx!, theirs);
    expect(ourShape["fetch()"]).toBe(JSON.stringify([["headers:object", "json:function", "ok:boolean", "status:number", "text:function", "url:string"], RESPONSE.headers, RESPONSE.text, { n: 1 }]));
    expect(ourShape.scope).toBe('"s1"');
    expect(Object.keys(ourShape).sort()).toEqual(["data.delete", "data.get", "data.patch", "data.put", "data.query", "exec", "fetch", "fetch()", "files.list", "files.read", "inputs.one.a.0", "inputs.one.a.1", "log", "requestAi", "scope", "summary"]);
    expect(ourShape).toEqual(hostShape);
    // Both hand the tool frozen inputs, all the way down.
    expect(ourCtx.inputs).toEqual(INPUTS);
    expect(Object.isFrozen((ourCtx.inputs as typeof INPUTS).one.a)).toBe(true);
    expect(Object.isFrozen((hostCtx!.inputs as typeof INPUTS).one.a)).toBe(true);
  });
});
