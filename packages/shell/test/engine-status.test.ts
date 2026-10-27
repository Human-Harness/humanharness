import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { NOTICE_VERSION, getEngine } from "@humanharness/engines";
import type { CommandDeps } from "../src/main/engine-command";
import { countProviders, detectEngine, hasAcceptedNotice, parseLoggedIn } from "../src/main/engine-status";
import { SharedConfigStore } from "../src/main/shared-config";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "hh-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
const store = () => new SharedConfigStore(fs.mkdtempSync(path.join(root, "s-")));

type Reply = { stdout?: string; code?: number; timedOut?: boolean; spawnError?: boolean };

/** Fake commands answered by their args (bundled `.js` entries left out); the login shell gives /usr/bin. */
function deps(replies: Record<string, Reply>, overrides: Partial<CommandDeps> = {}) {
  const calls: { cmd: string; args: string[]; env?: Record<string, string> }[] = [];
  const d: CommandDeps = {
    shell: "/bin/zsh",
    home: "/Users/me",
    run: async (cmd, args, env) => {
      if (cmd === "/bin/zsh") return { stdout: "/usr/bin", code: 0 };
      calls.push({ cmd, args, env });
      const reply = replies[args.filter((a) => !a.endsWith(".js")).join(" ")];
      return { stdout: reply?.stdout ?? "", code: reply?.code ?? 1, ...(reply?.timedOut ? { timedOut: true } : {}), ...(reply?.spawnError ? { spawnError: true } : {}) };
    },
    isExecutable: async (p) => p === "/Users/me/.local/bin/claude",
    electronPath: "/App/Electron",
    resolveModule: () => {
      throw new Error("not bundled");
    },
    ...overrides,
  };
  return { d, calls };
}

const signedIn = JSON.stringify({ loggedIn: true, authMethod: "claude.ai", email: "someone@example.com", subscriptionType: "max" });
const signedOut = JSON.stringify({ loggedIn: false, authMethod: "none", apiProvider: "firstParty" });

describe("parseLoggedIn", () => {
  it("reads only the loggedIn flag from JSON, or the exit code", () => {
    expect(parseLoggedIn("json-logged-in", { stdout: signedIn, code: 0 })).toBe(true);
    expect(parseLoggedIn("json-logged-in", { stdout: signedOut, code: 1 })).toBe(false);
    expect(parseLoggedIn("exit-code", { stdout: "", code: 0 })).toBe(true);
    expect(parseLoggedIn("exit-code", { stdout: "", code: 1 })).toBe(false);
  });

  it("reads the last JSON block when the CLI prints something before it", () => {
    const nested = JSON.stringify({ loggedIn: true, org: { id: "x" } });
    expect(parseLoggedIn("json-logged-in", { stdout: `Warning: {odd} text\n${nested}\n`, code: 0 })).toBe(true);
    expect(parseLoggedIn("json-logged-in", { stdout: `Notice\n${signedOut}`, code: 1 })).toBe(false);
  });

  it("falls back to the exit code when there is no usable JSON", () => {
    expect(parseLoggedIn("json-logged-in", { stdout: "not json", code: 0 })).toBe(true);
    expect(parseLoggedIn("json-logged-in", { stdout: "not json", code: 1 })).toBe(false);
  });
});

describe("detectEngine", () => {
  it("reports a ready Claude and remembers its path and version, never the account", async () => {
    const s = store();
    await s.update("claude", { notice: { version: NOTICE_VERSION, acceptedAt: "t" }, verifiedAt: "t" });
    const { d } = deps({ "--version": { stdout: "2.1.296 (Claude Code)\n", code: 0 }, "auth status --json": { stdout: signedIn, code: 0 } });
    expect(await detectEngine(getEngine("claude"), d, s)).toEqual({
      engineId: "claude",
      installed: true,
      version: "2.1.296",
      minVersion: "2.1.296",
      outdated: false,
      loggedIn: true,
      noticeAccepted: true,
      verified: true,
    });
    const saved = JSON.stringify(await s.load());
    expect(saved).toContain("/Users/me/.local/bin/claude");
    expect(saved).not.toContain("someone@example.com");
  });

  it("reports a signed-out Claude as not verified and not accepted", async () => {
    const s = store();
    await s.update("claude", { verifiedAt: "t" });
    const { d } = deps({ "--version": { stdout: "2.1.296 (Claude Code)", code: 0 }, "auth status --json": { stdout: signedOut, code: 1 } });
    expect(await detectEngine(getEngine("claude"), d, s)).toMatchObject({ loggedIn: false, verified: false, noticeAccepted: false });
  });

  it("flags an outdated Claude without checking the session", async () => {
    const { d, calls } = deps({ "--version": { stdout: "2.1.200 (Claude Code)", code: 0 } });
    expect(await detectEngine(getEngine("claude"), d, store())).toMatchObject({ installed: true, version: "2.1.200", outdated: true, loggedIn: null });
    expect(calls.map((c) => c.args.join(" "))).toEqual(["--version"]);
  });

  it("reports a missing Claude as not installed", async () => {
    const missing = deps({}, { isExecutable: async () => false });
    expect(await detectEngine(getEngine("claude"), missing.d, store())).toMatchObject({ installed: false, version: null, loggedIn: null });
    expect(missing.calls).toEqual([]);
  });

  it("keeps a Claude whose --version fails or times out as installed, with an unknown version", async () => {
    const broken = deps({ "--version": { code: 1 }, "auth status --json": { stdout: signedIn, code: 0 } });
    expect(await detectEngine(getEngine("claude"), broken.d, store())).toMatchObject({
      installed: true,
      version: null,
      outdated: false,
      loggedIn: true,
    });
  });

  it("checks Codex through the bundled CLI under Electron's Node", async () => {
    const { d, calls } = deps(
      { "--version": { stdout: "codex-cli 0.160.1", code: 0 }, "login status": { code: 1 } },
      { resolveModule: (id, from) => (from ? "/app/codex.js" : "/app/acp.js") },
    );
    expect(await detectEngine(getEngine("codex"), d, store())).toMatchObject({ installed: true, version: "0.160.1", loggedIn: false });
    expect(calls[0]).toMatchObject({ cmd: "/App/Electron", args: ["/app/codex.js", "--version"], env: { ELECTRON_RUN_AS_NODE: "1" } });
  });

  it("forgets an installed CLI's path once the bundled one is used", async () => {
    const s = store();
    await s.update("codex", { binary: "/opt/homebrew/bin/codex", version: "0.150.0" });
    const { d } = deps({ "--version": { stdout: "codex-cli 0.160.1", code: 0 }, "login status": { code: 0 } }, { resolveModule: (id, from) => (from ? "/app/codex.js" : "/app/acp.js") });
    await detectEngine(getEngine("codex"), d, s);
    expect(await s.engine("codex")).toEqual({ version: "0.160.1" });
  });

  it("reports the session as unknown, not signed out, when the status check times out or can't start", async () => {
    const s = store();
    await s.update("claude", { verifiedAt: "t" });
    for (const fault of [{ timedOut: true }, { spawnError: true }]) {
      const { d } = deps({ "--version": { stdout: "2.1.296", code: 0 }, "auth status --json": { code: 1, ...fault } });
      expect(await detectEngine(getEngine("claude"), d, s)).toMatchObject({ installed: true, loggedIn: null, verified: true });
    }
  });

  it("asks for the notice again after its version changes", async () => {
    const s = store();
    await s.update("claude", { notice: { version: NOTICE_VERSION - 1, acceptedAt: "t" } });
    const { d } = deps({ "--version": { stdout: "2.1.296", code: 0 }, "auth status --json": { stdout: signedIn, code: 0 } });
    expect((await detectEngine(getEngine("claude"), d, s)).noticeAccepted).toBe(false);
  });
});

const fixture = (name: string) => fs.readFileSync(path.join(__dirname, "fixtures", name), "utf8");

describe("countProviders (opencode-auth-list)", () => {
  it("counts the providers OpenCode 1.x lists, in both sections", () => {
    expect(countProviders(fixture("opencode-auth-list-one.txt"))).toBe(2);
    expect(countProviders(fixture("opencode-auth-list-empty.txt"))).toBe(0);
  });

  it("ignores colours (printed even when piped) and unknown lines", () => {
    expect(countProviders("\u001b[34m●\u001b[39m  OpenRouter \u001b[90mapi\u001b[0m\n")).toBe(1);
    expect(countProviders("\u001b[90m│\u001b[0m\n\u001b[34m●\u001b[39m  Anthropic \u001b[90mANTHROPIC_API_KEY\n")).toBe(1);
    expect(countProviders("something else\n")).toBe(0);
    expect(countProviders("")).toBe(0);
  });

  it("counts the integrations of OpenCode 2.x's JSON, and none in its empty answers", () => {
    expect(countProviders(fixture("opencode-auth-list-v2.json"))).toBe(2);
    expect(countProviders(fixture("opencode-auth-list-v2-empty.json"))).toBe(0);
    expect(countProviders("No authenticated integrations\n")).toBe(0);
    expect(countProviders('[{"id":"x","connections":[]}]')).toBe(0);
    expect(countProviders("[not json")).toBe(0);
  });
});

describe("parseLoggedIn: opencode-auth-list", () => {
  it("is signed in with a provider, signed out without one or on a failure", () => {
    expect(parseLoggedIn("opencode-auth-list", { stdout: fixture("opencode-auth-list-one.txt"), code: 0 })).toBe(true);
    expect(parseLoggedIn("opencode-auth-list", { stdout: fixture("opencode-auth-list-v2.json"), code: 0 })).toBe(true);
    expect(parseLoggedIn("opencode-auth-list", { stdout: fixture("opencode-auth-list-empty.txt"), code: 0 })).toBe(false);
    expect(parseLoggedIn("opencode-auth-list", { stdout: fixture("opencode-auth-list-v2-empty.json"), code: 0 })).toBe(false);
    expect(parseLoggedIn("opencode-auth-list", { stdout: fixture("opencode-auth-list-one.txt"), code: 1 })).toBe(false);
  });
});

describe("detectEngine: OpenCode", () => {
  const opencode = getEngine("opencode");
  const opencodeDeps = (version: string, replies: Record<string, Reply>) =>
    deps({ "--version": { stdout: `${version}\n`, code: 0 }, ...replies }, { isExecutable: async (p) => p === "/Users/me/.local/bin/opencode" });
  const v1 = (list: string) => opencodeDeps("1.19.4", { "auth list": { stdout: list, code: 0 } });

  it("is ready with a provider", async () => {
    const { d, calls } = v1(fixture("opencode-auth-list-one.txt"));
    expect(await detectEngine(opencode, d, store())).toMatchObject({ installed: true, loggedIn: true });
    expect(calls.map((c) => c.args.join(" "))).toEqual(["--version", "auth list"]);
  });

  it("asks OpenCode 2.x for JSON and reads it", async () => {
    const one = opencodeDeps("2.0.1", { "auth list --format json": { stdout: fixture("opencode-auth-list-v2.json"), code: 0 } });
    expect(await detectEngine(opencode, one.d, store())).toMatchObject({ installed: true, version: "2.0.1", loggedIn: true });
    expect(one.calls.map((c) => c.args.join(" "))).toEqual(["--version", "auth list --format json"]);
    const none = opencodeDeps("2.0.1", { "auth list --format json": { stdout: fixture("opencode-auth-list-v2-empty.json"), code: 0 } });
    expect(await detectEngine(opencode, none.d, store())).toMatchObject({ loggedIn: false, verified: false });
  });

  it("asks to choose a provider when none is listed and no test prompt worked", async () => {
    const { d } = v1(fixture("opencode-auth-list-empty.txt"));
    expect(await detectEngine(opencode, d, store())).toMatchObject({ installed: true, loggedIn: false, verified: false });
  });

  it("counts a past test prompt as set up (local models only)", async () => {
    const s = store();
    await s.update("opencode", { verifiedAt: "2026-10-27T10:00:00.000Z" });
    const { d } = v1(fixture("opencode-auth-list-empty.txt"));
    expect(await detectEngine(opencode, d, s)).toMatchObject({ installed: true, loggedIn: null, verified: true });
  });

  it("keeps Claude's and Codex's answers as they were (D0)", async () => {
    const s = store();
    await s.update("claude", { verifiedAt: "2026-10-27T10:00:00.000Z" });
    const { d, calls } = deps({ "--version": { stdout: "2.1.296 (Claude Code)", code: 0 }, "auth status --json": { stdout: signedOut, code: 1 } });
    expect(await detectEngine(getEngine("claude"), d, s)).toMatchObject({ loggedIn: false, verified: false });
    expect(calls.map((c) => c.args.join(" "))).toEqual(["--version", "auth status --json"]);
  });
});

describe("hasAcceptedNotice", () => {
  it("is true only for the current notice version, and false again after a reset", async () => {
    const shared = store();
    expect(await hasAcceptedNotice(shared, "claude")).toBe(false);
    await shared.update("claude", { notice: { version: NOTICE_VERSION - 1, acceptedAt: "t" } });
    expect(await hasAcceptedNotice(shared, "claude")).toBe(false);
    await shared.update("claude", { notice: { version: NOTICE_VERSION, acceptedAt: "t" } });
    expect(await hasAcceptedNotice(shared, "claude")).toBe(true);
    await shared.reset();
    expect(await hasAcceptedNotice(shared, "claude")).toBe(false);
  });
});
