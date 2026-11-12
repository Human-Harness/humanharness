import { createRoot } from "react-dom/client";
import App from "@harness/ui";
import { type BlockComponent, HhTheme, ModBlocksProvider, createBlockRegistry } from "@humanharness/ui";
import home from "@humanharness/mod-home";
// DM Sans for all text, DM Mono for code and keys, bundled with the app (no network fonts: the renderer's CSP allows 'self' only).
import "@fontsource/dm-sans/400.css";
import "@fontsource/dm-sans/500.css";
import "@fontsource/dm-sans/600.css";
import "@fontsource/dm-mono/400.css";
import "@humanharness/ui/styles.css";

// The core mods' blocks (minimal-core step 0b1), registered before the first render in the registry the layout gets
// through ModBlocksProvider. Home's on/off is main's: the layout draws "Mod Home is off" in its place while it is off.
const blocks = createBlockRegistry();
home.ui?.({ id: home.id, block: (name, component) => blocks.register(home.id, name, component as BlockComponent) });

createRoot(document.getElementById("root")!).render(
  <HhTheme>
    <ModBlocksProvider registry={blocks}>
      <App client={window.hh} />
    </ModBlocksProvider>
  </HhTheme>,
);
