import { createRoot } from "react-dom/client";
import App from "@harness/ui";
// DM Sans for all text, bundled with the app (no network fonts: the renderer's CSP allows 'self' only).
import "@fontsource/dm-sans/400.css";
import "@fontsource/dm-sans/500.css";
import "@fontsource/dm-sans/600.css";
import "@fontsource/dm-sans/700.css";
import "@humanharness/ui/styles.css";

createRoot(document.getElementById("root")!).render(<App client={window.hh} />);
