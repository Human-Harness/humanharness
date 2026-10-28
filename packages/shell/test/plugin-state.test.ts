import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { type PluginManifest, parsePluginManifest } from "@humanharness/harness-sdk";
import { DEFAULT_WORK_HOURS, PluginStateStore, inWorkHours, parseWorkHours, reviewStatus } from "../src/main/plugin-state";

const m = (permissions: object = {}): PluginManifest =>
  parsePluginManifest({ id: "oncall", name: "On-call", version: "1.0.0", api: 1, harness: "*", permissions: { hosts: ["*.atlassian.net"], ...permissions } });
const entry = (origin: "bundled" | "local" | "dev", manifest = m(), distHash = "h1") => ({ id: "oncall", origin, dist: "/d", folder: "/f", manifest, distHash });
const approved = () => ({ version: "1.0.0", permissions: m().permissions, distHash: "h1", at: "t" });

describe("reviewStatus (plugins spec §7, Decisions 5–6, B8)", () => {
  it("a local plugin starts off", () => {
    expect(reviewStatus(entry("local"), null, false)).toMatchObject({ run: false, status: "off" });
  });
  it("a bundled plugin in plugins.on starts on without a review; one not listed starts off", () => {
    expect(reviewStatus(entry("bundled"), null, true)).toMatchObject({ run: true, status: "on", approve: true });
    expect(reviewStatus(entry("bundled"), null, false)).toMatchObject({ run: false, status: "off" });
  });
  it("dev plugins run without review", () => {
    expect(reviewStatus(entry("dev"), null, false)).toMatchObject({ run: true, status: "on" });
  });
  it("on with the same permissions: runs; a code change shows updated", () => {
    expect(reviewStatus(entry("local"), { on: true, approved: approved() }, false)).toMatchObject({ run: true, updated: false });
    expect(reviewStatus(entry("local", m(), "h2"), { on: true, approved: approved() }, false)).toMatchObject({ run: true, updated: true });
  });
  it("updated clears once the person saw the new hash", () => {
    expect(reviewStatus(entry("local", m(), "h2"), { on: true, approved: approved(), seenHash: "h2" }, false)).toMatchObject({ run: true, updated: false });
  });
  it("B8: added permissions turn it off and ask for a review", () => {
    const wider = entry("local", m({ hosts: ["*.atlassian.net", "evil.com"] }), "h2");
    expect(reviewStatus(wider, { on: true, approved: approved() }, false)).toMatchObject({ run: false, status: "review", added: [{ kind: "host", value: "evil.com" }] });
  });
  it("B8: a bundled plugin in plugins.on is held to its approval too", () => {
    const wider = entry("bundled", m({ secrets: [{ id: "token", label: "Token" }] }), "h2");
    expect(reviewStatus(wider, { on: true, approved: approved() }, true)).toMatchObject({ run: false, status: "review", added: [{ kind: "secret", value: "token" }] });
  });
  it("fewer permissions need no review", () => {
    expect(reviewStatus(entry("local", m({ hosts: [] }), "h2"), { on: true, approved: approved() }, false)).toMatchObject({ run: true });
  });
  it("on without an approval runs only when the harness turns it on", () => {
    expect(reviewStatus(entry("local"), { on: true }, false)).toMatchObject({ run: false, status: "off" });
    expect(reviewStatus(entry("bundled"), { on: true }, true)).toMatchObject({ run: true, status: "on", approve: true });
  });
  it("a load error never runs", () => {
    expect(reviewStatus({ ...entry("bundled"), manifest: null, error: "bad" }, null, true)).toMatchObject({ run: false, status: "error" });
    expect(reviewStatus({ ...entry("dev"), manifest: null, error: "bad" }, null, false)).toMatchObject({ run: false, status: "error" });
  });
  it("turned off after crashes stays off with its reason", () => {
    expect(reviewStatus(entry("bundled"), { on: false, offReason: "crashed" }, true)).toMatchObject({ run: false, status: "crashed" });
    expect(reviewStatus(entry("local"), { on: false, offReason: "review", approved: approved() }, false)).toMatchObject({ run: false, status: "review" });
    expect(reviewStatus(entry("bundled"), { on: false }, true)).toMatchObject({ run: false, status: "off" });
  });
});

describe("PluginStateStore", () => {
  const tmp = () => fs.mkdtemp(path.join(os.tmpdir(), "hh-pl-state-"));
  const dir = (base: string, id: string) => path.join(base, ".harness", "plugins", id);
  /** A base and the app's per-harness folder, side by side. */
  const setup = async () => {
    const root = await tmp();
    const base = path.join(root, "work");
    const app = path.join(root, "app");
    await fs.mkdir(base);
    return { base, app, s: new PluginStateStore(base, app) };
  };
  const runFile = async (app: string, base: string, id: string) =>
    path.join(app, "plugin-state", createHash("sha256").update(await fs.realpath(base)).digest("hex").slice(0, 32), `${id}.json`);

  it("D0: reading writes nothing", async () => {
    const { base, app, s } = await setup();
    expect(await s.state("oncall")).toBeNull();
    expect(await s.settings("oncall")).toEqual({});
    expect(await s.errors("oncall")).toEqual([]);
    await expect(fs.access(path.join(base, ".harness"))).rejects.toThrow();
    await expect(fs.access(app)).rejects.toThrow();
  });
  it("writes settings and errors under .harness/plugins/<id>/, the run state in the app's folder", async () => {
    const { base, app, s } = await setup();
    await s.setState("oncall", { on: true });
    await s.setSettings("oncall", { team: "web" });
    await s.appendError("oncall", { at: "2026-10-27T10:00:00Z", source: "queues", message: "HTTP 500" });
    expect((await fs.readdir(dir(base, "oncall"))).sort()).toEqual(["errors.jsonl", "settings.json"]);
    const file = await runFile(app, base, "oncall");
    expect(JSON.parse(await fs.readFile(file, "utf8"))).toEqual({ on: true });
    expect((await fs.stat(file)).mode & 0o777).toBe(0o600);
    expect(await s.errors("oncall")).toEqual([{ at: "2026-10-27T10:00:00Z", source: "queues", message: "HTTP 500" }]);
    expect(await s.settings("oncall")).toEqual({ team: "web" });
  });
  it("B8: a state.json in the base that claims an approval approves nothing", async () => {
    const { base, s } = await setup();
    await fs.mkdir(dir(base, "oncall"), { recursive: true });
    await fs.writeFile(path.join(dir(base, "oncall"), "state.json"), JSON.stringify({ on: true, approved: approved() }));
    expect(await s.state("oncall")).toBeNull();
    expect(reviewStatus(entry("local"), await s.state("oncall"), false)).toMatchObject({ run: false, status: "off" });
  });
  it("the run state is per base: another base's approval doesn't carry over", async () => {
    const { base, app, s } = await setup();
    await s.setState("oncall", { on: true, approved: approved() });
    const other = path.join(path.dirname(base), "other");
    await fs.mkdir(other);
    expect(await new PluginStateStore(other, app).state("oncall")).toBeNull();
    expect(await new PluginStateStore(base, app).state("oncall")).toEqual({ on: true, approved: approved() });
  });
  it("setState merges a patch and returns the result; concurrent patches all land", async () => {
    const { s } = await setup();
    expect(await s.setState("a", { notify: true })).toEqual({ on: false, notify: true });
    await Promise.all([s.setState("a", { on: true, approved: approved() }), s.setState("a", { seenHash: "h1" })]);
    expect(await s.state("a")).toEqual({ on: true, notify: true, approved: approved(), seenHash: "h1" });
    expect(await s.setState("a", { offReason: undefined })).not.toHaveProperty("offReason");
  });
  it("setSettings({}) removes the file", async () => {
    const { base, s } = await setup();
    await s.setSettings("a", { team: "web" });
    await s.setSettings("a", {});
    await expect(fs.access(path.join(dir(base, "a"), "settings.json"))).rejects.toThrow();
    expect(await s.settings("a")).toEqual({});
  });
  it("broken files read as nothing; a hand-edited approval that doesn't parse reads as none", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { base, app, s } = await setup();
    const run = await runFile(app, base, "a");
    await fs.mkdir(dir(base, "a"), { recursive: true });
    await fs.mkdir(path.dirname(run), { recursive: true });
    await fs.writeFile(run, "{not json");
    await fs.writeFile(path.join(dir(base, "a"), "settings.json"), "[1,2]");
    await fs.writeFile(path.join(dir(base, "a"), "errors.jsonl"), 'oops\n{"at":"t","message":"kept"}\n{"at":3}\n');
    expect(await s.state("a")).toBeNull();
    expect(await s.settings("a")).toEqual({});
    expect(await s.errors("a")).toEqual([{ at: "t", message: "kept" }]);
    const bad = { on: true, approved: { ...approved(), permissions: { hosts: ["http://evil"] } }, offReason: "whatever", notify: "yes" };
    await fs.writeFile(run, JSON.stringify(bad));
    expect(await s.state("a")).toEqual({ on: true });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
  it("the error log keeps at most 256 KB, dropping the oldest lines", async () => {
    const { base, s } = await setup();
    for (let i = 0; i < 200; i++) await s.appendError("a", { at: "t", message: `${i} ${"x".repeat(1900)}` });
    const errors = await s.errors("a");
    expect(errors.at(-1)!.message.startsWith("199 ")).toBe(true);
    expect(JSON.stringify(errors).length).toBeLessThanOrEqual(256 * 1024);
    expect((await fs.stat(path.join(dir(base, "a"), "errors.jsonl"))).size).toBeLessThanOrEqual(256 * 1024);
  });
  it("a log line is at most 2,000 characters (B11)", async () => {
    const { s } = await setup();
    await s.appendError("a", { at: "t", source: "s".repeat(500), message: "y".repeat(10_000) });
    const [line] = await s.errors("a");
    expect(line.message.length).toBeLessThanOrEqual(2000);
    expect(line.source!.length).toBeLessThanOrEqual(64);
  });
  it("removeAll deletes the run state, settings, errors and plugin data", async () => {
    const { base, app, s } = await setup();
    await s.setState("a", { on: true });
    await s.setSettings("a", { team: "web" });
    await fs.mkdir(path.join(base, ".harness", "plugin-data", "a"), { recursive: true });
    await s.removeAll("a");
    await expect(fs.access(dir(base, "a"))).rejects.toThrow();
    await expect(fs.access(path.join(base, ".harness", "plugin-data", "a"))).rejects.toThrow();
    await expect(fs.access(await runFile(app, base, "a"))).rejects.toThrow();
  });
  it("an id that isn't a plugin id is refused before any path is built", async () => {
    const { s } = await setup();
    await expect(s.state("../x")).rejects.toThrow(/plugin/);
    await expect(s.setState("../x", { on: true })).rejects.toThrow(/plugin/);
    await expect(s.removeAll("..")).rejects.toThrow(/plugin/);
  });
});

describe("work hours (§4.3, Decision 4)", () => {
  const wh = { days: [1, 2, 3, 4, 5], from: "09:00", to: "18:00", timezone: "Europe/Madrid" };
  it.each([
    ["2026-10-27T08:30:00Z", true], // Tue 09:30 in Madrid (UTC+1)
    ["2026-10-27T07:30:00Z", false], // Tue 08:30
    ["2026-10-27T17:00:00Z", false], // Tue 18:00: the end is exclusive
    ["2026-10-25T10:00:00Z", false], // Sunday
  ])("%s → %s", (at, inside) => {
    expect(inWorkHours(wh, new Date(at))).toBe(inside);
  });
  it("from > to spans midnight; the hours after midnight belong to the day it started", () => {
    const night = { ...wh, from: "22:00", to: "06:00" };
    expect(inWorkHours({ ...night, days: [0, 1, 2, 3, 4, 5, 6] }, new Date("2026-10-27T23:30:00Z"))).toBe(true);
    expect(inWorkHours({ ...night, days: [2] }, new Date("2026-10-27T23:30:00Z"))).toBe(true); // Wed 00:30, started Tue
    expect(inWorkHours({ ...night, days: [3] }, new Date("2026-10-27T23:30:00Z"))).toBe(false);
  });
  it("from = to is the whole day", () => {
    expect(inWorkHours({ ...wh, from: "00:00", to: "00:00" }, new Date("2026-10-27T03:00:00Z"))).toBe(true);
  });
  it("defaults to Monday–Friday 09:00–18:00 in the system zone", () => {
    expect(DEFAULT_WORK_HOURS()).toMatchObject({ days: [1, 2, 3, 4, 5], from: "09:00", to: "18:00", timezone: Intl.DateTimeFormat().resolvedOptions().timeZone });
  });
  it("parseWorkHours accepts only well-formed hours in a real zone", () => {
    expect(parseWorkHours(wh)).toEqual(wh);
    expect(parseWorkHours({ ...wh, timezone: "Mars/Olympus" })).toBeNull();
    expect(parseWorkHours({ ...wh, from: "25:00" })).toBeNull();
    expect(parseWorkHours({ ...wh, days: [7] })).toBeNull();
    expect(parseWorkHours({ ...wh, days: [] })).toBeNull();
    expect(parseWorkHours("9-5")).toBeNull();
  });
});
