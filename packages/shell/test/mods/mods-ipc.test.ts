import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { registerModsIpc } from "../../src/main/mods/mods-ipc";

const fx = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../fixtures/mods");

function setup(pick: string | null) {
  const handlers = new Map<string, (...a: never[]) => unknown>();
  const handle = (c: string, fn: (...a: never[]) => unknown) => void handlers.set(c, fn);
  const deps = {
    view: vi.fn(async () => ({ mods: [], problems: [] })),
    set: vi.fn(async () => {}),
    pickFolder: vi.fn(async () => pick),
    addLocal: vi.fn(async () => {}),
    removeLocal: vi.fn(async () => {}),
    isLocal: (id: string) => id === "broken",
  };
  registerModsIpc(handle as never, deps);
  const call = (c: string, ...a: unknown[]) => (handlers.get(c) as (...x: unknown[]) => Promise<unknown>)(...a);
  return { call, deps };
}

describe("mods IPC", () => {
  it("lists, and refuses a malformed switch", async () => {
    const { call, deps } = setup(null);
    await call("hh:mods");
    await expect(call("hh:modSet", "Bad!", true)).rejects.toThrow();
    await expect(call("hh:modSet", "echo", "yes")).rejects.toThrow();
    await call("hh:modSet", "echo", true);
    expect(deps.set).toHaveBeenCalledWith("echo", true);
  });
  it("add: reviews the picked folder and adds it only with the matching token", async () => {
    const { call, deps } = setup(path.join(fx, "echo"));
    const r = (await call("hh:modReviewLocal")) as { review: { id: string; folder: string }; token: string };
    expect(r.review).toMatchObject({ id: "echo", name: "Echo", folder: path.join(fx, "echo") });
    await expect(call("hh:modAddLocal", "0".repeat(32))).rejects.toThrow();
    await call("hh:modAddLocal", r.token);
    expect(deps.addLocal).toHaveBeenCalledWith(path.join(fx, "echo"));
    await expect(call("hh:modAddLocal", r.token)).rejects.toThrow(); // one-time
  });
  it("add: a cancelled dialog answers null; a folder without a valid mod.json answers its problem", async () => {
    expect(await setup(null).call("hh:modReviewLocal")).toBeNull();
    expect(await setup(path.join(fx, "badjson")).call("hh:modReviewLocal")).toMatchObject({ problem: expect.stringContaining("mod.json") });
  });
  it("remove only applies to local mods", async () => {
    const { call, deps } = setup(null);
    await expect(call("hh:modRemoveLocal", "echo")).rejects.toThrow();
    await call("hh:modRemoveLocal", "broken");
    expect(deps.removeLocal).toHaveBeenCalledWith("broken");
  });
});
