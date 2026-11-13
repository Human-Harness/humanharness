import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { createRoot } from "react-dom/client";
import App from "@harness/ui";
import * as hhUi from "@humanharness/ui";
import { type BlockComponent, HhTheme, ModBlocksProvider, createBlockRegistry, startModLoader } from "@humanharness/ui";
import * as modSdk from "@humanharness/mod-sdk";
import * as zod from "zod";
import home from "@humanharness/mod-home";
// DM Sans for all text, DM Mono for code and keys, bundled with the app (no network fonts: the renderer's CSP allows 'self' only).
import "@fontsource/dm-sans/400.css";
import "@fontsource/dm-sans/500.css";
import "@fontsource/dm-sans/600.css";
import "@fontsource/dm-mono/400.css";
import "@humanharness/ui/styles.css";

// The app's own copies of what a mod's built ui may import (minimal-core 0b2): its bundle reads them from here, so a
// mod's blocks share the window's React and pieces. Set before anything could import a mod.
(globalThis as { __hhModules?: Record<string, unknown> }).__hhModules = {
  react: React,
  "react/jsx-runtime": jsxRuntime,
  "@humanharness/ui": hhUi,
  "@humanharness/mod-sdk": modSdk,
  zod,
};

// The core mods' blocks (minimal-core step 0b1), registered before the first render in the registry the layout gets
// through ModBlocksProvider. Home's on/off is main's: the layout draws "Mod Home is off" in its place while it is off.
const blocks = createBlockRegistry();
home.ui?.({ id: home.id, block: (name, component) => blocks.register(home.id, name, component as BlockComponent) });
// The harness's and the person's mods (0b2): their ui comes from hh-mod:, into the same registry, and again on reload.
startModLoader({ client: window.hh, registry: blocks });

createRoot(document.getElementById("root")!).render(
  <HhTheme>
    <ModBlocksProvider registry={blocks}>
      <App client={window.hh} />
    </ModBlocksProvider>
  </HhTheme>,
);
