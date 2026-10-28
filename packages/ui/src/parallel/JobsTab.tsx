import { type KeyboardEvent, type ReactNode, useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import type { AppConfig, AppState, HarnessClient, JobSettings, JobSummary, JobsInfo } from "../client";
import { shownLanguage } from "../language";
import { useJobs } from "./useJobs";

/** The lowest daily cap the field takes: less would pause a periodic job after its first run. */
export const DAILY_CAP_MIN = 1000;
const STATUS = { ok: "parallel.statusOk", "needs-you": "parallel.statusNeedsYou", failed: "parallel.statusFailed" } as const;

/**
 * Settings › Jobs for a harness that declares jobs (parallel spec §8, §9): each job can be turned off, and an `every`
 * job's daily token cap changed (the person's over the manifest's). Under each job, its runs per scope as the inbox
 * shows them, with "Run now" and a needs-you result's "Start": a harness with jobs but no inbox (no `parallel`) has
 * only this place to see them. A change saves the person's whole `jobs` (the store merges the top level only), so the
 * other jobs' settings stay.
 */
export function JobsTab({
  client,
  state,
  onChange,
  onStartAction,
}: {
  client: HarnessClient;
  state: AppState;
  onChange: (state: AppState) => void;
  /** Starts a needs-you run's action through the chat's start path; false when it couldn't. Absent: no Start. */
  onStartAction?: (action: string, scope: string | null) => boolean;
}) {
  const { t, i18n } = useTranslation();
  const language = shownLanguage(i18n);
  const runs = useJobs(client, true);
  const [scopeTitles, setScopeTitles] = useState<Record<string, string>>({});
  /** Why the last Start or Run now didn't go through, by job id. */
  const [problem, setProblem] = useState<{ job: string; text: string } | null>(null);
  const hasScopes = Boolean(state.scopes);
  useEffect(() => {
    if (!hasScopes) return;
    let live = true;
    client.scopes.list().then(
      (list) => {
        if (live) setScopeTitles(Object.fromEntries(list.map((s) => [s.id, s.title])));
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [client, hasScopes]);

  const settings = state.config.jobs ?? {};
  const save = (id: string, entry: JobSettings) => {
    const others = { ...settings };
    delete others[id];
    const patch: AppConfig = { jobs: Object.keys(entry).length > 0 ? { ...others, [id]: entry } : others };
    return client.saveConfig(patch).then(onChange, () => {});
  };
  const setOn = (id: string, on: boolean) => {
    const rest = { ...settings[id] };
    delete rest.off;
    void save(id, on ? rest : { ...rest, off: true });
  };

  /** A time today alone; another day with its weekday. */
  const when = (iso: string): string => {
    const at = new Date(iso);
    const time = at.toLocaleTimeString(language, { hour: "numeric", minute: "2-digit" });
    return at.toDateString() === new Date().toDateString() ? time : `${at.toLocaleDateString(language, { weekday: "long" })} ${time}`;
  };
  /** A needs-you result's action, when the harness declares it (the summary is the agent's; its action is checked here too). */
  const startable = (j: JobSummary): string | null => {
    const action = j.last?.status === "needs-you" ? j.last.action : undefined;
    return onStartAction && action !== undefined && Object.hasOwn(state.actions, action) ? action : null;
  };
  const runNow = (j: JobSummary) => {
    setProblem(null);
    void client.jobs.run(j.id, ...(j.scope !== null ? [j.scope] : [])).then(
      (queued) => {
        if (!queued) setProblem({ job: j.id, text: t("parallel.runFailed") });
      },
      () => setProblem({ job: j.id, text: t("parallel.runFailed") }),
    );
  };

  const runRow = (j: JobSummary, labelId: string) => {
    const scope = j.scope !== null && Object.hasOwn(scopeTitles, j.scope) ? scopeTitles[j.scope] : null;
    const action = startable(j);
    return (
      <li key={j.scope ?? "-"} className="hh-tk-item">
        <div className="hh-tk-row">
          <span className="hh-tk-meta">
            {scope && <span dir="auto">{scope}</span>}
            {j.running ? <span>{t("parallel.jobRunning")}</span> : j.last ? <span>{t(STATUS[j.last.status])}</span> : <span>{t("parallel.notRunYet")}</span>}
            {j.last && <span>{t("parallel.lastRun", { time: when(j.last.at) })}</span>}
            {j.paused === "daily-cap" && <span>{t("parallel.pausedTomorrow")}</span>}
            {j.paused === "off" && <span>{t("parallel.jobOff")}</span>}
            {!j.paused && j.next && <span>{t("parallel.nextRun", { time: when(j.next) })}</span>}
          </span>
          {j.last && (
            <span className="hh-tk-summary" dir="auto">
              {j.last.summary}
            </span>
          )}
        </div>
        {action && (
          <button
            className="hh-tk-cancel"
            aria-describedby={labelId}
            onClick={() => {
              setProblem(null);
              if (onStartAction?.(action, j.scope) === false) setProblem({ job: j.id, text: t("parallel.startFailed") });
            }}
          >
            {t("parallel.start")}
          </button>
        )}
        {j.manual && !j.running && j.paused !== "off" && (
          <button className="hh-tk-cancel" aria-describedby={labelId} onClick={() => runNow(j)}>
            {t("parallel.runNow")}
          </button>
        )}
      </li>
    );
  };

  return (
    <div className="hh-tab">
      {state.jobs!.jobs.map((job) => (
        <JobGroup key={job.id} job={job} entry={settings[job.id] ?? {}} onOn={(on) => setOn(job.id, on)} onCap={(cap) => save(job.id, { ...settings[job.id], dailyTokens: cap })}>
          {(labelId) => {
            const own = runs.filter((r) => r.id === job.id);
            return (
              <>
                {own.length > 0 && <ul className="hh-tk-list">{own.map((r) => runRow(r, labelId))}</ul>}
                {problem?.job === job.id && <p role="alert">{problem.text}</p>}
              </>
            );
          }}
        </JobGroup>
      ))}
    </div>
  );
}

/** One job: its heading, the On switch, an `every` job's interval and cap, then its runs. */
function JobGroup({
  job,
  entry,
  onOn,
  onCap,
  children,
}: {
  job: JobsInfo["jobs"][number];
  entry: JobSettings;
  onOn: (on: boolean) => void;
  onCap: (cap: number) => Promise<unknown>;
  children: (labelId: string) => ReactNode;
}) {
  const { t, i18n } = useTranslation();
  const id = useId();
  const labelId = `${id}-label`;
  const saved = entry.dailyTokens ?? job.dailyTokens;
  const [draft, setDraft] = useState(saved === undefined ? "" : String(saved));
  const [tooLow, setTooLow] = useState(false);
  // A save (or another window's) moves the field to what is stored.
  useEffect(() => setDraft(saved === undefined ? "" : String(saved)), [saved]);
  const commit = () => {
    const cap = Number(draft);
    if (draft.trim() === "" || !Number.isSafeInteger(cap) || cap < DAILY_CAP_MIN) {
      setTooLow(true);
      return;
    }
    setTooLow(false);
    if (cap !== saved) void onCap(cap);
  };
  return (
    <section aria-labelledby={labelId}>
      <h3 id={labelId} dir="auto">
        {job.label}
      </h3>
      <div className="hh-rows">
        <div className="hh-row">
          <label>
            <input type="checkbox" checked={entry.off !== true} aria-describedby={labelId} onChange={(e) => onOn(e.target.checked)} /> {t("parallel.jobOn")}
          </label>
          {job.every && <span className="hh-caption">{t("parallel.every", { interval: job.every })}</span>}
        </div>
        {job.every && (
          <div className="hh-row">
            <label className="hh-row-label" htmlFor={`${id}-cap`}>
              {t("parallel.dailyCap")}
            </label>
            <input
              id={`${id}-cap`}
              type="number"
              min={DAILY_CAP_MIN}
              step={1000}
              value={draft}
              aria-invalid={tooLow || undefined}
              aria-describedby={`${id}-cap-note`}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commit}
              onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
                if (e.key === "Enter") commit();
              }}
            />
            {tooLow ? (
              <p className="hh-caption hh-row-note" id={`${id}-cap-note`} role="alert">
                {t("parallel.dailyCapMin", { min: DAILY_CAP_MIN.toLocaleString(shownLanguage(i18n)) })}
              </p>
            ) : (
              <p className="hh-caption hh-row-note" id={`${id}-cap-note`}>
                {t("parallel.dailyCapHint")}
              </p>
            )}
          </div>
        )}
      </div>
      {children(labelId)}
    </section>
  );
}
