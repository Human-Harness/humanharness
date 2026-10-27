import { type ComponentType, useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { CheckIcon, TopBar } from "./chrome";
import { type AppState, type HarnessClient, type ProfileView, type SetupStepProps, type SetupStepResult, type SetupStepView, type SetupStepsState, type TaskView, isConfigured } from "./client";
import { EngineTab } from "./EngineTab";
import { FolderStep } from "./FolderStep";
import { systemLanguage } from "./language";
import type { BlockProps } from "./Message";
import { ProfileStep } from "./ProfileStep";
import { useProfiles } from "./ProfileSwitcher";
import { SetupInterviewStep } from "./SetupInterviewStep";
import { SetupStepForm } from "./SetupStepForm";

/** A core step, or a harness step by id (setup-steps spec §4). */
type Step = "folder" | "engine" | "profile" | "done" | `step:${string}`;
const stepOf = (id: string): Step => `step:${id}`;

export interface SetupFlowProps {
  client: HarnessClient;
  state: AppState;
  onChange: (state: AppState) => void;
  /** Back to Home; what was saved stays saved. */
  onCancel: () => void;
  /** "Start <name>" on the last step: the work screen. */
  onStart: () => void;
  /** A harness step to open at (Home's missing step); the core steps are done. */
  startAt?: string;
  /** Only `startAt` (Settings' "Do it again"); its end goes back (`onCancel`). */
  only?: boolean;
  /** "Add <label>" (profiles spec §5): start at the profile step; the core steps are done. */
  newProfile?: boolean;
  /** The harness's own step components (`component` steps), by the name the manifest gives. */
  components?: Record<string, ComponentType<SetupStepProps>>;
  /** The harness's block components and state-only blocks, for an interview's chat. */
  blocks?: Record<string, ComponentType<BlockProps>>;
  stateBlocks?: string[];
}

/**
 * First-time setup, a screen of its own (spec 2026-10-14 §2): the folder, the engine, the harness's own steps
 * (setup-steps spec §4), then "All set". A harness with profiles has one more core step after the engine: the profile
 * (profiles spec §5 "Creating a profile"), when none is active and on every "Add <label>".
 */
export function SetupFlow({ client, state, onChange, onCancel, onStart, startAt, only = false, newProfile = false, components = {}, blocks = {}, stateBlocks = [] }: SetupFlowProps) {
  const { t } = useTranslation();
  const name = state.harness.name;
  const harnessSteps = state.setup ?? [];
  /** Harnesses with profiles: the registry (the title, the privacy note) and whether this run made a profile. */
  const people = useProfiles(client, state.profiles !== undefined);
  const needsProfile = state.profiles !== undefined && !state.config.profile;
  const [madeProfile, setMadeProfile] = useState(false);
  /** A profile this run made but couldn't open (its id, and the name typed): the step says so, and Next can't make another. */
  const [stranded, setStranded] = useState<{ id: string; name: string } | null>(null);
  /** A profile's create is on its way. */
  const [creating, setCreating] = useState(false);
  const activeProfile = people?.list.find((p) => p.id === state.config.profile) ?? null;
  // A saved folder can't be changed here (it moves from Settings › General): the flow starts at the engine.
  const [withFolder] = useState(!state.config.folder);
  /** Opened at a harness step (Home, Settings): the core steps are done, and its first step's Back is Cancel. */
  const [entered] = useState(Boolean(startAt && isConfigured(state.config) && harnessSteps.some((s) => s.id === startAt)));
  const opened = entered ? startAt : undefined;
  const [step, setStep] = useState<Step>(
    newProfile && isConfigured(state.config) && state.profiles ? "profile" : opened ? stepOf(opened) : withFolder ? "folder" : "engine",
  );
  /** The harness steps this run goes through, in manifest order; null while their state loads. */
  const fixed = harnessSteps.length === 0 ? [] : only && opened ? [opened] : null;
  const [queue, setQueue] = useState<string[] | null>(fixed);
  const [selection, setSelection] = useState<{ engineId: string; ready: boolean } | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  /** A harness step's skip or completion is on its way. */
  const [busy, setBusy] = useState(false);
  const [stepError, setStepError] = useState<"failed" | "incomplete" | null>(null);
  const hasInterview = harnessSteps.some((s) => s.kind === "interview");
  /** The open task, for an interview's Next (it closes the interview's task first). */
  const [tasks, setTasks] = useState<TaskView | null>(null);
  useEffect(() => {
    if (!hasInterview) return;
    let live = true;
    let seen = false;
    const off = client.onTasks((v) => {
      seen = true;
      if (live) setTasks(v);
    });
    client.getTasks().then(
      (v) => {
        if (live && !seen) setTasks(v);
      },
      () => {},
    );
    return () => {
      live = false;
      off();
    };
  }, [client, hasInterview]);
  const headingId = useId();
  const folderFormId = useId();
  const stepFormId = useId();
  const profileFormId = useId();
  const heading = useRef<HTMLHeadingElement>(null);

  // A new step takes focus to its heading, so a screen reader starts reading there; an old refusal goes.
  useEffect(() => {
    heading.current?.focus();
    setStepError(null);
  }, [step]);

  // The steps not done yet (from the one opened at); skipped ones are offered again from Settings, never here. Read
  // once the folder is known: a folder chosen on the first step has its own setup.json, so nothing is read before it.
  const folder = state.config.folder;
  const all = harnessSteps.map((s) => s.id);
  const from = (ids: string[]) => (opened ? ids.slice(Math.max(0, ids.indexOf(opened))) : ids);
  const queueOf = (s: SetupStepsState) => from(all.filter((id) => id === opened || (Object.hasOwn(s.steps, id) ? s.steps[id] : "missing") === "missing"));
  useEffect(() => {
    if (fixed !== null || !folder) return;
    let live = true;
    setQueue(null);
    client.setupSteps.get().then(
      (s) => {
        if (live) setQueue(queueOf(s));
      },
      () => {
        if (live) setQueue(from(all));
      },
    );
    return () => {
      live = false;
    };
    // The steps and where the flow opened are fixed for the flow's life (HarnessApp keys it by them).
  }, [client, folder]);

  // "All set": the steps seen so far count from now on (spec §8 Q3).
  useEffect(() => {
    if (step === "done" && harnessSteps.length > 0) client.setupSteps.finish().catch(() => {});
  }, [step]);

  const current: SetupStepView | undefined = step.startsWith("step:") ? harnessSteps.find((s) => stepOf(s.id) === step) : undefined;
  /** The run's steps; while they load, the one opened at. */
  const run = queue ?? (opened ? [opened] : []);
  /** After harness step `id`: the next one, else All set (or back, for a single step). */
  const after = (id: string) => {
    const following = run[run.indexOf(id) + 1];
    if (following !== undefined) setStep(stepOf(following));
    else if (only) onCancel();
    else setStep("done");
  };
  /** Back from harness step `id`: the previous one, or the engine when the flow came through it; null: Cancel. */
  const backFrom = (id: string): Step | null => {
    const i = run.indexOf(id);
    if (i > 0) return stepOf(run[i - 1]);
    return entered || madeProfile || newProfile ? null : "engine";
  };
  const settle = async (id: string, call: () => Promise<SetupStepResult>) => {
    setBusy(true);
    setStepError(null);
    try {
      const r = await call();
      if (r.ok) after(id);
      // Any other refusal (a setup.json that can't be saved included) is "didn't go through".
      else setStepError(r.reason === "incomplete" ? "incomplete" : "failed");
    } catch {
      setStepError("failed");
    } finally {
      setBusy(false);
    }
  };
  const skip = (id: string) => void settle(id, () => client.setupSteps.skip(id));
  const complete = (id: string) => void settle(id, () => client.setupSteps.complete(id));
  /** An interview's Next (spec §3): its open task closes with the core closing turn, then the step completes. */
  const finishInterview = (s: SetupStepView) =>
    void settle(s.id, async () => {
      // A stopped closing turn leaves the task open: "didn't go through", and Next can be pressed again.
      if (tasks?.current?.action === s.action && !(await client.finishTask())) return { ok: false, reason: "open" };
      return client.setupSteps.complete(s.id);
    });

  /** The profile exists and is active: this run goes on with its harness steps not done (its own setup.json). */
  const created = async (next: AppState) => {
    onChange(next);
    setMadeProfile(true);
    let ids = all;
    try {
      const s = await client.setupSteps.get();
      ids = ids.filter((id) => (Object.hasOwn(s.steps, id) ? s.steps[id] : "missing") === "missing");
    } catch {
      // Unknown: every step, as on a first run.
    }
    setQueue(ids);
    setStep(ids.length > 0 ? stepOf(ids[0]) : "done");
  };

  const next = async () => {
    if (!selection?.ready) return;
    setSaveError(false);
    // A saved folder and engine with no usable language would never count as set up: write the system's here.
    const patch = {
      ...(selection.engineId !== state.config.engineId ? { engineId: selection.engineId } : {}),
      ...(state.config.language ? {} : { language: systemLanguage() }),
    };
    let ids = run;
    if (Object.keys(patch).length > 0) {
      setSaving(true);
      try {
        onChange(await client.saveConfig(patch));
        // Now set up: the folder's setup.json is recorded (main does it on save), so read the steps again from it.
        if (fixed === null) ids = await client.setupSteps.get().then(queueOf, () => run);
      } catch {
        setSaveError(true);
        return;
      } finally {
        setSaving(false);
      }
      setQueue(ids);
    }
    setStep(needsProfile ? "profile" : ids.length > 0 ? stepOf(ids[0]) : "done");
  };

  // Once a profile is active (and not while a new one is being made), the title names the person (spec §5).
  const title = state.profiles && activeProfile && step !== "profile" ? t("profiles.setupTitle", { name, profile: activeProfile.title }) : t("setupFlow.title", { name });

  if (step === "done") {
    const engine = state.engines.find((e) => e.id === state.config.engineId);
    return (
      <div className="hh-setup">
        <TopBar title={title} mock={state.mock} />
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

  // The core steps as today, then the harness steps of this run (only the opened one for a single step).
  const own = run.flatMap((id) => harnessSteps.filter((s) => s.id === id).map((s) => ({ id: stepOf(s.id), label: s.label })));
  const profileStep: { id: Step; label: string }[] =
    state.profiles && (needsProfile || newProfile || madeProfile) ? [{ id: "profile", label: t("profiles.stepLabel") }] : [];
  const steps: { id: Step; label: string }[] =
    only && current
      ? own.filter((s) => s.id === step)
      : newProfile
        ? [...profileStep, ...own]
        : [{ id: "folder", label: t("setupFlow.stepFolder") }, { id: "engine", label: t("setupFlow.stepEngine") }, ...profileStep, ...own];
  const at = steps.findIndex((s) => s.id === step);
  const back = current ? backFrom(current.id) : null;
  const waiting = busy || queue === null;

  return (
    <div className="hh-setup">
      <TopBar title={title} mock={state.mock} />
      <ol className="hh-setup-steps" aria-label={t("setupFlow.stepsLabel")}>
        {steps.map((s, i) => (
          <li key={s.id} aria-current={i === at ? "step" : undefined}>
            <span className={i < at ? "hh-step-mark done" : "hh-step-mark"}>{i < at ? <CheckIcon /> : i + 1}</span>
            {s.label}
          </li>
        ))}
      </ol>
      <main className="hh-setup-body">
        {current ? (
          <section key={current.id} className="hh-setup-step" aria-labelledby={headingId}>
            <h2 id={headingId} ref={heading} tabIndex={-1}>
              {current.label}
            </h2>
            {current.description && <p className="hh-setup-intro">{current.description}</p>}
            {current.kind === "form" && <SetupStepForm client={client} step={current} formId={stepFormId} onDone={() => after(current.id)} />}
            {current.kind === "component" && (
              <ComponentStep
                client={client}
                step={current}
                components={components}
                profile={state.profiles ? activeProfile : null}
                done={() => complete(current.id)}
                skip={() => skip(current.id)}
              />
            )}
            {current.kind === "interview" && <SetupInterviewStep client={client} state={state} step={current} blocks={blocks} stateBlocks={stateBlocks} />}
            {stepError && (
              <p className="hh-save-error" role="alert">
                {t(stepError === "incomplete" ? "setupSteps.incomplete" : "setupSteps.failed")}
              </p>
            )}
          </section>
        ) : step === "profile" && state.profiles ? (
          <section className="hh-setup-step" aria-labelledby={headingId}>
            <h2 id={headingId} ref={heading} tabIndex={-1}>
              {t("profiles.heading", { name })}
            </h2>
            <p className="hh-setup-intro">{t("profiles.intro", { label: state.profiles.label })}</p>
            <ProfileStep
              client={client}
              state={state}
              formId={profileFormId}
              others={(people?.list ?? []).filter((p) => !p.archived && p.id !== stranded?.id).length}
              stranded={stranded ? (people?.list.find((p) => p.id === stranded.id)?.title ?? stranded.name) : null}
              onCreated={(next) => void created(next)}
              onStranded={(id, typed) => setStranded({ id, name: typed })}
              onSending={setCreating}
            />
          </section>
        ) : step === "folder" ? (
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
        {current ? (
          <>
            {back ? (
              <button disabled={busy} onClick={() => setStep(back)}>
                {t("setupFlow.back")}
              </button>
            ) : (
              <button disabled={busy} onClick={onCancel}>
                {t("setupFlow.cancel")}
              </button>
            )}
            {/* The form draws no buttons of its own (it has a formId): Skip lives here. */}
            {!current.required && (
              <button disabled={waiting} onClick={() => skip(current.id)}>
                {t("setupSteps.skip")}
              </button>
            )}
            {/* A form's Next submits it from here, like the folder step's; a component step ends itself (done()). */}
            {current.kind === "form" && (
              <button type="submit" form={stepFormId} className="hh-primary" disabled={waiting}>
                {t("setupFlow.next")}
              </button>
            )}
            {/* An interview's Next waits while its task is busy (a turn, the closing turn). */}
            {current.kind === "interview" && (
              <button
                className="hh-primary"
                disabled={waiting || (tasks?.current?.action === current.action && tasks?.current?.status !== "waiting")}
                onClick={() => finishInterview(current)}
              >
                {t("setupFlow.next")}
              </button>
            )}
          </>
        ) : (
          <>
            {/* The profile step: Cancel when it was opened by "Add", else Back to the engine. */}
            {step === "profile" && (
              <>
                {/* Not while a create is on its way: its answer would move the flow on from wherever it went. */}
                {newProfile ? (
                  <button disabled={creating} onClick={onCancel}>
                    {t("setupFlow.cancel")}
                  </button>
                ) : (
                  <button disabled={creating} onClick={() => setStep("engine")}>
                    {t("setupFlow.back")}
                  </button>
                )}
                <button type="submit" form={profileFormId} className="hh-primary" disabled={creating || stranded !== null}>
                  {t("setupFlow.next")}
                </button>
              </>
            )}
            {/* Not while the engine is being saved: its answer would move the flow on from wherever it went. */}
            {step !== "profile" &&
              (step === "engine" && withFolder ? (
                <button disabled={saving} onClick={() => setStep("folder")}>
                  {t("setupFlow.back")}
                </button>
              ) : (
                <button disabled={saving} onClick={onCancel}>
                  {t("setupFlow.cancel")}
                </button>
              ))}
            {/* The folder step's Next submits its form from here, so it sits where the engine step's does. */}
            {step === "folder" && (
              <button type="submit" form={folderFormId} className="hh-primary">
                {t("setupFlow.next")}
              </button>
            )}
            {/* With harness steps, it also waits for which of them this run goes through. */}
            {step === "engine" && (
              <button className="hh-primary" disabled={!selection?.ready || saving || queue === null} onClick={() => void next()}>
                {t("setupFlow.next")}
              </button>
            )}
          </>
        )}
      </footer>
    </div>
  );
}

/** A `component` step: the harness's own React step, or a line saying it can't be shown (setup-steps spec §3). */
function ComponentStep({
  client,
  step,
  components,
  profile,
  done,
  skip,
}: {
  client: HarnessClient;
  step: SetupStepView;
  components: Record<string, ComponentType<SetupStepProps>>;
  /** The active profile in a harness with profiles; null without them. */
  profile: ProfileView | null;
  done: () => void;
  skip: () => void;
}) {
  const { t } = useTranslation();
  const name = step.component ?? "";
  const Component = Object.hasOwn(components, name) ? components[name] : undefined;
  if (!Component) return <p className="hh-caption" role="alert">{t("setupSteps.missingComponent")}</p>;
  return <Component client={client} profile={profile} done={done} skip={skip} />;
}
