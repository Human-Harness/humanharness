import { type ReactNode, useEffect, useId, useReducer, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Tier } from "@humanharness/harness-sdk";
import type { AppState, Effort, HarnessClient, ModelSpec, ModelsConfig, ModelsView, TaskModelChoice } from "./client";
import { shownLanguage } from "./language";
import { Group, Row, Rx, SectionHead } from "./guide";

// Local copies: the UI imports nothing from the core packages.
const TIERS: readonly Tier[] = ["light", "standard", "deep"];
/** Each level's tag colour (DESIGN.md "Tag colors": light green, standard blue, deep violet). */
const TIER_COLOR: Record<Tier, "green" | "blue" | "violet"> = { light: "green", standard: "blue", deep: "violet" };
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
  const [models, update, saveFailed] = useModels(client, state, onChange);
  const [part, setPart] = useState<"tasks" | "levels">(focus?.part ?? "tasks");
  const focusN = focus?.n;
  useEffect(() => {
    if (focus) setPart(focus.part);
  }, [focusN]);
  const view = state.models;
  const head = (
    <SectionHead
      line={t("settings.line.models")}
      aside={
        view && (
          <Rx.SegmentedControl.Root value={part} onValueChange={(v) => setPart(v as "tasks" | "levels")} aria-label={t("settings.tabs.models")}>
            <Rx.SegmentedControl.Item value="tasks">{t("models.tasks")}</Rx.SegmentedControl.Item>
            <Rx.SegmentedControl.Item value="levels">{t("models.levels")}</Rx.SegmentedControl.Item>
          </Rx.SegmentedControl.Root>
        )
      }
    />
  );
  // No models view from main yet: the section's head alone.
  if (!view) return <div>{head}</div>;
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
    <div>
      {head}
      {saveFailed && (
        <Rx.Callout.Root color="red" role="alert" mb="3">
          <Rx.Callout.Text>{t("models.saveFailed")}</Rx.Callout.Text>
        </Rx.Callout.Root>
      )}
      {part === "levels" && <LevelsSection state={state} view={view} models={models} rows={rows} update={update} />}
      {part === "tasks" && (
        <>
          {/* The engine the tasks run on: a grey tag, the one thing a card title may carry (Marco, 2026-11-04). */}
          <Group
            title={t("models.tasks")}
            tag={
              engineName && (
                <Rx.Badge color="gray" variant="soft">
                  {engineName}
                </Rx.Badge>
              )
            }
            data-setting="models.tasks"
          >
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
          </Group>
          <Group>
            <PinnedBudget
              value={models.pinnedTokens ?? view.pinnedTokens}
              suggested={view.pinnedTokens}
              onChange={(n) => update(({ pinnedTokens: _, ...rest }) => (n === view.pinnedTokens ? rest : { ...rest, pinnedTokens: n }))}
            />
          </Group>
        </>
      )}
    </div>
  );
}

/** A level's tag: light green, standard blue, deep violet (DESIGN.md "Tag colors"). */
function TierBadge({ tier }: { tier: Tier }) {
  const { t } = useTranslation();
  return (
    <Rx.Badge color={TIER_COLOR[tier]} variant="soft">
      {t(`models.tier.${tier}`)}
    </Rx.Badge>
  );
}

/**
 * Niveles: what each level runs on, per engine, and which tasks use it. One card: the engine first, then one row per
 * level with its three fields and the tasks on it (Marco, 2026-11-04).
 */
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
  const [engine, setEngine] = useState(state.config.engineId ?? state.engines[0]?.id ?? "");
  const offer = view.offered[engine] ?? NO_OFFER;
  const name = state.engines.find((e) => e.id === engine)?.name ?? engine;
  const tierSpec = (tier: Tier): ModelSpec => models.tiers?.[engine]?.[tier] ?? view.defaults[engine]?.[tier] ?? FALLBACK_SPEC;
  /** The tasks on `tier`: their own setting, else the recommendation (a custom task uses no level). */
  const users = (tier: Tier) => rows.filter(({ key }) => (models.tasks?.[key] ?? view.recommended[key] ?? "standard") === tier).map((r) => r.label);
  return (
    <Group title={t("models.levels")} data-setting="models.levels">
      {/* A control never sits by a card title: the engine drops to the first row (DESIGN.md "Settings"). */}
      <Row label={t("models.engine")} hint={t("models.levelsIntro", { engine: name })}>
        {state.engines.length > 1 && (
          <Rx.SegmentedControl.Root value={engine} onValueChange={setEngine} aria-label={t("models.engine")}>
            {state.engines.map((e) => (
              <Rx.SegmentedControl.Item key={e.id} value={e.id}>
                {e.name}
              </Rx.SegmentedControl.Item>
            ))}
          </Rx.SegmentedControl.Root>
        )}
      </Row>
      {TIERS.map((tier) => {
        const used = users(tier);
        return (
          <Row
            key={tier}
            aria-label={t(`models.tier.${tier}`)}
            label={<TierBadge tier={tier} />}
            hint={t(`models.tierHint.${tier}`)}
            below={
              <Rx.Flex direction="column" gap="3">
                <SpecFields spec={tierSpec(tier)} offer={offer} onChange={(spec) => update((m) => withTier(m, engine, tier, spec))} />
                <Rx.Flex align="center" gap="2" wrap="wrap">
                  <Rx.Text size="1" color="gray">
                    {t("models.usedBy")}
                  </Rx.Text>
                  {used.length > 0 ? (
                    // Chips: things, white with a border (DESIGN.md "Badge").
                    <Rx.Flex gap="1" wrap="wrap" role="list" aria-label={t("models.usedBy")}>
                      {used.map((l) => (
                        <Rx.Badge key={l} role="listitem" color="gray" variant="outline">
                          {l}
                        </Rx.Badge>
                      ))}
                    </Rx.Flex>
                  ) : (
                    <Rx.Text size="1" color="gray">
                      {t("models.nobody")}
                    </Rx.Text>
                  )}
                </Rx.Flex>
              </Rx.Flex>
            }
          />
        );
      })}
      {/* The card's end: a caption, and on the right its one action, secondary (DESIGN.md "Card and settings rows"). */}
      <Rx.Flex align="center" justify="between" gap="3" pt="3" wrap="wrap">
        <Rx.Text as="p" size="1" color="gray">
          {t("models.fallbackHint")}
        </Rx.Text>
        <Rx.Button size="1" variant="outline" color="gray" onClick={() => update((m) => withTier(m, engine, null))}>
          {t("models.restoreAll")}
        </Rx.Button>
      </Rx.Flex>
    </Group>
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
  // Under the control, right-aligned: the custom summary, or the recommendation when the choice is another level.
  const note =
    value === "custom" ? (
      <>
        <Rx.Text size="1" color="gray">
          {t("models.customSummary", { model: spec.model ?? t("models.engineDefault"), effort: t(`models.effortLevel.${spec.effort}`), cap: formatCap(spec.cap) })}
        </Rx.Text>
        <Rx.Button size="1" variant="ghost" color="gray" aria-expanded={open} aria-controls={open ? editorId : undefined} onClick={() => setOpen(!open)}>
          {t("models.edit")}
        </Rx.Button>
      </>
    ) : value !== recommended ? (
      <>
        <Rx.Text size="1" color="gray">
          {t("models.changed", { tier: t(`models.tier.${recommended}`) })}
        </Rx.Text>
        <Rx.Button size="1" variant="ghost" color="gray" onClick={onRestore}>
          {t("models.restore")}
        </Rx.Button>
      </>
    ) : null;
  return (
    <Row
      aria-label={label}
      label={label}
      hint={description}
      below={
        (note || (value === "custom" && open)) && (
          <Rx.Flex direction="column" gap="3">
            {note && (
              <Rx.Flex align="center" justify="end" gap="3" wrap="wrap">
                {note}
              </Rx.Flex>
            )}
            {value === "custom" && open && (
              <Rx.Flex id={editorId} direction="column" gap="3">
                <SpecFields spec={spec} offer={offer} onChange={onCustom} />
                <Rx.Text as="p" size="1" color="gray">
                  {t("models.customHint")}
                </Rx.Text>
                <Rx.Box>
                  <Rx.Button
                    size="1"
                    variant="ghost"
                    color="gray"
                    onClick={() => {
                      setOpen(false);
                      onRestore();
                    }}
                  >
                    {t("models.backToRecommended", { tier: t(`models.tier.${recommended}`) })}
                  </Rx.Button>
                </Rx.Box>
              </Rx.Flex>
            )}
          </Rx.Flex>
        )
      }
    >
      <Rx.SegmentedControl.Root
        value={value}
        aria-label={label}
        onValueChange={(v) => {
          setOpen(v === "custom");
          onPick(v as Choice);
        }}
      >
        {(["light", "standard", "deep", "custom"] as const).map((v) => (
          <Rx.SegmentedControl.Item key={v} value={v}>
            {t(`models.tier.${v}`)}
          </Rx.SegmentedControl.Item>
        ))}
      </Rx.SegmentedControl.Root>
    </Row>
  );
}

/** One field of the three: its label on top, a select under it (DESIGN.md "Field and form controls"). */
function SpecSelect({ id, label, value, onChange, children }: { id: string; label: string; value: string; onChange: (v: string) => void; children: ReactNode }) {
  return (
    <Rx.Flex direction="column" gap="2" minWidth="0">
      <Rx.Text as="label" size="2" weight="bold" htmlFor={id}>
        {label}
      </Rx.Text>
      <Rx.Select.Root value={value} onValueChange={onChange}>
        <Rx.Select.Trigger id={id} aria-label={label} />
        <Rx.Select.Content position="popper">{children}</Rx.Select.Content>
      </Rx.Select.Root>
    </Rx.Flex>
  );
}

/** Radix's Select has no empty value: the engine's own model stands for "no model set". */
const ENGINE_DEFAULT = "__engine-default__";

/**
 * Model, effort and context cap, in one line (Marco, 2026-11-04). A saved value the engine no longer lists stays
 * selectable as it is.
 */
export function SpecFields({ spec, offer, onChange }: { spec: ModelSpec; offer: Offer; onChange: (s: ModelSpec) => void }) {
  const { t } = useTranslation();
  const id = useId();
  const models = spec.model === undefined || offer.models.some((m) => m.id === spec.model) ? offer.models : [{ id: spec.model }, ...offer.models];
  const efforts: Effort[] = offer.efforts.includes(spec.effort) ? offer.efforts : [...offer.efforts, spec.effort];
  const caps = CAPS.includes(spec.cap) ? CAPS : [...CAPS, spec.cap].sort((a, b) => a - b);
  return (
    <Rx.Grid columns={{ initial: "1", xs: "3" }} gap="3">
      <SpecSelect id={`${id}-model`} label={t("models.model")} value={spec.model ?? ENGINE_DEFAULT} onChange={(v) => onChange(withModel(spec, v === ENGINE_DEFAULT ? undefined : v))}>
        <Rx.Select.Item value={ENGINE_DEFAULT}>{t("models.engineDefault")}</Rx.Select.Item>
        {models.map((m) => (
          <Rx.Select.Item key={m.id} value={m.id} title={m.description}>
            {m.name ?? m.id}
          </Rx.Select.Item>
        ))}
      </SpecSelect>
      <SpecSelect id={`${id}-effort`} label={t("models.effort")} value={spec.effort} onChange={(v) => onChange({ ...spec, effort: v as Effort })}>
        {efforts.map((e) => (
          <Rx.Select.Item key={e} value={e}>
            {t(`models.effortName.${e}`)}
          </Rx.Select.Item>
        ))}
      </SpecSelect>
      <SpecSelect id={`${id}-cap`} label={t("models.cap")} value={String(spec.cap)} onChange={(v) => onChange({ ...spec, cap: Number(v) })}>
        {caps.map((c) => (
          <Rx.Select.Item key={c} value={String(c)}>
            {formatCap(c)}
          </Rx.Select.Item>
        ))}
      </SpecSelect>
    </Rx.Grid>
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
    <Row label={t("models.pinned")} htmlFor={id} hint={t("models.pinnedHint")} hintId={`${id}-hint`}>
      <Rx.Select.Root value={String(value)} onValueChange={(v) => onChange(Number(v))}>
        <Rx.Select.Trigger id={id} aria-label={t("models.pinned")} aria-describedby={`${id}-hint`} />
        <Rx.Select.Content position="popper">
          {options.map((n) => {
            const tokens = n.toLocaleString(shownLanguage(i18n));
            return (
              <Rx.Select.Item key={n} value={String(n)}>
                {t(n === suggested ? "models.pinnedSuggested" : "models.pinnedOption", { tokens })}
              </Rx.Select.Item>
            );
          })}
        </Rx.Select.Content>
      </Rx.Select.Root>
    </Row>
  );
}
