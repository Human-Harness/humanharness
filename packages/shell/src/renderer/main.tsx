import { createRoot } from "react-dom/client";
import App from "@harness/ui";
import { HhTheme } from "@humanharness/ui";
// DM Sans for all text, DM Mono for code and keys, bundled with the app (no network fonts: the renderer's CSP allows 'self' only).
import "@fontsource/dm-sans/400.css";
import "@fontsource/dm-sans/500.css";
import "@fontsource/dm-sans/600.css";
import "@fontsource/dm-mono/400.css";
import "@humanharness/ui/styles.css";

createRoot(document.getElementById("root")!).render(
  <HhTheme>
    <App client={window.hh} />
  </HhTheme>,
);
