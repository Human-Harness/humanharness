import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { type DataRecord, PROFILE_COLORS, z } from "@humanharness/harness-sdk";
import { ProfileStore } from "@humanharness/workspace";
import { Profiles, type ProfilesDeps } from "../src/main/profiles";
import { ProfileSwitch } from "../src/main/profile-switch";

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hh-profiles-"));
afterAll(() => fs.rmSync(tmpRoot, { recursive: true, force: true }));

const collection = {
  scoped: false,
  single: true,
  agent: "read" as const,
  schema: z.object({ name: z.string().min(1).max(40), color: z.enum(PROFILE_COLORS).optional() }),
} as unknown as ProfilesDeps["collection"];

function setup(over: Partial<ProfilesDeps> = {}) {
  const base = fs.mkdtempSync(path.join(tmpRoot, "t-"));
  const root = path.join(base, "Work");
  const userData = path.join(base, "userData");
  const seed = path.join(base, "seed");
  fs.mkdirSync(root, { recursive: true });
  fs.mkdirSync(seed, { recursive: true });
  fs.writeFileSync(path.join(seed, "README.md"), "seed");
  let active: string | undefined;
  const records = new Map<string, DataRecord>();
  const trashed: string[] = [];
  const changed = vi.fn();
  const calls: string[] = [];
  const switcher = new ProfileSwitch({
    quitting: () => false,
    busy: () => false,
    turnBlocked: () => null,
    closeTask: async () => {
      calls.push("closeTask");
      return true;
    },
    closeRuntime: async () => void calls.push("closeRuntime"),
    saveActive: async (id) => void (active = id),
    arrived: async () => {},
  });
  const d: ProfilesDeps = {
    root: async () => root,
    active: async () => active,
    collection,
    seed,
    writeRecord: async (b, record) => void records.set(b, record),
    readRecord: async (b) => records.get(b) ?? null,
    switchTo: (target) => switcher.run(target),
    trash: async (p) => {
      trashed.push(p);
      await fs.promises.rm(p, { recursive: true, force: true });
    },
    historyDir: (folder) => path.join(userData, "history", path.basename(folder)),
    changed,
    ...over,
  };
  return { root, userData, records, trashed, changed, calls, profiles: new Profiles(d), active: () => active };
}

describe("Profiles (profiles spec §5)", () => {
  it("starts with none; not ready without a folder", async () => {
    const t = setup();
    expect(await t.profiles.state()).toEqual({ active: null, list: [] });
    const none = setup({ root: async () => null });
    expect(await none.profiles.create({ name: "Sofi" })).toEqual({ ok: false, reason: "not-ready" });
  });

  it("creating: closes the task, registers it, makes its folder with the seed, writes its record, makes it active", async () => {
    const t = setup();
    expect(await t.profiles.create({ name: "Sofi", color: "coral" })).toEqual({ ok: true });
    const dir = path.join(t.root, "sofi");
    expect(t.calls).toEqual(["closeTask", "closeRuntime"]);
    expect(fs.readFileSync(path.join(dir, "README.md"), "utf8")).toBe("seed");
    expect(t.records.get(dir)).toEqual({ name: "Sofi", color: "coral" });
    expect(t.active()).toBe("sofi");
    expect(await t.profiles.state()).toMatchObject({ active: "sofi", list: [{ id: "sofi", title: "Sofi", color: "coral", archived: false }] });
    expect(t.changed).toHaveBeenLastCalledWith(expect.objectContaining({ active: "sofi" }));
  });

  it("refuses fields the profile schema refuses, by field, making nothing", async () => {
    const t = setup();
    const r = await t.profiles.create({ name: "", color: "black" });
    expect(r).toMatchObject({ ok: false, reason: "invalid" });
    expect(r.ok ? [] : r.errors?.map((e) => e.path)).toEqual(["name", "color"]);
    expect(await t.profiles.state()).toEqual({ active: null, list: [] });
    expect(t.calls).toEqual([]);
  });

  it("opens a registered profile; the active one is a no-op; unknown and archived ones are refused", async () => {
    const t = setup();
    await t.profiles.create({ name: "Sofi" });
    await t.profiles.create({ name: "Tomás" });
    expect(t.active()).toBe("tomas");
    expect(await t.profiles.open("sofi")).toEqual({ ok: true });
    expect(t.active()).toBe("sofi");
    t.calls.length = 0;
    expect(await t.profiles.open("sofi")).toEqual({ ok: true });
    expect(t.calls).toEqual([]);
    expect(await t.profiles.open("nobody")).toEqual({ ok: false, reason: "unknown" });
    expect(await t.profiles.open("../x")).toEqual({ ok: false, reason: "unknown" });
    await t.profiles.setArchived("tomas", true);
    expect(await t.profiles.open("tomas")).toEqual({ ok: false, reason: "unknown" });
  });

  it("never archives or deletes the active profile", async () => {
    const t = setup();
    await t.profiles.create({ name: "Sofi" });
    expect(await t.profiles.setArchived("sofi", true)).toEqual({ ok: false, reason: "active" });
    expect(await t.profiles.remove("sofi")).toEqual({ ok: false, reason: "active" });
  });

  it("deleting puts the folder and its history in the Trash, then drops the entry", async () => {
    const t = setup();
    await t.profiles.create({ name: "Sofi" });
    await t.profiles.create({ name: "Tomás" });
    await t.profiles.open("sofi");
    const history = path.join(t.userData, "history", "tomas");
    fs.mkdirSync(history, { recursive: true });
    expect(await t.profiles.remove("tomas")).toEqual({ ok: true });
    expect(t.trashed).toEqual([path.join(t.root, "tomas"), history]);
    expect((await t.profiles.state()).list.map((p) => p.id)).toEqual(["sofi"]);
  });

  it("a folder the Trash refuses changes nothing", async () => {
    const t = setup({ trash: async () => Promise.reject(new Error("no Trash")) });
    vi.spyOn(console, "error").mockImplementation(() => {});
    await t.profiles.create({ name: "Sofi" });
    await t.profiles.create({ name: "Tomás" });
    await t.profiles.open("sofi");
    expect(await t.profiles.remove("tomas")).toEqual({ ok: false, reason: "failed" });
    expect((await t.profiles.state()).list.map((p) => p.id)).toEqual(["sofi", "tomas"]);
    expect(fs.existsSync(path.join(t.root, "tomas"))).toBe(true);
  });

  it("a folder already gone is skipped, and the entry still goes", async () => {
    const t = setup();
    await t.profiles.create({ name: "Sofi" });
    await t.profiles.create({ name: "Tomás" });
    await t.profiles.open("sofi");
    fs.rmSync(path.join(t.root, "tomas"), { recursive: true });
    expect(await t.profiles.remove("tomas")).toEqual({ ok: true });
    expect(t.trashed).toEqual([]);
  });

  it("the registry copies the record's name and colour; a bad name changes nothing", async () => {
    const t = setup();
    await t.profiles.create({ name: "Sofi", color: "coral" });
    const dir = path.join(t.root, "sofi");
    t.records.set(dir, { name: "Sofía", color: "teal" });
    await t.profiles.sync(dir);
    expect((await new ProfileStore(t.root).list())[0]).toMatchObject({ id: "sofi", title: "Sofía", color: "teal" });
    t.records.set(dir, { name: "" });
    await t.profiles.sync(dir);
    expect((await new ProfileStore(t.root).list())[0].title).toBe("Sofía");
    // Not a profile's folder: nothing happens.
    await t.profiles.sync(t.root);
    await t.profiles.sync(path.join(t.root, "sofi", "deeper"));
  });

  it("a switch that fails after the profile was made reports failed, and the window hears the new one", async () => {
    const t = setup({
      switchTo: async (target) => {
        await target();
        return { ok: false, reason: "failed" };
      },
    });
    expect(await t.profiles.create({ name: "Sofi" })).toEqual({ ok: false, reason: "failed" });
    expect(t.changed).toHaveBeenLastCalledWith({ active: null, list: [expect.objectContaining({ id: "sofi" })] });
  });

  it("openable: registered and not archived", async () => {
    const t = setup();
    await t.profiles.create({ name: "Sofi" });
    expect(await t.profiles.openable("sofi")).toBe(true);
    expect(await t.profiles.openable("tomas")).toBe(false);
  });
});
