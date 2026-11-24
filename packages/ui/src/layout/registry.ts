import { type ComponentType, type ReactNode, createContext, createElement, useContext, useSyncExternalStore } from "react";
import type { AppValue } from "./app";

/** What a mod's block gets: the `props` the layout gives it and the app (minimal-core spec §5.2). */
export interface BlockProps {
  props: Record<string, unknown>;
  app: AppValue;
}
export type BlockComponent = ComponentType<BlockProps>;

/** A mod's Settings tab: `openTab` goes to another tab (by its id). */
export interface SettingsTabProps {
  openTab(id: string): void;
}
/** A task row the Models tab draws the core's way: a level picker for the task `key` (its `models.tasks` entry). */
export interface ModelsTaskRow {
  key: string;
  label: string;
  description?: string;
}
/** A mod's row in Settings › Models: `taskRow` draws a task row like the core's own. */
export interface ModelsRowProps {
  taskRow(row: ModelsTaskRow): ReactNode;
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
  /** The longest wait for a review, in seconds, or "always" (default 5). */
  wait?: number | "always";
}

/** What each slot holds, by kind; each entry names the mod that registered it. */
export interface Slots {
  settingsTab: { mod: string; name: string; label: string; Component: ComponentType<SettingsTabProps> };
  row: { mod: string; place: RowPlace; Component: ComponentType<Partial<ModelsRowProps>> };
  taskBar: { mod: string; Component: ComponentType<TaskBarProps> };
  taskOverlay: { mod: string; name: string; Button: ComponentType<OverlayButtonProps>; Panel: ComponentType<OverlayPanelProps> };
  composer: { mod: string; reviewer: ComposerReviewer };
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
  const slots: { [K in SlotKind]: Slots[K][] } = { settingsTab: [], row: [], taskBar: [], taskOverlay: [], composer: [] };
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
