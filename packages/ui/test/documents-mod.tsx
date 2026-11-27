import { type ReactElement, createElement } from "react";
import documents from "../../mods/documents/src/ui";
import { startModLoader } from "../src/layout/mod-loader";
import { type BlockRegistry, ModBlocksProvider, createBlockRegistry } from "../src/layout/registry";

/** A registry that holds what the `documents` core mod registers (its file opener), as the shell's renderer entry does. */
export function documentsRegistry(registry: BlockRegistry = createBlockRegistry()): BlockRegistry {
  const mods = { view: async () => ({ mods: [], problems: [] }), onChanged: () => () => {}, onReloaded: () => () => {}, call: async () => undefined, on: () => () => {} };
  startModLoader({ client: { mods }, registry, core: [documents] });
  return registry;
}

/** `ui` inside a provider whose registry holds the reader (on top of `registry`), for tests that open files through the chat. */
export const withDocuments = (ui: ReactElement, registry: BlockRegistry = documentsRegistry()) =>
  createElement(ModBlocksProvider, { registry, children: ui });
