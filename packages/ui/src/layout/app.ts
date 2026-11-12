import { createContext, useContext } from "react";
import type { FolderMove } from "../BackupNotice";
import type { AppState, EngineStatus, HarnessClient, LimitWindow, SetupStepsState } from "../client";
import type { LanguageControl } from "../language-control";
import type { SearchIntent } from "../search/intent";

/**
 * What a core mod's block gets as `app` (minimal-core step 0b1): what Home needs today. Internal to the core mods;
 * its public typing is step 0b2's `hh.d.ts`.
 */
export interface AppValue {
  state: AppState;
  client: HarnessClient;
  setState: (s: AppState) => void;
  status: EngineStatus | null;
  checkFailed: boolean;
  limits: LimitWindow[] | null;
  steps: SetupStepsState | null;
  move: FolderMove;
  language: LanguageControl | undefined;
  /** The ways out of the screen a block may take. */
  nav: {
    start(): void;
    setup(step?: string): void;
    settings(): void;
    engine(): void;
    addProfile(): void;
    open(intent: SearchIntent): void;
  };
}

const AppContext = createContext<AppValue | null>(null);
export const AppProvider = AppContext.Provider;

/** The app, for the layout and its blocks. */
export function useApp(): AppValue {
  const app = useContext(AppContext);
  if (!app) throw new Error("useApp needs an AppProvider");
  return app;
}
