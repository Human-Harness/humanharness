import { type HarnessClient, HarnessApp } from "@humanharness/ui";

// Only core blocks and the core form: what a harness gets without writing any UI.
export default function App({ client }: { client: HarnessClient }) {
  return <HarnessApp client={client} />;
}
