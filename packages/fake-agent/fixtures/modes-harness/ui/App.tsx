import { type HarnessClient, HarnessApp } from "@humanharness/ui";

// Only the core screens: the mode bar, the recommendation and the Settings tab come from the manifest.
export default function App({ client }: { client: HarnessClient }) {
  return <HarnessApp client={client} />;
}
