import { promises as fs } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { PluginReview } from "@humanharness/ui/client";
import { type Ctx, HIDDEN, QUEUES, TEAM, bundled, files, setup, tmp, until, writePlugin } from "./plugins-fixtures";


describe("PluginsController D0", () => {
  it("a harness without plugins loads nothing, starts nothing, writes nothing", async () => {
    const t = await setup();
    await t.ctl.start();
    expect(await t.ctl.view()).toEqual({ local: false, plugins: [] });
    expect(await t.ctl.sentences()).toEqual([]);
    expect(t.ctl.agentCatalogue()).toEqual([]);
    expect(await t.ctl.attention.view()).toEqual({ items: [], badge: 0, show: false });
    expect(t.host.start).not.toHaveBeenCalled();
    expect(t.deps.changed).not.toHaveBeenCalled();
    expect(await files(t.base)).toEqual([]);
    expect(await files(t.shared)).toEqual([]);
    expect(await files(t.userData)).toEqual([]);
  });

  it("plugins accepted (local) but none added: same", async () => {
    const t = await setup({ plugins: { bundled: [], on: [], local: true } });
    await t.ctl.start();
    expect(await t.ctl.view()).toEqual({ local: true, plugins: [] });
    expect(await t.ctl.attention.view()).toEqual({ items: [], badge: 0, show: false });
    expect(t.host.start).not.toHaveBeenCalled();
    expect(await files(t.base)).toEqual([]);
    expect(await files(t.shared)).toEqual([]);
    expect(t.deps.refreshInstructions).not.toHaveBeenCalled();
  });

  it("a bundled plugin not in plugins.on stays off and writes nothing", async () => {
    const t = await setup({ plugins: { bundled: ["oncall"], on: [], local: false } });
    await bundled(t.root, "oncall");
    await t.ctl.start();
    expect((await t.ctl.view()).plugins).toMatchObject([{ id: "oncall", status: "off", origin: "bundled" }]);
    expect(t.host.start).not.toHaveBeenCalled();
    expect(await files(t.base)).toEqual([]);
    expect(await files(t.shared)).toEqual([]);
  });
});

describe("PluginsController: starting and reviews", () => {
  it("a bundled plugin in plugins.on starts, takes its snapshot, syncs once, and its data lands in plugin-data", async () => {
    const ran: string[] = [];
    const t = await setup({
      plugins: { bundled: ["oncall"], on: ["oncall"], local: false },
      backends: { oncall: { s: async (ctx) => (ran.push("s"), void (await ctx.data.put("queues", { key: "a", n: 1 }))) } },
    });
    await bundled(t.root, "oncall", { data: { queues: QUEUES } });
    await t.ctl.start();
    expect(t.host.started).toEqual(["oncall"]);
    await until(async () => (await files(t.base)).length > 0);
    expect(ran).toEqual(["s"]);
    expect(await files(t.base)).toContain(path.join(".harness", "plugin-data", "oncall", "_app", "queues.json"));
    // The approval lives in the app's folder, never in the base (B8).
    expect((await files(t.appDir)).some((f) => f.startsWith("plugin-state"))).toBe(true);
    expect((await t.ctl.view()).plugins[0]).toMatchObject({ status: "on" });
  });

  it("a local plugin: pick → review and token; add → off; approve → on; duplicates and reused tokens refused", async () => {
    const t = await setup({ plugins: { bundled: [], on: [], local: true } });
    const folder = path.dirname(await writePlugin(await tmp(), "mine", { permissions: { hosts: ["api.example.com"] } }));
    t.deps.pickFolder.mockResolvedValue(folder);
    await t.ctl.start();
    const pick = await t.ctl.pick();
    expect(pick).toMatchObject({ ok: true, review: { id: "mine", lines: [{ kind: "hosts", hosts: ["api.example.com"] }] } });
    const token = (pick as { token: string }).token;
    expect(token).toMatch(/^[0-9a-f]{32}$/);
    expect(await t.ctl.add(token)).toEqual({ ok: true });
    expect(await t.ctl.add(token)).toMatchObject({ ok: false });
    expect((await t.ctl.view()).plugins).toMatchObject([{ id: "mine", status: "off", origin: "local", folder }]);
    expect(t.host.start).not.toHaveBeenCalled();
    expect(await t.ctl.pick()).toMatchObject({ ok: false, message: expect.stringMatching(/already/) });
    expect(await t.ctl.approve("mine", (pick as { review: PluginReview }).review.distHash)).toEqual({ ok: true });
    expect(t.host.started).toEqual(["mine"]);
    expect((await t.ctl.view()).plugins[0].status).toBe("on");
  });

  it("pick: cancelled, no plugin.json, or a harness that takes no local plugins", async () => {
    const t = await setup({ plugins: { bundled: [], on: [], local: true } });
    expect(await t.ctl.pick()).toEqual({ ok: false, cancelled: true });
    t.deps.pickFolder.mockResolvedValue(await tmp());
    expect(await t.ctl.pick()).toMatchObject({ ok: false, message: expect.any(String) });
    const u = await setup({ plugins: { bundled: ["x"], on: [], local: false } });
    expect(await u.ctl.pick()).toMatchObject({ ok: false });
    expect(u.deps.pickFolder).not.toHaveBeenCalled();
  });

  it("B8: a dist that adds a host turns the plugin off for review; approve turns it on; code-only stays on, updated until detail", async () => {
    const t = await setup({ plugins: { bundled: ["oncall"], on: ["oncall"], local: false } });
    const dist = await bundled(t.root, "oncall", { permissions: { hosts: ["a.example.com"] } });
    await t.ctl.start();
    const manifest = JSON.parse(await fs.readFile(path.join(dist, "plugin.json"), "utf8"));
    await fs.writeFile(path.join(dist, "plugin.json"), JSON.stringify({ ...manifest, permissions: { hosts: ["a.example.com", "evil.example.org"] } }));
    const v = await t.ctl.rescan();
    expect(v.plugins[0]).toMatchObject({ status: "review" });
    expect(t.host.stopped).toEqual(["oncall"]);
    const asked = await t.ctl.setOn("oncall", true);
    expect(asked).toMatchObject({ ok: false, review: { added: [{ kind: "host", value: "evil.example.org" }] } });
    expect(await t.ctl.approve("oncall", (asked as { review: PluginReview }).review.distHash)).toEqual({ ok: true });
    expect((await t.ctl.view()).plugins[0].status).toBe("on");
    await fs.writeFile(path.join(dist, "backend.js"), "export default { sources: { s: async () => { /* v2 */ } } };\n");
    const v2 = await t.ctl.rescan();
    expect(v2.plugins[0]).toMatchObject({ status: "on", updated: true });
    await t.ctl.detail("oncall");
    expect((await t.ctl.view()).plugins[0].updated).toBeUndefined();
  });

  it("B8: approve carries the hash the review showed; a plugin.json widened after the review is refused", async () => {
    const t = await setup({ plugins: { bundled: ["oncall"], on: ["oncall"], local: false } });
    const dist = await bundled(t.root, "oncall", { permissions: { hosts: ["a.example.com"] } });
    await t.ctl.start();
    const manifest = JSON.parse(await fs.readFile(path.join(dist, "plugin.json"), "utf8"));
    const widen = async (hosts: string[]) => {
      await fs.writeFile(path.join(dist, "plugin.json"), JSON.stringify({ ...manifest, permissions: { hosts } }));
      await t.ctl.rescan();
    };
    await widen(["a.example.com", "b.example.org"]);
    const shown = (await t.ctl.setOn("oncall", true)) as { review: PluginReview };
    expect(shown.review.distHash).toMatch(/^[0-9a-f]{64}$/);
    // Between the review and the click the plugin asks for more.
    await widen(["a.example.com", "b.example.org", "evil.example.org"]);
    // Refused with the current review (its hash and what it adds) so the renderer replaces the stale one.
    const refused = (await t.ctl.approve("oncall", shown.review.distHash)) as { ok: false; message: string; review: PluginReview };
    expect(refused).toMatchObject({ ok: false, message: "This plugin changed; review it again" });
    expect(refused.review.distHash).toMatch(/^[0-9a-f]{64}$/);
    expect(refused.review.distHash).not.toBe(shown.review.distHash);
    expect(refused.review.added).toContainEqual({ kind: "host", value: "evil.example.org" });
    expect(await t.ctl.approve("oncall", undefined as unknown as string)).toMatchObject({ ok: false });
    expect(t.host.started).toEqual(["oncall"]);
    expect((await t.ctl.view()).plugins[0].status).toBe("review");
    const again = (await t.ctl.setOn("oncall", true)) as { review: PluginReview };
    expect(again.review.added).toContainEqual({ kind: "host", value: "evil.example.org" });
    expect(await t.ctl.approve("oncall", again.review.distHash)).toEqual({ ok: true });
    expect(t.host.started).toEqual(["oncall", "oncall"]);
  });

  it("a key a new version adds is shown by its label in the review's added list", async () => {
    const t = await setup({ plugins: { bundled: ["oncall"], on: ["oncall"], local: false } });
    const dist = await bundled(t.root, "oncall", { permissions: { secrets: [{ id: "tok", label: "Token" }] } });
    await t.ctl.start();
    const manifest = JSON.parse(await fs.readFile(path.join(dist, "plugin.json"), "utf8"));
    const secrets = [{ id: "tok", label: "Token" }, { id: "jira", label: "Jira token" }];
    await fs.writeFile(path.join(dist, "plugin.json"), JSON.stringify({ ...manifest, permissions: { ...manifest.permissions, secrets } }));
    await t.ctl.rescan();
    const asked = (await t.ctl.setOn("oncall", true)) as { review: PluginReview };
    expect(asked.review.added).toEqual([{ kind: "secret", value: "Jira token" }]);
  });

  it("a dev plugin turned off stays off across a rescan, until turned on", async () => {
    const dev = path.dirname(await writePlugin(await tmp(), "devp"));
    const t = await setup({ over: { devDirs: [dev] } });
    await t.ctl.start();
    expect(t.host.started).toEqual(["devp"]);
    expect(await t.ctl.setOn("devp", false)).toEqual({ ok: true });
    await t.ctl.rescan();
    expect(t.host.started).toEqual(["devp"]);
    expect((await t.ctl.view()).plugins[0].status).toBe("off");
    expect(await t.ctl.setOn("devp", true)).toEqual({ ok: true });
    expect(t.host.started).toEqual(["devp", "devp"]);
  });

  it("turning off or removing during a run logs nothing and leaves no error log behind", async () => {
    const t = await setup({ plugins: { bundled: [], on: [], local: true }, backends: { mine: { s: () => new Promise(() => {}) } } });
    const folder = path.dirname(await writePlugin(await tmp(), "mine", { permissions: { secrets: [{ id: "tok", label: "Token" }] } }));
    t.deps.pickFolder.mockResolvedValue(folder);
    await t.ctl.start();
    const pick = (await t.ctl.pick()) as { token: string; review: PluginReview };
    await t.ctl.add(pick.token);
    await t.ctl.setSecret("mine", "tok", "secret-value-123");
    await t.ctl.approve("mine", pick.review.distHash);
    await until(async () => (await t.ctl.detail("mine"))!.sources[0].running);
    await t.ctl.setOn("mine", false);
    await new Promise((r) => setTimeout(r, 50));
    expect((await t.ctl.detail("mine"))?.errors).toEqual([]);
    await t.ctl.setOn("mine", true);
    await until(async () => (await t.ctl.detail("mine"))!.sources[0].running);
    expect(await t.ctl.remove("mine")).toEqual({ ok: true });
    await new Promise((r) => setTimeout(r, 100));
    expect((await files(t.base)).filter((f) => f.includes("mine"))).toEqual([]);
  });

  it("setOn false stops the backend; setOn true without an approval returns the review and starts nothing", async () => {
    const t = await setup({ plugins: { bundled: ["a", "b"], on: ["a"], local: false } });
    await bundled(t.root, "a");
    await bundled(t.root, "b", { permissions: { hosts: ["b.example.com"] } });
    await t.ctl.start();
    expect(await t.ctl.setOn("a", false)).toEqual({ ok: true });
    expect(t.host.stopped).toEqual(["a"]);
    expect(t.ctl.channelOf("a")).toBeNull();
    expect(await t.ctl.setOn("a", true)).toEqual({ ok: true });
    expect(t.host.started).toEqual(["a", "a"]);
    expect(await t.ctl.setOn("b", true)).toMatchObject({ ok: false, review: { id: "b" } });
    expect(t.host.started).toEqual(["a", "a"]);
  });

  it("remove: local only; deletes pointer, state, data, attention items and keys; never the folder", async () => {
    const t = await setup({
      plugins: { bundled: ["bun"], on: [], local: true },
      backends: { mine: { s: async (ctx) => (await ctx.data.put("queues", { key: "a" }), void (await ctx.attention.raise({ key: "k", severity: "action", title: "Look" }))) } },
    });
    await bundled(t.root, "bun");
    const folder = path.dirname(await writePlugin(await tmp(), "mine", { data: { queues: QUEUES }, permissions: { secrets: [{ id: "tok", label: "Token" }] } }));
    t.deps.pickFolder.mockResolvedValue(folder);
    await t.ctl.start();
    const pick = (await t.ctl.pick()) as { token: string; review: PluginReview };
    await t.ctl.add(pick.token);
    await t.ctl.approve("mine", pick.review.distHash);
    expect(await t.ctl.setSecret("mine", "tok", "secret-value-123")).toEqual({ ok: true });
    await until(async () => (await t.ctl.attention.view()).items.length === 1);
    expect(await t.ctl.remove("bun")).toMatchObject({ ok: false });
    expect(await t.ctl.remove("mine")).toEqual({ ok: true });
    expect(await t.deps.pointers.list()).toEqual([]);
    const left = await files(t.base);
    expect(left.filter((f) => f.includes("mine"))).toEqual([]);
    expect(JSON.parse(await fs.readFile(path.join(t.base, ".harness", "attention.json"), "utf8"))).toEqual([]);
    expect(await t.deps.secrets.stored("mine")).toEqual([]);
    expect(await files(folder)).toEqual([path.join("dist", "backend.js"), path.join("dist", "plugin.json")].sort());
    expect((await t.ctl.view()).plugins.map((p) => p.id)).toEqual(["bun"]);
  });
});

describe("PluginsController: remove in every profile", () => {
  it("remove clears the run state of every base: a same-id plugin added again starts off everywhere", async () => {
    const t = await setup({ plugins: { bundled: [], on: [], local: true } });
    const folder = path.dirname(await writePlugin(await tmp(), "mine"));
    t.deps.pickFolder.mockResolvedValue(folder);
    await t.ctl.start();
    const pick = (await t.ctl.pick()) as { token: string; review: PluginReview };
    await t.ctl.add(pick.token);
    // Approved and on in two profiles (two bases, two keys).
    const other = await tmp("hh-pl-base2-");
    t.setBase(other);
    await t.ctl.rebase();
    expect(await t.ctl.approve("mine", pick.review.distHash)).toEqual({ ok: true });
    t.setBase(t.base);
    await t.ctl.rebase();
    expect(await t.ctl.approve("mine", pick.review.distHash)).toEqual({ ok: true });
    expect((await files(path.join(t.appDir, "plugin-state"))).filter((f) => f.endsWith("mine.json"))).toHaveLength(2);
    expect(await t.ctl.remove("mine")).toEqual({ ok: true });
    expect((await files(path.join(t.appDir, "plugin-state"))).filter((f) => f.endsWith("mine.json"))).toEqual([]);
    // The same id from another folder, no new permissions: off in the other profile, nothing starts.
    const again = path.dirname(await writePlugin(await tmp(), "mine"));
    t.deps.pickFolder.mockResolvedValue(again);
    const pick2 = (await t.ctl.pick()) as { token: string };
    expect(await t.ctl.add(pick2.token)).toEqual({ ok: true });
    const started = t.host.started.length;
    t.setBase(other);
    await t.ctl.rebase();
    expect(t.host.started).toHaveLength(started);
    expect((await t.ctl.view()).plugins).toMatchObject([{ id: "mine", status: "off" }]);
  });
});

describe("PluginsController: settings, keys, test", () => {
  it("validates settings, stores only changes, and the backend sees them with its work hours", async () => {
    let seen: Record<string, unknown> | undefined;
    const t = await setup({
      plugins: { bundled: ["oncall"], on: ["oncall"], local: false },
      backends: { oncall: { s: async (ctx) => void (seen = await ctx.settings.get()) } },
    });
    await bundled(t.root, "oncall", { name: "On-call", sources: [{ id: "s", ttl: 600, workHoursOnly: true }], settings: { fields: { team: TEAM } } });
    await t.ctl.start();
    expect(await t.ctl.setSetting("oncall", "team", "nope")).toMatchObject({ ok: false, message: expect.any(String) });
    expect(await t.ctl.setSetting("oncall", "nope", "web")).toMatchObject({ ok: false });
    expect(await t.ctl.setSetting("oncall", "team", "web")).toEqual({ ok: true });
    expect(await t.ctl.setWorkHours("oncall", { days: [1, 1], from: "09:00", to: "17:00", timezone: "UTC" })).toMatchObject({ ok: false });
    expect(await t.ctl.setWorkHours("oncall", { days: [1], from: "9:00", to: "17:00", timezone: "UTC" })).toMatchObject({ ok: false });
    expect(await t.ctl.setWorkHours("oncall", { days: [1], from: "09:00", to: "17:00", timezone: "Mars/Olympus" })).toMatchObject({ ok: false });
    expect(await t.ctl.setWorkHours("oncall", { days: [1, 2], from: "09:00", to: "17:00", timezone: "UTC" })).toEqual({ ok: true });
    const results = await t.ctl.test("oncall");
    expect(results).toEqual([{ source: "s", ok: true, writes: 0 }]);
    expect(seen).toEqual({ team: "web", workHours: { days: [1, 2], from: "09:00", to: "17:00", timezone: "UTC" } });
    const detail = await t.ctl.detail("oncall");
    expect(detail).toMatchObject({ values: { team: "web" }, workHours: { days: [1, 2] }, settings: { fields: [{ name: "team" }] } });
    expect(await t.ctl.setSetting("oncall", "team", "docs")).toEqual({ ok: true });
    expect(await t.ctl.resetSettings("oncall")).toEqual({ ok: true });
    expect((await t.ctl.detail("oncall"))?.workHours).toMatchObject({ days: [1, 2] });
  });

  it("B6: keys go through the SecretStore and no value appears in the detail or the view", async () => {
    const t = await setup({ plugins: { bundled: ["oncall"], on: ["oncall"], local: false } });
    await bundled(t.root, "oncall", { permissions: { secrets: [{ id: "tok", label: "Token", help: "From settings" }] } });
    await t.ctl.start();
    expect(await t.ctl.setSecret("oncall", "other", "secret-value-123")).toMatchObject({ ok: false });
    expect(await t.ctl.setSecret("oncall", "tok", "secret-value-123")).toEqual({ ok: true });
    const detail = await t.ctl.detail("oncall");
    expect(detail?.secrets).toEqual([{ id: "tok", label: "Token", help: "From settings", stored: true }]);
    expect(JSON.stringify(detail)).not.toContain("secret-value-123");
    expect(JSON.stringify(await t.ctl.view())).not.toContain("secret-value-123");
    expect(JSON.stringify((t.deps.changed as ReturnType<typeof vi.fn>).mock.calls)).not.toContain("secret-value-123");
    await t.ctl.deleteSecret("oncall", "tok");
    expect((await t.ctl.detail("oncall"))?.secrets[0].stored).toBe(false);
  });

  let runs = 0;
  it("a failing run's error is redacted of the plugin's keys before the log and the status", async () => {
    const t = await setup({
      plugins: { bundled: ["oncall"], on: ["oncall"], local: false },
      // The first run (at start, before the key is stored) succeeds; later ones echo the key back.
      backends: { oncall: { s: async () => (runs++ === 0 ? undefined : Promise.reject(new Error("bad token secret-value-123"))) } },
    });
    await bundled(t.root, "oncall", { permissions: { secrets: [{ id: "tok", label: "Token" }] } });
    await t.ctl.start();
    await until(async () => (await t.ctl.detail("oncall"))!.sources[0].lastOk !== undefined);
    expect(await t.ctl.setSecret("oncall", "tok", "secret-value-123")).toEqual({ ok: true });
    const [r] = await t.ctl.test("oncall");
    expect(r).toMatchObject({ ok: false, error: "bad token [redacted]" });
    const detail = await t.ctl.detail("oncall");
    expect(JSON.stringify(detail)).not.toContain("secret-value-123");
    expect(detail?.errors[0]).toMatchObject({ source: "s", message: "bad token [redacted]" });
  });

  it("refresh is refused for a plugin that is off or a source it doesn't declare", async () => {
    const t = await setup({ plugins: { bundled: ["oncall"], on: [], local: false } });
    await bundled(t.root, "oncall");
    await t.ctl.start();
    expect(await t.ctl.refresh("oncall", "s")).toMatchObject({ ok: false });
    expect(await t.ctl.test("oncall")).toEqual([{ source: "s", ok: false, error: expect.any(String) }]);
  });
});

describe("PluginsController: crashes and the run limit", () => {
  it("restarts a crashed backend after the policy's delay; the 5th crash in an hour turns it off with an action item", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let now = 0;
    const t = await setup({ plugins: { bundled: ["oncall"], on: ["oncall"], local: false }, over: { clock: () => now } });
    await bundled(t.root, "oncall", { name: "On-call" });
    await t.ctl.start();
    for (let i = 0; i < 4; i++) {
      t.gone("oncall");
      t.gone("oncall"); // the same window twice counts once
      await vi.advanceTimersByTimeAsync(0);
      const starts = t.host.started.length;
      await vi.advanceTimersByTimeAsync(1000 * 2 ** i - 1);
      expect(t.host.started.length).toBe(starts);
      await vi.advanceTimersByTimeAsync(1);
      await vi.waitFor(() => expect(t.host.started.length).toBe(starts + 1));
      now += 1000;
    }
    t.gone("oncall");
    vi.useRealTimers();
    await until(async () => (await t.ctl.view()).plugins[0].status === "crashed");
    expect(t.ctl.channelOf("oncall")).toBeNull();
    const att = await t.ctl.attention.view();
    expect(att.items).toMatchObject([{ plugin: "oncall", key: "crashed", severity: "action", title: "On-call was turned off" }]);
    expect(att.badge).toBe(1);
    expect(await t.ctl.setOn("oncall", true)).toEqual({ ok: true });
  });

  it("a dev plugin turned off after crashes stays off across a rescan and says why, until turned on", async () => {
    const dev = path.dirname(await writePlugin(await tmp(), "devp", { name: "Dev" }));
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let now = 0;
    const t = await setup({ over: { devDirs: [dev], clock: () => now } });
    await t.ctl.start();
    for (let i = 0; i < 4; i++) {
      const starts = t.host.started.length;
      t.gone("devp");
      await vi.advanceTimersByTimeAsync(1000 * 2 ** i);
      await vi.waitFor(() => expect(t.host.started.length).toBe(starts + 1));
      now += 1000;
    }
    t.gone("devp");
    vi.useRealTimers();
    await until(async () => (await t.ctl.view()).plugins[0].status === "crashed");
    // Opening Settings › Plugins rescans: the plugin must not start again.
    const starts = t.host.started.length;
    await t.ctl.rescan();
    expect(t.host.started.length).toBe(starts);
    expect((await t.ctl.view()).plugins[0].status).toBe("crashed");
    expect((await t.ctl.attention.view()).items).toMatchObject([{ plugin: "devp", key: "crashed", title: "Dev was turned off" }]);
    // No state file for a dev plugin (its approval is its own manifest).
    await expect(fs.readdir(path.join(t.appDir, "plugin-state"))).rejects.toThrow();
    expect(await t.ctl.setOn("devp", true)).toEqual({ ok: true });
    expect(t.host.started.length).toBe(starts + 1);
    expect((await t.ctl.view()).plugins[0].status).toBe("on");
  });

  it("a run over the limit fails, the window reloads, and its run id is dead", async () => {
    let late: Ctx | undefined;
    const t = await setup({
      plugins: { bundled: ["oncall"], on: ["oncall"], local: false },
      backends: { oncall: { s: (ctx) => ((late = ctx), new Promise(() => {})) } },
      over: { runLimitMs: 50 },
    });
    await bundled(t.root, "oncall", { data: { queues: QUEUES } });
    await t.ctl.start();
    await until(() => (t.host.reload as ReturnType<typeof vi.fn>).mock.calls.length === 1);
    // The old page's channel is closed and its run ids are dead.
    await expect(late!.data.put("queues", { key: "x" })).rejects.toThrow(/ended|stopped/);
    // The log lines are written after the reload.
    await until(async () => /took too long/.test(((await t.ctl.detail("oncall"))?.errors ?? []).map((e) => e.message).join("\n")));
  });
  it("after a reload a queued run reaches the new page, not the old page's waiting next", async () => {
    let calls = 0;
    const t = await setup({
      plugins: { bundled: ["oncall"], on: ["oncall"], local: false },
      // The first run hangs past the limit; later ones finish.
      backends: { oncall: { s: () => (calls++ === 0 ? new Promise<void>(() => {}) : Promise.resolve()) } },
      over: { runLimitMs: 100, idleMs: 60_000 },
    });
    await bundled(t.root, "oncall");
    await t.ctl.start();
    await until(() => (t.host.reload as ReturnType<typeof vi.fn>).mock.calls.length === 1);
    expect(await t.ctl.refresh("oncall", "s")).toEqual({ ok: true });
    expect(t.host.reload).toHaveBeenCalledTimes(1);
  });
});

describe("PluginsController: attention", () => {
  it("lists items of on plugins with the plugin's name; badge counts unread actions; notify only when asked", async () => {
    let ctx: Ctx | undefined;
    const u = await setup({
      plugins: { bundled: ["oncall"], on: ["oncall"], local: false },
      backends: { oncall: { s: (c) => ((ctx = c), new Promise(() => {})) } },
    });
    await bundled(u.root, "oncall", { name: "On-call" });
    await u.ctl.start();
    expect(await u.ctl.attention.view()).toEqual({ items: [], badge: 0, show: true });
    await until(() => ctx !== undefined);
    await ctx!.attention.raise({ key: "a1", severity: "action", title: "Page", body: "<img src=x onerror=alert(1)>" });
    await ctx!.attention.raise({ key: "i1", severity: "info", title: "FYI" });
    expect(u.deps.notify).not.toHaveBeenCalled();
    let v = await u.ctl.attention.view();
    expect(v.items.map((i) => [i.key, i.pluginName, i.read])).toEqual([
      ["i1", "On-call", false],
      ["a1", "On-call", false],
    ]);
    expect(v.badge).toBe(1);
    await u.ctl.setNotify("oncall", true);
    await ctx!.attention.raise({ key: "a2", severity: "action", title: "Page 2" });
    expect(u.deps.notify).toHaveBeenCalledWith("On-call: Page 2", "");
    await u.ctl.attention.read("oncall", "a1");
    await u.ctl.attention.dismiss("oncall", "i1");
    v = await u.ctl.attention.view();
    expect(v.items.map((i) => i.key)).toEqual(["a2", "a1"]);
    expect(v.badge).toBe(1);
    expect(u.deps.attentionChanged).toHaveBeenCalled();
    // Off: its items hide, and with nothing on the icon goes.
    await u.ctl.setOn("oncall", false);
    expect(await u.ctl.attention.view()).toEqual({ items: [], badge: 0, show: false });
  });

  it("a target is checked again at the click: plugin on, panel or action declared, tasks approved, vars that pass the schema", async () => {
    let ctx: Ctx | undefined;
    const u = await setup({
      plugins: { bundled: ["oncall"], on: ["oncall"], local: false },
      backends: { oncall: { s: (c) => ((ctx = c), new Promise(() => {})) } },
    });
    await bundled(u.root, "oncall", {
      permissions: { tasks: true },
      panels: [{ id: "queue", slot: "side", title: "Queue" }],
      actions: [{ id: "ack", label: "Ack", tier: "light", vars: { type: "object", properties: { n: { type: "number" } }, required: ["n"] }, prompt: "Ack {{n}}" }],
    });
    await u.ctl.start();
    await until(() => ctx !== undefined);
    await ctx!.attention.raise({ key: "p", severity: "info", title: "Panel", target: { panel: "queue", focus: "a" } });
    await ctx!.attention.raise({ key: "good", severity: "action", title: "Ack it", target: { action: "ack", vars: { n: 1 } } });
    await ctx!.attention.raise({ key: "bad", severity: "action", title: "Bad vars", target: { action: "ack", vars: { n: "one" } } });
    await ctx!.attention.raise({ key: "none", severity: "info", title: "Nothing to open" });
    const has = Object.fromEntries((await u.ctl.attention.view()).items.map((i) => [i.key, i.hasTarget]));
    expect(has).toEqual({ p: true, good: true, bad: false, none: false });
    expect(await u.ctl.attentionTarget("oncall", "good")).toEqual({ action: "ack", vars: { n: 1 } });
    expect(await u.ctl.attentionTarget("oncall", "p")).toEqual({ panel: "queue", focus: "a" });
    expect(await u.ctl.attentionTarget("oncall", "bad")).toBeNull();
    expect(await u.ctl.attentionTarget("oncall", "missing")).toBeNull();
    expect(await u.ctl.attentionTarget("other", "good")).toBeNull();
    // Turned off: nothing of it opens any more.
    await u.ctl.setOn("oncall", false);
    expect(await u.ctl.attentionTarget("oncall", "good")).toBeNull();
  });

  it("a target's vars come back as the action's schema parsed them: extra keys are dropped", async () => {
    let ctx: Ctx | undefined;
    const u = await setup({
      plugins: { bundled: ["oncall"], on: ["oncall"], local: false },
      backends: { oncall: { s: (c) => ((ctx = c), new Promise(() => {})) } },
    });
    await bundled(u.root, "oncall", {
      permissions: { tasks: true },
      actions: [{ id: "ack", label: "Ack", tier: "light", vars: { type: "object", properties: { n: { type: "number" } }, required: ["n"] }, prompt: "Ack {{n}}" }],
    });
    await u.ctl.start();
    await until(() => ctx !== undefined);
    await ctx!.attention.raise({ key: "x", severity: "action", title: "Ack", target: { action: "ack", vars: { n: 2, extra: "smuggled" } } });
    expect(await u.ctl.attentionTarget("oncall", "x")).toEqual({ action: "ack", vars: { n: 2 } });
  });

  it("an action of a plugin whose approved snapshot lacks tasks opens nothing", async () => {
    let ctx: Ctx | undefined;
    const u = await setup({
      plugins: { bundled: ["oncall"], on: ["oncall"], local: false },
      backends: { oncall: { s: (c) => ((ctx = c), new Promise(() => {})) } },
    });
    await bundled(u.root, "oncall", {
      permissions: { tasks: true },
      actions: [{ id: "ack", label: "Ack", tier: "light", vars: { type: "object", properties: {} }, prompt: "Ack" }],
    });
    await u.ctl.start();
    await until(() => ctx !== undefined);
    await ctx!.attention.raise({ key: "x", severity: "action", title: "Ack", target: { action: "ack", vars: {} } });
    expect(await u.ctl.attentionTarget("oncall", "x")).toEqual({ action: "ack", vars: {} });
    // A snapshot without tasks never runs beside a manifest with them (that is a review); the guard holds regardless.
    (u.ctl as unknown as { running: Map<string, { approvedTasks: boolean }> }).running.get("oncall")!.approvedTasks = false;
    expect(await u.ctl.attentionTarget("oncall", "x")).toBeNull();
    expect((await u.ctl.attention.view()).items.find((i) => i.key === "x")?.hasTarget).toBe(false);
  });

  it("an action or a panel the plugin no longer declares opens nothing", async () => {
    let ctx: Ctx | undefined;
    const u = await setup({
      plugins: { bundled: ["oncall"], on: ["oncall"], local: false },
      backends: { oncall: { s: (c) => ((ctx = c), new Promise(() => {})) } },
    });
    const action = { id: "ack", label: "Ack", tier: "light", vars: { type: "object", properties: {} }, prompt: "Ack" };
    await bundled(u.root, "oncall", { permissions: { tasks: true }, panels: [{ id: "queue", slot: "side", title: "Queue" }], actions: [action] });
    await u.ctl.start();
    await until(() => ctx !== undefined);
    await ctx!.attention.raise({ key: "a", severity: "action", title: "Ack", target: { action: "ack", vars: {} } });
    await ctx!.attention.raise({ key: "p", severity: "info", title: "Panel", target: { panel: "queue" } });
    expect(await u.ctl.attentionTarget("oncall", "a")).not.toBeNull();
    expect(await u.ctl.attentionTarget("oncall", "p")).not.toBeNull();
    // A new version drops both (no new permission: it runs again without a review); the items stay in the inbox.
    ctx = undefined;
    await bundled(u.root, "oncall", { version: "1.1.0", permissions: { tasks: true }, panels: [{ id: "other", slot: "side", title: "Other" }], actions: [{ ...action, id: "other" }] });
    await u.ctl.rescan();
    await until(() => ctx !== undefined);
    expect((await u.ctl.attention.view()).items.map((i) => [i.key, i.hasTarget])).toEqual(expect.arrayContaining([["a", false], ["p", false]]));
    expect(await u.ctl.attentionTarget("oncall", "a")).toBeNull();
    expect(await u.ctl.attentionTarget("oncall", "p")).toBeNull();
  });
});

describe("PluginsController: agent surface", () => {
  it("catalogue, data route, sentences, staleness", async () => {
    const t = await setup({ plugins: { bundled: ["oncall"], on: ["oncall"], local: false }, backends: { oncall: { s: async (ctx) => void (await ctx.data.put("queues", { key: "a", n: 2 })) } } });
    await bundled(t.root, "oncall", { name: "On-call", data: { queues: QUEUES, hidden: HIDDEN }, settings: { fields: { team: TEAM } } });
    t.ctl.markRuntimeBuilt(false);
    await t.ctl.start();
    expect(t.ctl.agentCatalogue()).toEqual([{ name: "oncall.queues", key: "key", single: false, fields: QUEUES.schema }]);
    expect(t.ctl.takeRuntimeStale()).toBe(true);
    expect(t.ctl.takeRuntimeStale()).toBe(false);
    await until(async () => (await t.ctl.detail("oncall"))!.sources[0].lastOk !== undefined);
    expect(await t.ctl.agentData({ op: "query", collection: "oncall.queues" })).toMatchObject({ records: [{ key: "a", n: 2 }] });
    await expect(t.ctl.agentData({ op: "put", collection: "oncall.queues", record: { key: "b" } })).rejects.toMatchObject({ code: "refused" });
    await expect(t.ctl.agentData({ op: "query", collection: "oncall.hidden" })).rejects.toMatchObject({ code: "refused" });
    await expect(t.ctl.agentData({ op: "query", collection: "other.queues" })).rejects.toMatchObject({ code: "refused" });
    expect(await t.ctl.sentences()).toEqual(["On-call: Our team is docs."]);
    const file = await t.ctl.catalogueFile(t.base);
    expect(JSON.parse(await fs.readFile(file!, "utf8"))).toEqual(t.ctl.agentCatalogue());

    t.deps.refreshInstructions.mockClear();
    await t.ctl.setSetting("oncall", "team", "web");
    await t.ctl.betweenTasks();
    await t.ctl.betweenTasks();
    expect(t.deps.refreshInstructions).toHaveBeenCalledTimes(1);
    expect(await t.ctl.sentences()).toEqual(["On-call: Our team is web."]);

    t.deps.refreshInstructions.mockClear();
    await t.ctl.setOn("oncall", false);
    await t.ctl.betweenTasks();
    expect(t.deps.refreshInstructions).toHaveBeenCalledTimes(1);
    await expect(t.ctl.agentData({ op: "query", collection: "oncall.queues" })).rejects.toMatchObject({ code: "refused" });
    expect(await t.ctl.sentences()).toEqual([]);
    expect(t.ctl.agentCatalogue()).toEqual([]);
    expect(await t.ctl.catalogueFile(t.base)).toBeNull();
    expect(t.ctl.takeRuntimeStale()).toBe(true);
    expect(t.ctl.takeRuntimeStale()).toBe(false);
  });

  it("D0: nothing on → no staleness, no catalogue file", async () => {
    const t = await setup({ plugins: { bundled: ["oncall"], on: [], local: false } });
    await bundled(t.root, "oncall", { data: { queues: QUEUES } });
    await t.ctl.start();
    await t.ctl.betweenTasks();
    expect(t.deps.refreshInstructions).not.toHaveBeenCalled();
    expect(t.ctl.takeRuntimeStale()).toBe(false);
    expect(await t.ctl.catalogueFile(t.base)).toBeNull();
    expect(await t.ctl.contextTables(undefined)).toBe("");
    expect(await files(t.userData)).toEqual([]);
  });
});

describe("PluginsController: base changes", () => {
  it("a base switch without rebase stops the old base's plugins and shows nothing of it until rebase", async () => {
    const t = await setup({ plugins: { bundled: ["oncall"], on: ["oncall"], local: false }, backends: { oncall: { s: async (ctx) => void (await ctx.data.put("queues", { key: "a", n: 1 })) } } });
    await bundled(t.root, "oncall", { data: { queues: QUEUES } });
    await t.ctl.start();
    await until(async () => (await t.ctl.detail("oncall"))!.sources[0].lastOk !== undefined);
    expect(await t.ctl.agentData({ op: "query", collection: "oncall.queues" })).toMatchObject({ records: [{ key: "a" }] });
    const other = await tmp("hh-pl-base2-");
    t.setBase(other);
    await expect(t.ctl.agentData({ op: "query", collection: "oncall.queues" })).rejects.toMatchObject({ code: "refused" });
    await until(() => t.host.stopped.includes("oncall"));
    expect(t.ctl.channelOf("oncall")).toBeNull();
    expect(t.ctl.agentCatalogue()).toEqual([]);
    expect(await t.ctl.contextTables(undefined)).toBe("");
    expect(await t.ctl.sentences()).toEqual([]);
    const row = (await t.ctl.view()).plugins[0];
    expect(row.status).not.toBe("on");
    expect(row.lastSync).toBeUndefined();
    expect(await t.ctl.setOn("oncall", true)).toMatchObject({ ok: false });
    expect(t.host.started).toEqual(["oncall"]);
    expect(await files(other)).toEqual([]);
    await t.ctl.rebase();
    expect(t.host.started).toEqual(["oncall", "oncall"]);
  });

  it("after stop() (a folder move, quit) a rescan, a turn-on or an approval starts nothing and writes nothing until rebase()", async () => {
    const t = await setup({ plugins: { bundled: ["oncall", "other"], on: ["oncall"], local: false }, backends: { oncall: { s: async () => {} } } });
    await bundled(t.root, "oncall");
    await bundled(t.root, "other");
    await t.ctl.start();
    expect(t.host.started).toEqual(["oncall"]);
    await t.ctl.stop();
    expect(t.host.stopAll).toHaveBeenCalled();
    const before = { base: await files(t.base), app: await files(t.appDir) };
    await t.ctl.rescan();
    expect(await t.ctl.setOn("oncall", true)).toMatchObject({ ok: false, message: "The app is not set up yet" });
    const hash = (await t.ctl.detail("other"))!.review.distHash;
    expect(await t.ctl.approve("other", hash)).toMatchObject({ ok: false, message: "The app is not set up yet" });
    expect(t.host.started).toEqual(["oncall"]);
    expect(t.ctl.channelOf("oncall")).toBeNull();
    expect(await files(t.base)).toEqual(before.base);
    expect(await files(t.appDir)).toEqual(before.app);
    await t.ctl.rebase();
    expect(t.host.started).toEqual(["oncall", "oncall"]);
  });

  it("rebase stops the old base's backends and starts the new base's; before setup nothing starts", async () => {
    const t = await setup({ plugins: { bundled: ["oncall"], on: ["oncall"], local: false } });
    await bundled(t.root, "oncall");
    t.setBase(null);
    await t.ctl.start();
    expect(t.host.start).not.toHaveBeenCalled();
    t.setBase(t.base);
    await t.ctl.rebase();
    expect(t.host.started).toEqual(["oncall"]);
    const other = await tmp("hh-pl-base2-");
    await t.ctl.setOn("oncall", false);
    t.setBase(other);
    await t.ctl.rebase();
    // The new base has its own state: the harness's plugin starts on there.
    expect(t.host.started).toEqual(["oncall", "oncall"]);
    expect(t.host.stopped).toEqual(["oncall"]);
    t.setBase(t.base);
    await t.ctl.rebase();
    expect(t.host.started).toEqual(["oncall", "oncall"]);
    expect(t.host.stopAll).toHaveBeenCalled();
  });
});
