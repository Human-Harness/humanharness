import { type HarnessClient, HarnessApp } from "@humanharness/ui";

// Only the core screens: the Settings tab comes from the manifest, with no UI code.
export default function App({ client }: { client: HarnessClient }) {
  return <HarnessApp client={client} />;
}
