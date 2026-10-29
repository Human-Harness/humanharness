import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { ScopeStore } from "@humanharness/workspace";
import { engineApprovalTag, engineApprovalValid } from "../../src/main/engine-config/approval";
import { EngineHost } from "../../src/main/engine-config/engine-host";
import { EngineEpochs } from "../../src/main/engine-config/epochs";
import { type EngineConfigView, registerEngineIpc } from "../../src/main/engine-config/engine-ipc";

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "hh-engine-ipc-")));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

const harness = { permissions: { edit: "folder" as const, web: false }, actions: { review: {}, study: {} }, mcp: [] as string[] };
const NOW = new Date("2026-10-28T11:00:00.000Z");

let n = 0;
/** A base with scope `intro` registered, `files` under `.harness/engine/intro/`, `extra` at its top, the channels registered. */
async function setup(
  files: Record<string, string> | null,
  extra: Record<string, string> = {},
  o: { codex?: boolean; key?: boolean; profile?: string; hostProfile?: string; now?: () => Date; engine?: string } = {},
) {
  const at = path.join(root, `w${++n}`);
  const base = path.join(at, "folder");
  const userData = path.join(at, "userData");
  const dir = path.join(base, ".harness", "engine", "intro");
  fs.mkdirSync(base, { recursive: true });
  fs.mkdirSync(userData, { recursive: true });
  const write = (rel: string, data: string, from = dir) => {
    fs.mkdirSync(path.dirname(path.join(from, rel)), { recursive: true });
    fs.writeFileSync(path.join(from, rel), data);
  };
  if (files) {
    fs.mkdirSync(dir, { recursive: true });
    for (const [rel, data] of Object.entries(files)) write(rel, data);
  }
  for (const [rel, data] of Object.entries(extra)) write(rel, data, base);
  // The app's key: none until the first approval makes it (as linkedSecret(userData)(true) does).
  let key: Buffer | null = o.key === false ? null : randomBytes(32);
  const made = randomBytes(32);
  const secret = vi.fn(async () => (key ??= made));
  const epochs = new EngineEpochs(path.join(userData, "engine-epochs.json"));
  const scopes = new ScopeStore(base);
  await scopes.add({ id: "intro", title: "Intro", createdAt: "2026-10-28T09:00:00.000Z", archived: false });
  await scopes.add({ id: "old", title: "Old", createdAt: "2026-10-28T09:00:00.000Z", archived: true });
  const host = new EngineHost({
    userData,
    context: async () => ({ base, profile: o.hostProfile ?? o.profile ?? "", scopes }),
    linked: async () => [],
    secret: async () => key,
    epoch: (profile, scope) => epochs.get(profile, scope),
    harness,
    log: vi.fn(),
  });
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const send = vi.fn();
  const ipc = registerEngineIpc((channel, fn) => void handlers.set(channel, fn as (...args: unknown[]) => unknown), {
    current: (scope) => host.current(scope),
    store: async () => ({ store: scopes, profile: o.profile ?? "" }),
    secret,
    epochs,
    codexLimit: () => o.codex ?? false,
    activeEngine: async () => o.engine ?? "",
    send,
    now: o.now ?? (() => NOW),
  });
  const call = <T>(channel: string, ...args: unknown[]) => Promise.resolve(handlers.get(channel)!(...args)) as Promise<T>;
  const view = (...args: unknown[]) => call<EngineConfigView | null>("hh:engineConfig", ...(args.length > 0 ? args : ["intro"]));
  const approve = (scope: unknown, hash: unknown) => call<{ ok: boolean; reason?: string }>("hh:engineApprove", scope, hash);
  const revoke = (scope: unknown) => call<EngineConfigView | null>("hh:engineRevoke", scope);
  const entry = async () => (await scopes.list()).find((s) => s.id === "intro")!;
  return { base, dir, userData, scopes, host, handlers, send, secret, ipc, view, approve, revoke, entry, write, key: () => key };
}

const SERVER = JSON.stringify({ mcpServers: { lint: { command: "node", args: ["./tools/lint.js"] } } });
const SETTINGS = JSON.stringify({
  defaultMode: "bypassPermissions",
  hooks: { Stop: [{ hooks: [{ type: "command", command: 'node "$CLAUDE_PROJECT_DIR"/tools/stop.js' }] }], PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: 'node "$CLAUDE_PROJECT_DIR"/tools/stop.js --pre' }] }] },
  permissions: { allow: ["Bash(npm test)"] },
});
const TOOLS = { "tools/lint.js": "console.log('lint')", "tools/stop.js": "console.log('stop')" };
const FULL = {
  base: "global\n",
  "instructions.md": "Use tabs.\n",
  "mcp.json": SERVER,
  "settings.json": SETTINGS,
  "skills/fmt/SKILL.md": "---\nname: fmt\ndescription: Formats files\n---\nRun the formatter.\n",
  "agents/reviewer.md": "---\ndescription: Reviews changes\ntools: [Read, Grep]\npermissionMode: plan\n---\nYou review.\n",
  "codex.toml": 'model_verbosity = "low"\nhide_agent_reasoning = true\n',
  "actions/study/instructions.md": "Quiz me.",
  "actions/study/mcp.json": JSON.stringify({ mcpServers: { cards: { command: "node", args: ["./tools/lint.js", "--deck", "a"] } } }),
  "actions/study/settings.json": JSON.stringify({ permissions: { defaultMode: "plan", deny: ["Bash(git push:*)"] } }),
};

describe("engine IPC (E10)", () => {
  it("hh:engineConfig(scope) returns the view: base, codexLimit, hooks, servers, instructions, skills, agents (ignored keys), codex keys, actions, scripts, refusals, hash, approved", async () => {
    const w = await setup(FULL, TOOLS, { codex: true });
    const v = (await w.view())!;
    expect(v.scope).toBe("intro");
    expect(v.base).toBe("global");
    expect(v.codexLimit).toBe(true);
    expect(v.runsCommands).toEqual([
      { kind: "hook", label: "Stop", command: 'node "$CLAUDE_PROJECT_DIR"/tools/stop.js', args: [], layer: "", file: "settings.json" },
      { kind: "hook", label: "PreToolUse · Bash", command: 'node "$CLAUDE_PROJECT_DIR"/tools/stop.js --pre', args: [], layer: "", file: "settings.json" },
      { kind: "server", label: "scope-lint", command: "node", args: ["./tools/lint.js"], layer: "", file: "mcp.json" },
      { kind: "server", label: "scope-cards", command: "node", args: ["./tools/lint.js", "--deck", "a"], layer: "study", file: "actions/study/mcp.json" },
    ]);
    expect(v.instructions).toEqual([
      { layer: "", text: "Use tabs.\n" },
      { layer: "study", text: "Quiz me." },
    ]);
    expect(v.skills).toEqual([{ name: "fmt", description: "Formats files", allowedTools: [], files: [] }]);
    expect(v.agents).toEqual([{ name: "reviewer", description: "Reviews changes", ignored: ["permissionMode"], tools: ["Read", "Grep"] }]);
    expect(v.codexKeys).toEqual([
      { key: "model_verbosity", value: '"low"' },
      { key: "hide_agent_reasoning", value: "true" },
    ]);
    // The agent's ignored key is shown with the agent; the settings' (the scope's and the layer's) here.
    expect(v.ignored).toEqual(["settings.json: defaultMode", "actions/study/settings.json: permissions.defaultMode"]);
    expect(v.permissions).toEqual([
      { layer: "", allow: ["Bash(npm test)"], deny: [], ask: [] },
      { layer: "study", allow: [], deny: ["Bash(git push:*)"], ask: [] },
    ]);
    expect(v.scripts).toEqual([path.join(w.base, "tools/lint.js"), path.join(w.base, "tools/stop.js")]);
    expect(v.loadsOtherCode).toEqual([]);
    expect(v).not.toHaveProperty("changed");
    expect(v.refusals).toEqual([]);
    expect(v.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(v.approved).toBe(false);
    expect(v).not.toHaveProperty("approvedAt");
    // Plain data: it crosses the bridge by copy.
    expect(JSON.parse(JSON.stringify(v))).toEqual(v);

    // Without Codex among the harness's engines, no limit; no engine folder: null (D0 for the scope), nothing made.
    expect((await (await setup({ "instructions.md": "a" })).view())!.codexLimit).toBe(false);
    const none = await setup(null);
    expect(await none.view()).toBeNull();
    expect(fs.existsSync(path.join(none.base, ".harness", "engine"))).toBe(false);
    expect(await (await setup({})).view()).toBeNull();
  });

  it("runs-commands items come first (hooks and servers)", async () => {
    const w = await setup(FULL, TOOLS);
    const v = (await w.view())!;
    const keys = Object.keys(v);
    // The section shows them first: before the instructions, skills, agents and Codex keys.
    for (const later of ["instructions", "skills", "agents", "codexKeys", "ignored", "scripts"]) {
      expect(keys.indexOf("runsCommands"), later).toBeLessThan(keys.indexOf(later));
    }
    // Within it: the scope's own first (hooks, then servers), then each action layer's.
    expect(v.runsCommands.map((r) => [r.layer, r.kind])).toEqual([
      ["", "hook"],
      ["", "hook"],
      ["", "server"],
      ["study", "server"],
    ]);
  });

  it("hh:engineApprove approves only when the hash equals the one computed now", async () => {
    const w = await setup({ "instructions.md": "Use tabs.\n", "mcp.json": SERVER }, TOOLS);
    const shown = (await w.view())!.hash;
    // The folder changes after the screen showed it: that hash is stale.
    w.write("instructions.md", "Use spaces.\n");
    expect(await w.approve("intro", shown)).toEqual({ ok: false, reason: "changed" });
    expect((await w.entry()).engineApproval).toBeUndefined();
    // A referenced script is part of what was shown too.
    const current = (await w.view())!.hash;
    w.write("tools/lint.js", "console.log('changed')", w.base);
    expect(await w.approve("intro", current)).toEqual({ ok: false, reason: "changed" });
    expect((await w.entry()).engineApproval).toBeUndefined();

    const now = (await w.view())!.hash;
    const ok = await w.approve("intro", now);
    expect(ok).toMatchObject({ ok: true });
    const a = (await w.entry()).engineApproval!;
    expect(a).toEqual({ hash: now, at: NOW.toISOString(), tag: expect.stringMatching(/^[0-9a-f]{64}$/) });
    // Signed with the app's key: the host takes it, and the view says so.
    expect(engineApprovalValid(a, "", "intro", w.key())).toBe(true);
    expect(a.tag).toBe(engineApprovalTag("", "intro", a, w.key()!));
    const v = (await w.view())!;
    expect(v.approved).toBe(true);
    expect(v.approvedAt).toBe(NOW.toISOString());
    expect((await w.host.presetFor("intro", undefined)).preset?.hash).toBe(now);
  });

  it("approving makes the app's key when there is none yet, and an unsigned approval shows as not approved", async () => {
    const w = await setup({ "instructions.md": "a" }, {}, { key: false });
    const { hash } = (await w.view())!;
    // Pasted into scopes.json by hand (or by the agent): no tag of the app's, so not approved.
    await w.scopes.approveEngine("intro", hash, () => "0".repeat(64));
    expect((await w.view())!.approved).toBe(false);
    expect(await w.approve("intro", hash)).toMatchObject({ ok: true });
    expect(w.secret).toHaveBeenCalled();
    expect(w.key()).not.toBeNull();
    expect((await w.view())!.approved).toBe(true);
  });

  it("refuses an unknown scope (Object.hasOwn), an id over 64 chars, a non-hex hash, and a config with refusals", async () => {
    const w = await setup({ "instructions.md": "a" });
    const { hash } = (await w.view())!;
    for (const scope of ["nope", "old", "__proto__", "constructor", "toString", "a".repeat(65), "", 7, null, undefined, { id: "intro" }, "../intro"]) {
      await expect(w.view(scope), String(scope)).rejects.toThrow("Unknown scope");
      await expect(w.approve(scope, hash), String(scope)).rejects.toThrow("Unknown scope");
    }
    for (const bad of [hash.toUpperCase(), hash.slice(1), `${hash}0`, "", 42, null, undefined, ["a"]]) {
      await expect(w.approve("intro", bad), String(bad)).rejects.toThrow("Invalid engine config hash");
    }
    expect((await w.entry()).engineApproval).toBeUndefined();

    // A config with refusals is shown (with each one) but never approved, even with its own hash.
    const r = await setup({ "instructions.md": "a", "settings.json": JSON.stringify({ apiKeyHelper: "x" }) });
    const rv = (await r.view())!;
    expect(rv.refusals).toEqual([{ file: "settings.json", message: expect.stringContaining("apiKeyHelper") }]);
    expect(await r.approve("intro", rv.hash)).toEqual({ ok: false, reason: "refused" });
    expect((await r.entry()).engineApproval).toBeUndefined();
    expect(r.secret).not.toHaveBeenCalled();
    // A folder emptied since: nothing to approve.
    const e = await setup({ "instructions.md": "a" });
    const eh = (await e.view())!.hash;
    fs.rmSync(path.join(e.dir, "instructions.md"));
    expect(await e.approve("intro", eh)).toEqual({ ok: false, reason: "changed" });
  });

  it("approving notifies the window (engine config changed)", async () => {
    const w = await setup({ "instructions.md": "a" });
    const { hash } = (await w.view())!;
    expect(w.send).not.toHaveBeenCalled();
    await w.approve("intro", hash);
    expect(w.send).toHaveBeenCalledWith("hh:engineConfigChanged", "intro");
    // A refused or stale approval tells nothing.
    w.send.mockClear();
    await w.approve("intro", "0".repeat(64));
    expect(w.send).not.toHaveBeenCalled();
  });

  it("a commit that touches an engine folder tells the window which scope; others tell nothing", async () => {
    const w = await setup({ "instructions.md": "a" });
    w.ipc.committed(["notes/a.md", ".harness/context/intro.json"]);
    expect(w.send).not.toHaveBeenCalled();
    w.ipc.committed([".harness/engine/intro/mcp.json", ".harness/engine/intro/settings.json", ".harness/engine/other/base"]);
    expect(w.send.mock.calls).toEqual([
      ["hh:engineConfigChanged", "intro"],
      ["hh:engineConfigChanged", "other"],
    ]);
    // Too many paths to list (null), or the approvals file: any scope may have changed.
    w.send.mockClear();
    w.ipc.committed(null);
    w.ipc.committed([".harness/scopes.json"]);
    expect(w.send.mock.calls).toEqual([
      ["hh:engineConfigChanged", null],
      ["hh:engineConfigChanged", null],
    ]);
  });

  it("shows what each skill asks for, and the code its commands and scripts may load outside the approval", async () => {
    const w = await setup(
      {
        "skills/fmt/SKILL.md": "---\nname: fmt\ndescription: Formats files\nallowed-tools: Bash(npm run fmt), Read\nmodel: haiku\ncontext: fork\n---\nGo.\n",
        "skills/fmt/scripts/run.sh": "echo fmt\n",
        "skills/fmt/reference.md": "More.\n",
        "skills/peek/SKILL.md": "---\ndescription: Peeks\nallowed-tools: [Read, Grep]\n---\nGo.\n",
        "agents/helper.md": "---\ndescription: Helps\ntools: Read, Grep\nmodel: sonnet\nskills: [fmt]\nmemory: project\n---\nYou help.\n",
        "codex.toml": "hide_agent_reasoning = false\n",
        "mcp.json": JSON.stringify({
          mcpServers: { lint: { command: "node", args: ["./tools/lint.js"], env: { LOG_LEVEL: "debug" } }, fetch: { command: "uvx", args: ["mcp-fetch"] } },
        }),
        "settings.json": JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "command", command: "npx -y some-tool" }, { type: "command", command: 'node "$CLAUDE_PROJECT_DIR"/tools/stop.js' }] }] } }),
      },
      { "tools/lint.js": "const x = require('./helpers');", "tools/stop.js": "console.log('stop')" },
    );
    const v = (await w.view())!;
    expect(v.skills).toEqual([
      { name: "fmt", description: "Formats files", allowedTools: ["Bash(npm run fmt)", "Read"], files: ["reference.md", "scripts/run.sh"], model: "haiku", fork: true },
      { name: "peek", description: "Peeks", allowedTools: ["Read", "Grep"], files: [] },
    ]);
    expect(v.agents).toEqual([{ name: "helper", description: "Helps", ignored: [], tools: ["Read", "Grep"], model: "sonnet", skills: ["fmt"], memory: "project" }]);
    // Values shown: the screen says whether a switch is on or off.
    expect(v.codexKeys).toEqual([{ key: "hide_agent_reasoning", value: "false" }]);
    expect(v.runsCommands.find((r) => r.label === "scope-lint")!.env).toEqual({ LOG_LEVEL: "debug" });
    expect(v.runsCommands.find((r) => r.label === "scope-fetch")).not.toHaveProperty("env");
    expect(v.runsCommands.map((r) => [r.command, r.loadsOtherCode ?? false])).toEqual([
      ["npx -y some-tool", true],
      ['node "$CLAUDE_PROJECT_DIR"/tools/stop.js', false],
      ["node", false],
      ["uvx", true],
    ]);
    expect(v.loadsOtherCode).toEqual([path.join(w.base, "tools/lint.js")]);
  });

  it("an approval the folder no longer matches shows as changed", async () => {
    const w = await setup({ "instructions.md": "a" });
    const first = (await w.view())!;
    expect(await w.approve("intro", first.hash)).toMatchObject({ ok: true });
    w.write("instructions.md", "b");
    const v = (await w.view())!;
    expect(v.approved).toBe(false);
    expect(v.changed).toBe(true);
  });

  it("the view names the active engine (Decision 10), and none before one is chosen", async () => {
    expect((await (await setup({ "instructions.md": "a" }, {}, { engine: "opencode" })).view())!.engine).toBe("opencode");
    expect(await (await setup({ "instructions.md": "a" })).view()).not.toHaveProperty("engine");
  });

  it("approvals in a profile: signed for it, valid in it, never in another", async () => {
    const w = await setup({ "instructions.md": "a" }, {}, { profile: "work" });
    const { hash } = (await w.view())!;
    expect(await w.approve("intro", hash)).toMatchObject({ ok: true, view: { approved: true } });
    const a = (await w.entry()).engineApproval!;
    expect(engineApprovalValid(a, "work", "intro", w.key())).toBe(true);
    expect(engineApprovalValid(a, "", "intro", w.key())).toBe(false);
    expect((await w.host.presetFor("intro", undefined)).preset?.hash).toBe(hash);
    // The host checks with another profile than the one that signed: not approved, no preset.
    const m = await setup({ "instructions.md": "a" }, {}, { profile: "work", hostProfile: "home" });
    // Written, but the view (as the host reads it) says not approved.
    expect(await m.approve("intro", (await m.view())!.hash)).toMatchObject({ ok: true, view: { approved: false } });
    expect((await m.entry()).engineApproval).toBeDefined();
    expect((await m.view())!.approved).toBe(false);
    expect(await m.host.presetFor("intro", undefined)).toEqual({ preset: null, instructions: "", notice: "unapproved" });
  });

  it("two approvals at once run one after the other: the second sees the first's", async () => {
    let t = 0;
    const w = await setup({ "instructions.md": "a" }, {}, { now: () => new Date(Date.UTC(2026, 9, 28, 11, 0, ++t)) });
    const { hash } = (await w.view())!;
    // The first one's key read is slow: without the chain the second would write first and the first overwrite it.
    let release!: () => void;
    const slow = new Promise<void>((r) => (release = r));
    const key = await w.secret();
    w.secret.mockImplementationOnce(async () => {
      await slow;
      return key;
    });
    const first = w.approve("intro", hash);
    const second = w.approve("intro", hash);
    release();
    const [r1, r2] = await Promise.all([first, second]);
    expect(r1).toMatchObject({ ok: true, view: { approvedAt: "2026-10-28T11:00:01.000Z" } });
    expect(r2).toMatchObject({ ok: true, view: { approvedAt: "2026-10-28T11:00:02.000Z" } });
    expect((await w.entry()).engineApproval!.at).toBe("2026-10-28T11:00:02.000Z");
    expect((await w.view())!.approved).toBe(true);
  });

  it("hh:engineRevoke clears the approval for good: a replayed old approval gives no preset, approving again works", async () => {
    const w = await setup({ "instructions.md": "Use tabs.\n", "mcp.json": SERVER }, TOOLS);
    const { hash } = (await w.view())!;
    await w.approve("intro", hash);
    const old = (await w.entry()).engineApproval!;
    expect((await w.host.presetFor("intro", undefined)).preset?.hash).toBe(hash);
    // Approving made no revocation record: approvals made before epochs keep their tag (epoch 0).
    const record = path.join(w.userData, "engine-epochs.json");
    expect(fs.existsSync(record)).toBe(false);
    const task = { id: "t1", scope: "intro", engineHash: hash, engineTag: (await w.host.pinTag("intro", "t1", hash))! };
    expect((await w.host.presetForTask(task)).preset?.hash).toBe(hash);

    w.send.mockClear();
    const v = (await w.revoke("intro"))!;
    expect(v.approved).toBe(false);
    expect(v).not.toHaveProperty("changed");
    expect((await w.entry()).engineApproval).toBeUndefined();
    expect(w.send).toHaveBeenCalledWith("hh:engineConfigChanged", "intro");
    expect(fs.existsSync(record)).toBe(true);
    // A running task loses the preset from its next turn.
    expect(await w.host.presetForTask(task)).toEqual({ preset: null, instructions: "", notice: "unapproved" });

    // The agent pastes the old signed approval back into scopes.json: not the app's any more.
    await w.scopes.approveEngine("intro", old.hash, () => old.tag, new Date(old.at));
    expect((await w.entry()).engineApproval).toEqual(old);
    expect((await w.view())!.approved).toBe(false);
    expect(await w.host.presetFor("intro", undefined)).toEqual({ preset: null, instructions: "", notice: "unapproved" });
    expect((await w.host.presetForTask(task)).preset).toBeNull();

    // Approving again signs at the new epoch and works; the pin made before the revoke stays void, a new one holds.
    expect(await w.approve("intro", hash)).toMatchObject({ ok: true, view: { approved: true } });
    expect((await w.host.presetFor("intro", undefined)).preset?.hash).toBe(hash);
    expect((await w.host.presetForTask(task)).preset).toBeNull();
    const repinned = { ...task, engineTag: (await w.host.pinTag("intro", "t1", hash))! };
    expect((await w.host.presetForTask(repinned)).preset?.hash).toBe(hash);
  });

  it("hh:engineRevoke checks the scope, and runs after an approval in flight", async () => {
    const w = await setup({ "instructions.md": "a" });
    // "old" is archived: revoking it is allowed (below).
    for (const scope of ["nope", "__proto__", "a".repeat(65), 7, null]) {
      await expect(w.revoke(scope), String(scope)).rejects.toThrow("Unknown scope");
    }
    const { hash } = (await w.view())!;
    const [approved, revoked] = await Promise.all([w.approve("intro", hash), w.revoke("intro")]);
    expect(approved).toMatchObject({ ok: true });
    expect(revoked!.approved).toBe(false);
    expect((await w.entry()).engineApproval).toBeUndefined();
    // An archived scope can't be approved but can be revoked: its approval must not come back on unarchive.
    await w.scopes.add({ id: "shelf", title: "Shelf", createdAt: "2026-10-28T09:00:00.000Z", archived: false });
    await w.scopes.approveEngine("shelf", hash, () => "0".repeat(64));
    await w.scopes.setArchived("shelf", true);
    await expect(w.approve("shelf", hash)).rejects.toThrow("Unknown scope");
    expect(await w.revoke("shelf")).toBeNull();
    expect((await w.scopes.list()).find((s) => s.id === "shelf")!.engineApproval).toBeUndefined();
    // No engine folder: nothing to show, the record still bumped.
    const none = await setup(null);
    expect(await none.revoke("intro")).toBeNull();
  });
});
