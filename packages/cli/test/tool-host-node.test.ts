import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { runFile } from "@humanharness/shell/plugins";
import { type CliToolsOptions, TOOL_P12_NOTE, cliTools } from "../src/tool-host-node";
import { buildTools } from "../src/tool-build";

// The terminal's tool host (tools spec §11; slice 5 threat row A1): the built tools of test/fixtures/tools-mini run
// through the app's own registry and broker, in a vm context with plugin-run.ts's globals and nothing more. Every
// fetch goes to a fake transport: api.example.test is never asked.
const MINI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "fixtures/tools-mini");
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
