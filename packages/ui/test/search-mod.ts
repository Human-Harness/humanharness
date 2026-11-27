import { createElement, type ReactElement } from "react";
import search from "../../mods/search/src/ui";
import { ModBlocksProvider, createBlockRegistry } from "../src/layout/registry";
import type { BlockComponent, BlockRegistry } from "../src/layout/registry";

/** A registry that holds what the `search` core mod registers (its `palette` block), as the shell's renderer entry does. */
export function searchRegistry(registry: BlockRegistry = createBlockRegistry()): BlockRegistry {
  search.ui?.({ id: "search", block: (name: string, component: unknown) => registry.register("search", name, component as BlockComponent) } as never);
  return registry;
}

/** `ui` inside a provider whose registry holds the palette, for tests that draw a window on its own. */
export const withSearch = (ui: ReactElement) => createElement(ModBlocksProvider, { registry: searchRegistry(), children: ui });
