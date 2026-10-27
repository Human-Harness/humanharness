import { type HarnessClient, type SetupStepProps, HarnessApp } from "@humanharness/ui";

/** The fixture's own setup step: one button that ends it. */
function ReadyStep({ done }: SetupStepProps) {
  return (
    <button type="button" onClick={done}>
      All good
    </button>
  );
}

export default function App({ client }: { client: HarnessClient }) {
  return <HarnessApp client={client} setupSteps={{ ReadyStep }} />;
}
