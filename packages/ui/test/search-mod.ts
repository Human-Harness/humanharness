import { createElement, type ReactElement } from "react";
import search from "../../mods/search/src/ui";
import { newestFakeClient } from "./fake-client";
import { ModBlocksProvider, createBlockRegistry } from "../src/layout/registry";
import type { BlockComponent, BlockRegistry } from "../src/layout/registry";

/** A registry that holds what the `search` core mod registers (its `palette` block), as the shell's renderer entry does. */
export function searchRegistry(registry: BlockRegistry = createBlockRegistry()): BlockRegistry {
  // The mod's ipc and push, answered by the newest FakeClient's `searchApi` (what main's handlers answer in the app).
  const call = async (name: string, payload?: unknown) => {
    const api = newestFakeClient()?.searchApi as unknown as Record<string, (...a: unknown[]) => unknown> | undefined;
    if (!api || (name !== "query" && name !== "opened")) throw new Error(`no such call ${name}`);
    return api[name]!(...(Array.isArray(payload) ? payload : []));
  };
  const on = (name: string, fn: (value: unknown) => void) => {
    const client = newestFakeClient();
    return name === "status" && client ? client.searchApi.onStatus(fn as never) : () => {};
  };
  search.ui?.({ id: "search", call, on, block: (name: string, component: unknown) => registry.register("search", name, component as BlockComponent) } as never);
  return registry;
}

/** `ui` inside a provider whose registry holds the palette, for tests that draw a window on its own. */
export const withSearch = (ui: ReactElement) => createElement(ModBlocksProvider, { registry: searchRegistry(), children: ui });
