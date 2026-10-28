import { describe, expect, it } from "vitest";
import { parsePluginManifest } from "@humanharness/harness-sdk";
import { BROKER_CALLS, PluginBroker } from "../src/main/plugin-broker";

const manifest = parsePluginManifest({
  id: "oncall", name: "On-call", version: "1.0.0", api: 1, harness: "*",
  permissions: { hosts: ["*.atlassian.net"], secrets: [{ id: "jira", label: "Jira" }], exec: [{ cmd: "gh", args: ["api", "--method", "GET", "*"] }], tasks: true },
  sources: [{ id: "queues", ttl: 300 }],
  data: { queues: { scoped: false, key: "key", agent: "read", schema: { type: "object", properties: { key: { type: "string" } }, required: ["key"] } } },
  panels: [{ id: "queue", slot: "sidebar", title: "Queue" }],
  chips: [{ id: "who", slot: "status-bar" }],
  actions: [{ id: "triage", label: "Triage", tier: "light", prompt: "Triage {{key}}" }],
});
const SECRET = "tok-SECRET-1234";
/** A broker with doubles for every dependency; `seen` records what reached each one. */
function broker(over: Partial<ConstructorParameters<typeof PluginBroker>[0]> = {}) {
  const seen = { data: [] as unknown[], raised: [] as unknown[], resolved: [] as unknown[], chips: [] as unknown[], logs: [] as unknown[], fetches: [] as { url: string; init: RequestInit }[], secretIds: [] as string[][], exec: [] as unknown[] };
  const b = new PluginBroker({
    manifest,
    data: { run: async (op: unknown) => (seen.data.push(op), null) },
    secrets: async (ids: string[]) => (seen.secretIds.push(ids), { jira: SECRET, other: "tok-OTHER-9999" }),
    settings: async () => ({ team: "docs" }),
    attention: { raise: async (i: unknown) => void seen.raised.push(i), resolve: async (k: string) => void seen.resolved.push(k) },
    chips: (id: string, chip: unknown) => void seen.chips.push([id, chip]),
    log: async (level: string, message: string) => void seen.logs.push([level, message]),
    fetch: (async (url: string, init: RequestInit) => (seen.fetches.push({ url, init }), new Response(`ok ${new Headers(init.headers).get("a") ?? ""}`))) as unknown as typeof fetch,
    exec: { resolve: async () => "/bin/gh", run: async (file: string, args: string[], o: object) => (seen.exec.push({ file, args, ...o }), { code: 0, stdout: "out", stderr: "" }), cwd: async () => "/c", env: async () => ({ PATH: "/bin" }) },
    ...over,
  } as never);
  return { b, seen };
}

describe("PluginBroker (plugins spec §4.2)", () => {
  it("B9: the call surface is exactly the spec's", () => {
    expect([...BROKER_CALLS].sort()).toEqual(["attention.raise", "attention.resolve", "chip.clear", "chip.set", "data.delete", "data.get", "data.patch", "data.put", "data.query", "data.replaceAll", "exec", "fetch", "log", "settings.get"]);
  });

  it("calls need a live run; a dead run's calls are refused", async () => {
    const { b } = broker();
    expect(await b.call("nope", "settings.get", [])).toEqual({ ok: false, refused: "This sync run has ended" });
    expect(await b.call({ toString: () => "x" }, "settings.get", [])).toEqual({ ok: false, refused: "This sync run has ended" });
    const run = b.startRun("queues");
    expect(await b.call(run.id, "settings.get", [])).toEqual({ ok: true, value: { team: "docs" } });
    expect(b.endRun(run.id)).toEqual({ writes: 0 });
    expect(run.signal.aborted).toBe(true);
    expect(await b.call(run.id, "settings.get", [])).toMatchObject({ ok: false });
  });

  it("only declared sources start a run", () => {
    const { b } = broker();
    expect(() => b.startRun("nope")).toThrow();
    expect(() => b.startRun("__proto__")).toThrow();
  });

  it("an unknown call or malformed args are refused and logged", async () => {
    const { b, seen } = broker();
    const run = b.startRun("queues");
    expect(await b.call(run.id, "tasks.start", [])).toMatchObject({ ok: false, refused: expect.stringMatching(/unknown/i) });
    expect(await b.call(run.id, "fetch", [42])).toMatchObject({ ok: false });
    expect(seen.logs.length).toBe(2);
    for (const [name, args] of [
      ["constructor", []], ["__proto__", []], ["toString", []], [7, []],
      ["settings.get", "x"], ["settings.get", { length: 0 }], ["settings.get", [1]],
      ["data.put", ["queues"]], ["data.put", ["queues", "x"]], ["data.put", ["queues", [1]]], ["data.put", ["queues", { key: 1n }]],
      ["data.put", ["queues", JSON.parse('{"key":"x","__proto__":{"admin":true}}')]],
      ["data.replaceAll", ["queues", { 0: { key: "x" }, length: 1 }]],
      ["data.query", ["queues", { where: [] }]], ["data.query", ["queues", { fields: "key" }]], ["data.query", ["queues", { limit: "9" }]], ["data.query", ["queues", { evil: 1 }]],
      ["data.get", ["queues", { key: "x" }]],
      ["exec", ["gh", "api"]], ["exec", [["gh"], []]],
      ["log", ["debug", "x"]], ["log", ["info", { a: 1 }]],
      ["chip.set", ["who", "text"]],
    ] as [unknown, unknown][]) {
      expect(await b.call(run.id, name, args), String(name)).toMatchObject({ ok: false });
    }
    expect(seen.data).toEqual([]);
    // Refusals are logged with the call name and the reason, never the args.
    expect(JSON.stringify(seen.logs)).not.toContain("admin");
  });

  it("a deeply nested record is refused without overflowing", async () => {
    const { b, seen } = broker();
    const run = b.startRun("queues");
    let deep: Record<string, unknown> = { key: "x" };
    for (let i = 0; i < 10_000; i++) deep = { key: "x", d: deep };
    expect(await b.call(run.id, "data.put", ["queues", deep])).toMatchObject({ ok: false });
    expect(seen.data).toEqual([]);
  });

  it("fetch goes through the host and secret rules", async () => {
    const { b, seen } = broker();
    const run = b.startRun("queues");
    expect(await b.call(run.id, "fetch", ["https://evil.com/"])).toMatchObject({ ok: false });
    expect(seen.fetches).toEqual([]);
    expect(await b.call(run.id, "fetch", ["https://acme.atlassian.net/", { headers: { a: "{{secret:jira}}" } }])).toMatchObject({ ok: true, value: { status: 200, text: "ok [redacted]" } });
    expect(new Headers(seen.fetches[0].init.headers).get("a")).toBe(SECRET);
    expect(seen.secretIds).toEqual([["jira"]]);
  });

  it("B6: only declared keys are asked for, and the store's extra values are never used", async () => {
    const { b, seen } = broker();
    const run = b.startRun("queues");
    expect(await b.call(run.id, "fetch", ["https://acme.atlassian.net/", { headers: { a: "{{secret:other}}" } }])).toMatchObject({ ok: false, refused: expect.stringMatching(/not declared/) });
    expect(await b.call(run.id, "fetch", ["https://acme.atlassian.net/", { method: "POST", body: "{{secret:other}}" }])).toMatchObject({ ok: false });
    expect(seen.secretIds).toEqual([]);
    expect(seen.fetches).toEqual([]);
    // A plain request asks for no key at all.
    expect(await b.call(run.id, "fetch", ["https://acme.atlassian.net/"])).toMatchObject({ ok: true });
    expect(seen.secretIds).toEqual([]);
  });

  it("ending the run aborts its fetches", async () => {
    let started!: () => void;
    const begun = new Promise<void>((r) => (started = r));
    const slow = ((_u: string, init: RequestInit) => {
      started();
      return new Promise((_, reject) => init.signal!.addEventListener("abort", () => reject(new Error("aborted"))));
    }) as unknown as typeof fetch;
    const { b } = broker({ fetch: slow } as never);
    const run = b.startRun("queues");
    const p = b.call(run.id, "fetch", ["https://acme.atlassian.net/"]);
    await begun;
    b.endRun(run.id);
    expect(await p).toMatchObject({ ok: false });
  });

  it("at most 4 fetches at once; the rest wait", async () => {
    let active = 0;
    let peak = 0;
    const releases: (() => void)[] = [];
    const gated = (() => {
      active += 1;
      peak = Math.max(peak, active);
      return new Promise<Response>((r) => releases.push(() => ((active -= 1), r(new Response("ok")))));
    }) as unknown as typeof fetch;
    const { b } = broker({ fetch: gated } as never);
    const run = b.startRun("queues");
    const calls = Array.from({ length: 6 }, () => b.call(run.id, "fetch", ["https://acme.atlassian.net/"]));
    const tick = () => new Promise((r) => setTimeout(r, 1));
    await tick();
    expect(releases.length).toBe(4);
    for (let released = 0; released < 6; released++) {
      for (let i = 0; i < 50 && releases.length === 0; i++) await tick();
      releases.shift()!();
    }
    const out = await Promise.all(calls);
    expect(out.every((a) => a.ok)).toBe(true);
    expect(peak).toBe(4);
  });

  it("B7: exec goes through the patterns, with the controller's env and cwd", async () => {
    const { b, seen } = broker();
    const run = b.startRun("queues");
    expect(await b.call(run.id, "exec", ["sh", ["-c", "id"]])).toMatchObject({ ok: false });
    expect(seen.exec).toEqual([]);
    expect(await b.call(run.id, "exec", ["gh", ["api", "--method", "GET", "/x"]])).toEqual({ ok: true, value: { code: 0, stdout: "out", stderr: "" } });
    expect(seen.exec[0]).toMatchObject({ file: "/bin/gh", args: ["api", "--method", "GET", "/x"], cwd: "/c", env: { PATH: "/bin" } });
  });

  it("B4: data only on its own collections, counted per run", async () => {
    const { b, seen } = broker();
    const run = b.startRun("queues");
    expect(await b.call(run.id, "data.put", ["notes", { key: "x" }])).toMatchObject({ ok: false });
    expect(await b.call(run.id, "data.put", ["other.queues", { key: "x" }])).toMatchObject({ ok: false });
    expect(await b.call(run.id, "data.put", ["__proto__", { key: "x" }])).toMatchObject({ ok: false });
    expect(await b.call(run.id, "data.put", ["queues", { key: "x" }])).toMatchObject({ ok: true });
    expect(seen.data).toEqual([{ op: "put", collection: "queues", record: { key: "x" } }]);
    expect(b.endRun(run.id)).toMatchObject({ writes: 1 });
  });

  it("every data call reaches the store in its own shape", async () => {
    const { b, seen } = broker();
    const run = b.startRun("queues");
    for (const [name, args] of [
      ["data.get", ["queues", "x"]],
      ["data.get", ["queues"]],
      ["data.query", ["queues", { where: { key: { in: ["a"] } }, fields: ["key"], limit: 5 }]],
      ["data.query", ["queues"]],
      ["data.patch", ["queues", "x", { key: "x" }]],
      ["data.patch", ["queues", undefined, { key: "x" }]],
      ["data.delete", ["queues", 3]],
      ["data.replaceAll", ["queues", [{ key: "a" }, { key: "b" }]]],
    ] as [string, unknown[]][]) {
      expect(await b.call(run.id, name, args), name).toMatchObject({ ok: true });
    }
    expect(seen.data).toEqual([
      { op: "get", collection: "queues", key: "x" },
      { op: "get", collection: "queues" },
      { op: "query", collection: "queues", query: { where: { key: { in: ["a"] } }, fields: ["key"], limit: 5 } },
      { op: "query", collection: "queues", query: {} },
      { op: "patch", collection: "queues", key: "x", patch: { key: "x" } },
      { op: "patch", collection: "queues", patch: { key: "x" } },
      { op: "delete", collection: "queues", key: 3 },
      { op: "replaceAll", collection: "queues", records: [{ key: "a" }, { key: "b" }] },
    ]);
    expect(b.endRun(run.id)).toEqual({ writes: 4 });
  });

  it("a store error becomes a refusal and isn't counted as a write", async () => {
    const { b } = broker({ data: { run: async () => { throw new Error("The record is too large (at most 64 KB)"); } } } as never);
    const run = b.startRun("queues");
    expect(await b.call(run.id, "data.put", ["queues", { key: "x" }])).toEqual({ ok: false, refused: "The record is too large (at most 64 KB)" });
    expect(b.endRun(run.id)).toEqual({ writes: 0 });
  });

  it("attention items are checked: declared targets, sizes, plain text", async () => {
    const { b, seen } = broker();
    const run = b.startRun("queues");
    expect(await b.call(run.id, "attention.raise", [{ key: "sla:DOC-1", severity: "action", title: "SLA breach", target: { panel: "queue", focus: "DOC-1" } }])).toMatchObject({ ok: true });
    expect(await b.call(run.id, "attention.raise", [{ key: "x", severity: "action", title: "T", target: { panel: "nope" } }])).toMatchObject({ ok: false });
    expect(await b.call(run.id, "attention.raise", [{ key: "x", severity: "urgent", title: "T" }])).toMatchObject({ ok: false });
    expect(await b.call(run.id, "attention.raise", [{ key: "x", severity: "info", title: "t".repeat(121) }])).toMatchObject({ ok: false });
    expect(await b.call(run.id, "attention.raise", [{ key: "x y", severity: "info", title: "T" }])).toMatchObject({ ok: false });
    expect(await b.call(run.id, "attention.raise", [{ key: "x", severity: "info", title: "   " }])).toMatchObject({ ok: false });
    expect(await b.call(run.id, "attention.raise", [{ key: "x", severity: "info", title: "T", extra: 1 }])).toMatchObject({ ok: false });
    expect(await b.call(run.id, "attention.raise", [{ key: "x", severity: "info", title: "T", target: { action: "nope" } }])).toMatchObject({ ok: false });
    expect(await b.call(run.id, "attention.raise", [{ key: "x", severity: "info", title: "T", target: { action: "triage", vars: { k: "x".repeat(5000) } } }])).toMatchObject({ ok: false });
    expect(await b.call(run.id, "attention.raise", [{ key: "y", severity: "warn", title: " A\u0000‮B ", body: "line1\nline2\u0007", target: { action: "triage", vars: { key: "DOC-1" } } }])).toMatchObject({ ok: true });
    expect(seen.raised).toEqual([
      { key: "sla:DOC-1", severity: "action", title: "SLA breach", target: { panel: "queue", focus: "DOC-1" } },
      { key: "y", severity: "warn", title: "AB", body: "line1\nline2", target: { action: "triage", vars: { key: "DOC-1" } } },
    ]);
    expect(await b.call(run.id, "attention.resolve", ["sla:DOC-1"])).toMatchObject({ ok: true });
    expect(await b.call(run.id, "attention.resolve", [{}])).toMatchObject({ ok: false });
    expect(seen.resolved).toEqual(["sla:DOC-1"]);
  });

  it("chips: declared ids, ≤ 40 characters", async () => {
    const { b, seen } = broker();
    const run = b.startRun("queues");
    expect(await b.call(run.id, "chip.set", ["who", { text: "You're on call", severity: "action" }])).toMatchObject({ ok: true });
    expect(await b.call(run.id, "chip.set", ["nope", { text: "x" }])).toMatchObject({ ok: false });
    expect(await b.call(run.id, "chip.set", ["who", { text: "x".repeat(41) }])).toMatchObject({ ok: false });
    expect(await b.call(run.id, "chip.set", ["who", { text: "x", severity: "loud" }])).toMatchObject({ ok: false });
    expect(await b.call(run.id, "chip.set", ["who", { text: "Quiet" }])).toMatchObject({ ok: true });
    expect(await b.call(run.id, "chip.clear", ["who"])).toMatchObject({ ok: true });
    expect(await b.call(run.id, "chip.clear", ["nope"])).toMatchObject({ ok: false });
    expect(seen.chips).toEqual([["who", { text: "You're on call", severity: "action" }], ["who", { text: "Quiet", severity: "info" }], ["who", null]]);
  });

  it("B11: at most 16 calls in flight", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { b } = broker({ settings: () => gate.then(() => ({})) } as never);
    const run = b.startRun("queues");
    const calls = Array.from({ length: 17 }, () => b.call(run.id, "settings.get", []));
    expect(await calls[16]).toMatchObject({ ok: false, refused: expect.stringMatching(/too many/i) });
    release();
    await Promise.all(calls);
    expect(await b.call(run.id, "settings.get", [])).toMatchObject({ ok: true });
  });

  it("log lines are capped at 2000 characters, one line, and a failing log never fails the call", async () => {
    const { b, seen } = broker();
    const run = b.startRun("queues");
    await b.call(run.id, "log", ["info", "x".repeat(5000)]);
    expect((seen.logs[0] as [string, string])[1].length).toBeLessThanOrEqual(2000);
    await b.call(run.id, "log", ["warn", "a\nb\u0000c"]);
    expect(seen.logs[1]).toEqual(["warn", "a b c"]);
    const failing = broker({ log: async () => { throw new Error("refused"); } } as never);
    const r2 = failing.b.startRun("queues");
    expect(await failing.b.call(r2.id, "log", ["info", "x"])).toMatchObject({ ok: true });
    expect(await failing.b.call(r2.id, "nope", [])).toMatchObject({ ok: false });
  });

  it("killAll ends every run", async () => {
    const { b } = broker();
    const run = b.startRun("queues");
    const other = b.startRun("queues");
    b.killAll();
    expect(await b.call(run.id, "settings.get", [])).toMatchObject({ ok: false });
    expect(await b.call(other.id, "settings.get", [])).toMatchObject({ ok: false });
    expect(other.signal.aborted).toBe(true);
  });
});
