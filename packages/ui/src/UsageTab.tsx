import { type ReactNode, useEffect, useState } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import type { AppState, EngineOption, HarnessClient, LimitWindow, UsageSummary } from "./client";
import { QUESTIONS, taskRows } from "./ModelsTab";
import { shownTitle, useProfiles } from "./ProfileSwitcher";
import { WARN_AT, compactTokens, compareTokens, formatReset, percent, timesFit, timesLeft } from "./usage";
import { useCurrentWindows } from "./UsageMeter";
import { shownLanguage } from "./language";
import { Group, Hidden, Row, Rx, SectionHead } from "./guide";

const EMPTY: UsageSummary = { limits: null, estimates: {}, tokens: {} };

/** A grey line in a card: its whole text when it has nothing else to show (14), or a note at its end (12). */
function Note({ children, size = "1" }: { children: ReactNode; size?: "1" | "2" }) {
  return (
    <Rx.Box py="3">
      <Rx.Text as="p" size={size} color="gray">
        {children}
      </Rx.Text>
    </Rx.Box>
  );
}

/**
 * Settings › Uso (spec 2026-10-14-usage-tab-design.md): what the engine reported about the plan, and
 * how much each topic uses, measured from the local log. The app knows nothing about plans.
 * Radix stage 2c: the plan is one card with a row per window, the topics a table in a card, the spend apart from the
 * tasks one card of rows, and the per-scope and per-person totals loose lists.
 */
export function UsageTab({ client, state }: { client: HarnessClient; state: AppState }) {
  const { t, i18n } = useTranslation();
  const language = shownLanguage(i18n);
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  useEffect(() => {
    client.getUsage().then(setUsage, () => setUsage(EMPTY));
  }, [client]);
  const limits = useCurrentWindows(usage?.limits ?? null);
  const engine = state.engines.find((e) => e.id === state.config.engineId);
  // The mock engine reports no limits, so its table compares tokens.
  const reportsLimits = Boolean(engine?.reportsLimits && !engine.mock);
  const primary = usage?.primary ? limits?.find((w) => w.kind === usage.primary) : undefined;
  const near = primary !== undefined && primary.utilization >= WARN_AT;
  const showPlans = Boolean(engine?.plansUrl && (near || !reportsLimits));
  const about = (n: number) => t("usage.aboutTokens", { tokens: n.toLocaleString(language) });
  /** What ran apart from the tasks: each line only once that part has run. */
  const apart: { key: string; label: string; value: string }[] = [];
  // Material spec §11.
  if (usage?.material !== undefined) apart.push({ key: "material", label: t("usage.row.material"), value: about(usage.material) });
  // Sidekick spec §8.
  if (usage?.sidekick !== undefined) apart.push({ key: "sidekick", label: t("usage.row.sidekick"), value: about(usage.sidekick) });
  // Parallel spec §10.
  if (usage?.jobs !== undefined) apart.push({ key: "jobs", label: t("usage.row.jobs"), value: about(usage.jobs) });
  // Subagent plan D4.
  if (usage?.subagents !== undefined) apart.push({ key: "subagents", label: t("usage.row.subagents"), value: about(usage.subagents) });
  // OpenCode spec §4: real money, as the engine reported it (only once a turn reported a cost; 0 is a real US$ 0.00).
  const spent = usage?.spentUsd !== undefined && engine ? usage.spentUsd : undefined;

  return (
    <div>
      <SectionHead line={t("settings.line.usage")} />
      <Group title={t("usage.planTitle")} data-setting="usage.plan">
        {planRows(t, language, engine, limits, Boolean(usage?.limits))}
        {showPlans && engine && (
          <Row label={t("usage.plans", { provider: engine.provider })}>
            <Rx.Button asChild size="1" variant="outline" color="gray">
              <a href={engine.plansUrl ?? ""} target="_blank" rel="noopener noreferrer">
                {t("usage.seePlans", { provider: engine.provider })}
              </a>
            </Rx.Button>
          </Row>
        )}
      </Group>
      <Group title={t("usage.actionsTitle")} data-setting="usage.actions">
        {usage ? <TopicTable state={state} usage={usage} reportsLimits={reportsLimits} near={near ? primary : undefined} /> : null}
      </Group>
      {(apart.length > 0 || spent !== undefined) && (
        <Group title={t("usage.apartTitle")}>
          {apart.map((a) => (
            <Row key={a.key} label={a.label} aria-label={a.label}>
              <Rx.Text size="2" color="gray">
                {a.value}
              </Rx.Text>
            </Row>
          ))}
          {spent !== undefined && engine && (
            <Row label={t("usage.spent")} hint={t("usage.spentCaption", { engine: engine.name })} aria-label={t("usage.spent")}>
              <Rx.Text size="2" color="gray">
                {/* A spend that would round to US$ 0.00 is not nothing: say it is under a cent. */}
                {spent > 0 && spent < 0.005
                  ? t("usage.spentTiny", { amount: (0.01).toLocaleString(language, { minimumFractionDigits: 2 }) })
                  : t("usage.spentAmount", { amount: spent.toLocaleString(language, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) })}
              </Rx.Text>
            </Row>
          )}
        </Group>
      )}
      {usage?.scopes && state.scopes && <ScopeUsage client={client} tokens={usage.scopes} plural={state.scopes.plural} />}
      {usage?.profiles && state.profiles && <ProfileUsage client={client} tokens={usage.profiles} />}
    </div>
  );
}

/** A topic's cost hint as a badge: low use green, medium blue, high orange. */
const COST_COLOR = { light: "green", medium: "blue", heavy: "orange" } as const;

const windowName = (t: TFunction, kind: string): string => t(`usage.${kind}`, { defaultValue: t("usage.limit") });

/**
 * The plan card's rows. `reported`: the engine has sent windows before, even if they have all reset since. One row
 * per window: its name (and Close to your limit), how much is used, a bar, and when it renews.
 */
function planRows(t: TFunction, language: string, engine: EngineOption | undefined, limits: LimitWindow[] | null, reported: boolean): ReactNode[] {
  const only = (text: string) => [
    <Note key="only" size="2">
      {text}
    </Note>,
  ];
  if (!engine) return only(t("home.noEngine"));
  if (engine.mock) return only(t("usage.mock"));
  if (engine.reportsCost) return only(t("usage.noLimitsCost", { engine: engine.name }));
  if (!engine.reportsLimits) return only(t("usage.noLimitsPlan", { engine: engine.name }));
  if (!limits?.length) return only(t(reported ? "usage.renewed" : "usage.notYet", { engine: engine.name }));
  return [
    ...limits.map((w) => {
      const warn = w.utilization >= WARN_AT;
      const name = windowName(t, w.kind);
      return (
        <Row
          key={w.kind}
          aria-label={name}
          label={
            <Rx.Flex as="span" align="center" gap="2">
              {name}
              {warn && (
                <Rx.Badge color="orange" variant="soft">
                  {t("usage.near")}
                </Rx.Badge>
              )}
            </Rx.Flex>
          }
          below={
            <Rx.Flex direction="column" gap="2">
              <Rx.Progress value={percent(w.utilization)} color={warn ? "orange" : undefined} aria-label={name} />
              <Rx.Text as="p" size="1" color="gray">
                {t("usage.renews", { time: formatReset(w.resetsAt, language) })}
              </Rx.Text>
            </Rx.Flex>
          }
        >
          <Rx.Text size="2" color={warn ? "orange" : undefined}>
            {t("usage.used", { percent: percent(w.utilization) })}
          </Rx.Text>
        </Row>
      );
    }),
    <Note key="reported">{t("usage.reportedBy", { engine: engine.name })}</Note>,
  ];
}

function TopicTable({
  state,
  usage,
  reportsLimits,
  near,
}: {
  state: AppState;
  usage: UsageSummary;
  reportsLimits: boolean;
  near?: LimitWindow;
}) {
  const { t, i18n } = useTranslation();
  const language = shownLanguage(i18n);
  const rows = taskRows(state, { key: QUESTIONS, label: t("models.questions") });
  const kind = usage.primary;
  const measured = rows.filter((r) => (reportsLimits ? usage.estimates[r.key] : usage.tokens[r.key]) !== undefined);
  const tokens = measured.map((r) => usage.tokens[r.key]).filter((n) => n !== undefined);
  const average = tokens.length ? tokens.reduce((a, b) => a + b, 0) / tokens.length : 0;
  const largest = Math.max(0, ...tokens);

  /**
   * Not measured yet: the harness's cost hint (free questions have none). With limits, a topic that has
   * tokens was used, but no task of it could be measured against the window (e.g. it crossed a reset).
   */
  const hint = (key: string) => {
    const cost = state.actions[key]?.cost;
    const text = cost ? (
      <Rx.Badge color={COST_COLOR[cost]} variant="soft">
        {t(`usage.hint.${cost}`)}
      </Rx.Badge>
    ) : (
      "—"
    );
    if (!reportsLimits) return text;
    return (
      <>
        {text}
        {` · ${t(usage.tokens[key] !== undefined ? "usage.notMeasured" : "usage.afterUse")}`}
      </>
    );
  };
  const fits = (estimate: number) => {
    if (near) {
      const n = timesLeft(1 - near.utilization, estimate);
      return n === null ? t("usage.timesMany") : n === 0 ? t("usage.noneLeft") : t("usage.timesLeft", { count: n });
    }
    const n = timesFit(estimate);
    return n === null ? t("usage.timesMany") : t("usage.times", { count: n });
  };
  const comparison = (n: number) => {
    const c = compareTokens(n, average);
    if (c.kind !== "times") return t(`usage.compare.${c.kind}`);
    const times = new Intl.NumberFormat(language, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(c.times);
    return t("usage.compare.times", { times });
  };

  let caption: string;
  if (measured.length === 0) caption = t("usage.captionNone");
  else if (reportsLimits) caption = t("usage.captionLimits", { window: kind ? t(`usage.long.${kind}`, { defaultValue: windowName(t, kind) }) : "" });
  else caption = t("usage.captionTokens");

  const head = (text: string) => (
    <Rx.Table.ColumnHeaderCell>
      <Rx.Text size="1" color="gray" weight="bold">
        {text}
      </Rx.Text>
    </Rx.Table.ColumnHeaderCell>
  );

  return (
    <>
      <Rx.Table.Root variant="ghost" size="1" mt="2">
        {/* Radix puts a Root's props on its wrapper, not the table: the card's title names the table as its caption. */}
        <Hidden as="caption">{t("usage.actionsTitle")}</Hidden>
        <Rx.Table.Header>
          <Rx.Table.Row>
            {head(t("usage.col.topic"))}
            {head(t("usage.col.each"))}
            {reportsLimits && head(near ? t("usage.col.until", { time: formatReset(near.resetsAt, language) }) : t("usage.col.fits"))}
          </Rx.Table.Row>
        </Rx.Table.Header>
        <Rx.Table.Body>
          {rows.map((row) => {
            const estimate = usage.estimates[row.key];
            const n = usage.tokens[row.key];
            const heavy = state.actions[row.key]?.cost === "heavy";
            let cells;
            if (reportsLimits && estimate !== undefined) {
              const share = Math.max(1, percent(estimate));
              const short = kind ? t(`usage.short.${kind}`, { defaultValue: "" }) : "";
              cells = (
                <>
                  <Rx.Table.Cell>
                    <Rx.Text color={heavy ? "orange" : undefined}>{short ? t("usage.share", { percent: share, window: short }) : t("usage.shareBare", { percent: share })}</Rx.Text>
                  </Rx.Table.Cell>
                  <Rx.Table.Cell>{fits(estimate)}</Rx.Table.Cell>
                </>
              );
            } else if (!reportsLimits && n !== undefined) {
              // The tooltip is for the mouse; the hidden text gives the same detail to screen readers.
              const detail = t("usage.tokensEach", { tokens: compactTokens(n, language) });
              cells = (
                <Rx.Table.Cell title={detail}>
                  <Rx.Flex align="center" gap="3">
                    <Rx.Box width="80px" flexShrink="0">
                      <Rx.Progress size="1" color="gray" value={largest > 0 ? percent(n / largest) : 0} aria-hidden="true" />
                    </Rx.Box>
                    <Rx.Text>
                      {comparison(n)}
                      <Hidden> ({detail})</Hidden>
                    </Rx.Text>
                  </Rx.Flex>
                </Rx.Table.Cell>
              );
            } else {
              cells = (
                <Rx.Table.Cell colSpan={reportsLimits ? 2 : 1}>
                  <Rx.Text color="gray">{hint(row.key)}</Rx.Text>
                </Rx.Table.Cell>
              );
            }
            return (
              <Rx.Table.Row key={row.key}>
                <Rx.Table.RowHeaderCell>{row.label}</Rx.Table.RowHeaderCell>
                {cells}
              </Rx.Table.Row>
            );
          })}
        </Rx.Table.Body>
      </Rx.Table.Root>
      <Note>{caption}</Note>
    </>
  );
}

/** One total per row of a loose list: the name, and its tokens in grey on the right. */
function TotalsList({ heading, rows }: { heading: string; rows: { id: string; name: string; n: number }[] }) {
  const { t, i18n } = useTranslation();
  return (
    <Group loose title={heading}>
      {rows.map((r) => (
        <Row
          key={r.id}
          as="li"
          aria-label={r.name}
          label={
            <Rx.Text truncate title={r.name}>
              {r.name}
            </Rx.Text>
          }
        >
          <Rx.Text size="2" color="gray">
            {t("usage.scopeTokens", { tokens: compactTokens(r.n, shownLanguage(i18n)) })}
          </Rx.Text>
        </Row>
      ))}
    </Group>
  );
}

/** Settings › Uso per scope (spec §3.3): tokens per scope over the whole log, most first. */
function ScopeUsage({ client, tokens, plural }: { client: HarnessClient; tokens: Record<string, number>; plural: string }) {
  const { t } = useTranslation();
  const [titles, setTitles] = useState<Record<string, string>>({});
  useEffect(() => {
    client.scopes.list().then(
      (list) => setTitles(Object.fromEntries(list.map((s) => [s.id, s.title]))),
      () => undefined,
    );
  }, [client]);
  const rows = Object.entries(tokens)
    .sort((a, b) => b[1] - a[1])
    .map(([id, n]) => ({ id, name: id === "_app" ? t("usage.appScope") : (titles[id] ?? id), n }));
  return <TotalsList heading={t("usage.byScope", { plural })} rows={rows} />;
}

/**
 * Settings › Usage by person (profiles spec §4): tokens per profile over each profile's whole log, most first. A profile
 * with no log yet has no key (0); an archived one still counts; an id the registry no longer lists shows as itself.
 */
function ProfileUsage({ client, tokens }: { client: HarnessClient; tokens: Record<string, number> }) {
  const { t } = useTranslation();
  const people = useProfiles(client, true);
  // Drawn once the names are in: before, every row would show its bare id.
  if (!people) return null;
  const list = people.list;
  const known = list.map((p) => ({ id: p.id, name: shownTitle(p.title), n: Object.hasOwn(tokens, p.id) ? tokens[p.id] : 0 }));
  const lost = Object.entries(tokens)
    .filter(([id]) => !list.some((p) => p.id === id))
    .map(([id, n]) => ({ id, name: id, n }));
  return <TotalsList heading={t("usage.byProfile")} rows={[...known, ...lost].sort((a, b) => b.n - a.n)} />;
}
