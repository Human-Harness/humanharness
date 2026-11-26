import { type ReactElement, createElement } from "react";
import historyView from "../../mods/history-view/src/ui";
import { ModBlocksProvider, createBlockRegistry } from "../src/layout/registry";
import type { BlockRegistry } from "../src/layout/registry";

/** A registry that holds what the `history-view` core mod registers (its task page), as the shell's renderer entry does. */
export function historyViewRegistry(registry: BlockRegistry = createBlockRegistry()): BlockRegistry {
  historyView.ui?.({
    id: "history-view",
    block: () => () => {},
    taskPage: (o: { name: string; rail: { icon: string; label: string }; title: string; page: unknown }) =>
      registry.add("taskPage", { mod: "history-view", name: o.name, rail: o.rail as never, title: o.title, Page: o.page as never }),
  } as never);
  return registry;
}

/** `ui` inside a provider whose registry holds the History page, for tests that open History through the chat. */
export const withHistoryView = (ui: ReactElement) => createElement(ModBlocksProvider, { registry: historyViewRegistry(), children: ui });
