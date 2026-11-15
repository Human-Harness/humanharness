import { promises as fs } from "node:fs";
import { app } from "electron";
import type { BackendInit } from "@humanharness/harness-sdk";
import type { LifecycleDeps } from "../index";
import { BackendGeneration, backendInit, usableLinks } from "./backend-ipc";

/** The harness backend's start, rebase, scopes update and stop as the app's base changes (hatches spec §4). */
export interface BackendWiring {
  backendReady(): Promise<void>;
  backendRebase(): Promise<void>;
  backendScopes(): Promise<void>;
  backendLeaveBase(): Promise<void>;
}

/** Built once in the main entry; `d` reads its state (the start-up blocks' getters) when a call needs it. */
export function createBackendWiring(d: () => LifecycleDeps): BackendWiring {
  /** The backend was started in this process (Decision 5): from then on a base change is a rebase. */
  let backendStarted = false;
  /** Bumped when the backend's base changes: a scopes update read before it is stale and dropped. */
  const backendGen = new BackendGeneration();

  /**
   * The backend's `init` for the base the app is in now (hatches Decisions 3, 4), its data folder made; null before
   * setup. Each scope's links are the ones a turn there would use (the scope access's checks), none without linked folders.
   */
  async function backendInitNow(): Promise<BackendInit | null> {
    await d().scopesSettled();
    const c = await d().validConfig();
    if (!c) return null;
    const base = d().baseOf(c);
    const profile = d().profilesOn() ? (c.profile ?? "") : "";
    const scopes = d().scoped() ? await d().scopeStoreFor(base).list() : [];
    const access = d().linked_()?.access;
    const init = backendInit({
      base,
      scopes,
      ...(access ? { links: await usableLinks(scopes, (id) => access.entries(id)) } : {}),
      language: c.language,
      coreVersion: app.getVersion(),
      userData: app.getPath("userData"),
      ...(profile ? { profile } : {}),
      mock: d().hooks.mock === true,
    });
    await fs.mkdir(init.dataDir, { recursive: true });
    return init;
  }

  /** The backend starts the first time the app is set up in this process (Decision 5); never while quitting. */
  async function backendReady(): Promise<void> {
    const b = d().backend;
    if (!b || d().quitting || backendStarted) return;
    backendGen.bump();
    // Null when another start, rebase or profile switch began meanwhile: that one's base wins.
    const init = await backendGen.readFresh(backendInitNow);
    if (!init || d().quitting || backendStarted) return;
    backendStarted = true;
    await b.start(init);
  }

  /** The base changed (profile switch, another folder, a move's end): a started backend starts again there. */
  async function backendRebase(): Promise<void> {
    const b = d().backend;
    if (!b || d().quitting) return;
    if (!backendStarted) return backendReady();
    backendGen.bump();
    // Null when a later rebase or profile switch began meanwhile: this base is already stale.
    const init = await backendGen.readFresh(backendInitNow);
    if (init && !d().quitting) await b.rebase(init);
  }

  async function backendScopes(): Promise<void> {
    const b = d().backend;
    if (!b || !backendStarted || d().quitting) return;
    // Null when a rebase began meanwhile: its own init is newer than these scopes.
    const init = await backendGen.readFresh(backendInitNow);
    // The supervisor drops scopes of another folder (Settings changed it; the rebase comes after).
    if (init) b.scopesChanged(init.scopes, init.folder);
  }

  /** A profile switch begins: a started backend stops before anything reads the new base (backendRebase starts it). */
  async function backendLeaveBase(): Promise<void> {
    backendGen.bump();
    const b = d().backend;
    if (b && backendStarted) await b.stop().catch((err: unknown) => console.error("Could not stop the backend", err));
  }

  return { backendReady, backendRebase, backendScopes, backendLeaveBase };
}
