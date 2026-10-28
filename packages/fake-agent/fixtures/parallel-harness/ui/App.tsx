import { type HarnessClient, HarnessApp } from "@humanharness/ui";

// Only the core screens: the inbox and the task strip come from the manifest's `parallel`.
export default function App({ client }: { client: HarnessClient }) {
  return <HarnessApp client={client} />;
}
