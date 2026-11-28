import { type ComponentType, type ReactNode, createContext, createElement, useContext, useSyncExternalStore } from "react";
import type { ActionOption, AppState, HarnessClient, HistoryFileChange, UsageSummary } from "../client";
import type { IconName } from "../guide/icons";
import type { AppValue } from "./app";

/** What a mod's block gets: the `props` the layout gives it and the app (minimal-core spec §5.2). */
export interface BlockProps {
  props: Record<string, unknown>;
  app: AppValue;
}
export type BlockComponent = ComponentType<BlockProps>;

/** What every Settings part of a mod gets: the app's client and state. */
export interface SettingsAppProps {
  client: HarnessClient;
  state: AppState;
}
/** A mod's Settings tab: `openTab` goes to another tab (by its id). */
export interface SettingsTabProps extends SettingsAppProps {
  openTab(id: string): void;
}
/**
 * A mod's Settings tab, besides its component: `label` is its button's name; `shown` says whether this state shows it
 * (default: always); `useLabel`, a hook the sheet calls while it is open, gives a name that changes (default `label`).
 */
export interface SettingsTabOptions {
  label: string;
  shown?(state: AppState): boolean;
  useLabel?(app: SettingsAppProps): string;
}
/** A task row the Models tab draws the core's way: a level picker for the task `key` (its `models.tasks` entry). */
export interface ModelsTaskRow {
  key: string;
  label: string;
  description?: string;
}
/** A mod's row in Settings › Models: `taskRow` draws a task row like the core's own. */
export interface ModelsRowProps extends SettingsAppProps {
  taskRow(row: ModelsTaskRow): ReactNode;
}
/** A mod's line in Settings › Usage: the usage the tab read (null until it is read). */
export interface UsageRowProps extends SettingsAppProps {
  usage: UsageSummary | null;
}
/** What a mod's row gets: the app's client and state, and its place's own (`taskRow` in Models, `usage` in Usage). */
export type RowProps = SettingsAppProps & Partial<Pick<ModelsRowProps, "taskRow"> & Pick<UsageRowProps, "usage">>;
/** A mod's row, besides its component: `shown` says whether it has something to draw (default: always). */
export interface RowOptions {
  shown?(props: RowProps): boolean;
}
/** Where a mod's `row` goes: Settings › Models' task rows, or Settings › Usage's lines apart from the tasks. */
export type RowPlace = "models" | "usage";
/** A mod's piece in the task bar: the open task's id, or null. */
export interface TaskBarProps {
  task: string | null;
}
/** The button that opens a mod's right overlay, in the task bar. */
export interface OverlayButtonProps {
  expanded: boolean;
  /** The overlay's element id (for `aria-controls`). */
  controls: string;
  onOpen(): void;
  /** Put on the button: a close gives it focus back. */
  buttonRef(el: HTMLElement | null): void;
}
/** A mod's right overlay's content. */
export interface OverlayPanelProps {
  close(): void;
}
/** What a mod's review of a send says: send it as it is, or hold it (the mod shows why; the draft stays). */
export type ReviewVerdict = "send" | "hold";
/**
 * A mod's reviewer for the composer and the answer form: Enter reviews first (with the countdown and Send now), ⌥⏎
 * forces a review, ⌘⏎ sends at once. `signal` aborts when the person sends at once or the form goes.
 */
export interface ComposerReviewer {
  /** Spans of the draft to underline, `[start, end)`. */
  marks?(draft: string): readonly (readonly [number, number])[];
  review(text: string, signal: AbortSignal, o: { force: boolean; answer: boolean }): Promise<ReviewVerdict>;
  /** The longest wait for a review, in seconds, or "always" (default 6). */
  wait?: number | "always";
}

/**
 * What a mod's task page gets: the props the core's History panel gets, plus the client. `onBack` goes back to the
 * chat; `onRestored` says a restore went through (the chat notes it and refreshes); `onOpenFile` opens a changed file.
 */
export interface TaskPageProps {
  client: HarnessClient;
  actions: Record<string, ActionOption>;
  /** A past task search asked the page to open at. */
  openTask?: string;
  currentTask?: string;
  undoByFiles?: boolean;
  jobs?: { id: string; label: string }[];
  linkedFolders?: Record<string, { label: string }>;
  /** Going back is not allowed while a turn is live. */
  disabled: boolean;
  onBack(): void;
  onRestored(kind: "task" | "point"): void;
  onOpenFile(path: string, kind: HistoryFileChange["kind"]): void;
}
/** A mod's task page: its rail entry (icon and label) and the title the page takes the work screen with. */
export interface TaskPageOptions {
  name: string;
  rail: { icon: IconName; label: string };
  title: string;
}

/**
 * A file the task view opens: a `.md` link, a card, a History link, `client.openDocument` and the rest. `agent` names
 * who wrote it (a card), `timeline` asks for the document with its history shown, `historyOnly` for the history alone
 * (a file that is not a `.md`, or was deleted).
 */
export interface FileTarget {
  path: string;
  anchor?: string;
  agent?: string;
  timeline?: boolean;
  historyOnly?: boolean;
}
/** What a mod's panel in the reader's slot gets: what it was opened with, and the task view's side of the slot. */
export interface PanelProps {
  /** What `open(props)` was last given. */
  props: unknown;
  client: HarnessClient;
  state: AppState;
  /** A turn runs, or the task is saving its note. */
  busy: boolean;
  /** The panel takes the whole body. */
  full: boolean;
  onFull(full: boolean): void;
  onClose(): void;
  /** Opens a file the way the chat does. */
  openFile(target: FileTarget): void;
  /** A file the chat has a card for is gone: the chat checks its cards again. */
  onMissing(): void;
  /** The task view is quiet (`taskView.quiet`). */
  quiet: boolean;
}

/** What each slot holds, by kind; each entry names the mod that registered it. */
export interface Slots {
  settingsTab: { mod: string; name: string; Component: ComponentType<SettingsTabProps> } & SettingsTabOptions;
  row: { mod: string; place: RowPlace; Component: ComponentType<RowProps> } & RowOptions;
  taskBar: { mod: string; Component: ComponentType<TaskBarProps> };
  taskOverlay: { mod: string; name: string; Button: ComponentType<OverlayButtonProps>; Panel: ComponentType<OverlayPanelProps> };
  composer: { mod: string; reviewer: ComposerReviewer };
  taskPage: { mod: string; name: string; rail: TaskPageOptions["rail"]; title: string; Page: ComponentType<TaskPageProps> };
  /** What opens files; the last one counts. */
  opener: { mod: string; open(target: FileTarget): void };
  /** The panel open in the reader's slot (one at a time). */
  openPanel: { mod: string; Component: ComponentType<PanelProps>; props: unknown; close(): void };
  /** Holds the task view quiet while it is there. */
  quiet: { mod: string; end(): void };
}
export type SlotKind = keyof Slots;

/** The blocks mods registered, by mod id and block name, and the parts they put in the core's slots. */
export interface BlockRegistry {
  /** Registers `Component` as `modId`'s block `name`; the disposer takes it away again (only if it is still that one). */
  register(modId: string, name: string, Component: BlockComponent): () => void;
  get(modId: string, name: string): BlockComponent | undefined;
  /** Puts `entry` in the slot `kind`, after the ones there; the disposer takes it away again. */
  add<K extends SlotKind>(kind: K, entry: Slots[K]): () => void;
  /** What the slot `kind` holds, in the order it was put there. */
  slot<K extends SlotKind>(kind: K): readonly Slots[K][];
  /** Calls `listener` on each change; returns the unsubscribe. */
  subscribe(listener: () => void): () => void;
  /** A number that changes on each change (for `useSyncExternalStore`). */
  version(): number;
}

export function createBlockRegistry(): BlockRegistry {
  const blocks = new Map<string, BlockComponent>();
  const slots: { [K in SlotKind]: Slots[K][] } = { settingsTab: [], row: [], taskBar: [], taskOverlay: [], composer: [], taskPage: [], opener: [], openPanel: [], quiet: [] };
  const listeners = new Set<() => void>();
  let version = 0;
  const key = (modId: string, name: string) => `${modId}/${name}`;
  const changed = () => {
    version += 1;
    for (const l of listeners) l();
  };
  return {
    register(modId, name, Component) {
      const k = key(modId, name);
      blocks.set(k, Component);
      changed();
      return () => {
        if (blocks.get(k) !== Component) return;
        blocks.delete(k);
        changed();
      };
    },
    get: (modId, name) => blocks.get(key(modId, name)),
    add(kind, entry) {
      // A fresh list on each change: a render that read the old one keeps it whole.
      slots[kind] = [...slots[kind], entry] as never;
      changed();
      return () => {
        const list = slots[kind] as unknown[];
        if (!list.includes(entry)) return;
        slots[kind] = list.filter((e) => e !== entry) as never;
        changed();
      };
    },
    slot: (kind) => slots[kind],
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    version: () => version,
  };
}

/** The app's own registry: the one the screen uses unless a `ModBlocksProvider` gives another. */
export const appRegistry = createBlockRegistry();

/** Registers a block in the app's registry; returns the disposer. */
export const registerBlock = (modId: string, name: string, Component: BlockComponent): (() => void) => appRegistry.register(modId, name, Component);
/** The block `modId` registered as `name` in the app's registry. */
export const blockFor = (modId: string, name: string): BlockComponent | undefined => appRegistry.get(modId, name);

const BlocksContext = createContext<BlockRegistry>(appRegistry);

/** Gives the layout under it another registry (tests give their own). */
export function ModBlocksProvider({ registry, children }: { registry: BlockRegistry; children: ReactNode }) {
  return createElement(BlocksContext.Provider, { value: registry }, children);
}

/** The registry in use; the caller redraws when a block is registered or taken away. */
export function useBlocks(): BlockRegistry {
  const registry = useContext(BlocksContext);
  useSyncExternalStore(registry.subscribe, registry.version);
  return registry;
}
