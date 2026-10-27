import type { ComponentType } from "react";
import { useTranslation } from "react-i18next";
import { ChatView } from "./ChatView";
import type { AppState, HarnessClient, SetupStepView } from "./client";
import type { BlockProps } from "./Message";

/**
 * An `interview` step's body (setup-steps spec §3): its cost when it isn't light, then its task's chat, slim. The
 * section is only in a task's first message: "Continue the interview" always starts a new task of the action.
 */
export function SetupInterviewStep({
  client,
  state,
  step,
  blocks,
  stateBlocks,
}: {
  client: HarnessClient;
  state: AppState;
  step: SetupStepView;
  blocks: Record<string, ComponentType<BlockProps>>;
  stateBlocks: string[];
}) {
  const { t } = useTranslation();
  return (
    <>
      {(step.cost === "medium" || step.cost === "heavy") && (
        <p className="hh-caption">{t(step.cost === "heavy" ? "setupSteps.costHeavy" : "setupSteps.costMedium")}</p>
      )}
      <ChatView client={client} state={state} components={blocks} stateBlocks={stateBlocks} slim={{ action: step.action ?? "" }} />
    </>
  );
}
