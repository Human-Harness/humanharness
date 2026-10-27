import { type HarnessClient, HarnessApp } from "@humanharness/ui";

export default function App({ client }: { client: HarnessClient }) {
  return <HarnessApp client={client} />;
}
