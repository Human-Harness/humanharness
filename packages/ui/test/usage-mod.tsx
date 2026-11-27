import { type ReactElement, createElement } from "react";
import usage from "../../mods/usage/src/ui";
import { ModBlocksProvider, createBlockRegistry } from "../src/layout/registry";
import type { BlockRegistry } from "../src/layout/registry";

/** A registry that holds what the `usage` core mod registers (its Settings tab), as the shell's renderer entry does. */
export function usageRegistry(registry: BlockRegistry = createBlockRegistry()): BlockRegistry {
  usage.ui?.({
    id: "usage",
    settingsTab: (name: string, component: unknown, o: { label: string }) =>
      registry.add("settingsTab", { mod: "usage", name, label: o.label, Component: component as never }),
  } as never);
  return registry;
}

/** `ui` inside a provider whose registry holds the Usage tab, for tests that open Settings. */
const shared = usageRegistry();
export const withUsage = (ui: ReactElement) => createElement(ModBlocksProvider, { registry: shared, children: ui });
