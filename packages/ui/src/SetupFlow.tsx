import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { CheckIcon, TopBar } from "./chrome";
import type { AppState, HarnessClient } from "./client";
import { EngineTab } from "./EngineTab";
import { FolderStep } from "./FolderStep";

type Step = "folder" | "engine" | "done";

/** First-time setup, a screen of its own (spec 2026-10-14 §2): the folder, the engine, then "All set". */
export function SetupFlow({
  client,
  state,
  onChange,
  onCancel,
  onStart,
}: {
  client: HarnessClient;
  state: AppState;
  onChange: (state: AppState) => void;
  /** Back to Home; what was saved stays saved. */
  onCancel: () => void;
  /** "Start <name>" on the last step: the work screen. */
  onStart: () => void;
}) {
  const { t } = useTranslation();
  const name = state.harness.name;
  // A saved folder can't be changed here (it moves from Settings › General): the flow starts at the engine.
  const [withFolder] = useState(!state.config.folder);
  const [step, setStep] = useState<Step>(withFolder ? "folder" : "engine");
  const [selection, setSelection] = useState<{ engineId: string; ready: boolean } | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const headingId = useId();
  const folderFormId = useId();
  const heading = useRef<HTMLHeadingElement>(null);

  // A new step takes focus to its heading, so a screen reader starts reading there.
  useEffect(() => {
    heading.current?.focus();
  }, [step]);

  const next = async () => {
    if (!selection?.ready) return;
    setSaveError(false);
    if (selection.engineId !== state.config.engineId) {
      setSaving(true);
      try {
        onChange(await client.saveConfig({ engineId: selection.engineId }));
      } catch {
        setSaveError(true);
        return;
      } finally {
        setSaving(false);
      }
    }
    setStep("done");
  };

  if (step === "done") {
    const engine = state.engines.find((e) => e.id === state.config.engineId);
    return (
      <div className="hh-setup">
        <TopBar title={t("setupFlow.title", { name })} mock={state.mock} />
        <main className="hh-setup-body done">
          <section className="hh-setup-step hh-setup-done" aria-labelledby={headingId}>
            <span className="hh-setup-done-mark" aria-hidden="true">
              <CheckIcon />
            </span>
            <h2 id={headingId} ref={heading} tabIndex={-1}>
              {t("setupFlow.readyTitle")}
            </h2>
            <div className="hh-rows">
              <div className="hh-row">
                <span className="hh-row-label">{t("setupFlow.readyFolder")}</span>
                <code>
                  <bdi dir="ltr">{state.config.folder}</bdi>
                </code>
              </div>
              <div className="hh-row">
                <span className="hh-row-label">{t("setupFlow.readyEngine")}</span>
                <span>{engine ? (engine.mock ? `${engine.name} · ${t("mock.modelName")}` : engine.name) : state.config.engineId}</span>
              </div>
            </div>
            <p className="hh-caption">{t("setupFlow.readyHint")}</p>
            <button className="hh-primary hh-start" onClick={onStart}>
              {t("home.start", { name })}
            </button>
          </section>
        </main>
      </div>
    );
  }

  const steps: { id: Step; label: string }[] = [
    { id: "folder", label: t("setupFlow.stepFolder") },
    { id: "engine", label: t("setupFlow.stepEngine") },
  ];
  const at = steps.findIndex((s) => s.id === step);

  return (
    <div className="hh-setup">
      <TopBar title={t("setupFlow.title", { name })} mock={state.mock} />
      <ol className="hh-setup-steps" aria-label={t("setupFlow.stepsLabel")}>
        {steps.map((s, i) => (
          <li key={s.id} aria-current={i === at ? "step" : undefined}>
            <span className={i < at ? "hh-step-mark done" : "hh-step-mark"}>{i < at ? <CheckIcon /> : i + 1}</span>
            {s.label}
          </li>
        ))}
      </ol>
      <main className="hh-setup-body">
        {step === "folder" ? (
          <section className="hh-setup-step" aria-labelledby={headingId}>
            <h2 id={headingId} ref={heading} tabIndex={-1}>
              {t("setupFlow.folderHeading")}
            </h2>
            <p className="hh-setup-intro">{t("setupFlow.folderIntro", { name })}</p>
            <FolderStep
              client={client}
              state={state}
              formId={folderFormId}
              onSaved={(s) => {
                onChange(s);
                if (s.config.folder) setStep("engine");
              }}
            />
          </section>
        ) : (
          <section className="hh-setup-step" aria-labelledby={headingId}>
            <h2 id={headingId} ref={heading} tabIndex={-1}>
              {t("setupFlow.engineHeading", { name })}
            </h2>
            {/* A mock app has no plan or account to bring: only the test-mode caption. */}
            <p className="hh-setup-intro">{state.mock ? t("mock.only") : t("setupFlow.engineIntro", { name })}</p>
            <EngineTab client={client} state={state} onChange={onChange} setup onSelection={(engineId, ready) => setSelection({ engineId, ready })} />
            {saveError && (
              <p className="hh-save-error" role="alert">
                {t("setupFlow.saveError")}
              </p>
            )}
          </section>
        )}
      </main>
      <footer className="hh-setup-footer">
        {/* Not while the engine is being saved: its answer would move the flow on from wherever it went. */}
        {step === "engine" && withFolder ? (
          <button disabled={saving} onClick={() => setStep("folder")}>
            {t("setupFlow.back")}
          </button>
        ) : (
          <button disabled={saving} onClick={onCancel}>
            {t("setupFlow.cancel")}
          </button>
        )}
        {/* The folder step's Next submits its form from here, so it sits where the engine step's does. */}
        {step === "folder" && (
          <button type="submit" form={folderFormId} className="hh-primary">
            {t("setupFlow.next")}
          </button>
        )}
        {step === "engine" && (
          <button className="hh-primary" disabled={!selection?.ready || saving} onClick={() => void next()}>
            {t("setupFlow.next")}
          </button>
        )}
      </footer>
    </div>
  );
}
