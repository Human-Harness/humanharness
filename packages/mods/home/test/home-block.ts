import { type ReactElement, type ReactNode, createElement } from "react";
import { type RenderOptions, render as rtlRender } from "@testing-library/react";
import { type BlockComponent, ModBlocksProvider, createBlockRegistry } from "@humanharness/ui";
import { renderIn as uiRenderIn } from "../../../ui/test/render";
import mod from "../src/ui";

// The tests here render HarnessApp, which draws Home from the layout's `home/home` block: their renders go inside a
// ModBlocksProvider whose registry holds the block, registered as the shell's renderer entry does (minimal-core 0b1).
const registry = createBlockRegistry();
mod.ui?.({ id: "home", block: (name, component) => registry.register("home", name, component as BlockComponent) });

const withHome = ({ children }: { children: ReactNode }) => createElement(ModBlocksProvider, { registry, children });

/** `@testing-library/react`'s render, inside the provider (rerender keeps it). */
export const render = (ui: ReactElement, options: Omit<RenderOptions, "wrapper"> = {}) => rtlRender(ui, { ...options, wrapper: withHome });

/** `packages/ui/test/render`'s renderIn, inside the provider. */
export const renderIn = (language: string, ui: ReactElement, options?: Parameters<typeof uiRenderIn>[2]) =>
  uiRenderIn(language, createElement(withHome, null, ui), options);
