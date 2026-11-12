import { type ComponentType, type ReactNode, createContext, createElement, useContext, useSyncExternalStore } from "react";
import type { AppValue } from "./app";

/** What a mod's block gets: the `props` the layout gives it and the app (minimal-core spec §5.2). */
export interface BlockProps {
  props: Record<string, unknown>;
  app: AppValue;
}
export type BlockComponent = ComponentType<BlockProps>;

/** The blocks mods registered, by mod id and block name. */
export interface BlockRegistry {
  /** Registers `Component` as `modId`'s block `name`; the disposer takes it away again (only if it is still that one). */
  register(modId: string, name: string, Component: BlockComponent): () => void;
  get(modId: string, name: string): BlockComponent | undefined;
  /** Calls `listener` on each change; returns the unsubscribe. */
  subscribe(listener: () => void): () => void;
  /** A number that changes on each change (for `useSyncExternalStore`). */
  version(): number;
}

export function createBlockRegistry(): BlockRegistry {
  const blocks = new Map<string, BlockComponent>();
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
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    version: () => version,
  };
}

/** The app's own registry: the one the screen uses unless a `ModBlocksProvider` gives another. */
const appRegistry = createBlockRegistry();

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
