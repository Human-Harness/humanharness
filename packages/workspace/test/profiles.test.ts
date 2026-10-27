import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { PROFILE_TITLE_MAX, ProfileStore, cleanProfileTitle, isProfileId, profileDir, profileSlug } from "../src";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "hh-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
const tmp = () => fs.mkdtempSync(path.join(root, "t-"));
const at = () => new Date("2026-10-27T10:00:00.000Z");

describe("profile ids and titles", () => {
  it("slugs the first name and numbers it when taken", () => {
    expect(profileSlug("Sofi", new Set())).toBe("sofi");
    expect(profileSlug("Sofi", new Set(["sofi"]))).toBe("sofi-2");
    expect(profileSlug("Tomás Pérez", new Set())).toBe("tomas-perez");
    expect(profileSlug("!!!", new Set())).toBe("profile");
    expect(profileSlug("a".repeat(100), new Set())).toHaveLength(32);
  });

  it("an id is lowercase letters, digits and dashes", () => {
    expect(isProfileId("sofi-2")).toBe(true);
    for (const bad of ["", "Sofi", "../x", ".harness", "-a", "a".repeat(41), 3]) expect(isProfileId(bad)).toBe(false);
  });

  it("a title is one line of 1 to 40 characters", () => {
    expect(cleanProfileTitle("  Sofi\n Pérez ")).toBe("Sofi Pérez");
    expect(() => cleanProfileTitle("  ")).toThrow(/name/);
    expect(() => cleanProfileTitle("x".repeat(PROFILE_TITLE_MAX + 1))).toThrow(/name/);
  });

  it("a profile's folder is its id inside the app's folder; anything else throws", () => {
    expect(profileDir("/f", "sofi")).toBe(path.join("/f", "sofi"));
    expect(() => profileDir("/f", "../etc")).toThrow(/profile/);
  });
});

describe("ProfileStore", () => {
  it("starts empty; creates, lists in creation order and reads back", async () => {
    const folder = tmp();
    const store = new ProfileStore(folder, at);
    expect(await store.list()).toEqual([]);
    const sofi = await store.create("Sofi", "coral");
    const tomas = await store.create("Tomás");
    expect(sofi).toEqual({ id: "sofi", title: "Sofi", color: "coral", createdAt: "2026-10-27T10:00:00.000Z", archived: false });
    expect(tomas.id).toBe("tomas");
    expect((await new ProfileStore(folder).list()).map((p) => p.id)).toEqual(["sofi", "tomas"]);
    expect(JSON.parse(fs.readFileSync(path.join(folder, ".harness", "profiles.json"), "utf8"))).toMatchObject({ version: 1, profiles: [{ id: "sofi" }, { id: "tomas" }] });
  });

  it("never reuses a name the root folder already has, in any case", async () => {
    const folder = tmp();
    fs.mkdirSync(path.join(folder, "Sofi"));
    fs.writeFileSync(path.join(folder, "notes"), "x");
    const store = new ProfileStore(folder, at);
    expect((await store.create("Sofi")).id).toBe("sofi-2");
    expect((await store.create("Notes")).id).toBe("notes-2");
  });

  it("two creates at once get two ids", async () => {
    const store = new ProfileStore(tmp(), at);
    const [a, b] = await Promise.all([store.create("Sofi"), store.create("Sofi")]);
    expect([a.id, b.id].sort()).toEqual(["sofi", "sofi-2"]);
  });

  it("keeps the id when the title changes; drops a colour that isn't a plain word", async () => {
    const store = new ProfileStore(tmp(), at);
    await store.create("Sofi", "coral");
    expect(await store.setIdentity("sofi", { title: "Sofía", color: "teal" })).toMatchObject({ id: "sofi", title: "Sofía", color: "teal" });
    expect(await store.setIdentity("sofi", { title: "Sofía", color: "#ff0000" })).not.toHaveProperty("color");
    await expect(store.setIdentity("nobody", { title: "X" })).rejects.toThrow(/Unknown profile/);
  });

  it("archives, brings back and removes", async () => {
    const store = new ProfileStore(tmp(), at);
    await store.create("Sofi");
    await store.create("Tomás");
    expect((await store.setArchived("tomas", true)).archived).toBe(true);
    expect((await store.setArchived("tomas", false)).archived).toBe(false);
    await store.remove("tomas");
    expect((await store.list()).map((p) => p.id)).toEqual(["sofi"]);
    await expect(store.remove("tomas")).rejects.toThrow(/Unknown profile/);
  });

  it("sets a file that isn't JSON aside; keeps only entries with a valid id and title, once each", async () => {
    const folder = tmp();
    fs.mkdirSync(path.join(folder, ".harness"));
    fs.writeFileSync(path.join(folder, ".harness", "profiles.json"), "{");
    expect(await new ProfileStore(folder).list()).toEqual([]);
    expect(fs.readdirSync(path.join(folder, ".harness")).some((f) => f.startsWith("profiles.json.corrupt-"))).toBe(true);
    fs.writeFileSync(
      path.join(folder, ".harness", "profiles.json"),
      JSON.stringify({ version: 1, profiles: [{ id: "sofi", title: "Sofi" }, { id: "sofi", title: "Again" }, { id: "../x", title: "Bad" }, { id: "tomas", title: "" }, "junk"] }),
    );
    expect(await new ProfileStore(folder).list()).toEqual([{ id: "sofi", title: "Sofi", createdAt: "", archived: false }]);
  });
});
