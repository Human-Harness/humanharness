import type { Language, LocalizedText } from "@humanharness/harness-sdk";
import type { ActivityKind, EngineError, Event, LimitWindow } from "@humanharness/runtime";

export interface AppConfig {
  language?: Language;
  folder?: string;
  engineId?: string;
}

export interface EngineOption {
  id: string;
  name: string;
  status: "allowed" | "pending";
  requires: LocalizedText;
  dataLocation: LocalizedText;
}

export interface AppState {
  harness: { id: string; name: LocalizedText; languages: Language[] };
  config: AppConfig;
  /** Absolute suggested folder (e.g. ~/Documents/Demo). */
  suggestedFolder: string;
  engines: EngineOption[];
}

export interface ChatEntry {
  id: string;
  role: "user" | "assistant";
  text: string;
  blocks: { name: string; data: unknown }[];
  activities: { kind: ActivityKind; detail: string }[];
  at: string;
  error?: EngineError;
}

export interface HistoryItem {
  sha: string;
  message: string;
  date: string;
}

/** Why a folder can't be the harness folder. */
export type FolderProblem = "not-absolute" | "root" | "home" | "too-broad" | "protected";

/** A folder the user picked, and why it can't be used (null when it can). */
export interface FolderPick {
  folder: string;
  problem: FolderProblem | null;
}

/** Everything the renderer can ask the main process. Implemented by the preload as `window.hh`. */
export interface HarnessClient {
  getState(): Promise<AppState>;
  /** Null when the user cancelled the dialog. */
  pickFolder(defaultPath: string): Promise<FolderPick | null>;
  saveConfig(patch: AppConfig): Promise<AppState>;
  loadChat(): Promise<ChatEntry[]>;
  send(message: string): Promise<void>;
  cancel(): Promise<void>;
  onEvent(listener: (event: Event) => void): () => void;
  history(): Promise<HistoryItem[]>;
  restore(sha: string): Promise<void>;
}

export function isConfigured(config: AppConfig): config is Required<AppConfig> {
  return Boolean(config.language && config.folder && config.engineId);
}

export type { Event, EngineError, LimitWindow };
