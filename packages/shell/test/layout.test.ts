import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { layoutSchema } from "@humanharness/mod-sdk";
import defaultLayout from "../src/main/mods/default-layout.json";
import { pickLayout, shownLayout } from "../src/main/mods/layout";

let home: string;
const harnessFile = () => path.join(home, "harness", "layouts", "main.json");
const coreFile = () => path.join(home, "core", "layouts", "main.json");
async function put(file: string, text: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, text);
}
const exists = (f: string) => fs.access(f).then(() => true, () => false);
const custom = { type: "stack", children: [{ type: "block", id: "home", content: { mod: "home", block: "other" } }, { type: "block", id: "work", content: { core: "task" } }] };

beforeEach(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), "hh-layout-"));
  await put(coreFile(), JSON.stringify(defaultLayout));
});
afterEach(() => fs.rm(home, { recursive: true, force: true }));

describe("shownLayout", () => {
  it("the core's default layout parses", () => {
    expect(layoutSchema.safeParse(defaultLayout).success).toBe(true);
  });
  it("shows the core layout when the harness has none", async () => {
    const v = await shownLayout(home);
    expect(v).toMatchObject({ layout: defaultLayout, source: "core", name: "main", problems: [] });
  });
  it("shows the harness layout when it is valid", async () => {
    await put(harnessFile(), JSON.stringify(custom));
    const v = await shownLayout(home);
    expect(v.source).toBe("harness");
    expect(v.layout).toEqual(custom);
    expect(v.problems).toEqual([]);
  });
  it("an invalid harness layout writes .error and the core layout is shown", async () => {
    await put(harnessFile(), JSON.stringify({ type: "row", children: [] }));
    const v = await shownLayout(home);
    expect(v.source).toBe("core");
    expect(v.problems.length).toBeGreaterThan(0);
    const err = await fs.readFile(`${harnessFile()}.error`, "utf8");
    expect(err).toContain("The root must be a stack");
    expect(err.trimEnd().split("\n").map((l) => `harness/layouts/main.json: ${l}`)).toEqual(v.problems);
  });
  it("a file that is not JSON is a problem too", async () => {
    await put(harnessFile(), "{ nope");
    const v = await shownLayout(home);
    expect(v.source).toBe("core");
    expect(await exists(`${harnessFile()}.error`)).toBe(true);
  });
  it("fixing it removes the .error", async () => {
    await put(harnessFile(), "{}");
    await shownLayout(home);
    await put(harnessFile(), JSON.stringify(custom));
    const v = await shownLayout(home);
    expect(v.source).toBe("harness");
    expect(await exists(`${harnessFile()}.error`)).toBe(false);
  });
  it("a broken core file gets its .error and the built-in copy is used", async () => {
    await put(coreFile(), "{}");
    const v = await shownLayout(home);
    expect(v.layout).toEqual(defaultLayout);
    expect(v.source).toBe("core");
    expect(await exists(`${coreFile()}.error`)).toBe(true);
  });
  it("no core file at all uses the built-in copy", async () => {
    await fs.rm(coreFile());
    const v = await shownLayout(home);
    expect(v.layout).toEqual(defaultLayout);
  });
});

const userFile = (name: string) => path.join(home, "layouts", `${name}.json`);
const settingsFile = () => path.join(home, "settings.json");
const mine = { type: "stack", children: [{ type: "block", id: "home", content: { mod: "hello", block: "hello" } }, { type: "block", id: "work", content: { core: "task" } }] };

describe("the picked layout (0b2)", () => {
  it("a picked user layout wins", async () => {
    await put(harnessFile(), JSON.stringify(custom));
    await put(userFile("mine"), JSON.stringify(mine));
    await put(settingsFile(), JSON.stringify({ layout: "mine" }));
    const v = await shownLayout(home);
    expect(v).toMatchObject({ source: "user", name: "mine", picked: "mine", problems: [] });
    expect(v.layout).toEqual(mine);
  });
  it("a picked harness layout wins over main", async () => {
    await put(harnessFile(), JSON.stringify(custom));
    await put(path.join(home, "harness", "layouts", "focus.json"), JSON.stringify(mine));
    await put(settingsFile(), JSON.stringify({ layout: "focus" }));
    const v = await shownLayout(home);
    expect(v).toMatchObject({ source: "harness", name: "focus" });
    expect(v.layout).toEqual(mine);
  });
  it("an invalid picked layout writes its .error and falls back", async () => {
    await put(harnessFile(), JSON.stringify(custom));
    await put(userFile("mine"), JSON.stringify({ type: "row", children: [] }));
    await put(settingsFile(), JSON.stringify({ layout: "mine" }));
    const v = await shownLayout(home);
    expect(v).toMatchObject({ source: "harness", name: "main", picked: "mine" });
    expect(v.problems.length).toBeGreaterThan(0);
    expect(await fs.readFile(`${userFile("mine")}.error`, "utf8")).toContain("The root must be a stack");
  });
  it("a missing picked name falls back with a problem", async () => {
    await put(settingsFile(), JSON.stringify({ layout: "gone" }));
    const v = await shownLayout(home);
    expect(v).toMatchObject({ source: "core", name: "main", picked: "gone" });
    expect(v.problems.join("\n")).toContain("gone");
  });
  it("a settings.json that is not valid is a problem, and the default shows", async () => {
    await put(settingsFile(), "{ nope");
    const v = await shownLayout(home);
    expect(v.source).toBe("core");
    expect(v.problems.join("\n")).toContain("settings.json");
  });
  it("choices lists every layout in the three layers", async () => {
    await put(harnessFile(), JSON.stringify(custom));
    await put(path.join(home, "harness", "layouts", "focus.json"), JSON.stringify(mine));
    await put(userFile("mine"), JSON.stringify(mine));
    await put(`${userFile("mine")}.error`, "old");
    const v = await shownLayout(home);
    expect(v.choices).toEqual([
      { name: "mine", source: "user" },
      { name: "focus", source: "harness" },
      { name: "main", source: "harness" },
      { name: "main", source: "core" },
    ]);
  });
});

describe("pickLayout", () => {
  it("writes the pick, keeping other keys, and returns the new view", async () => {
    await put(userFile("mine"), JSON.stringify(mine));
    await put(settingsFile(), JSON.stringify({ other: 1 }));
    const v = await pickLayout(home, "mine");
    expect(v.source).toBe("user");
    expect(JSON.parse(await fs.readFile(settingsFile(), "utf8"))).toEqual({ other: 1, layout: "mine" });
  });
  it("null clears the key", async () => {
    await put(settingsFile(), JSON.stringify({ layout: "mine", other: 1 }));
    const v = await pickLayout(home, null);
    expect(v).toMatchObject({ source: "core", name: "main" });
    expect(v.picked).toBeUndefined();
    expect(JSON.parse(await fs.readFile(settingsFile(), "utf8"))).toEqual({ other: 1 });
  });
  it("creates settings.json when there is none", async () => {
    await pickLayout(home, "main");
    expect(JSON.parse(await fs.readFile(settingsFile(), "utf8"))).toEqual({ layout: "main" });
  });
  it("refuses a name that is not a plain file name", async () => {
    await expect(pickLayout(home, "../x")).rejects.toThrow();
    await expect(pickLayout(home, "")).rejects.toThrow();
  });
});
