import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";
import { type FixtureExchange, fixtureTransport, matchFixture, parseFixture, stripSecrets } from "../src/plugin-fixtures";

const fx = (url: string, text = "{}", method = "GET"): FixtureExchange => ({ kind: "fetch", request: { method, url }, response: { status: 200, headers: { "content-type": "application/json" }, text } });
const runOpts = { cwd: "/x", env: {}, timeoutMs: 1000, maxBytes: 1000 };

describe("matchFixture (Decision 14)", () => {
  it.each([
    ["exact", "https://a.example/x/y", "https://a.example/x/y", true],
    ["* segment", "https://a.example/d/*/*", "https://a.example/d/10/27", true],
    ["* is one segment only", "https://a.example/d/*", "https://a.example/d/10/27", false],
    ["host differs", "https://a.example/x", "https://b.example/x", false],
    ["host case", "https://A.example/x", "https://a.example/x", true],
    ["query must match", "https://a.example/x?a=1", "https://a.example/x?a=2", false],
    ["query wildcard", "https://a.example/x?*", "https://a.example/x?a=2", true],
    ["no regex from fixture text", "https://a.example/.*", "https://a.example/abc", false],
  ])("%s", (_n, fixture, url, hit) => expect(matchFixture(fx(fixture), { kind: "fetch", method: "GET", url })).toBe(hit));
  it("method must match", () => expect(matchFixture(fx("https://a.example/x", "{}", "POST"), { kind: "fetch", method: "GET", url: "https://a.example/x" })).toBe(false));
  it("exec: cmd and args token by token, * one token", () => {
    const e: FixtureExchange = { kind: "exec", request: { cmd: "gh", args: ["api", "*"] }, response: { code: 0, stdout: "[]", stderr: "" } };
    expect(matchFixture(e, { kind: "exec", cmd: "gh", args: ["api", "repos/x"] })).toBe(true);
    expect(matchFixture(e, { kind: "exec", cmd: "gh", args: ["api", "a", "b"] })).toBe(false);
    expect(matchFixture(e, { kind: "exec", cmd: "git", args: ["api", "a"] })).toBe(false);
  });
});

describe("fixtureTransport (P10)", () => {
  it("plays exchanges in order, wraps around, and refuses a request with no fixture — never the network", async () => {
    const t = fixtureTransport([fx("https://a.example/1", '"one"'), fx("https://a.example/1", '"two"')]);
    const asFetch: typeof fetch = t.fetch; // the broker takes it in place of the global fetch
    expect(asFetch).toBe(t.fetch);
    expect(await (await t.fetch("https://a.example/1")).text()).toBe('"one"');
    expect(await (await t.fetch("https://a.example/1")).text()).toBe('"two"');
    expect(await (await t.fetch("https://a.example/1")).text()).toBe('"one"');
    await expect(t.fetch("https://a.example/2")).rejects.toThrow("No fixture for GET https://a.example/2");
  });
  it("takes the method from init, and answers a body-less status without a body", async () => {
    const t = fixtureTransport([{ kind: "fetch", request: { method: "POST", url: "https://a.example/x" }, response: { status: 204, headers: {}, text: "" } }]);
    const res = await t.fetch("https://a.example/x", { method: "post", headers: { a: "b" }, body: "{}", redirect: "manual" });
    expect(res.status).toBe(204);
    await expect(t.fetch("https://a.example/x")).rejects.toThrow("No fixture for GET");
  });
  it("exec returns the recorded result; an unknown command is refused", async () => {
    const t = fixtureTransport([{ kind: "exec", request: { cmd: "date", args: [] }, response: { code: 0, stdout: "Mon\n", stderr: "" } }]);
    expect(await t.run("/bin/date", [], runOpts)).toMatchObject({ code: 0, stdout: "Mon\n" });
    await expect(t.run("/usr/bin/id", [], runOpts)).rejects.toThrow(/No fixture/);
  });
  it("parseFixture refuses unknown keys, huge texts and statuses a Response can't carry", () => {
    expect(() => parseFixture({ ...fx("https://a.example/"), extra: 1 })).toThrow();
    expect(() => parseFixture(fx("https://a.example/", "x".repeat(10 * 1024 * 1024 + 1)))).toThrow();
    expect(() => parseFixture({ ...fx("https://a.example/"), response: { status: 101, headers: {}, text: "" } })).toThrow();
  });
});

describe("stripSecrets (P11)", () => {
  const secrets = { jira: "s3cr3t+/=x" };
  it("replaces raw, URL-encoded and base64 forms anywhere in the exchange", () => {
    const out = stripSecrets(
      {
        kind: "fetch",
        request: { method: "GET", url: "https://a.example/?t=s3cr3t%2B%2F%3Dx", headers: { authorization: `Basic ${Buffer.from("me:s3cr3t+/=x").toString("base64")}`, "x-token": "s3cr3t+/=x" } },
        response: { status: 200, headers: {}, text: "echo s3cr3t+/=x" },
      },
      secrets,
    );
    const text = JSON.stringify(out.exchange);
    expect(text).not.toContain("s3cr3t");
    expect(text).not.toContain(Buffer.from("s3cr3t+/=x").toString("base64").slice(0, 8));
    expect(out.exchange.request).toMatchObject({ headers: { "x-token": "{{secret:jira}}" } });
    expect(out.leaked).toEqual([]);
  });
  it("reports a secret it can't strip (e.g. base64 at an odd offset) so the caller writes nothing", () => {
    const odd = Buffer.from("xx" + "s3cr3t+/=x").toString("base64");
    expect(stripSecrets({ kind: "fetch", request: { method: "GET", url: "https://a.example/" }, response: { status: 200, headers: {}, text: odd } }, secrets).leaked).toEqual(["jira"]);
  });
  it("strips lower-case and form URL encoding; reports mixed-case escapes and base64 starting inside a longer token", () => {
    const b64 = Buffer.from("s3cr3t+/=x is the key").toString("base64");
    const exchange = (text: string): FixtureExchange => ({ kind: "fetch", request: { method: "GET", url: "https://a.example/" }, response: { status: 200, headers: {}, text } });
    expect(stripSecrets(exchange(`abc${b64}`), secrets).leaked).toEqual(["jira"]);
    expect(stripSecrets(exchange("t=s3cr3t%2b%2f%3dx"), secrets)).toMatchObject({ exchange: { response: { text: "t={{secret:jira}}" } }, leaked: [] });
    expect(stripSecrets(exchange("t=s3cr3t%2B%2f%3Dx"), secrets).leaked).toEqual(["jira"]);
    const spaced = { jira: "a b+c d" };
    const form = new URLSearchParams({ t: "a b+c d" }).toString();
    const out = stripSecrets(exchange(form), spaced);
    expect(JSON.stringify(out.exchange)).not.toContain("a+b");
    expect(out.leaked).toEqual([]);
  });
  it("a key holding JSON-escaped characters is stripped too", () => {
    const out = stripSecrets(fx("https://a.example/", 'tok "q\\uote" end'), { k: 'tok "q\\uote"' });
    expect(out.exchange).toMatchObject({ response: { text: "{{secret:k}} end" } });
    expect(out.leaked).toEqual([]);
  });
  it("a short key is stripped as well, never skipped", () => {
    const out = stripSecrets(fx("https://a.example/", "pin=4x2 ok"), { pin: "4x2" });
    expect(JSON.stringify(out.exchange)).not.toContain("4x2");
    expect(out.leaked).toEqual([]);
  });
});
