import { type HarnessClient, HarnessApp } from "@humanharness/ui";

// Only the core screens: Scope settings › Linked folders comes from the manifest's `linkedFolders`.
export default function App({ client }: { client: HarnessClient }) {
  return <HarnessApp client={client} />;
}
