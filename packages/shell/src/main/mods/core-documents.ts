// `ctx.app.documents` (minimal core step 4): the calls the core's reader, review and file timeline make on the app
// today, as the documents mod will make them.
import path from "node:path";
import type { CoreApp } from "@humanharness/mod-sdk/core";
import type { LoadedHarness } from "@humanharness/harness-sdk";
import type { ConfiguredApp } from "@humanharness/protocol";
import type { History } from "@humanharness/workspace";
import { openRoots } from "../open-path";
import type { TaskManager } from "../task-manager";

export interface CoreDocumentsDeps {
  /** The set-up app's config; null when it isn't set up. */
  validConfig(): Promise<ConfiguredApp | null>;
  baseOf(c: ConfiguredApp): string;
  workReferences(c: ConfiguredApp, base: string): Promise<{ path: string }[]>;
  currentHistory(): Promise<History | null>;
  tasks(): Pick<TaskManager, "trailerNow" | "runningTask" | "isBusy" | "whenSettled" | "reviewRound" | "documentApproved">;
  quitting(): boolean;
  turnBlocked(): string | null;
  actions(): Record<string, { label: string }>;
  harness(): Pick<LoadedHarness, "permissions" | "documents">;
  /** The folder of the built main process. */
  here: string;
}

/** An action's label as a file's timeline names it: a question has no action, and a gone action keeps its id. */
export function actionLabelOf(actions: Record<string, { label: string }>, id: string | null): string {
  if (id === null) return "A question";
  return Object.hasOwn(actions, id) ? actions[id].label : id;
}

export function coreDocuments(d: CoreDocumentsDeps): CoreApp["documents"] {
  return {
    canEdit: () => d.harness().permissions.edit === "folder",
    kinds: () => d.harness().documents?.kinds ?? {},
    async folder() {
      const c = await d.validConfig();
      if (!c) return null;
      const base = d.baseOf(c);
      return { base, roots: async () => openRoots(base, (await d.workReferences(c, base)).map((r) => r.path)) };
    },
    history: () => d.currentHistory(),
    trailer: () => d.tasks().trailerNow(),
    async openTask() {
      const t = await d.tasks().runningTask();
      return t ? { id: t.id, scope: t.scope } : null;
    },
    busy: () => d.tasks().isBusy(),
    whenSettled: (read) => d.tasks().whenSettled(read),
    blocked: () => (d.quitting() ? "The app is closing" : d.turnBlocked()),
    reviewRound: (round) => d.tasks().reviewRound(round),
    documentApproved: (approval) => d.tasks().documentApproved(approval),
    actionLabel: (id) => actionLabelOf(d.actions(), id),
    diffWorker: () => path.join(d.here, "diff-worker.js"),
  };
}
