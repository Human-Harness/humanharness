import { type HarnessClient, HarnessApp } from "@humanharness/ui";

// Only the core screens.
export default function App({ client }: { client: HarnessClient }) {
  return <HarnessApp client={client} />;
}
