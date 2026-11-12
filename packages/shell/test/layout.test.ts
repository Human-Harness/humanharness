import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { layoutSchema } from "@humanharness/mod-sdk";
import defaultLayout from "../src/main/mods/default-layout.json";
import { shownLayout } from "../src/main/mods/layout";

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
    expect(v).toEqual({ layout: defaultLayout, source: "core", problems: [] });
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
    expect(err.trimEnd().split("\n")).toEqual(v.problems);
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
