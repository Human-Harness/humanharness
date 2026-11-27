// A profile switch arrives: the core mods hear it (Sidekick reads its settings and the new base again), with no
// Sidekick object in the core.
import { describe, expect, it, vi } from "vitest";
import { type ScopeStoresDeps, createScopeStores } from "../src/main/scope-stores";

/** Scope stores with nothing set up: no config, no scopes, no controllers. */
function deps(o: Partial<ScopeStoresDeps> = {}): ScopeStoresDeps {
  return {
    harness: () => ({ id: "h", name: "H", actions: {}, data: {} }) as never,
    validConfig: async () => null,
    baseOf: (c) => c.folder,
    scoped: () => false,
    sendToWindow: () => {},
    events: () => ({ dataChanged: () => {}, folderChanged: () => {} }),
    settingsCtl: () => null,
    profilesCtl: () => null,
    setupCtl: () => null,
    materialSvc: () => null,
    tasks: () => ({ currentScope: async () => null, switchScope: async () => {}, view: async () => ({}) }) as never,
    linked_: () => null,
    jobsChanged: () => {},
    jobsReady: async () => {},
    kickMaterial: () => {},
    interruptTasks: async () => {},
    rebasePlugins: async () => {},
    backendScopes: async () => {},
    backendLeaveBase: async () => {},
    backendRebase: async () => {},
    ...o,
  };
}

describe("a profile switch arrives", () => {
  it("tells the core mods to refresh once the new base is settled", async () => {
    const refresh = vi.fn(async () => {});
    await createScopeStores(deps({ modHost: () => ({ refresh }) })).arrivedInProfile();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("says the folder changed, so the documents mod closes the reader's watches", async () => {
    const order: string[] = [];
    const events = () => ({ dataChanged: () => {}, folderChanged: () => void order.push("folderChanged") });
    await createScopeStores(deps({ events })).arrivedInProfile();
    expect(order).toEqual(["folderChanged"]);
  });

  it("without a mod host, nothing (D0)", async () => {
    await expect(createScopeStores(deps()).arrivedInProfile()).resolves.toBeUndefined();
  });
});
