import { createElement, type ReactElement } from "react";
import contextPanel from "../../mods/context-panel/src/ui";
import { ModBlocksProvider, createBlockRegistry } from "../src/layout/registry";
import type { BlockComponent, BlockRegistry } from "../src/layout/registry";

/** A registry that holds what the `context-panel` core mod registers (its `panel` block), as the shell's renderer entry does. */
export function contextPanelRegistry(registry: BlockRegistry = createBlockRegistry()): BlockRegistry {
  contextPanel.ui?.({ id: "context-panel", block: (name: string, component: unknown) => registry.register("context-panel", name, component as BlockComponent) } as never);
  return registry;
}

/** `ui` inside a provider whose registry holds the context panel, for tests that draw a task view on its own. */
export const withContextPanel = (ui: ReactElement) => createElement(ModBlocksProvider, { registry: contextPanelRegistry(), children: ui });
