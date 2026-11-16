import { type HarnessClient, HarnessApp, useBackend } from "@humanharness/ui";
import { BackendPanel } from "./BackendPanel";
import "./backend.css";

// Test fixture: the harness backend at work (hatches spec §4). The panel sits in a fixed corner (bottom left, clear of the core's helper card), outside the
// core's layout, so the test does not depend on a side slot.
export default function App({ client }: { client: HarnessClient }) {
  const backend = useBackend(client);
  return (
    <>
      <HarnessApp client={client} />
      <div className="fx-backend-dock">
        <BackendPanel backend={backend} />
      </div>
    </>
  );
}
