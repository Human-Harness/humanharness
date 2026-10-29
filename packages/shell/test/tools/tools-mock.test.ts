import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ToolMeta } from "@humanharness/harness-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolChannel, ToolHostAnswer, ToolHostCall } from "../../src/main/tools/tool-host";
import { recordedToolTransport as fromEntry } from "../../src/main/tools/tool-cli";
import { recordedToolTransport } from "../../src/main/tools/recorded-transport";
import { type ToolsHarness, type ToolsHostDeps, createToolsHost } from "../../src/main/tools/tools-host";

const TASK = randomUUID();

let root: string;
let base: string;
let userData: string;
let mockDir: string;

beforeEach(async () => {
  const tmp = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "hh-tools-mock-")));
  root = path.join(tmp, "harness");
  base = path.join(tmp, "base");
  userData = path.join(tmp, "user-data");
  mockDir = path.join(root, "mock", "tools");
  await fs.mkdir(path.join(root, "dist"), { recursive: true });
  await fs.mkdir(base);
});
const pumps: ReturnType<typeof setInterval>[] = [];
afterEach(async () => {
  for (const p of pumps.splice(0)) clearInterval(p);
  await fs.rm(path.dirname(root), { recursive: true, force: true });
});

function meta(id: string): ToolMeta {
  return {
    description: `Tool ${id} that reaches the network and gh`,
    agent: "call",
    uses: { hosts: ["api.x.com"], secrets: ["jira"], exec: [{ cmd: "gh", args: ["pr", "checks", "*"] }] },
    params: { type: "object", properties: {} },
    timeout: 30,
    file: `tools/${id}.js`,
  };
}
const TOOLS: Record<string, ToolMeta> = { net: meta("net"), other: meta("other") };

function harness(): ToolsHarness {
  return {
    id: "notes",
    root,
    permissions: { edit: "folder", exec: true, web: true },
    data: {} as never,
    secrets: [{ id: "jira", label: "Jira token" }] as never,
    tools: Object.fromEntries(Object.keys(TOOLS).map((t) => [t, `./tools/${t}.ts`])),
  };
}

/** One recorded exchange, `mock/tools/<tool>/<name>`, in the plugin fixture format (tools Decision 8). */
async function recorded(tool: string, name: string, exchange: unknown): Promise<void> {
  await fs.mkdir(path.join(mockDir, tool), { recursive: true });
  await fs.writeFile(path.join(mockDir, tool, name), JSON.stringify(exchange));
}
const GET_A = { kind: "fetch", request: { method: "GET", url: "https://api.x.com/a" }, response: { status: 200, headers: { "content-type": "text/plain" }, text: "recorded a" } };
const CHECKS = { kind: "exec", request: { cmd: "gh", args: ["pr", "checks", "12"] }, response: { code: 0, stdout: "2 failing", stderr: "" } };

type Try = (c: ToolHostCall, channel: ToolChannel) => Promise<ToolHostAnswer>;
/** The tool fetches `url` with the jira key in a header and answers the broker's reply (value or refusal). */
const fetches =
  (url: string): Try =>
  async (c, channel) => {
    const r = await channel.ctx(c.tool, c.callId, "fetch", [url, { headers: { authorization: "Bearer {{secret:jira}}" } }]);
    return r.ok ? { ok: true, value: r.value } : { ok: false, error: r.refused };
  };
/** The tool runs `gh <args>` and answers the broker's reply. */
const runs =
  (args: string[]): Try =>
  async (c, channel) => {
    const r = await channel.ctx(c.tool, c.callId, "exec", ["gh", args]);
    return r.ok ? { ok: true, value: r.value } : { ok: false, error: r.refused };
  };

function wire(answer: Try, over: Partial<ToolsHostDeps> = {}) {
  let channel: ToolChannel | null = null;
  const page: (() => void)[] = [];
  const pump = setInterval(() => page.splice(0).forEach((run) => run()), 1);
  pumps.push(pump);
  const live = {
    fetch: vi.fn(async () => new Response("live", { status: 200 })),
    run: vi.fn(async () => ({ code: 0, stdout: "live", stderr: "" })),
    harnessValues: vi.fn(async (ids: string[]) => Object.fromEntries(ids.map((id) => [id, "real-key-123"]))),
    resolve: vi.fn(async (cmd: string) => `/usr/bin/${cmd}`),
    allowHost: vi.fn(async () => true),
  };
  const deps: ToolsHostDeps = {
    harness: harness(),
    base: async () => base,
    references: async () => [],
    userData,
    store: { harnessValues: live.harnessValues },
    data: async () => ({ ok: true }),
    exec: { resolve: live.resolve, run: live.run as never, env: async () => ({ PATH: "/usr/bin" }) },
    fetch: live.fetch as never,
    allowHost: live.allowHost,
    host: {
      start: (p) => void (channel = p.channel),
      stop: () => undefined,
      call: (c) => new Promise<ToolHostAnswer>((resolve) => page.push(() => void answer(c, channel!).then(resolve))),
      off: () => null,
    },
    openScope: async () => null,
    slotTask: async (key) => (key === "main" ? { id: TASK, scope: "main" } : null),
    jobRun: () => null,
    emitToTask: () => undefined,
    log: () => undefined,
    ...over,
  };
  return { t: createToolsHost(deps), live };
}

async function built(): Promise<void> {
  await fs.writeFile(path.join(root, "dist", "tools.json"), JSON.stringify({ version: 1, tools: TOOLS }));
}

async function traceLines(): Promise<Record<string, unknown>[]> {
  const text = await fs.readFile(path.join(base, ".harness", "trace", `${TASK}.jsonl`), "utf8");
  return text
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

const MOCK = () => ({ mock: { dir: mockDir } });

describe("tools in mock mode (tools spec §12, A2, A7)", () => {
  it("D0: without mock the transport is the real one, whatever mock/tools/ holds", async () => {
    await built();
    await recorded("net", "001.json", GET_A);
    const { t, live } = wire(fetches("https://api.x.com/a"));
    const ws = (await t.workspaceOptions())!;
    expect(await ws.request({ tool: "net" }, { key: "main" })).toMatchObject({ status: 200, text: "live" });
    expect(live.fetch).toHaveBeenCalledTimes(1);
    // The key came from the store, and the host was checked.
    expect(live.harnessValues).toHaveBeenCalled();
    expect(live.allowHost).toHaveBeenCalledWith("api.x.com");
  });

  it("ctx.fetch answers from mock/tools/<tool>/ and the tool runs for real", async () => {
    await built();
    await recorded("net", "001.json", GET_A);
    const { t, live } = wire(fetches("https://api.x.com/a"), MOCK());
    const ws = (await t.workspaceOptions())!;
    expect(await ws.request({ tool: "net" }, { key: "main" })).toMatchObject({ status: 200, ok: true, text: "recorded a", headers: { "content-type": "text/plain" } });
    expect(live.fetch).not.toHaveBeenCalled();
    // No DNS look-up of a recorded host: nothing reaches the network.
    expect(live.allowHost).not.toHaveBeenCalled();
    const [entry] = await traceLines();
    expect(entry).toMatchObject({ tool: "net", ok: true, accesses: [{ kind: "fetch", target: "https://api.x.com/a", allowed: true }] });
  });

  it("an access with no recording fails 'Not recorded: GET https://…'", async () => {
    await built();
    await recorded("net", "001.json", GET_A);
    const { t, live } = wire(fetches("https://api.x.com/b"), MOCK());
    const ws = (await t.workspaceOptions())!;
    await expect(ws.request({ tool: "net" }, { key: "main" })).rejects.toThrow("Not recorded: GET https://api.x.com/b");
    expect(live.fetch).not.toHaveBeenCalled();
    const [entry] = await traceLines();
    expect(entry).toMatchObject({ tool: "net", ok: false });
    expect(String(entry!.error)).toContain("Not recorded: GET https://api.x.com/b");
  });

  it("an exec plays its recording, and one with no recording fails 'Not recorded: gh pr checks 12'", async () => {
    await built();
    const first = wire(runs(["pr", "checks", "12"]), MOCK());
    await expect((await first.t.workspaceOptions())!.request({ tool: "net" }, { key: "main" })).rejects.toThrow("Not recorded: gh pr checks 12");
    await recorded("net", "001.json", CHECKS);
    const second = wire(runs(["pr", "checks", "12"]), MOCK());
    expect(await (await second.t.workspaceOptions())!.request({ tool: "net" }, { key: "main" })).toEqual({ code: 0, stdout: "2 failing", stderr: "" });
    // Nothing was looked up on the PATH or run.
    for (const w of [first, second]) {
      expect(w.live.run).not.toHaveBeenCalled();
      expect(w.live.resolve).not.toHaveBeenCalled();
    }
  });

  it("keys are fixture-<id>; the key store is never read", async () => {
    await built();
    await recorded("net", "001.json", GET_A);
    const { t, live } = wire(fetches("https://api.x.com/a"), MOCK());
    const ws = (await t.workspaceOptions())!;
    // A missing key would refuse the fetch ("Jira token" is not set): the fetch that names it goes through.
    expect(await ws.request({ tool: "net" }, { key: "main" })).toMatchObject({ text: "recorded a" });
    expect(live.harnessValues).not.toHaveBeenCalled();
  });

  it("the key handed out is fixture-<id>: the registry hides it as the tool's key", async () => {
    await built();
    await recorded("net", "001.json", GET_A);
    const { t } = wire(async (c, channel) => {
      const r = await channel.ctx(c.tool, c.callId, "fetch", ["https://api.x.com/a", { headers: { authorization: "Bearer {{secret:jira}}" } }]);
      return { ok: true, value: `${r.ok ? "fetched" : r.refused} with fixture-jira` };
    }, MOCK());
    const result = await (await t.workspaceOptions())!.request({ tool: "net" }, { key: "main" });
    expect(result).toMatch(/^fetched with /);
    expect(result).not.toContain("fixture-jira");
  });

  it("each tool reads only its own folder: tool other can't answer from net's recordings", async () => {
    await built();
    await recorded("net", "001.json", GET_A);
    const { t } = wire(fetches("https://api.x.com/a"), MOCK());
    const ws = (await t.workspaceOptions())!;
    await expect(ws.request({ tool: "other" }, { key: "main" })).rejects.toThrow("Not recorded: GET https://api.x.com/a");
    expect(await ws.request({ tool: "net" }, { key: "main" })).toMatchObject({ text: "recorded a" });
  });

  it("a recording file that isn't an exchange is skipped and logged, naming mock/tools/<tool>/<file>", async () => {
    await built();
    await recorded("net", "001.json", { kind: "fetch" });
    await recorded("net", "002.json", GET_A);
    const logs: string[] = [];
    const { t } = wire(fetches("https://api.x.com/a"), { ...MOCK(), log: (m) => void logs.push(m) });
    expect(await (await t.workspaceOptions())!.request({ tool: "net" }, { key: "main" })).toMatchObject({ text: "recorded a" });
    expect(logs).toContain("mock/tools/net/001.json skipped");
  });

  it("recordedToolTransport is the CLI's too (@humanharness/shell/tools)", () => {
    expect(fromEntry).toBe(recordedToolTransport);
  });
});
