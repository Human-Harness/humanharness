import { createRoot } from "react-dom/client";
import App from "@harness/ui";
// Lexend for display text, bundled with the app (no network fonts).
import "@fontsource/lexend/500.css";
import "@fontsource/lexend/600.css";
import "@humanharness/ui/styles.css";

createRoot(document.getElementById("root")!).render(<App client={window.hh} />);
