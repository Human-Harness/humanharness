import { type ReactElement, type ReactNode, createElement } from "react";
import { type RenderOptions, render as rtlRender } from "@testing-library/react";
import { type ModLoaderOptions, ModBlocksProvider, createBlockRegistry, startModLoader } from "@humanharness/ui";
import home from "../../home/src/ui";
import { renderIn as uiRenderIn } from "../../../ui/test/render";
import sidekick from "../src/ui";

/** No mods beyond the core's: the loader only runs the core mods' ui. */
const noMods = {
  mods: { view: async () => ({ mods: [] }), onChanged: () => () => {}, onReloaded: () => () => {}, call: async () => undefined, on: () => () => {} },
} as unknown as ModLoaderOptions["client"];

/**
 * The tests here render HarnessApp with the core mods turned on as the shell's renderer entry does: Home's block and
 * Sidekick's task-view pieces, run by the mod loader into a fresh registry for each render.
 */
function withCoreMods() {
  const registry = createBlockRegistry();
  startModLoader({ client: noMods, registry, core: [home, sidekick] });
  return ({ children }: { children: ReactNode }) => createElement(ModBlocksProvider, { registry, children });
}

/** `@testing-library/react`'s render, inside the provider (rerender keeps it). */
export const render = (ui: ReactElement, options: Omit<RenderOptions, "wrapper"> = {}) => rtlRender(ui, { ...options, wrapper: withCoreMods() });

/** `packages/ui/test/render`'s renderIn, inside the provider. */
export const renderIn = (language: string, ui: ReactElement, options?: Parameters<typeof uiRenderIn>[2]) =>
  uiRenderIn(language, createElement(withCoreMods(), null, ui), options);
