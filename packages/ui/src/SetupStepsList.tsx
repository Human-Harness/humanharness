import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { HarnessClient, SetupStepStatus, SetupStepView, SetupStepsState } from "./client";
import { SetupStepForm } from "./SetupStepForm";

/**
 * Settings' list of the harness's setup steps (setup-steps spec §5): each with its status. A form edits in place;
 * an interview or a component runs again on the setup screen (`onRun`). Showing it acknowledges the steps, so the
 * ones a harness update added count from now on (spec §8 Q3).
 */
export function SetupStepsList({ client, steps, onRun }: { client: HarnessClient; steps: SetupStepView[]; onRun: (id: string) => void }) {
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
  return (
    <section className="hh-setup-list" aria-labelledby="hh-setup-list-title">
      <h3 id="hh-setup-list-title">{t("setupSteps.listTitle")}</h3>
      <ul className="hh-rows">
        {steps.map((s) => {
          const st = status(s.id);
          const labelId = `hh-setup-step-${s.id}`;
          return (
            <li key={s.id} className="hh-row hh-row-wrap" aria-labelledby={labelId}>
              <span id={labelId} className="hh-row-label">
                {s.label}
              </span>
              <span className="hh-caption">{t(`setupSteps.status.${st}`)}</span>
              {s.kind === "form" ? (
                editing === s.id ? (
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
                ) : (
                  <button
                    onClick={() => {
                      setSaved(null);
                      setEditing(s.id);
                    }}
                  >
                    {t("setupSteps.edit")}
                  </button>
                )
              ) : (
                <button onClick={() => onRun(s.id)}>{t(st === "done" ? "setupSteps.redo" : "setupSteps.doNow")}</button>
              )}
              {saved === s.id && <span role="status">{t("setupSteps.saved")}</span>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
