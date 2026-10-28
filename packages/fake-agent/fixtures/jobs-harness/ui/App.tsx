import { type HarnessClient, HarnessApp } from "@humanharness/ui";

// Only the core screens: Settings › Jobs comes from the manifest's `jobs`.
export default function App({ client }: { client: HarnessClient }) {
  return <HarnessApp client={client} />;
}
