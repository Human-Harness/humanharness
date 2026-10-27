import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { type DataRecord, PROFILE_COLORS, z } from "@humanharness/harness-sdk";
import { ProfileStore } from "@humanharness/workspace";
import type { AppState } from "@humanharness/ui/client";
import { DataUnavailable } from "../src/main/data-requests";
import { Profiles, type ProfilesDeps, profileResult } from "../src/main/profiles";
import { ProfileSwitch } from "../src/main/profile-switch";

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hh-profiles-"));
afterAll(() => fs.rmSync(tmpRoot, { recursive: true, force: true }));

const collection = {
  scoped: false,
  single: true,
  agent: "read" as const,
  schema: z.object({ name: z.string().min(1).max(40), color: z.enum(PROFILE_COLORS).optional(), goal: z.string().optional() }),
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
    fields: ["name", "color"],
    writeActive: async (record) => {
      if (!active) throw new Error("no active profile");
      records.set(path.join(root, active), record);
    },
    switchTo: (target) => switcher.run(target),
    trash: async (p) => {
      trashed.push(p);
      await fs.promises.rm(p, { recursive: true, force: true });
    },
    historyDir: (folder) => path.join(userData, "history", path.basename(folder)),
    changed,
    blocked: () => false,
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

  it("a profile archived while the open task closes is not opened", async () => {
    let root = "";
    let archiveFirst = false;
    const t = setup({
      switchTo: async (target) => {
        if (archiveFirst) await new ProfileStore(root).setArchived("sofi", true);
        try {
          return { ok: true, id: await target() };
        } catch {
          return { ok: false, reason: "failed" };
        }
      },
    });
    root = t.root;
    await t.profiles.create({ name: "Sofi" });
    await t.profiles.create({ name: "Tomás" });
    archiveFirst = true;
    expect(await t.profiles.open("sofi")).toEqual({ ok: false, reason: "unknown" });
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
    expect(await t.profiles.create({ name: "Sofi" })).toEqual({ ok: false, reason: "failed", made: "sofi" });
    expect(t.changed).toHaveBeenLastCalledWith({ active: null, list: [expect.objectContaining({ id: "sofi" })] });
  });

  it("a record that can't be written after the entry exists names it too; a refused switch made nothing", async () => {
    const t = setup({
      writeRecord: async () => {
        throw new Error("disk full");
      },
    });
    expect(await t.profiles.create({ name: "Sofi" })).toEqual({ ok: false, reason: "failed", made: "sofi" });
    expect(t.active()).toBeUndefined();

    const busy = setup({ switchTo: async () => ({ ok: false, reason: "busy" }) });
    expect(await busy.profiles.create({ name: "Sofi" })).toEqual({ ok: false, reason: "busy" });
  });

  it("archiving and deleting are refused while a switch, a turn or a move runs, touching nothing", async () => {
    let blocked = false;
    const t = setup({ blocked: () => blocked });
    await t.profiles.create({ name: "Sofi" });
    await t.profiles.create({ name: "Tomás" });
    await t.profiles.open("sofi");
    t.changed.mockClear();
    blocked = true;
    expect(await t.profiles.remove("tomas")).toEqual({ ok: false, reason: "busy" });
    expect(await t.profiles.setArchived("tomas", true)).toEqual({ ok: false, reason: "busy" });
    expect(t.trashed).toEqual([]);
    expect(fs.existsSync(path.join(t.root, "tomas"))).toBe(true);
    expect(await t.profiles.state()).toMatchObject({ list: [{ id: "sofi" }, { id: "tomas", archived: false }] });
    expect(t.changed).not.toHaveBeenCalled();
  });

  it("while a profile is being deleted, a switch, another delete and an archive are refused", async () => {
    let releaseTrash!: () => void;
    const trashGate = new Promise<void>((r) => (releaseTrash = r));
    let hold = false;
    let active: string | undefined;
    let profiles!: Profiles;
    // The switch's busy reads `changing()`, as the main process wires it.
    const switcher = new ProfileSwitch({
      quitting: () => false,
      busy: () => profiles.changing(),
      turnBlocked: () => null,
      closeTask: async () => true,
      closeRuntime: async () => {},
      saveActive: async (id) => void (active = id),
      arrived: async () => {},
    });
    const t = setup({
      active: async () => active,
      switchTo: (target) => switcher.run(target),
      trash: async (p) => {
        if (hold) await trashGate;
        await fs.promises.rm(p, { recursive: true, force: true });
      },
    });
    profiles = t.profiles;
    await t.profiles.create({ name: "Sofi" });
    await t.profiles.create({ name: "Tomás" });
    await t.profiles.create({ name: "Ana" });
    await t.profiles.open("sofi");
    expect(t.profiles.changing()).toBe(false);
    hold = true;
    const removing = t.profiles.remove("tomas");
    expect(t.profiles.changing()).toBe(true);
    expect(await t.profiles.open("tomas")).toEqual({ ok: false, reason: "busy" });
    expect(await t.profiles.open("ana")).toEqual({ ok: false, reason: "busy" });
    expect(await t.profiles.remove("tomas")).toEqual({ ok: false, reason: "busy" });
    expect(await t.profiles.setArchived("ana", true)).toEqual({ ok: false, reason: "busy" });
    expect(active).toBe("sofi");
    releaseTrash();
    expect(await removing).toEqual({ ok: true });
    expect(t.profiles.changing()).toBe(false);
    expect((await t.profiles.state()).list.map((p) => p.id)).toEqual(["sofi", "ana"]);
    expect(await t.profiles.open("tomas")).toEqual({ ok: false, reason: "unknown" });
  });

  it("archiving holds a switch off too, and lets go when it fails", async () => {
    let profiles!: Profiles;
    const seen: boolean[] = [];
    const t = setup({ active: async () => (seen.push(profiles.changing()), "sofi") });
    profiles = t.profiles;
    await t.profiles.create({ name: "Sofi" });
    await t.profiles.create({ name: "Tomás" });
    seen.length = 0;
    expect(await t.profiles.setArchived("tomas", true)).toEqual({ ok: true });
    expect(seen.length > 0 && seen.every(Boolean)).toBe(true);
    expect(t.profiles.changing()).toBe(false);
    expect(await t.profiles.setArchived("sofi", true)).toEqual({ ok: false, reason: "active" });
    expect(t.profiles.changing()).toBe(false);
  });

  it("the new profile's record carries the cleaned name", async () => {
    const t = setup();
    expect(await t.profiles.create({ name: "  Sofi\n Pérez " })).toEqual({ ok: true });
    expect(t.records.get(path.join(t.root, "sofi-perez"))).toEqual({ name: "Sofi Pérez" });
    expect((await t.profiles.state()).list[0].title).toBe("Sofi Pérez");
  });

  it("sync never rejects: a failing read is logged", async () => {
    const t = setup({ readRecord: async () => Promise.reject(new Error("disk")) });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await t.profiles.create({ name: "Sofi" });
    t.changed.mockClear();
    await expect(t.profiles.sync(path.join(t.root, "sofi"))).resolves.toBeUndefined();
    expect(log).toHaveBeenCalled();
    expect(t.changed).not.toHaveBeenCalled();
    log.mockRestore();
  });

  it("openable: registered and not archived", async () => {
    const t = setup();
    await t.profiles.create({ name: "Sofi" });
    expect(await t.profiles.openable("sofi")).toBe(true);
    expect(await t.profiles.openable("tomas")).toBe(false);
  });
});

describe("Profiles: editing the active one (spec §5)", () => {
  it("writes the form's fields over the record: a field left out is cleared, one the form doesn't ask for stays; the registry follows", async () => {
    const t = setup();
    await t.profiles.create({ name: "Sofi", color: "coral" });
    const dir = path.join(t.root, "sofi");
    t.records.set(dir, { name: "Sofi", color: "coral", goal: "Pass maths" });
    expect(await t.profiles.edit({ name: "  Sofía ", goal: "ignored" })).toEqual({ ok: true });
    expect(t.records.get(dir)).toEqual({ name: "Sofía", goal: "Pass maths" });
    expect((await t.profiles.state()).list).toEqual([expect.objectContaining({ id: "sofi", title: "Sofía" })]);
    expect((await t.profiles.state()).list[0].color).toBeUndefined();
  });

  it("refuses by field like a create (a blank name too), writing nothing", async () => {
    const t = setup();
    await t.profiles.create({ name: "Sofi" });
    const dir = path.join(t.root, "sofi");
    const blank = await t.profiles.edit({ name: "   " });
    expect(blank).toMatchObject({ ok: false, reason: "invalid", errors: [{ path: "name" }] });
    const colour = await t.profiles.edit({ name: "Sofi", color: "black" });
    expect(colour.ok ? [] : colour.errors?.map((e) => e.path)).toEqual(["color"]);
    expect(await t.profiles.edit("name")).toMatchObject({ ok: false, reason: "invalid" });
    expect(t.records.get(dir)).toEqual({ name: "Sofi" });
  });

  it("is refused with no active profile, while anything else runs, and when writes are held", async () => {
    expect(await setup().profiles.edit({ name: "Sofi" })).toEqual({ ok: false, reason: "not-ready" });
    let blocked = false;
    const t = setup({ blocked: () => blocked });
    await t.profiles.create({ name: "Sofi" });
    blocked = true;
    expect(await t.profiles.edit({ name: "Sofía" })).toEqual({ ok: false, reason: "busy" });
    const held = setup({
      writeActive: async () => {
        throw new DataUnavailable("Switching profiles");
      },
    });
    await held.profiles.create({ name: "Sofi" });
    expect(await held.profiles.edit({ name: "Sofía" })).toEqual({ ok: false, reason: "busy" });
    expect(held.records.get(path.join(held.root, "sofi"))).toEqual({ name: "Sofi" });
  });
});

describe("profileResult (what the window gets)", () => {
  const known = { config: { language: "en", folder: "/w", engineId: "claude", profile: "sofi" } } as unknown as AppState;
  const fresh = { config: { language: "en", folder: "/w", engineId: "claude", profile: "tomas" } } as unknown as AppState;
  const quiet = () => vi.spyOn(console, "error").mockImplementation(() => {});

  it("adds the state to a change that went through; a refusal passes as it is", async () => {
    expect(await profileResult(Promise.resolve({ ok: true }), async () => fresh, () => known, async () => "tomas")).toEqual({ ok: true, state: fresh });
    const refusal = { ok: false as const, reason: "failed" as const, made: "tomas" };
    expect(await profileResult(Promise.resolve(refusal), async () => fresh, () => known, async () => null)).toEqual(refusal);
    quiet();
    expect(await profileResult(Promise.reject(new Error("x")), async () => fresh, () => known, async () => null)).toEqual({ ok: false, reason: "failed" });
  });

  it("a state that can't be read after a change that went through never makes it a refusal", async () => {
    quiet();
    let reads = 0;
    const flaky = async () => {
      reads++;
      if (reads === 1) throw new Error("once");
      return fresh;
    };
    expect(await profileResult(Promise.resolve({ ok: true }), flaky, () => known, async () => "tomas")).toEqual({ ok: true, state: fresh });
    const broken = async (): Promise<AppState> => {
      throw new Error("always");
    };
    const r = await profileResult(Promise.resolve({ ok: true }), broken, () => known, async () => "tomas");
    expect(r).toEqual({ ok: true, state: { config: { ...known.config, profile: "tomas" } } });
    expect(await profileResult(Promise.resolve({ ok: true }), broken, () => null, async () => "tomas")).toEqual({ ok: false, reason: "failed" });
  });
});
