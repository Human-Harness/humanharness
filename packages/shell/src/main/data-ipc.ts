import { type LoadedHarness, dataCollections } from "@humanharness/harness-sdk";
import { type History, dataDiffOf } from "@humanharness/workspace";

export interface DataIpcDeps {
  harness(): LoadedHarness;
  scopesSettled(): Promise<void>;
  /** The harness UI's data requests. */
  harnessUiData(request: unknown, options: unknown): unknown;
  currentHistory(): Promise<History | null>;
}

/** The harness UI's data channels: its requests and a task's data changes. */
export function dataIpc(d: DataIpcDeps) {
  const { scopesSettled, harnessUiData, currentHistory } = d;
  return {
    "hh:data": async (request: unknown, options: unknown) => {
      // After the migration: it opens `main`, the scope a request made on mount acts in.
      await scopesSettled();
      return harnessUiData(request, options);
    },
    "hh:dataDiff": async (taskId: unknown) => {
      if (typeof taskId !== "string" || taskId.length === 0 || taskId.length > 200) return [];
      const history = await currentHistory();
      return history ? dataDiffOf(history, taskId, dataCollections(d.harness())) : [];
    },
  };
}
