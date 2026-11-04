import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { HarnessClient, SetupStepStatus, SetupStepView, SetupStepsState } from "./client";
import { Group, Row, Rx } from "./guide";
import { SetupStepForm } from "./SetupStepForm";

/** Each status's badge (DESIGN.md "Badge": green ok, orange needs the person). */
const STATUS_BADGE: Record<SetupStepStatus, "green" | "orange"> = { done: "green", missing: "orange", skipped: "orange" };

/**
 * Settings' list of the harness's setup steps (setup-steps spec §5): each with its status. A form edits in place;
 * an interview or a component runs again on the setup screen (`onRun`); a connect step opens Settings › Connections
 * (`onConnections`, given when the harness declares keys). Showing it acknowledges the steps, so the
 * ones a harness update added count from now on (spec §8 Q3).
 *
 * Radix stage 2e: a "Setup" card, one row per step: its name, its status as a badge, its action as a ghost button on the
 * right. A form opens under its row, inside the same card (no card in a card).
 */
export function SetupStepsList({
  client,
  steps,
  onRun,
  onConnections,
}: {
  client: HarnessClient;
  steps: SetupStepView[];
  onRun: (id: string) => void;
  onConnections?: () => void;
}) {
  const { t } = useTranslation();
  const [state, setState] = useState<SetupStepsState | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    const off = client.setupSteps.onChange((s) => {
      if (live) setState(s);
    });
    client.setupSteps.acknowledge().then(
      (s) => {
        if (live) setState(s);
      },
      () => {},
    );
    return () => {
      live = false;
      off();
    };
  }, [client]);

  const status = (id: string): SetupStepStatus => (state && Object.hasOwn(state.steps, id) ? state.steps[id] : "missing");
  const action = (label: string, onClick: () => void) => (
    <Rx.Button variant="ghost" color="gray" size="1" onClick={onClick}>
      {label}
    </Rx.Button>
  );
  return (
    <Group title={t("setupSteps.listTitle")}>
      {steps.map((s) => {
        const st = status(s.id);
        const open = s.kind === "form" && editing === s.id;
        return (
          <Row
            key={s.id}
            aria-label={s.label}
            label={
              <Rx.Flex as="span" align="center" gap="2" wrap="wrap">
                <span>{s.label}</span>
                <Rx.Badge color={STATUS_BADGE[st]}>{t(`setupSteps.status.${st}`)}</Rx.Badge>
              </Rx.Flex>
            }
            hint={
              saved === s.id ? (
                <Rx.Text color="green" role="status">
                  {t("setupSteps.saved")}
                </Rx.Text>
              ) : undefined
            }
            below={
              open ? (
                // A refused field shows on the form, which stays open; a settings form saves field by field, so the
                // ones before it may already be saved (the harness's fields below show them).
                <SetupStepForm
                  client={client}
                  step={s}
                  submitLabel={t("setupSteps.save")}
                  onDone={(next) => {
                    setState(next);
                    setEditing(null);
                    setSaved(s.id);
                  }}
                />
              ) : undefined
            }
          >
            {s.kind === "form"
              ? !open &&
                action(t("setupSteps.edit"), () => {
                  setSaved(null);
                  setEditing(s.id);
                })
              : s.kind === "connect" && onConnections
                ? action(t("connections.open"), onConnections)
                : action(t(st === "done" ? "setupSteps.redo" : "setupSteps.doNow"), () => onRun(s.id))}
          </Row>
        );
      })}
    </Group>
  );
}
