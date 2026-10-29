import { describe, expect, it } from "vitest";
import { Broker, type BrokerGrant, CORE_CALLS, type CoreBrokerDeps } from "../../src/main/broker/broker";

const grant: BrokerGrant = {
  hosts: ["api.example.com"],
  secrets: ["jira"],
  exec: [{ cmd: "gh", args: ["pr", "checks", "*"] }],
  collection: (name, write) => name === "tickets" && !write,
  refusals: {
    collection: "The collection is not declared in uses.data",
    secret: (id) => `The key "${id}" is not declared in uses.secrets`,
    exec: (line) => `${line} is not declared in uses.exec`,
  },
};
const SECRET = "tok-SECRET-1234";

function core(over: Partial<CoreBrokerDeps> = {}) {
  const seen = { fetches: [] as { url: string; init: RequestInit }[], data: [] as unknown[], logs: [] as unknown[], secretIds: [] as string[][], exec: [] as unknown[] };
  const deps: CoreBrokerDeps = {
    grant,
    calls: ["fetch", "exec", "data.get", "data.query", "data.put", "log"],
    data: { run: async (op) => (seen.data.push(op), null) },
    secrets: async (ids) => (seen.secretIds.push(ids), { jira: SECRET }),
    log: async (level, message) => void seen.logs.push([level, message]),
    fetch: (async (url: string, init: RequestInit) => (seen.fetches.push({ url, init }), new Response("ok"))) as unknown as typeof fetch,
    exec: {
      resolve: async () => "/bin/gh",
      run: async (file, args) => (seen.exec.push({ file, args }), { code: 0, stdout: "out", stderr: "" }),
      cwd: async () => "/c",
      env: async () => ({ PATH: "/bin" }),
    },
    ended: "This call has ended",
  };
  const b = new Broker({ ...deps, ...over } as CoreBrokerDeps);
  return { b, seen };
}

describe("Broker (tools spec §4.2: the core service)", () => {
  it("CORE_CALLS is the generic surface: fetch, exec, data.*, log", () => {
    expect([...CORE_CALLS].sort()).toEqual(["data.delete", "data.get", "data.patch", "data.put", "data.query", "data.replaceAll", "exec", "fetch", "log"]);
  });
  it("a call outside the caller's `calls` is refused as unknown, even when it is a core call", async () => {
    const { b } = core();
    const run = b.startRun("t");
    expect(await b.call(run.id, "data.delete", ["tickets"])).toMatchObject({ ok: false, refused: expect.stringMatching(/unknown/i) });
  });
  it("a dead run answers the owner's ended text", async () => {
    const { b } = core();
    expect(await b.call("nope", "log", ["info", "x"])).toEqual({ ok: false, refused: "This call has ended" });
  });
  it("an ended run's id dies and its signal aborts", async () => {
    const { b } = core();
    const run = b.startRun("t");
    expect(b.endRun(run.id)).toEqual({ writes: 0 });
    expect(run.signal.aborted).toBe(true);
    expect(await b.call(run.id, "log", ["info", "x"])).toEqual({ ok: false, refused: "This call has ended" });
  });
  it("fetch: only granted hosts; only granted secrets, named by the grant's refusal", async () => {
    const { b, seen } = core();
    const run = b.startRun("t");
    expect(await b.call(run.id, "fetch", ["https://evil.example.org/x"])).toMatchObject({ ok: false });
    expect(await b.call(run.id, "fetch", ["https://api.example.com/x", { headers: { a: "{{secret:other}}" } }])).toEqual({
      ok: false,
      refused: 'The key "other" is not declared in uses.secrets',
    });
    expect(seen.secretIds).toEqual([]);
    expect(await b.call(run.id, "fetch", ["https://api.example.com/x", { headers: { a: "{{secret:jira}}" } }])).toMatchObject({ ok: true });
    expect(seen.secretIds).toEqual([["jira"]]);
    expect(seen.fetches).toHaveLength(1);
  });
  it("exec: only granted patterns, refused with the grant's text", async () => {
    const { b, seen } = core();
    const run = b.startRun("t");
    expect(await b.call(run.id, "exec", ["gh", ["repo", "delete", "x"]])).toEqual({ ok: false, refused: "gh repo delete x is not declared in uses.exec" });
    expect(seen.exec).toEqual([]);
    expect(await b.call(run.id, "exec", ["gh", ["pr", "checks", "12"]])).toMatchObject({ ok: true });
    expect(seen.exec).toHaveLength(1);
  });
  it("data: the grant decides each collection and whether it may be written", async () => {
    const { b, seen } = core();
    const run = b.startRun("t");
    expect(await b.call(run.id, "data.get", ["tickets"])).toEqual({ ok: true, value: null });
    expect(await b.call(run.id, "data.put", ["tickets", { key: "a" }])).toMatchObject({ ok: false, refused: expect.stringContaining("uses.data") });
    expect(await b.call(run.id, "data.get", ["other"])).toMatchObject({ ok: false });
    expect(seen.data).toHaveLength(1);
  });
  it("data: a read-only grant refuses every write call", async () => {
    const { b, seen } = core({ calls: ["data.patch", "data.delete", "data.replaceAll"] });
    const run = b.startRun("t");
    const refused = (name: string) => ({ ok: false, refused: `The collection is not declared in uses.data (${name})` });
    expect(await b.call(run.id, "data.patch", ["tickets", "a", { x: 1 }])).toEqual(refused("data.patch"));
    expect(await b.call(run.id, "data.delete", ["tickets", "a"])).toEqual(refused("data.delete"));
    expect(await b.call(run.id, "data.replaceAll", ["tickets", [{ key: "a" }]])).toEqual(refused("data.replaceAll"));
    expect(seen.data).toEqual([]);
    expect(b.endRun(run.id)).toEqual({ writes: 0 });
  });
  it("extra handlers from the owner join the surface under their names", async () => {
    const { b } = core({ calls: ["log", "settings.get"], extra: new Map([["settings.get", { max: 0, fn: async () => ({ ok: true as const, value: { a: 1 } }) }]]) });
    const run = b.startRun("t");
    expect(await b.call(run.id, "settings.get", [])).toEqual({ ok: true, value: { a: 1 } });
  });
  it("an extra can't take a core call's name", () => {
    for (const name of CORE_CALLS) {
      expect(() => core({ calls: [name], extra: new Map([[name, { max: 2, fn: async () => ({ ok: true as const, value: null }) }]]) })).toThrow(name);
    }
  });
  it("refusals.host names the owner's declaration for an undeclared https host; without it the fetch's own text stays", async () => {
    const own = core({ grant: { ...grant, refusals: { ...grant.refusals, host: (h) => `${h} is not declared in uses.hosts` } } });
    expect(await own.b.call(own.b.startRun("t").id, "fetch", ["https://evil.example.org/x"])).toEqual({ ok: false, refused: "evil.example.org is not declared in uses.hosts" });
    const plain = core();
    expect(await plain.b.call(plain.b.startRun("t").id, "fetch", ["https://evil.example.org/x"])).toEqual({ ok: false, refused: "evil.example.org is not declared in permissions.hosts" });
    expect([...own.seen.fetches, ...plain.seen.fetches]).toEqual([]);
  });
  it("data.run gets the call's run, so an owner can bind the data to it", async () => {
    const keys: string[] = [];
    const { b } = core({ data: { run: async (_op, run) => (keys.push(run.key), null) } });
    await b.call(b.startRun("call-1").id, "data.get", ["tickets"]);
    expect(keys).toEqual(["call-1"]);
  });
  it("transport(key) replaces fetch and the runner after every check (fixture mode)", async () => {
    let fixtureCalls = 0;
    const fx = (async () => ((fixtureCalls += 1), new Response("fixture"))) as unknown as typeof fetch;
    const keys: string[] = [];
    const { b, seen } = core({ transport: (key) => (keys.push(key), { fetch: fx, run: async () => ({ code: 0, stdout: "fx", stderr: "" }) }) });
    const run = b.startRun("t");
    const r = await b.call(run.id, "fetch", ["https://api.example.com/x"]);
    expect(r).toMatchObject({ ok: true, value: { text: "fixture" } });
    expect(seen.fetches).toEqual([]);
    expect(keys).toEqual(["t"]);
    expect(await b.call(run.id, "fetch", ["https://evil.example.org/x"])).toMatchObject({ ok: false });
    expect(fixtureCalls).toBe(1);
  });
});
