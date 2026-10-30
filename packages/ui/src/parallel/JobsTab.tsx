import { type KeyboardEvent, type ReactNode, useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import type { AppConfig, AppState, HarnessClient, JobSettings, JobSummary, JobsInfo } from "../client";
import { useLatestConfig } from "../latest-config";
import { shownLanguage } from "../language";
import { JobRunSteps } from "../tools/JobRunSteps";
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
  /** The `jobs` the last change asked for: a save still in flight isn't in `state` yet, and the next one sends it whole. */
  const latest = useLatestConfig(settings);
  const [saveFailed, setSaveFailed] = useState(false);
  /** Changes one job's entry (`change` gets its latest) and saves every job's. */
  const save = (id: string, change: (entry: JobSettings) => JobSettings) => {
    setSaveFailed(false);
    const all = { ...latest.get() };
    const entry = change({ ...all[id] });
    delete all[id];
    const next = Object.keys(entry).length > 0 ? { ...all, [id]: entry } : all;
    return latest.save(next, (jobs) => client.saveConfig({ jobs } satisfies AppConfig)).then(onChange, () => setSaveFailed(true));
  };
  const setOn = (id: string, on: boolean) =>
    void save(id, ({ off: _off, ...rest }) => (on ? rest : { ...rest, off: true }));
  const setCap = (id: string, cap: number | undefined) =>
    save(id, ({ dailyTokens: _cap, ...rest }) => (cap === undefined ? rest : { ...rest, dailyTokens: cap }));

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
        {j.last?.run ? <JobRunSteps client={client} run={j.last.run} describedBy={labelId} /> : null}
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
        <JobGroup key={job.id} job={job} entry={settings[job.id] ?? {}} onOn={(on) => setOn(job.id, on)} onCap={(cap) => setCap(job.id, cap)}>
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
      {saveFailed && <p role="alert">{t("parallel.saveFailed")}</p>}
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
  /** undefined: back to the manifest's cap. */
  onCap: (cap: number | undefined) => Promise<unknown>;
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
    // Unchanged (even a cap under the minimum set by hand in the config): nothing to check or save.
    if (draft === (saved === undefined ? "" : String(saved))) return setTooLow(false);
    // Emptied: the person's cap goes, and the manifest's is back.
    if (draft.trim() === "") {
      setTooLow(false);
      if (entry.dailyTokens !== undefined) void onCap(undefined);
      else setDraft(saved === undefined ? "" : String(saved));
      return;
    }
    const cap = Number(draft);
    if (!Number.isSafeInteger(cap) || cap < DAILY_CAP_MIN) {
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
