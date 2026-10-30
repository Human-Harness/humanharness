// Ambient declarations (no top-level import/export, so `declare module` declares rather than augments).

interface Window {
  hh: import("@humanharness/protocol").HarnessClient;
}

declare module "@harness/ui" {
  import type { ComponentType } from "react";
  import type { HarnessClient } from "@humanharness/protocol";
  const App: ComponentType<{ client: HarnessClient }>;
  export default App;
}

declare module "*.css";
