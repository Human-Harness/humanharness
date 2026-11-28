import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { createRoot } from "react-dom/client";
import App from "@harness/ui";
import * as hhUi from "@humanharness/ui";
import { HhTheme, ModBlocksProvider, createBlockRegistry, startModLoader } from "@humanharness/ui";
import * as modSdk from "@humanharness/mod-sdk";
import * as zod from "zod";
import historyView from "@humanharness/mod-history-view";
import home from "@humanharness/mod-home";
import sidekick from "@humanharness/mod-sidekick/ui";
import usage from "@humanharness/mod-usage";
import contextPanel from "@humanharness/mod-context-panel/ui";
import documents from "@humanharness/mod-documents/ui";
import search from "@humanharness/mod-search/ui";
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

// The core mods' ui (Home's block, Sidekick's task-view pieces), run before the first render into the registry the
// layout gets through ModBlocksProvider. Their on/off is main's: the layout draws "Mod Home is off" in its place while
// it is off. The harness's and the person's mods (0b2): their ui comes from hh-mod:, into the same registry, and again
// on reload.
const blocks = createBlockRegistry();
startModLoader({ client: window.hh, registry: blocks, core: [home, historyView, sidekick, usage, contextPanel, search, documents] });

createRoot(document.getElementById("root")!).render(
  <HhTheme>
    <ModBlocksProvider registry={blocks}>
      <App client={window.hh} />
    </ModBlocksProvider>
  </HhTheme>,
);
