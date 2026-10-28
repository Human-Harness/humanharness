import { type HarnessClient, HarnessApp } from "@humanharness/ui";

// Only the core screens: the reader's review comes from the manifest's edit permission.
export default function App({ client }: { client: HarnessClient }) {
  return <HarnessApp client={client} />;
}
