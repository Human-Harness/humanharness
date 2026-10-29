import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ToolMeta } from "@humanharness/harness-sdk";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TOOL_BROKER_LIMITS, TOOL_CALLS, ToolBroker, type ToolBrokerDeps, localOrIp, toolAllowHost } from "../../src/main/tools/tool-broker";

const SECRET = "tok-SECRET-1234";
let userData: string;

beforeEach(async () => {
  userData = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "hh-tool-broker-")));
});
afterEach(async () => {
  await fs.rm(userData, { recursive: true, force: true });
});

function meta(uses: ToolMeta["uses"]): ToolMeta {
  return { description: "Reads the CI checks of a pull request", agent: "call", uses, params: { type: "object" }, timeout: 30, file: "tools/pr-ci.js" };
}

function broker(uses: ToolMeta["uses"], over: Partial<ToolBrokerDeps> = {}) {
  const seen = {
    fetches: [] as { url: string; init: RequestInit }[],
    asked: [] as string[][],
    data: [] as { op: unknown; who: string; tool: string; scope: string | null }[],
    exec: [] as { file: string; args: string[]; cwd: string }[],
    files: [] as (string | null)[],
    hosts: [] as string[],
    logs: [] as unknown[],
  };
  const deps: ToolBrokerDeps = {
    harnessId: "dev",
    tool: "pr-ci",
    meta: meta(uses),
    secrets: [
      { id: "jira", label: "Jira token" },
      { id: "gh", label: "GitHub token" },
    ],
    store: { harnessValues: async (ids) => (seen.asked.push([...ids]), { jira: SECRET }) },
    data: async (op, c) => (seen.data.push({ op, ...c }), op.op === "query" ? { records: [], total: 0 } : null),
    files: async (scope) => (
      seen.files.push(scope),
      { read: async (rel: string) => `text of ${rel}`, list: async (dir: string) => [`${dir}/a.md`] }
    ),
    fetch: (async (url: string, init: RequestInit) => (seen.fetches.push({ url, init }), new Response("ok"))) as unknown as typeof fetch,
    allowHost: async (host) => (seen.hosts.push(host), host !== "inside.x.com"),
    userData,
    exec: {
      resolve: async (cmd) => `/usr/bin/${cmd}`,
      run: async (file, args, o) => (seen.exec.push({ file, args, cwd: o.cwd }), { code: 0, stdout: "out", stderr: "" }),
      env: async () => ({ PATH: "/usr/bin" }),
    },
    log: async (level, message) => void seen.logs.push([level, message]),
    ...over,
  };
  return { b: new ToolBroker(deps), seen };
}

describe("ToolBroker: one core broker per tool, bound to its uses (tools spec §4.2, D7)", () => {
  it("TOOL_CALLS is fetch, exec, data.get/query/put/patch/delete, files.read, files.list, scope, log", () => {
    expect([...TOOL_CALLS].sort()).toEqual(["data.delete", "data.get", "data.patch", "data.put", "data.query", "exec", "fetch", "files.list", "files.read", "log", "scope"]);
  });

  it("a call outside TOOL_CALLS (data.replaceAll) is refused as unknown", async () => {
    const { b, seen } = broker({ data: { write: ["tickets"] } });
    const run = b.startCall(null);
    expect(await b.call(run.id, "data.replaceAll", ["tickets", []])).toMatchObject({ ok: false, refused: expect.stringMatching(/unknown/i) });
    expect(seen.data).toEqual([]);
  });

  it("fetch: a host outside uses.hosts is refused with ToolRefused-style text naming uses.hosts", async () => {
    const { b, seen } = broker({ hosts: ["api.x.com"] });
    const run = b.startCall(null);
    expect(await b.call(run.id, "fetch", ["https://evil.y.com/a"])).toEqual({ ok: false, refused: "evil.y.com is not declared in uses.hosts" });
    expect(await b.call(run.id, "fetch", ["https://api.x.com/a"])).toMatchObject({ ok: true, value: { status: 200, text: "ok" } });
    expect(seen.fetches.map((f) => f.url)).toEqual(["https://api.x.com/a"]);
  });

  it("fetch: localhost, IP literals and hosts that resolve to a private address are refused, on every hop", async () => {
    const redirect = (async (url: string) =>
      url === "https://api.x.com/r"
        ? new Response(null, { status: 302, headers: { location: "https://inside.x.com/b" } })
        : new Response("ok")) as unknown as typeof fetch;
    const { b, seen } = broker({ hosts: ["*.x.com", "localhost", "127.0.0.1", "[::1]"] }, { fetch: redirect });
    const run = b.startCall(null);
    expect(await b.call(run.id, "fetch", ["https://localhost/a"])).toEqual({ ok: false, refused: "localhost is not a public host name" });
    expect(await b.call(run.id, "fetch", ["https://127.0.0.1/a"])).toEqual({ ok: false, refused: "127.0.0.1 is not a public host name" });
    expect(await b.call(run.id, "fetch", ["https://[::1]/a"])).toMatchObject({ ok: false, refused: "[::1] is not a public host name" });
    // The resolver passed the first hop; the redirect's host resolves to a private address.
    expect(await b.call(run.id, "fetch", ["https://api.x.com/r"])).toEqual({ ok: false, refused: "inside.x.com resolves to a private address" });
    expect(seen.hosts).toEqual(["api.x.com", "inside.x.com"]);
  });

  it("fetch: {{secret:jira}} is filled only when uses.secrets names it; another id is refused before the store is read", async () => {
    const { b, seen } = broker({ hosts: ["api.x.com"], secrets: ["jira"] });
    const run = b.startCall(null);
    const out = await b.call(run.id, "fetch", ["https://api.x.com/a", { headers: { Authorization: "Bearer {{secret:jira}}" } }]);
    expect(out).toMatchObject({ ok: true });
    expect(new Headers(seen.fetches[0]!.init.headers).get("authorization")).toBe(`Bearer ${SECRET}`);
    expect(seen.asked).toEqual([["jira"]]);
    expect(await b.call(run.id, "fetch", ["https://api.x.com/a", { headers: { Authorization: "{{secret:gh}}" } }])).toEqual({
      ok: false,
      refused: 'The key "gh" is not declared in uses.secrets',
    });
    expect(seen.asked).toEqual([["jira"]]);
  });

  it("a missing secret fails with '<label> is not set — Settings › Connections'", async () => {
    const { b, seen } = broker({ hosts: ["api.x.com"], secrets: ["jira"] }, { store: { harnessValues: async () => ({}) } });
    const run = b.startCall(null);
    expect(await b.call(run.id, "fetch", ["https://api.x.com/a", { body: "{{secret:jira}}", method: "POST" }])).toEqual({
      ok: false,
      refused: "Jira token is not set — Settings › Connections",
    });
    expect(seen.fetches).toEqual([]);
  });

  it("exec: only uses.exec patterns; cwd is <userData>/tool-exec/<harness-id>/", async () => {
    const { b, seen } = broker({ exec: [{ cmd: "gh", args: ["pr", "checks", "*"] }] });
    const run = b.startCall(null);
    expect(await b.call(run.id, "exec", ["gh", ["pr", "checks", "12"]])).toEqual({ ok: true, value: { code: 0, stdout: "out", stderr: "" } });
    const cwd = path.join(userData, "tool-exec", "dev");
    expect(seen.exec).toEqual([{ file: "/usr/bin/gh", args: ["pr", "checks", "12"], cwd }]);
    expect((await fs.lstat(cwd)).isDirectory()).toBe(true);
    expect(await b.call(run.id, "exec", ["gh", ["repo", "delete", "x"]])).toEqual({ ok: false, refused: "gh repo delete x is not declared in uses.exec" });
    expect(seen.exec).toHaveLength(1);
  });

  it("data: reads only uses.data.read ∪ write; writes only uses.data.write; each goes out with who: tool and the tool's id", async () => {
    const { b, seen } = broker({ data: { read: ["people"], write: ["tickets"] } });
    const run = b.startCall("intro");
    const refused = (name: string) => ({ ok: false, refused: `The collection is not declared in uses.data (${name})` });
    expect(await b.call(run.id, "data.get", ["people", "ana"])).toEqual({ ok: true, value: null });
    expect(await b.call(run.id, "data.query", ["tickets", { limit: 5 }])).toEqual({ ok: true, value: { records: [], total: 0 } });
    expect(await b.call(run.id, "data.put", ["tickets", { key: "a" }])).toEqual({ ok: true, value: null });
    expect(await b.call(run.id, "data.put", ["people", { key: "b" }])).toEqual(refused("data.put"));
    expect(await b.call(run.id, "data.delete", ["people", "ana"])).toEqual(refused("data.delete"));
    expect(await b.call(run.id, "data.get", ["other"])).toEqual(refused("data.get"));
    expect(await b.call(run.id, "data.get", ["__proto__"])).toEqual(refused("data.get"));
    expect(seen.data).toEqual([
      { op: { op: "get", collection: "people", key: "ana" }, who: "tool", tool: "pr-ci", scope: "intro" },
      { op: { op: "query", collection: "tickets", query: { limit: 5 } }, who: "tool", tool: "pr-ci", scope: "intro" },
      { op: { op: "put", collection: "tickets", record: { key: "a" } }, who: "tool", tool: "pr-ci", scope: "intro" },
    ]);
  });

  it("files: refused without uses.files; read and list allowed with read", async () => {
    const without = broker({});
    const r1 = without.b.startCall(null);
    expect(await without.b.call(r1.id, "files.read", ["notes.md"])).toEqual({ ok: false, refused: "This tool doesn't declare uses.files" });
    expect(await without.b.call(r1.id, "files.list", ["notes"])).toEqual({ ok: false, refused: "This tool doesn't declare uses.files" });
    expect(without.seen.files).toEqual([]);
    const withRead = broker({ files: "read" });
    const r2 = withRead.b.startCall("intro");
    expect(await withRead.b.call(r2.id, "files.read", ["notes.md"])).toEqual({ ok: true, value: "text of notes.md" });
    expect(await withRead.b.call(r2.id, "files.list", ["notes", "*.md"])).toEqual({ ok: true, value: ["notes/a.md"] });
    expect(await withRead.b.call(r2.id, "files.read", [42])).toMatchObject({ ok: false, refused: expect.stringContaining("A path") });
    expect(withRead.seen.files).toEqual(["intro", "intro"]);
  });

  it("a run carries the caller's scope; ctx.scope is that scope or null", async () => {
    const { b } = broker({});
    const a = b.startCall("intro");
    const n = b.startCall(null);
    expect(await b.call(a.id, "scope", [])).toEqual({ ok: true, value: "intro" });
    expect(await b.call(n.id, "scope", [])).toEqual({ ok: true, value: null });
    b.endCall(a.id);
    expect(await b.call(a.id, "scope", [])).toEqual({ ok: false, refused: "This tool call has ended" });
    expect(a.signal.aborted).toBe(true);
  });

  it("every allowed and refused access is recorded for the trace", async () => {
    const { b } = broker({ hosts: ["api.x.com"], exec: [{ cmd: "gh", args: ["pr", "*"] }], data: { read: ["people"] } });
    const run = b.startCall(null);
    await b.call(run.id, "fetch", ["https://api.x.com/a", { headers: { "X-Note": "header value" }, body: "body text", method: "POST" }]);
    await b.call(run.id, "exec", ["gh", ["repo", "delete", "x"]]);
    await b.call(run.id, "data.get", ["people"]);
    await b.call(run.id, "data.put", ["people", { key: "a" }]);
    await b.call(run.id, "files.read", ["notes.md"]);
    await b.call(run.id, "fetch", [`https://api.x.com/${"p".repeat(300)}`]);
    const { accesses } = b.endCall(run.id);
    expect(accesses.slice(0, 5)).toEqual([
      { kind: "fetch", target: "https://api.x.com/a", allowed: true },
      { kind: "exec", target: "gh repo delete x", allowed: false },
      { kind: "data", target: "get people", allowed: true },
      { kind: "data", target: "put people", allowed: false },
      { kind: "files", target: "notes.md", allowed: false },
    ]);
    expect(accesses[5]!.target).toHaveLength(200);
    expect(JSON.stringify(accesses)).not.toContain("header value");
    expect(JSON.stringify(accesses)).not.toContain("body text");
    expect(b.endCall(run.id)).toEqual({ accesses: [], logs: [] });
  });

  it("accesses belong to their own call", async () => {
    const { b } = broker({ hosts: ["api.x.com"] });
    const a = b.startCall(null);
    const c = b.startCall(null);
    await b.call(a.id, "fetch", ["https://api.x.com/a"]);
    await b.call(c.id, "fetch", ["https://api.x.com/c"]);
    expect(b.endCall(a.id).accesses.map((x) => x.target)).toEqual(["https://api.x.com/a"]);
    expect(b.endCall(c.id).accesses.map((x) => x.target)).toEqual(["https://api.x.com/c"]);
  });

  it("a redirect hop to a local or IP host is refused even when the resolver says yes", async () => {
    for (const location of ["https://2130706433/x", "http://localhost./", "https://localhost./x"]) {
      const redirect = (async (url: string) =>
        url === "https://api.x.com/r" ? new Response(null, { status: 302, headers: { location } }) : new Response("reached")) as unknown as typeof fetch;
      const { b, seen } = broker({ hosts: ["*.x.com"] }, { fetch: redirect, allowHost: async () => true });
      const run = b.startCall(null);
      expect(await b.call(run.id, "fetch", ["https://api.x.com/r"])).toMatchObject({ ok: false });
      expect(seen.fetches).toEqual([]);
    }
  });

  it("the hop guard: localhost, *.localhost and IP literals (a final dot too) never reach the resolver", async () => {
    const asked: string[] = [];
    const allow = toolAllowHost(async (h) => (asked.push(h), true));
    for (const h of ["localhost", "localhost.", "a.localhost", "127.0.0.1", "127.0.0.1.", "[::1]", "::1"]) expect(await allow(h)).toBe(false);
    expect(asked).toEqual([]);
    expect(await allow("api.x.com")).toBe(true);
    expect(localOrIp("localhost.")).toBe(true);
    expect(localOrIp("127.0.0.1.")).toBe(true);
    expect(localOrIp("api.x.com.")).toBe(false);
  });

  it("a key a redirect echoes in its Location never reaches the accesses", async () => {
    const redirect = (async (url: string) =>
      url === "https://api.x.com/r"
        ? new Response(null, { status: 302, headers: { location: `https://api.x.com/ok?t=${SECRET}` } })
        : new Response("ok")) as unknown as typeof fetch;
    const { b } = broker({ hosts: ["api.x.com"], secrets: ["jira"] }, { fetch: redirect });
    const run = b.startCall(null);
    expect(await b.call(run.id, "fetch", ["https://api.x.com/r", { headers: { Authorization: "{{secret:jira}}" } }])).toMatchObject({ ok: true });
    const { accesses } = b.endCall(run.id);
    expect(accesses.map((a) => a.target)).toEqual(["https://api.x.com/r", "https://api.x.com/ok?t=[redacted]"]);
    expect(JSON.stringify(accesses)).not.toContain(SECRET);
  });

  it("a data op the data path refuses is recorded as refused", async () => {
    const { b } = broker({ data: { write: ["tickets"] } }, { data: async () => Promise.reject(new Error("A rule refused the write")) });
    const run = b.startCall(null);
    expect(await b.call(run.id, "data.put", ["tickets", { key: "a" }])).toMatchObject({ ok: false, refused: "A rule refused the write" });
    expect(b.endCall(run.id).accesses).toEqual([{ kind: "data", target: "put tickets", allowed: false }]);
  });

  it("ctx.log lines are kept per call for its trace entry (spec §4.2): one line each, the first 20, still sent to main's log", async () => {
    const { b, seen } = broker({});
    const run = b.startCall(null);
    const other = b.startCall(null);
    expect(await b.call(run.id, "log", ["warn", "first\nline"])).toMatchObject({ ok: true });
    expect(await b.call(other.id, "log", ["info", "other call"])).toMatchObject({ ok: true });
    for (let i = 0; i < 25; i++) await b.call(run.id, "log", ["info", `n${i}`]);
    expect(await b.call(run.id, "log", ["loud", "bad level"])).toMatchObject({ ok: false });
    const { logs } = b.endCall(run.id);
    expect(logs).toHaveLength(TOOL_BROKER_LIMITS.logs);
    expect(logs[0]).toEqual({ level: "warn", message: "first line" });
    expect(logs[19]).toEqual({ level: "info", message: "n18" });
    expect(b.endCall(other.id).logs).toEqual([{ level: "info", message: "other call" }]);
    expect(seen.logs).toContainEqual(["warn", "first line"]);
    expect(seen.logs).toContainEqual(["info", "n24"]);
  });

  it("a ctx.log line is kept with the keys this tool's fetches were filled with already hidden", async () => {
    const { b } = broker({ hosts: ["api.x.com"], secrets: ["jira"] });
    const run = b.startCall(null);
    await b.call(run.id, "fetch", ["https://api.x.com/a", { headers: { Authorization: "{{secret:jira}}" } }]);
    await b.call(run.id, "log", ["info", `sent ${SECRET}`]);
    expect(b.endCall(run.id).logs).toEqual([{ level: "info", message: "sent [redacted]" }]);
  });

  it("a job run's narrowed permissions hold: web: false refuses fetch, exec: false refuses exec, naming them; the rest works", async () => {
    const { b, seen } = broker({ hosts: ["api.x.com"], exec: [{ cmd: "gh", args: ["*"] }], data: { read: ["tickets"] } });
    const run = b.startCall("s1", { job: "digest", web: false, exec: false });
    expect(await b.call(run.id, "fetch", ["https://api.x.com/a"])).toEqual({ ok: false, refused: 'The job "digest" runs with web: false: its tools can\'t fetch' });
    expect(await b.call(run.id, "exec", ["gh", ["pr"]])).toEqual({ ok: false, refused: 'The job "digest" runs with exec: false: its tools can\'t run commands' });
    expect(await b.call(run.id, "data.get", ["tickets", "a"])).toMatchObject({ ok: true });
    expect(seen.fetches).toEqual([]);
    expect(seen.exec).toEqual([]);
    expect(b.endCall(run.id).accesses).toEqual([
      { kind: "fetch", target: "https://api.x.com/a", allowed: false },
      { kind: "exec", target: "gh pr", allowed: false },
      { kind: "data", target: "get tickets", allowed: true },
    ]);
    // Only the one that is off: web on, exec off.
    const half = b.startCall(null, { job: "digest", web: true, exec: false });
    expect(await b.call(half.id, "fetch", ["https://api.x.com/a"])).toMatchObject({ ok: true });
    expect(await b.call(half.id, "exec", ["gh", ["pr"]])).toMatchObject({ ok: false });
    // A call with no job limits (a task's, the UI's) is as before.
    const free = b.startCall(null);
    expect(await b.call(free.id, "exec", ["gh", ["pr"]])).toMatchObject({ ok: true });
  });
});

