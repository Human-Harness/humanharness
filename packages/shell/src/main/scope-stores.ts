import path from "node:path";
import { type LoadedHarness, PROFILE_COLLECTION, SETTINGS_COLLECTION, dataCollections } from "@humanharness/harness-sdk";
import type { ConfiguredApp, ScopesView } from "@humanharness/protocol";
import type { PushChannel } from "@humanharness/protocol/channels";
import { DataStore, MAIN_SCOPE, ScopeStore, migrateToScopes } from "@humanharness/workspace";
import type { DocumentSessions } from "./document-sessions";
import type { LinkedInstructions } from "./scope-access";
import type { MaterialService } from "./material";
import { isInsideFolder } from "./profile-base";
import type { Profiles } from "./profiles";
import { searchableCollection } from "./search/data-sources";
import type { SearchService } from "./search/service";
import type { SettingsController } from "./settings";
import type { SetupSteps } from "./setup-steps";
import type { TaskManager } from "./task-manager";

/** What the scope and data stores read from the main entry. Getters for what changes after they are built. */
export interface ScopeStoresDeps {
  harness(): LoadedHarness;
  validConfig(): Promise<ConfiguredApp | null>;
  baseOf(c: { folder: string; profile?: string }): string;
  scoped(): boolean;
  sendToWindow(channel: PushChannel, value: unknown): void;
  searchSvc(): Pick<SearchService, "dataChanged">;
  settingsCtl(): SettingsController | null;
  profilesCtl(): Profiles | null;
  setupCtl(): SetupSteps | null;
  materialSvc(): MaterialService | null;
  tasks(): Pick<TaskManager, "currentScope" | "switchScope" | "view">;
  linked_(): { instructions: LinkedInstructions } | null;
  documentSessions: Pick<DocumentSessions, "closeAll">;
  jobsChanged(): void;
  jobsReady(): Promise<void>;
  kickMaterial(): void;
  interruptTasks(): Promise<void>;
  rebasePlugins(): Promise<void>;
  backendScopes(): Promise<void>;
  backendLeaveBase(): Promise<void>;
  backendRebase(): Promise<void>;
}

/** The per-base scope and data stores, and the scopes' migration and view. */
export function createScopeStores(d: ScopeStoresDeps) {
  const { validConfig, baseOf, scoped, sendToWindow } = d;

  /** Whether `id` is in the configured folder's registry and not archived. */
  async function activeScope(id: string): Promise<boolean> {
    const c = await validConfig();
    return c ? (await scopeStoreFor(baseOf(c)).list()).some((s) => s.id === id && !s.archived) : false;
  }

  /** One registry per base, so its write queue orders every change. */
  const scopeStores = new Map<string, ScopeStore>();
  function scopeStoreFor(base: string): ScopeStore {
    let store = scopeStores.get(base);
    if (!store) {
      store = new ScopeStore(base);
      scopeStores.set(base, store);
    }
    return store;
  }

  /**
   * One data store per base, so its write queue orders every write: the person's (hh:data) and the agent's
   * (its data tools). Every caller gets the store from here, never with `new DataStore`.
   */
  const dataStores = new Map<string, { store: DataStore; off: () => void }>();
  function dataStoreFor(base: string): DataStore {
    let entry = dataStores.get(base);
    if (!entry) {
      const harness = d.harness();
      // The harness's collections, plus the reserved `settings` one when it declares settings (D0: harness.data itself).
      const store = new DataStore(base, dataCollections(harness));
      // Spec §4.5 `subscribe`: every write, from any writer, reaches the window. A settings write also reaches AGENTS.md
      // once no task is open (harness-settings D4): the controller only marks it stale and queues the rewrite.
      entry = {
        store,
        off: store.onChange((change) => {
          sendToWindow("hh:dataChange", change);
          // Search (D0): a no-op until the palette first opened; then a searchable collection is read again.
          if (searchableCollection(dataCollections(d.harness()), change.collection)) d.searchSvc().dataChanged();
          if (change.collection === SETTINGS_COLLECTION) void d.settingsCtl()?.changed();
          // Profiles: the registry copies the record's name and colour (spec §4), whoever wrote it. Never rejects.
          if (change.collection === PROFILE_COLLECTION) void d.profilesCtl()?.sync(path.resolve(base));
        }),
      };
      dataStores.set(base, entry);
    }
    return entry.store;
  }

  /** The folder changed or moved: the old base's store goes, with its listener. */
  function dropDataStore(base: string): void {
    dataStores.get(base)?.off();
    dataStores.delete(base);
  }

  /** Every store under `root` (the folder itself, or each profile's): a moved or changed folder drops them all. */
  function dropDataStoresUnder(root: string): void {
    for (const base of [...dataStores.keys()]) if (isInsideFolder(base, root)) dropDataStore(base);
  }

  /** The last migration run (settleScopes). Scope requests wait for it, whether it worked or not. */
  let scopesReady: Promise<unknown> = Promise.resolve();
  const scopesSettled = (): Promise<void> => scopesReady.then(() => undefined, () => undefined);

  async function scopesView(): Promise<ScopesView> {
    await scopesSettled();
    const c = await validConfig();
    if (!c || !scoped()) return { open: null, list: [] };
    // Linked folders reach the window only through their own channel, signed ones only (hatches L1); an engine approval
    // only through the Engine config view (its tag is the app's). D0: no key to drop.
    const list = (await scopeStoreFor(baseOf(c)).list())
      .map(({ linked: _linked, ...s }) => s)
      .map(({ engineApproval: _approval, ...s }) => s);
    return { open: await d.tasks().currentScope(), list };
  }

  async function scopesChanged(): Promise<void> {
    // A scope made, archived or brought back: the Jobs section's rows follow (each active scope has its own).
    d.jobsChanged();
    // A running backend hears the active scopes and their links (hatches spec §4.2). Without one, nothing (D0).
    void d.backendScopes().catch((err: unknown) => console.error("Could not tell the backend the scopes", err));
    try {
      sendToWindow("hh:scopes", await scopesView());
    } catch (err) {
      console.error("Could not send the scopes to the window", err);
    }
  }

  /**
   * A profile switch arrived (profiles spec §5): a task left open there by a crash ends, the settings and AGENTS.md are
   * read afresh, the scopes migrate and are sent, and the setup steps and tasks of the new folder reach the window.
   */
  async function arrivedInProfile(): Promise<void> {
    // Before anything reads the new base: the old profile's plugins stop, and nothing of theirs reaches the new one.
    await d.rebasePlugins();
    // The old profile's backend too: stopped now, started in the new one once its scopes are settled (below).
    await d.backendLeaveBase();
    // Another profile is another folder: the reader's watches were checked against the old one.
    d.documentSessions.closeAll();
    await d.interruptTasks();
    d.settingsCtl()?.forget();
    await d.settingsCtl()?.changed();
    // The new profile's open scope and links reach AGENTS.md (hatches). Nothing without linked folders.
    void d.linked_()?.instructions.changed();
    await settleScopes();
    await scopesChanged();
    const setupCtl = d.setupCtl();
    if (setupCtl) sendToWindow("hh:setupSteps", await setupCtl.state());
    sendToWindow("hh:tasks", await d.tasks().view());
    // The new profile's material: what an earlier run (or the switch) left converting resumes, and its AI stages run.
    // Without material, nothing (D0).
    void d.materialSvc()?.settle().catch((err: unknown) => console.error("Could not resume the material", err));
    d.kickMaterial();
    // A profile chosen for the first time in this process: the jobs' start runs (Decision 7). Without jobs, nothing.
    void d.jobsReady().catch((err: unknown) => console.error("Could not start the jobs", err));
    // The backend follows the base: started, or stopped and started in the new profile. Without one, nothing (D0).
    void d.backendRebase().catch((err: unknown) => console.error("Could not move the backend to the profile", err));
  }

  async function scopeStore(): Promise<ScopeStore> {
    // A scope created before the migration ran would write scopes.json first and leave the earlier notes behind.
    await scopesSettled();
    const c = await validConfig();
    if (!c) throw new Error("The app is not set up yet");
    if (!scoped()) throw new Error("This harness has no scopes");
    return scopeStoreFor(baseOf(c));
  }

  /**
   * A harness with scopes in a folder used without them (spec §3.2): earlier work moves into `main`, which opens.
   * `main` is registered through the app's own store, so it queues with the person's changes.
   */
  function settleScopes(): Promise<void> {
    const run = scopesSettled().then(async () => {
      const c = await validConfig();
      if (!c || !scoped()) return;
      const base = baseOf(c);
      if (await migrateToScopes(base, undefined, scopeStoreFor(base))) await d.tasks().switchScope(MAIN_SCOPE);
    });
    scopesReady = run;
    return run;
  }

  return {
    activeScope,
    scopeStoreFor,
    dataStoreFor,
    dropDataStoresUnder,
    scopesSettled,
    scopesView,
    scopesChanged,
    arrivedInProfile,
    scopeStore,
    settleScopes,
  };
}
