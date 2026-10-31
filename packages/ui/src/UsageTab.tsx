import { useEffect, useId, useState } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import type { AppState, EngineOption, HarnessClient, LimitWindow, UsageSummary } from "./client";
import { QUESTIONS, taskRows } from "./ModelsTab";
import { shownTitle, useProfiles } from "./ProfileSwitcher";
import { WARN_AT, compactTokens, compareTokens, formatReset, percent, timesFit, timesLeft } from "./usage";
import { useCurrentWindows } from "./UsageMeter";
import { shownLanguage } from "./language";

const EMPTY: UsageSummary = { limits: null, estimates: {}, tokens: {} };

/**
 * Settings › Uso (spec 2026-10-14-usage-tab-design.md): what the engine reported about the plan, and
 * how much each topic uses, measured from the local log. The app knows nothing about plans.
 */
export function UsageTab({ client, state }: { client: HarnessClient; state: AppState }) {
  const { t, i18n } = useTranslation();
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
  const tableTitle = useId();

  return (
    <div className="hh-tab">
      <h3 data-setting="usage.plan">{t("usage.planTitle")}</h3>
      <PlanSection engine={engine} limits={limits} reported={Boolean(usage?.limits)} />
      <h3 id={tableTitle} data-setting="usage.actions">{t("usage.actionsTitle")}</h3>
      {usage && <TopicTable state={state} usage={usage} reportsLimits={reportsLimits} near={near ? primary : undefined} labelledBy={tableTitle} />}
      {/* Material spec §11: what processing the person's material used (only once a stage has run). */}
      {usage?.material !== undefined && <p className="hh-caption">{t("usage.material", { tokens: usage.material.toLocaleString(shownLanguage(i18n)) })}</p>}
      {/* Sidekick spec §8: its own spend, apart from the tasks' (only once it has run). */}
      {usage?.sidekick !== undefined && <p className="hh-caption">{t("sidekick.usage", { tokens: usage.sidekick.toLocaleString(shownLanguage(i18n)) })}</p>}
      {/* Parallel spec §10: background jobs' spend, apart from the tasks' (only once a job has run). */}
      {usage?.jobs !== undefined && <p className="hh-caption">{t("parallel.jobsUsage", { tokens: usage.jobs.toLocaleString(shownLanguage(i18n)) })}</p>}
      {/* OpenCode spec §4: real money, as the engine reported it (only once a turn reported a cost; 0 is a real US$ 0.00). */}
      {usage?.spentUsd !== undefined && engine && (
        <>
          <div className="hh-rows">
            <div className="hh-row">
              <span>{t("usage.spent")}</span>
              <span>
                {/* A spend that would round to US$ 0.00 is not nothing: say it is under a cent. */}
                {usage.spentUsd > 0 && usage.spentUsd < 0.005
                  ? t("usage.spentTiny", { amount: (0.01).toLocaleString(shownLanguage(i18n), { minimumFractionDigits: 2 }) })
                  : t("usage.spentAmount", {
                      amount: usage.spentUsd.toLocaleString(shownLanguage(i18n), { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
                    })}
              </span>
            </div>
          </div>
          <p className="hh-caption">{t("usage.spentCaption", { engine: engine.name })}</p>
        </>
      )}
      {usage?.scopes && state.scopes && <ScopeUsage client={client} tokens={usage.scopes} plural={state.scopes.plural} />}
      {usage?.profiles && state.profiles && <ProfileUsage client={client} tokens={usage.profiles} />}
      {showPlans && engine && (
        <div className="hh-rows">
          <div className="hh-row">
            <span>{t("usage.plans", { provider: engine.provider })}</span>
            <a className="hh-button" href={engine.plansUrl} target="_blank" rel="noopener noreferrer">
              {t("usage.seePlans", { provider: engine.provider })}
            </a>
          </div>
        </div>
      )}
    </div>
  );
}

const windowName = (t: TFunction, kind: string): string => t(`usage.${kind}`, { defaultValue: t("usage.limit") });

/** `reported`: the engine has sent windows before, even if they have all reset since. */
function PlanSection({ engine, limits, reported }: { engine?: EngineOption; limits: LimitWindow[] | null; reported: boolean }) {
  const { t, i18n } = useTranslation();
  if (!engine) return <p className="hh-caption">{t("home.noEngine")}</p>;
  if (engine.mock) return <p className="hh-caption">{t("usage.mock")}</p>;
  if (engine.reportsCost) return <p className="hh-caption">{t("usage.noLimitsCost", { engine: engine.name })}</p>;
  if (!engine.reportsLimits) return <p className="hh-caption">{t("usage.noLimitsPlan", { engine: engine.name })}</p>;
  if (!limits?.length) return <p className="hh-caption">{t(reported ? "usage.renewed" : "usage.notYet", { engine: engine.name })}</p>;
  return (
    <>
      <div className="hh-rows">
        {limits.map((w) => {
          const warn = w.utilization >= WARN_AT;
          return (
            <div key={w.kind} className="hh-row hh-usage-window">
              <span>{windowName(t, w.kind)}</span>
              <span className={warn ? "hh-warn" : undefined}>{t("usage.used", { percent: percent(w.utilization) })}</span>
              <Bar share={w.utilization} warn={warn} />
              <span className="hh-caption">{t("usage.renews", { time: formatReset(w.resetsAt, shownLanguage(i18n)) })}</span>
            </div>
          );
        })}
      </div>
      <p className="hh-caption">{t("usage.reportedBy", { engine: engine.name })}</p>
    </>
  );
}

function Bar({ share, warn }: { share: number; warn?: boolean }) {
  return (
    <span className={warn ? "hh-usage-bar warn" : "hh-usage-bar"} aria-hidden="true">
      <span style={{ width: `${percent(share)}%` }} />
    </span>
  );
}

function TopicTable({
  state,
  usage,
  reportsLimits,
  near,
  labelledBy,
}: {
  state: AppState;
  usage: UsageSummary;
  reportsLimits: boolean;
  near?: LimitWindow;
  labelledBy: string;
}) {
  const { t, i18n } = useTranslation();
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
    const text = cost ? t(`usage.hint.${cost}`) : "—";
    if (!reportsLimits) return text;
    return `${text} · ${t(usage.tokens[key] !== undefined ? "usage.notMeasured" : "usage.afterUse")}`;
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
    const times = new Intl.NumberFormat(shownLanguage(i18n), { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(c.times);
    return t("usage.compare.times", { times });
  };

  let caption: string;
  if (measured.length === 0) caption = t("usage.captionNone");
  else if (reportsLimits) caption = t("usage.captionLimits", { window: kind ? t(`usage.long.${kind}`, { defaultValue: windowName(t, kind) }) : "" });
  else caption = t("usage.captionTokens");

  return (
    <>
      <table className="hh-usage-table" aria-labelledby={labelledBy}>
        <thead>
          <tr>
            <th scope="col">{t("usage.col.topic")}</th>
            <th scope="col">{t("usage.col.each")}</th>
            {reportsLimits && <th scope="col">{near ? t("usage.col.until", { time: formatReset(near.resetsAt, shownLanguage(i18n)) }) : t("usage.col.fits")}</th>}
          </tr>
        </thead>
        <tbody>
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
                  <td className={heavy ? "hh-warn" : undefined}>{short ? t("usage.share", { percent: share, window: short }) : t("usage.shareBare", { percent: share })}</td>
                  <td>{fits(estimate)}</td>
                </>
              );
            } else if (!reportsLimits && n !== undefined) {
              // The tooltip is for the mouse; the hidden text gives the same detail to screen readers.
              const detail = t("usage.tokensEach", { tokens: compactTokens(n, shownLanguage(i18n)) });
              cells = (
                <td title={detail}>
                  <Bar share={largest > 0 ? n / largest : 0} />
                  <span>{comparison(n)}</span>
                  <span className="hh-sr-only"> ({detail})</span>
                </td>
              );
            } else {
              cells = (
                <td className="hh-caption" colSpan={reportsLimits ? 2 : 1}>
                  {hint(row.key)}
                </td>
              );
            }
            return (
              <tr key={row.key}>
                <th scope="row">{row.label}</th>
                {cells}
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="hh-caption">{caption}</p>
    </>
  );
}

/** Settings › Uso per scope (spec §3.3): tokens per scope over the whole log, most first. */
function ScopeUsage({ client, tokens, plural }: { client: HarnessClient; tokens: Record<string, number>; plural: string }) {
  const { t, i18n } = useTranslation();
  const [titles, setTitles] = useState<Record<string, string>>({});
  useEffect(() => {
    client.scopes.list().then(
      (list) => setTitles(Object.fromEntries(list.map((s) => [s.id, s.title]))),
      () => undefined,
    );
  }, [client]);
  const heading = t("usage.byScope", { plural });
  const rows = Object.entries(tokens).sort((a, b) => b[1] - a[1]);
  return (
    <>
      <h3>{heading}</h3>
      <ul className="hh-rows" aria-label={heading}>
        {rows.map(([id, n]) => (
          <li key={id} className="hh-row">
            <span>{id === "_app" ? t("usage.appScope") : (titles[id] ?? id)}</span>
            <span className="hh-caption">{t("usage.scopeTokens", { tokens: compactTokens(n, shownLanguage(i18n)) })}</span>
          </li>
        ))}
      </ul>
    </>
  );
}

/**
 * Settings › Usage by person (profiles spec §4): tokens per profile over each profile's whole log, most first. A profile
 * with no log yet has no key (0); an archived one still counts; an id the registry no longer lists shows as itself.
 */
function ProfileUsage({ client, tokens }: { client: HarnessClient; tokens: Record<string, number> }) {
  const { t, i18n } = useTranslation();
  const people = useProfiles(client, true);
  const heading = t("usage.byProfile");
  // Drawn once the names are in: before, every row would show its bare id.
  if (!people) return null;
  const list = people.list;
  const known = list.map((p) => ({ id: p.id, name: shownTitle(p.title), n: Object.hasOwn(tokens, p.id) ? tokens[p.id] : 0 }));
  const lost = Object.entries(tokens)
    .filter(([id]) => !list.some((p) => p.id === id))
    .map(([id, n]) => ({ id, name: id, n }));
  const rows = [...known, ...lost].sort((a, b) => b.n - a.n);
  return (
    <>
      <h3>{heading}</h3>
      <ul className="hh-rows" aria-label={heading}>
        {rows.map((r) => (
          <li key={r.id} className="hh-row">
            <span className="hh-profile-row-name" title={r.name}>
              {r.name}
            </span>
            <span className="hh-caption">{t("usage.scopeTokens", { tokens: compactTokens(r.n, shownLanguage(i18n)) })}</span>
          </li>
        ))}
      </ul>
    </>
  );
}
