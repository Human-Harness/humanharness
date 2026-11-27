import { createElement, type ReactElement } from "react";
import contextPanel from "../../mods/context-panel/src/ui";
import { newestFakeClient } from "./fake-client";
import { ModBlocksProvider, createBlockRegistry } from "../src/layout/registry";
import type { BlockComponent, BlockRegistry } from "../src/layout/registry";

/** A registry that holds what the `context-panel` core mod registers (its `panel` block), as the shell's renderer entry does. */
export function contextPanelRegistry(registry: BlockRegistry = createBlockRegistry()): BlockRegistry {
  // The mod's ipc and push, answered by the newest FakeClient's context (what main's handlers answer in the app).
  const call = async (name: string, payload?: unknown) => {
    const api = newestFakeClient()?.context as unknown as Record<string, (...a: unknown[]) => unknown> | undefined;
    if (!api || typeof api[name] !== "function") throw new Error(`no such call ${name}`);
    return api[name]!(...(Array.isArray(payload) ? payload : []));
  };
  const on = (name: string, fn: (value: unknown) => void) => {
    const client = newestFakeClient();
    if (name !== "changed" || !client) return () => {};
    client.contextPushes.add(fn);
    return () => void client.contextPushes.delete(fn);
  };
  contextPanel.ui?.({ id: "context-panel", call, on, block: (name: string, component: unknown) => registry.register("context-panel", name, component as BlockComponent) } as never);
  return registry;
}

/** `ui` inside a provider whose registry holds the context panel, for tests that draw a task view on its own. */
export const withContextPanel = (ui: ReactElement) => createElement(ModBlocksProvider, { registry: contextPanelRegistry(), children: ui });
