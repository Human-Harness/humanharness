import { useId, useReducer, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Language, Tier } from "@humanharness/harness-sdk";
import type { Effort, ModelSpec, ModelsConfig, TaskModelChoice } from "@humanharness/engines";
import { Segmented } from "./chrome";
import type { AppState, HarnessClient, ModelsView } from "./client";
import { uiLanguage } from "./FolderStep";

// Local copies: the UI only imports types from the core packages.
const TIERS: readonly Tier[] = ["light", "standard", "deep"];
const CAPS: readonly number[] = [100_000, 200_000, 400_000, 1_000_000];
const QUESTIONS = "questions";
const FALLBACK_SPEC: ModelSpec = { effort: "medium", cap: 200_000 };

type Choice = Tier | "custom";
type Offer = ModelsView["offered"][string];
const NO_OFFER: Offer = { models: [], efforts: ["low", "medium", "high"] };

interface TaskRowInfo {
  key: string;
  label: string;
  description?: string;
}

/** 100000 → "100 k", 1000000 → "1 M". */
export function formatCap(n: number): string {
  return n >= 1_000_000 ? `${n / 1_000_000} M` : `${Math.round(n / 1000)} k`;
}

/** `models` with one task's setting replaced (null: back to the recommendation); empty sections go away. */
function withTask(models: ModelsConfig, key: string, choice: TaskModelChoice | null): ModelsConfig {
  const { tasks: old, ...rest } = models;
  const tasks = { ...old };
  if (choice === null) delete tasks[key];
  else tasks[key] = choice;
  return Object.keys(tasks).length > 0 ? { ...rest, tasks } : rest;
}

const withModel = (spec: ModelSpec, model: string | undefined): ModelSpec => {
  const { model: _old, ...rest } = spec;
  return model ? { ...rest, model } : rest;
};

/** The actions in path order, then the others, then free questions. */
function taskRows(state: AppState, lang: Language, questions: TaskRowInfo): TaskRowInfo[] {
  const path = (state.path ?? []).filter((id) => state.actions[id]);
  const ids = [...path, ...Object.keys(state.actions).filter((id) => !path.includes(id))];
  return [...ids.map((id) => ({ key: id, label: state.actions[id].label[lang], description: state.actions[id].description?.[lang] })), questions];
}

/**
 * The `models` object Settings edits. config.json merges a save shallowly, so every save sends the whole
 * object; changes made while a save is on its way build on the newest one, not on the last saved state.
 */
function useModels(client: HarnessClient, state: AppState, onChange: (s: AppState) => void) {
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const pending = useRef(0);
  const latest = useRef<{ from: ModelsConfig | undefined | null; models: ModelsConfig }>({ from: state.config.models, models: state.config.models ?? {} });
  if (pending.current === 0 && latest.current.from !== state.config.models) latest.current = { from: state.config.models, models: state.config.models ?? {} };
  const update = (change: (models: ModelsConfig) => ModelsConfig) => {
    const models = change(latest.current.models);
    latest.current = { ...latest.current, models };
    pending.current++;
    client.saveConfig({ models }).then(
      (s) => {
        pending.current--;
        onChange(s);
      },
      () => {
        // Not saved: show what config.json holds again.
        pending.current--;
        latest.current = { ...latest.current, from: null };
        rerender();
      },
    );
  };
  return [latest.current.models, update] as const;
}

/**
 * Settings › Modelos (resources spec §7): how much model each task uses and what each level runs on, per
 * engine. Saved in config.json; a change applies to the next task, never to the running one.
 */
export function ModelsTab({ client, state, onChange }: { client: HarnessClient; state: AppState; onChange: (s: AppState) => void }) {
  const { t, i18n } = useTranslation();
  const tasksId = useId();
  const [models, update] = useModels(client, state, onChange);
  const view = state.models;
  if (!view) return null;
  const lang = uiLanguage(state, i18n.language);
  const engine = state.config.engineId ?? state.engines[0]?.id ?? "";
  const engineName = state.engines.find((e) => e.id === engine)?.name ?? engine;
  const tierSpec = (tier: Tier): ModelSpec => models.tiers?.[engine]?.[tier] ?? view.defaults[engine]?.[tier] ?? FALLBACK_SPEC;
  const offer = view.offered[engine] ?? NO_OFFER;
  const rows = taskRows(state, lang, { key: QUESTIONS, label: t("models.questions"), description: t("models.questionsHint") });

  return (
    <div className="hh-tab">
      <section aria-labelledby={tasksId}>
        <div className="hh-model-head">
          <h3 id={tasksId}>{t("models.tasks")}</h3>
          {engineName && <span className="hh-caption">{t("models.engineNow", { engine: engineName })}</span>}
        </div>
        <p className="hh-caption">{t("models.tasksIntro")}</p>
        <div className="hh-rows">
          {rows.map(({ key, label, description }) => {
            const choice = models.tasks?.[key];
            const recommended = view.recommended[key] ?? "standard";
            const custom = typeof choice === "object" ? choice.custom : undefined;
            const spec = custom ?? tierSpec(typeof choice === "string" ? choice : recommended);
            return (
              <TaskRow
                key={key}
                label={label}
                description={description}
                recommended={recommended}
                choice={choice}
                spec={spec}
                offer={offer}
                onPick={(v) => update((m) => withTask(m, key, v === "custom" ? { custom: { engine, ...spec } } : v === recommended ? null : v))}
                onCustom={(next) => update((m) => withTask(m, key, { custom: { engine, ...next } }))}
                onRestore={() => update((m) => withTask(m, key, null))}
              />
            );
          })}
        </div>
      </section>
    </div>
  );
}

function TaskRow({
  label,
  description,
  recommended,
  choice,
  spec,
  offer,
  onPick,
  onCustom,
  onRestore,
}: {
  label: string;
  description?: string;
  recommended: Tier;
  choice: TaskModelChoice | undefined;
  /** The task's custom setting, or the level's settings a new custom one starts from. */
  spec: ModelSpec;
  offer: Offer;
  onPick: (choice: Choice) => void;
  onCustom: (spec: ModelSpec) => void;
  onRestore: () => void;
}) {
  const { t } = useTranslation();
  const editorId = useId();
  const [open, setOpen] = useState(false);
  const value: Choice = choice === undefined ? recommended : typeof choice === "string" ? choice : "custom";
  const options = (["light", "standard", "deep", "custom"] as const).map((v) => ({ value: v as Choice, label: t(`models.tier.${v}`) }));
  return (
    <div className="hh-row hh-model-task">
      <span className="hh-model-name">
        <span className="hh-row-label">{label}</span>
        {description && <span className="hh-caption">{description}</span>}
      </span>
      <Segmented
        label={label}
        value={value}
        options={options}
        onChange={(v) => {
          setOpen(v === "custom");
          onPick(v);
        }}
      />
      {value === "custom" && (
        <p className="hh-caption">
          {t("models.customSummary", { model: spec.model ?? t("models.engineDefault"), effort: t(`models.effortLevel.${spec.effort}`), cap: formatCap(spec.cap) })}{" "}
          <button type="button" className="hh-link" aria-expanded={open} aria-controls={open ? editorId : undefined} onClick={() => setOpen(!open)}>
            {t("models.edit")}
          </button>
        </p>
      )}
      {value !== "custom" && value !== recommended && (
        <p className="hh-caption">
          {t("models.changed", { tier: t(`models.tier.${recommended}`) })}{" "}
          <button type="button" className="hh-link" onClick={onRestore}>
            {t("models.restore")}
          </button>
        </p>
      )}
      {value === "custom" && open && (
        <div id={editorId} className="hh-model-editor">
          <SpecFields spec={spec} offer={offer} onChange={onCustom} />
          <p className="hh-caption">{t("models.customHint")}</p>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              onRestore();
            }}
          >
            {t("models.backToRecommended")}
          </button>
        </div>
      )}
    </div>
  );
}

/** Model, effort and context cap. A saved value the engine no longer lists stays selectable as it is. */
export function SpecFields({ spec, offer, onChange }: { spec: ModelSpec; offer: Offer; onChange: (s: ModelSpec) => void }) {
  const { t } = useTranslation();
  const id = useId();
  const models = spec.model === undefined || offer.models.some((m) => m.id === spec.model) ? offer.models : [{ id: spec.model }, ...offer.models];
  const efforts: Effort[] = offer.efforts.includes(spec.effort) ? offer.efforts : [...offer.efforts, spec.effort];
  const caps = CAPS.includes(spec.cap) ? CAPS : [...CAPS, spec.cap].sort((a, b) => a - b);
  return (
    <div className="hh-model-fields">
      <label htmlFor={`${id}-model`}>{t("models.model")}</label>
      <select id={`${id}-model`} value={spec.model ?? ""} onChange={(e) => onChange(withModel(spec, e.target.value || undefined))}>
        <option value="">{t("models.engineDefault")}</option>
        {models.map((m) => (
          <option key={m.id} value={m.id} title={m.description}>
            {m.name ?? m.id}
          </option>
        ))}
      </select>
      <label htmlFor={`${id}-effort`}>{t("models.effort")}</label>
      <select id={`${id}-effort`} value={spec.effort} onChange={(e) => onChange({ ...spec, effort: e.target.value as Effort })}>
        {efforts.map((e) => (
          <option key={e} value={e}>
            {t(`models.effortLevel.${e}`)}
          </option>
        ))}
      </select>
      <label htmlFor={`${id}-cap`}>{t("models.cap")}</label>
      <select id={`${id}-cap`} value={String(spec.cap)} onChange={(e) => onChange({ ...spec, cap: Number(e.target.value) })}>
        {caps.map((c) => (
          <option key={c} value={c}>
            {formatCap(c)}
          </option>
        ))}
      </select>
    </div>
  );
}
