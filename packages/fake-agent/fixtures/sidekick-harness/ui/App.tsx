import { type HarnessClient, HarnessApp } from "@humanharness/ui";

// Only the core screens: the stepper and the mode bar come from the manifest.
export default function App({ client }: { client: HarnessClient }) {
  return <HarnessApp client={client} />;
}
