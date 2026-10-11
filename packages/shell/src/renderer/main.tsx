import { createRoot } from "react-dom/client";
import App from "@harness/ui";
import "@humanharness/ui/styles.css";

createRoot(document.getElementById("root")!).render(<App client={window.hh} />);
