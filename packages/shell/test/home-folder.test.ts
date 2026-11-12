import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type Layer, harnessLayer, writeLayers } from "../src/main/mods/home-folder";

let tmp: string;
let home: string;
let core: Layer;
let harness: Layer;

async function put(file: string, text: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, text);
}
const read = (file: string) => fs.readFile(file, "utf8");
const exists = (file: string) => fs.access(file).then(() => true, () => false);

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "hh-home-"));
  home = path.join(tmp, "userData", "demo", "app");
  // A core mod as the build copies it: mod.json, README.md and src/.
  const coreMod = path.join(tmp, "core-mods", "home");
  await put(path.join(coreMod, "mod.json"), '{ "id": "home" }');
  await put(path.join(coreMod, "README.md"), "# Home");
  await put(path.join(coreMod, "src", "ui.tsx"), "export {};");
  core = { mods: { home: coreMod }, layouts: {} };
  // A harness root with one declared mod and one layout.
  const root = path.join(tmp, "harness");
  await put(path.join(root, "mods", "echo", "mod.json"), '{ "id": "echo" }');
  await put(path.join(root, "mods", "echo", "main.js"), "export default {};");
  await put(path.join(root, "layouts", "main.json"), '{ "type": "row" }');
  harness = await harnessLayer(root, ["echo", "ghost"]);
});
afterEach(async () => {
  await fs.chmod(home, 0o755).catch(() => {});
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("harnessLayer", () => {
  it("takes the declared mods that exist and the root's layouts", () => {
    expect(harness).toEqual({ mods: { echo: path.join(tmp, "harness", "mods", "echo") }, layouts: { main: path.join(tmp, "harness", "layouts", "main.json") } });
  });
  it("is empty for a harness without mods or layouts", async () => {
    expect(await harnessLayer(path.join(tmp, "nothing"), ["echo"])).toEqual({ mods: {}, layouts: {} });
  });
});

describe("writeLayers", () => {
  it("a fresh start writes core/, harness/ and .layers.json", async () => {
    const notice = vi.fn();
    await writeLayers({ home, core, harness, notice });
    expect(await read(path.join(home, "core", "mods", "home", "mod.json"))).toBe('{ "id": "home" }');
    expect(await read(path.join(home, "core", "mods", "home", "README.md"))).toBe("# Home");
    expect(await read(path.join(home, "core", "mods", "home", "src", "ui.tsx"))).toBe("export {};");
    expect(await read(path.join(home, "harness", "mods", "echo", "main.js"))).toBe("export default {};");
    expect(await read(path.join(home, "harness", "layouts", "main.json"))).toBe('{ "type": "row" }');
    const layers = JSON.parse(await read(path.join(home, ".layers.json"))) as Record<string, string>;
    expect(Object.keys(layers).sort()).toEqual([
      "core/mods/home/README.md",
      "core/mods/home/mod.json",
      "core/mods/home/src/ui.tsx",
      "harness/layouts/main.json",
      "harness/mods/echo/main.js",
      "harness/mods/echo/mod.json",
    ]);
    expect(layers["core/mods/home/README.md"]).toMatch(/^[0-9a-f]{64}$/);
    expect(notice).not.toHaveBeenCalled();
  });

  it("a second start with no edit changes nothing", async () => {
    await writeLayers({ home, core, harness, notice: vi.fn() });
    const file = path.join(home, "core", "mods", "home", "mod.json");
    const before = (await fs.stat(file)).mtimeMs;
    const layers = await read(path.join(home, ".layers.json"));
    const notice = vi.fn();
    await new Promise((r) => setTimeout(r, 20));
    await writeLayers({ home, core, harness, notice });
    expect((await fs.stat(file)).mtimeMs).toBe(before);
    expect(await read(path.join(home, ".layers.json"))).toBe(layers);
    expect(await exists(path.join(home, "mods"))).toBe(false);
    expect(notice).not.toHaveBeenCalled();
  });

  it("moves an edited core mod to mods/<id>-edited, brings the original back and says so once", async () => {
    await writeLayers({ home, core, harness, notice: vi.fn() });
    await fs.writeFile(path.join(home, "core", "mods", "home", "README.md"), "# Mine");
    await fs.writeFile(path.join(home, "core", "mods", "home", "src", "ui.tsx"), "mine");
    const notice = vi.fn();
    await writeLayers({ home, core, harness, notice });
    expect(await read(path.join(home, "mods", "home-edited", "README.md"))).toBe("# Mine");
    expect(await read(path.join(home, "mods", "home-edited", "src", "ui.tsx"))).toBe("mine");
    expect(await read(path.join(home, "mods", "home-edited", "mod.json"))).toBe('{ "id": "home" }');
    expect(await read(path.join(home, "core", "mods", "home", "README.md"))).toBe("# Home");
    expect(await read(path.join(home, "core", "mods", "home", "src", "ui.tsx"))).toBe("export {};");
    expect(notice).toHaveBeenCalledTimes(1);
    expect(notice).toHaveBeenCalledWith("Your change to core/mods/home was moved to mods/home-edited; the original is back.");
  });

  it("adds -2 when the -edited name is taken", async () => {
    await writeLayers({ home, core, harness, notice: vi.fn() });
    await put(path.join(home, "mods", "home-edited", "mod.json"), "older");
    await fs.writeFile(path.join(home, "core", "mods", "home", "mod.json"), "mine");
    const notice = vi.fn();
    await writeLayers({ home, core, harness, notice });
    expect(await read(path.join(home, "mods", "home-edited", "mod.json"))).toBe("older");
    expect(await read(path.join(home, "mods", "home-edited-2", "mod.json"))).toBe("mine");
    expect(notice).toHaveBeenCalledWith("Your change to core/mods/home was moved to mods/home-edited-2; the original is back.");
  });

  it("moves an edited harness layout to layouts/<name>-edited.json", async () => {
    await writeLayers({ home, core, harness, notice: vi.fn() });
    await fs.writeFile(path.join(home, "harness", "layouts", "main.json"), '{ "type": "column" }');
    const notice = vi.fn();
    await writeLayers({ home, core, harness, notice });
    expect(await read(path.join(home, "layouts", "main-edited.json"))).toBe('{ "type": "column" }');
    expect(await read(path.join(home, "harness", "layouts", "main.json"))).toBe('{ "type": "row" }');
    expect(notice).toHaveBeenCalledWith("Your change to harness/layouts/main.json was moved to layouts/main-edited.json; the original is back.");
  });

  it("counts an unlisted extra file as an edit", async () => {
    await writeLayers({ home, core, harness, notice: vi.fn() });
    await put(path.join(home, "harness", "mods", "echo", "extra.js"), "added");
    const notice = vi.fn();
    await writeLayers({ home, core, harness, notice });
    expect(await read(path.join(home, "mods", "echo-edited", "extra.js"))).toBe("added");
    expect(await exists(path.join(home, "harness", "mods", "echo", "extra.js"))).toBe(false);
    expect(await read(path.join(home, "harness", "mods", "echo", "main.js"))).toBe("export default {};");
    expect(notice).toHaveBeenCalledTimes(1);
  });

  it("brings back a deleted file without a notice, and drops a mod the layer no longer has", async () => {
    await writeLayers({ home, core, harness, notice: vi.fn() });
    await fs.rm(path.join(home, "core", "mods", "home", "README.md"));
    const notice = vi.fn();
    await writeLayers({ home, core, harness: { mods: {}, layouts: harness.layouts }, notice });
    expect(await read(path.join(home, "core", "mods", "home", "README.md"))).toBe("# Home");
    expect(await exists(path.join(home, "harness", "mods", "echo"))).toBe(false);
    expect(Object.keys(JSON.parse(await read(path.join(home, ".layers.json"))) as object)).not.toContain("harness/mods/echo/main.js");
    expect(notice).not.toHaveBeenCalled();
  });

  it.skipIf(process.getuid?.() === 0)("logs and returns when the home folder is read-only", async () => {
    await fs.mkdir(home, { recursive: true });
    await fs.chmod(home, 0o555);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(writeLayers({ home, core, harness, notice: vi.fn() })).resolves.toBeUndefined();
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});
