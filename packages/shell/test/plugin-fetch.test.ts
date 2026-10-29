import { describe, expect, it } from "vitest";
import { pluginFetch } from "../src/main/plugin-fetch";

type Call = { url: string; init: RequestInit };
/** A fetch double: answers from `routes` by URL, records every call, never touches the network. */
function fakeFetch(routes: Record<string, () => Response>) {
  const calls: Call[] = [];
  const fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), init });
    const r = Object.hasOwn(routes, String(url)) ? routes[String(url)] : undefined;
    if (!r) throw new Error(`unexpected ${url}`);
    return r();
  }) as unknown as typeof globalThis.fetch;
  return { fetch, calls };
}
const SECRET = "tok-SECRET-1234";
const opts = (fetch: typeof globalThis.fetch, extra: object = {}) => ({ hosts: ["*.atlassian.net", "api.firehydrant.io"], secrets: { jira: SECRET }, fetch, ...extra });
const header = (c: Call, name: string) => new Headers(c.init.headers).get(name);

describe("pluginFetch (plugins spec §4.2, Decision 8)", () => {
  it("substitutes a secret in a header and never returns it", async () => {
    const f = fakeFetch({ "https://acme.atlassian.net/rest": () => new Response(`echo ${SECRET}`, { headers: { "x-echo": `Bearer ${SECRET}` } }) });
    const r = await pluginFetch({ url: "https://acme.atlassian.net/rest", init: { headers: { authorization: "Bearer {{secret:jira}}" } } }, opts(f.fetch));
    expect(header(f.calls[0], "authorization")).toBe(`Bearer ${SECRET}`);
    expect(f.calls[0].init.redirect).toBe("manual");
    expect(r).toMatchObject({ ok: true, response: { status: 200, text: "echo [redacted]", headers: { "x-echo": "Bearer [redacted]" } } });
    expect(JSON.stringify(r)).not.toContain(SECRET);
  });

  it("substitutes in the body and redacts encoded echoes", async () => {
    const f = fakeFetch({ "https://acme.atlassian.net/b": () => new Response(`${encodeURIComponent(SECRET)} ${btoa(SECRET)}`) });
    const r = await pluginFetch({ url: "https://acme.atlassian.net/b", init: { method: "post", body: '{"t":"{{secret:jira}}"}' } }, opts(f.fetch));
    expect(f.calls[0].init.body).toBe(`{"t":"${SECRET}"}`);
    expect(f.calls[0].init.method).toBe("POST");
    expect(r).toMatchObject({ ok: true, response: { text: "[redacted] [redacted]" } });
  });

  it("fetches the parsed URL, never the raw string", async () => {
    const f = fakeFetch({ "https://acme.atlassian.net/a%20b": () => new Response("ok") });
    expect(await pluginFetch({ url: "HTTPS://ACME.atlassian.net/a b" }, opts(f.fetch))).toMatchObject({ ok: true });
    expect(f.calls[0].url).toBe("https://acme.atlassian.net/a%20b");
  });

  it.each([
    ["http://acme.atlassian.net/", /https/],
    ["https://evil.com/", /not declared/],
    ["https://acme.atlassian.net/?t={{secret:jira}}", /URL/],
    ["https://acme.atlassian.net/?t={{ Secret:jira}}", /URL/],
    ["file:///etc/hosts", /https/],
    ["https://127.0.0.1/", /not declared/],
    ["https://localhost/", /not declared/],
    ["https://user:pw@acme.atlassian.net/", /not declared/],
    ["https://acme.atlassian.net:8443/", /not declared/],
    ["not a url", /not valid/],
  ])("refuses %s before any network", async (url, why) => {
    const f = fakeFetch({});
    expect(await pluginFetch({ url }, opts(f.fetch))).toMatchObject({ ok: false, reason: expect.stringMatching(why) });
    expect(f.calls).toEqual([]);
  });

  it("a secret the plugin didn't declare, or not stored, is refused", async () => {
    const f = fakeFetch({});
    expect(await pluginFetch({ url: "https://acme.atlassian.net/", init: { headers: { a: "{{secret:other}}" } } }, opts(f.fetch))).toMatchObject({ ok: false });
    expect(await pluginFetch({ url: "https://acme.atlassian.net/", init: { method: "POST", body: "{{secret:other}}" } }, opts(f.fetch))).toMatchObject({ ok: false });
    expect(f.calls).toEqual([]);
  });

  it("follows a redirect to a declared host, refuses one to an undeclared host", async () => {
    const ok = fakeFetch({
      "https://acme.atlassian.net/a": () => new Response(null, { status: 302, headers: { location: "https://api.firehydrant.io/b" } }),
      "https://api.firehydrant.io/b": () => new Response("done"),
    });
    const r = await pluginFetch({ url: "https://acme.atlassian.net/a", init: { headers: { authorization: "Bearer {{secret:jira}}", "x-key": "{{secret:jira}}", accept: "x" } } }, opts(ok.fetch));
    expect(r).toMatchObject({ ok: true, response: { url: "https://api.firehydrant.io/b", text: "done" } });
    // The secret-bearing headers are dropped when the host changes; other headers stay.
    expect(header(ok.calls[1], "authorization")).toBeNull();
    expect(header(ok.calls[1], "x-key")).toBeNull();
    expect(header(ok.calls[1], "accept")).toBe("x");
    const bad = fakeFetch({ "https://acme.atlassian.net/a": () => new Response(null, { status: 301, headers: { location: "https://evil.com/" } }) });
    expect(await pluginFetch({ url: "https://acme.atlassian.net/a" }, opts(bad.fetch))).toMatchObject({ ok: false, reason: expect.stringMatching(/redirect/i) });
    expect(bad.calls).toHaveLength(1);
    const plain = fakeFetch({ "https://acme.atlassian.net/a": () => new Response(null, { status: 302, headers: { location: "http://acme.atlassian.net/b" } }) });
    expect(await pluginFetch({ url: "https://acme.atlassian.net/a" }, opts(plain.fetch))).toMatchObject({ ok: false, reason: expect.stringMatching(/redirect/i) });
    expect(plain.calls).toHaveLength(1);
  });

  it("keeps a secret header on a same-host redirect", async () => {
    const f = fakeFetch({
      "https://acme.atlassian.net/a": () => new Response(null, { status: 307, headers: { location: "/b?x=1" } }),
      "https://acme.atlassian.net/b?x=1": () => new Response("ok"),
    });
    expect(await pluginFetch({ url: "https://acme.atlassian.net/a", init: { headers: { authorization: "{{secret:jira}}" } } }, opts(f.fetch))).toMatchObject({ ok: true });
    expect(header(f.calls[1], "authorization")).toBe(SECRET);
  });

  it("never resends a body with a key to another host, and drops the body on 303", async () => {
    const cross = fakeFetch({ "https://acme.atlassian.net/a": () => new Response(null, { status: 308, headers: { location: "https://api.firehydrant.io/b" } }) });
    const r = await pluginFetch({ url: "https://acme.atlassian.net/a", init: { method: "POST", body: "{{secret:jira}}" } }, opts(cross.fetch));
    expect(r).toMatchObject({ ok: false, reason: expect.stringMatching(/redirect/i) });
    expect(cross.calls).toHaveLength(1);
    const see = fakeFetch({
      "https://acme.atlassian.net/a": () => new Response(null, { status: 303, headers: { location: "https://api.firehydrant.io/b" } }),
      "https://api.firehydrant.io/b": () => new Response("ok"),
    });
    const s = await pluginFetch({ url: "https://acme.atlassian.net/a", init: { method: "POST", body: "{{secret:jira}}", headers: { "content-type": "text/plain" } } }, opts(see.fetch));
    expect(s).toMatchObject({ ok: true });
    expect(see.calls[1].init.method).toBe("GET");
    expect(see.calls[1].init.body).toBeUndefined();
    expect(header(see.calls[1], "content-type")).toBeNull();
  });

  it("at most 5 redirects", async () => {
    const routes: Record<string, () => Response> = {};
    for (let i = 0; i < 7; i++) routes[`https://acme.atlassian.net/${i}`] = () => new Response(null, { status: 302, headers: { location: `/${i + 1}` } });
    const f = fakeFetch(routes);
    expect(await pluginFetch({ url: "https://acme.atlassian.net/0" }, opts(f.fetch))).toMatchObject({ ok: false, reason: expect.stringMatching(/redirects/) });
    expect(f.calls).toHaveLength(6);
  });

  it("caps the response at maxBytes and times out", async () => {
    const big = fakeFetch({ "https://acme.atlassian.net/big": () => new Response("x".repeat(2048)) });
    expect(await pluginFetch({ url: "https://acme.atlassian.net/big" }, opts(big.fetch, { maxBytes: 1024 }))).toMatchObject({ ok: false, reason: expect.stringMatching(/larger/) });
    const said = fakeFetch({ "https://acme.atlassian.net/big": () => new Response("x", { headers: { "content-length": "999999" } }) });
    expect(await pluginFetch({ url: "https://acme.atlassian.net/big" }, opts(said.fetch, { maxBytes: 1024 }))).toMatchObject({ ok: false, reason: expect.stringMatching(/larger/) });
    const slow = { fetch: ((_u: string, init: RequestInit) => new Promise((_, reject) => init.signal!.addEventListener("abort", () => reject(new Error("aborted"))))) as unknown as typeof fetch };
    expect(await pluginFetch({ url: "https://acme.atlassian.net/" }, opts(slow.fetch, { timeoutMs: 20 }))).toMatchObject({ ok: false, reason: expect.stringMatching(/took more than/) });
  });

  it("the run's signal aborts it", async () => {
    const run = new AbortController();
    const slow = { fetch: ((_u: string, init: RequestInit) => new Promise((_, reject) => init.signal!.addEventListener("abort", () => reject(new Error("aborted"))))) as unknown as typeof fetch };
    const p = pluginFetch({ url: "https://acme.atlassian.net/" }, opts(slow.fetch, { signal: run.signal }));
    run.abort();
    expect(await p).toMatchObject({ ok: false, reason: expect.stringMatching(/ended/) });
  });

  it("an error message never carries a secret", async () => {
    const f = { fetch: (async () => { throw new Error(`bad header value Bearer ${SECRET}`); }) as unknown as typeof fetch };
    const r = await pluginFetch({ url: "https://acme.atlassian.net/", init: { headers: { authorization: "Bearer {{secret:jira}}" } } }, opts(f.fetch));
    expect(r).toMatchObject({ ok: false });
    expect(JSON.stringify(r)).not.toContain(SECRET);
  });

  it("a key that can't go in a header is refused, without a throw or its length", async () => {
    const f = fakeFetch({});
    for (const value of ["tok-SECRET-1234\u0100", "tok-SECRET\n1234", "tok-SECRET-1234\u2028"]) {
      const r = await pluginFetch({ url: "https://acme.atlassian.net/", init: { headers: { authorization: "Bearer {{secret:jira}}" } } }, { ...opts(f.fetch), secrets: { jira: value } });
      expect(r).toEqual({ ok: false, reason: "The header authorization has a value that is not valid" });
    }
    expect(await pluginFetch({ url: "https://acme.atlassian.net/", init: { headers: { a: "x\u0100" } } }, opts(f.fetch))).toMatchObject({ ok: false });
    expect(f.calls).toEqual([]);
  });

  it("a redirect echoing the secret is redacted from the url too", async () => {
    const f = fakeFetch({
      "https://acme.atlassian.net/a": () => new Response(null, { status: 302, headers: { location: `/b?t=${SECRET}` } }),
      [`https://acme.atlassian.net/b?t=${SECRET}`]: () => new Response("ok", { headers: { [`x-${SECRET.toLowerCase()}`]: "1" } }),
    });
    const r = await pluginFetch({ url: "https://acme.atlassian.net/a", init: { headers: { authorization: "{{secret:jira}}" } } }, opts(f.fetch, { secrets: { jira: SECRET } }));
    expect(r).toMatchObject({ ok: true });
    expect(JSON.stringify(r)).not.toContain(SECRET);
  });

  it("refuses forbidden headers, bad names and values, methods and oversized input", async () => {
    const f = fakeFetch({});
    const u = "https://acme.atlassian.net/";
    for (const init of [
      { headers: { host: "evil.com" } },
      { headers: { "bad name": "x" } },
      { headers: { a: "x\r\ninjected: y" } },
      { headers: { a: 1 } },
      { method: "CONNECT" },
      { method: "GET", body: "x" },
      { body: "x".repeat(1024 * 1024 + 1), method: "POST" },
      { headers: Object.fromEntries(Array.from({ length: 51 }, (_, i) => [`h${i}`, "x"])) },
    ]) {
      expect(await pluginFetch({ url: u, init } as never, opts(f.fetch))).toMatchObject({ ok: false });
    }
    expect(await pluginFetch({ url: `${u}${"x".repeat(9000)}` }, opts(f.fetch))).toMatchObject({ ok: false });
    expect(await pluginFetch({ url: 42 } as never, opts(f.fetch))).toMatchObject({ ok: false });
    expect(f.calls).toEqual([]);
  });

  it("a host the address check refuses is never fetched, on any hop", async () => {
    const f = fakeFetch({ "https://acme.atlassian.net/a": () => new Response(null, { status: 302, headers: { location: "https://inner.atlassian.net/" } }) });
    const allowHost = async (h: string) => h !== "inner.atlassian.net";
    expect(await pluginFetch({ url: "https://acme.atlassian.net/a" }, opts(f.fetch, { allowHost }))).toMatchObject({ ok: false, reason: expect.stringMatching(/private/) });
    expect(f.calls).toHaveLength(1);
  });
});
