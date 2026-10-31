import { useEffect, useId, useReducer, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Tier } from "@humanharness/harness-sdk";
import { Segmented, Tag, type TagTone } from "./chrome";
import type { AppState, Effort, HarnessClient, ModelSpec, ModelsConfig, ModelsView, TaskModelChoice } from "./client";
import { shownLanguage } from "./language";
import { SectionHead, SettingRow, SettingsCard } from "./settings-parts";

// Local copies: the UI imports nothing from the core packages.
const TIERS: readonly Tier[] = ["light", "standard", "deep"];
/** Each level's tag colour (UI refresh spec: light green, standard blue, deep violet). */
const TIER_TONE: Record<Tier, TagTone> = { light: "green", standard: "blue", deep: "violet" };
const CAPS: readonly number[] = [100_000, 200_000, 400_000, 1_000_000];
/** The engines package's `PINNED_OPTIONS`. */
const PINNED: readonly number[] = [1000, 3000, 6000, 12_000];
export const QUESTIONS = "questions";
const FALLBACK_SPEC: ModelSpec = { effort: "medium", cap: 200_000 };

type Choice = Tier | "custom";
type Offer = ModelsView["offered"][string];
const NO_OFFER: Offer = { models: [], efforts: ["low", "medium", "high"] };

export interface TaskRowInfo {
  key: string;
  label: string;
  description?: string;
}

/** 100000 → "100k", 1000000 → "1M". */
export function formatCap(n: number): string {
  return n >= 1_000_000 ? `${n / 1_000_000}M` : `${Math.round(n / 1000)}k`;
}

/** `models` with one task's setting replaced (null: back to the recommendation); empty sections go away. */
function withTask(models: ModelsConfig, key: string, choice: TaskModelChoice | null): ModelsConfig {
  const { tasks: old, ...rest } = models;
  const tasks = { ...old };
  if (choice === null) delete tasks[key];
  else tasks[key] = choice;
  return Object.keys(tasks).length > 0 ? { ...rest, tasks } : rest;
}

/** `models` with one level of one engine replaced; `tier` null clears the engine's whole table. */
function withTier(models: ModelsConfig, engine: string, tier: Tier | null, spec?: ModelSpec): ModelsConfig {
  const { tiers: old, ...rest } = models;
  const tiers = { ...old };
  if (tier === null || !spec) delete tiers[engine];
  else tiers[engine] = { ...tiers[engine], [tier]: spec };
  return Object.keys(tiers).length > 0 ? { ...rest, tiers } : rest;
}

const withModel = (spec: ModelSpec, model: string | undefined): ModelSpec => {
  const { model: _old, ...rest } = spec;
  return model ? { ...rest, model } : rest;
};

// Local copy of the material stages' reserved ids (harness-sdk MATERIAL_STAGE_KEYS, tested to match), in their order.
export const MATERIAL_ROWS = ["material-review", "material-repair", "material-label", "material-sheet", "material-link"] as const;

/**
 * The actions in path order, then the others, then free questions, then (with material, and only when
 * `material` gives the stages' labels) the material stages; the links stage only with items (material spec §8);
 * Sidekick last, only when given (sidekick spec §5).
 */
export function taskRows(state: AppState, questions: TaskRowInfo, material?: Record<string, string>, sidekick?: TaskRowInfo): TaskRowInfo[] {
  const path = (state.path ?? []).filter((id) => state.actions[id]);
  const ids = [...path, ...Object.keys(state.actions).filter((id) => !path.includes(id))];
  const stages = state.material && material ? MATERIAL_ROWS.filter((k) => k !== "material-link" || state.material?.items) : [];
  return [
    ...ids.map((id) => ({ key: id, label: state.actions[id].label, description: state.actions[id].description })),
    questions,
    ...stages.map((key) => ({ key, label: material?.[key] ?? key })),
    ...(sidekick ? [sidekick] : []),
  ];
}

/**
 * The `models` object Settings edits. config.json merges a save shallowly, so every save sends the whole
 * object; changes made while a save is on its way build on the newest one, not on the last saved state.
 */
function useModels(client: HarnessClient, state: AppState, onChange: (s: AppState) => void) {
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const pending = useRef(0);
  const [failed, setFailed] = useState(false);
  const latest = useRef<{ from: ModelsConfig | undefined | null; models: ModelsConfig }>({ from: state.config.models, models: state.config.models ?? {} });
  if (pending.current === 0 && latest.current.from !== state.config.models) latest.current = { from: state.config.models, models: state.config.models ?? {} };
  const update = (change: (models: ModelsConfig) => ModelsConfig) => {
    const models = change(latest.current.models);
    latest.current = { ...latest.current, models };
    pending.current++;
    setFailed(false);
    // Draw the change now: a second edit before the save comes back builds on what the screen shows.
    rerender();
    client.saveConfig({ models }).then(
      (s) => {
        pending.current--;
        onChange(s);
      },
      () => {
        // Not saved: show what config.json holds again, and say so.
        pending.current--;
        latest.current = { ...latest.current, from: null };
        setFailed(true);
        rerender();
      },
    );
  };
  return [latest.current.models, update, failed] as const;
}

/**
 * Settings › Modelos (resources spec §7): how much model each task uses and what each level runs on, per
 * engine. Saved in config.json; a change applies to the next task, never to the running one.
 */
export function ModelsTab({
  client,
  state,
  onChange,
  focus,
}: {
  client: HarnessClient;
  state: AppState;
  onChange: (s: AppState) => void;
  /** Search's Models row (§6): the part it shows; `n` changes on each search, the tab staying as it is otherwise. */
  focus?: { part: "tasks" | "levels"; n: number };
}) {
  const { t } = useTranslation();
  const tasksId = useId();
  const [models, update, saveFailed] = useModels(client, state, onChange);
  const [part, setPart] = useState<"tasks" | "levels">(focus?.part ?? "tasks");
  const focusN = focus?.n;
  useEffect(() => {
    if (focus) setPart(focus.part);
  }, [focusN]);
  const view = state.models;
  if (!view) return null;
  const engine = state.config.engineId ?? state.engines[0]?.id ?? "";
  const engineName = state.engines.find((e) => e.id === engine)?.name ?? engine;
  const tierSpec = (tier: Tier): ModelSpec => models.tiers?.[engine]?.[tier] ?? view.defaults[engine]?.[tier] ?? FALLBACK_SPEC;
  const offer = view.offered[engine] ?? NO_OFFER;
  const rows = taskRows(
    state,
    { key: QUESTIONS, label: t("models.questions"), description: t("models.questionsHint") },
    state.material
      ? {
          "material-review": t("models.material.review"),
          "material-repair": t("models.material.repair"),
          "material-label": t("models.material.label"),
          "material-sheet": t("models.material.sheet"),
          "material-link": t("models.material.link"),
        }
      : undefined,
    state.sidekick ? { key: "sidekick", label: t("sidekick.models.label"), description: t("sidekick.models.hint") } : undefined,
  );

  return (
    <div className="hh-tab">
      <SectionHead title={t("settings.tabs.models")} line={t("settings.line.models")} />
      <div className="hh-model-head">
        <Segmented
          label={t("settings.tabs.models")}
          value={part}
          onChange={setPart}
          options={[
            { value: "tasks", label: t("models.tasks") },
            { value: "levels", label: t("models.levels") },
          ]}
        />
        {part === "tasks" && engineName && <span className="hh-caption">{t("models.engineNow", { engine: engineName })}</span>}
      </div>
      {saveFailed && (
        <p className="hh-caption" role="alert">
          {t("models.saveFailed")}
        </p>
      )}
      {part === "levels" && <LevelsSection state={state} view={view} models={models} rows={rows} update={update} />}
      {part === "tasks" && (
        <section aria-labelledby={tasksId} data-setting="models.tasks">
          <SettingsCard title={t("models.tasks")} headingId={tasksId}>
            <TaskList rows={rows} view={view} models={models} engine={engine} tierSpec={tierSpec} offer={offer} update={update} />
          </SettingsCard>
          <SettingsCard>
            <PinnedBudget
              value={models.pinnedTokens ?? view.pinnedTokens}
              suggested={view.pinnedTokens}
              onChange={(n) =>
                update(({ pinnedTokens: _, ...rest }) => (n === view.pinnedTokens ? rest : { ...rest, pinnedTokens: n }))
              }
            />
          </SettingsCard>
        </section>
      )}
    </div>
  );
}

function TaskList({
  rows,
  view,
  models,
  engine,
  tierSpec,
  offer,
  update,
}: {
  rows: TaskRowInfo[];
  view: ModelsView;
  models: ModelsConfig;
  engine: string;
  tierSpec: (tier: Tier) => ModelSpec;
  offer: Offer;
  update: (change: (models: ModelsConfig) => ModelsConfig) => void;
}) {
  return (
    <>
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
            onPick={(v) => update((m) => withTask(m, key, v === "custom" ? { custom: { ...spec, engine } } : v === recommended ? null : v))}
            // The editor offers the current engine's models: an edited custom task runs on that engine.
            onCustom={(next) => update((m) => withTask(m, key, { custom: { ...next, engine } }))}
            onRestore={() => update((m) => withTask(m, key, null))}
          />
        );
      })}
    </>
  );
}

/** Niveles: what each level runs on, per engine, and which tasks use it. */
function LevelsSection({
  state,
  view,
  models,
  rows,
  update,
}: {
  state: AppState;
  view: ModelsView;
  models: ModelsConfig;
  rows: TaskRowInfo[];
  update: (change: (models: ModelsConfig) => ModelsConfig) => void;
}) {
  const { t } = useTranslation();
  const headingId = useId();
  const [engine, setEngine] = useState(state.config.engineId ?? state.engines[0]?.id ?? "");
  const offer = view.offered[engine] ?? NO_OFFER;
  const name = state.engines.find((e) => e.id === engine)?.name ?? engine;
  const tierSpec = (tier: Tier): ModelSpec => models.tiers?.[engine]?.[tier] ?? view.defaults[engine]?.[tier] ?? FALLBACK_SPEC;
  /** The tasks on `tier`: their own setting, else the recommendation (a custom task uses no level). */
  const users = (tier: Tier) => rows.filter(({ key }) => (models.tasks?.[key] ?? view.recommended[key] ?? "standard") === tier).map((r) => r.label);
  return (
    <section aria-labelledby={headingId} data-setting="models.levels">
      <SettingsCard
        title={t("models.levels")}
        headingId={headingId}
        actions={
          state.engines.length > 1 && (
            <div className="hh-model-engine">
              <span className="hh-row-label">{t("models.engine")}</span>
              <Segmented label={t("models.engine")} value={engine} onChange={setEngine} options={state.engines.map((e) => ({ value: e.id, label: e.name }))} />
            </div>
          )
        }
      >
      <p className="hh-caption">{t("models.levelsIntro", { engine: name })}</p>
      <div className="hh-model-cards">
        {TIERS.map((tier) => {
          const label = t(`models.tier.${tier}`);
          const used = users(tier);
          return (
            <section key={tier} className="hh-model-card" aria-label={label}>
              <h4>
                <Tag tone={TIER_TONE[tier]}>{label}</Tag>
              </h4>
              <p className="hh-caption">{t(`models.tierHint.${tier}`)}</p>
              <SpecFields spec={tierSpec(tier)} offer={offer} onChange={(spec) => update((m) => withTier(m, engine, tier, spec))} />
              <p className="hh-caption">{t("models.usedBy")}</p>
              {used.length > 0 ? (
                <ul className="hh-model-chips" aria-label={t("models.usedBy")}>
                  {used.map((l) => (
                    <li key={l}>{l}</li>
                  ))}
                </ul>
              ) : (
                <p className="hh-caption">{t("models.nobody")}</p>
              )}
            </section>
          );
        })}
      </div>
      <p className="hh-caption">{t("models.fallbackHint")}</p>
      <div>
        <button type="button" className="hh-pill" onClick={() => update((m) => withTier(m, engine, null))}>
          {t("models.restoreAll")}
        </button>
      </div>
      </SettingsCard>
    </section>
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
    <SettingRow className="hh-model-task" label={label} hint={description}>
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
        <p className="hh-model-note">
          <span className="hh-model-changed">{t("models.changed", { tier: t(`models.tier.${recommended}`) })}</span>{" "}
          <button type="button" className="hh-pill" onClick={onRestore}>
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
            {t("models.backToRecommended", { tier: t(`models.tier.${recommended}`) })}
          </button>
        </div>
      )}
    </SettingRow>
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
            {t(`models.effortName.${e}`)}
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

/**
 * How much pinned text a new task gets whole (context-panel spec §4.2). The harness's suggestion is always offered;
 * picking it drops the saved value, so the harness's own number applies again.
 */
function PinnedBudget({ value, suggested, onChange }: { value: number; suggested: number; onChange: (n: number) => void }) {
  const { t, i18n } = useTranslation();
  const id = useId();
  const options = [...new Set([...PINNED, suggested, value])].sort((a, b) => a - b);
  return (
    <div className="hh-model-fields">
      <label htmlFor={id}>{t("models.pinned")}</label>
      <select id={id} value={String(value)} aria-describedby={`${id}-hint`} onChange={(e) => onChange(Number(e.target.value))}>
        {options.map((n) => {
          const tokens = n.toLocaleString(shownLanguage(i18n));
          return (
            <option key={n} value={String(n)}>
              {t(n === suggested ? "models.pinnedSuggested" : "models.pinnedOption", { tokens })}
            </option>
          );
        })}
      </select>
      <p id={`${id}-hint`} className="hh-caption hh-ctxp-budget-hint">
        {t("models.pinnedHint")}
      </p>
    </div>
  );
}
