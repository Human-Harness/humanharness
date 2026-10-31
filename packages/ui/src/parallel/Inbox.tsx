import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { InboxIcon, Tag } from "../chrome";
import type { AppState, HarnessClient, JobSummary, TaskSummary, TasksState } from "../client";
import { shownLanguage } from "../language";
import { JobRunSteps } from "../tools/JobRunSteps";
import { taskGroups } from "./board";
import { useJobs } from "./useJobs";

export { WORKING } from "./board";

/** Waiting for the person: tasks waiting for them, and needs-you job results (a job turned off, as the Dock badge, waits for no one). */
export function waitingCount(tasks: TasksState | null, jobs: readonly JobSummary[] = []): number {
  const waiting = (tasks?.tasks ?? []).filter((s) => s.state === "waiting").length;
  return waiting + jobs.filter((j) => j.last?.status === "needs-you" && j.paused !== "off").length;
}

/**
 * The top bar's Inbox pill (UI refresh spec §4.1): the waiting count on an orange tag. It opens the Inbox screen (§5.4).
 */
export function InboxPill({ tasks, jobs, onOpen }: { tasks: TasksState | null; jobs?: readonly JobSummary[]; onOpen: () => void }) {
  const { t } = useTranslation();
  const count = waitingCount(tasks, jobs);
  return (
    <button className="hh-pill" aria-label={t("inbox.pill", { count })} onClick={onOpen}>
      <InboxIcon />
      {t("inbox.title")}
      {count > 0 && <Tag tone="orange">{count}</Tag>}
    </button>
  );
}

/** The scopes' titles by id, read once on mount; empty for a harness without scopes (it asks nothing). */
export function useScopeTitles(client: HarnessClient, enabled: boolean): Record<string, string> {
  const [titles, setTitles] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    client.scopes.list().then(
      (list) => {
        if (live) setTitles(Object.fromEntries(list.map((s) => [s.id, s.title])));
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [client, enabled]);
  return titles;
}

/** A time today alone; another day with its weekday. */
export function jobTime(iso: string, language: string): string {
  const at = new Date(iso);
  const time = at.toLocaleTimeString(language, { hour: "numeric", minute: "2-digit" });
  return at.toDateString() === new Date().toDateString() ? time : `${at.toLocaleDateString(language, { weekday: "long" })} ${time}`;
}

export const JOB_STATUS = { ok: "parallel.statusOk", "needs-you": "parallel.statusNeedsYou", failed: "parallel.statusFailed" } as const;

/** A needs-you result's action, when the harness declares it (the summary is the agent's; its action is checked here too). */
export function startableAction(state: AppState, j: JobSummary): string | null {
  const action = j.last?.status === "needs-you" ? j.last.action : undefined;
  return action !== undefined && Object.hasOwn(state.actions, action) ? action : null;
}

/** The queues' pause (out of quota, a folder move), with Resume when quota is what stopped them. */
export function QueuePause({ client, tasks }: { client: HarnessClient; tasks: TasksState | null }) {
  const { t, i18n } = useTranslation();
  const language = shownLanguage(i18n);
  /** The reset's time, with its weekday when it is not today (a weekly window can reset days later). */
  const untilText = (at: number): string => {
    const reset = new Date(at);
    const time = reset.toLocaleTimeString(language, { hour: "numeric", minute: "2-digit" });
    if (reset.toDateString() === new Date().toDateString()) return t("parallel.outOfQuotaUntil", { time });
    return t("parallel.outOfQuotaUntilDay", { day: reset.toLocaleDateString(language, { weekday: "long" }), time });
  };
  const paused = tasks?.paused;
  const resetsAt = paused?.resetsAt ? Date.parse(paused.resetsAt) : NaN;
  const pauseText = !paused
    ? null
    : paused.reason === "folder-move"
      ? t("parallel.pausedMove")
      : Number.isNaN(resetsAt)
        ? t("parallel.outOfQuota")
        : untilText(resetsAt);
  if (!pauseText) return null;
  return (
    <p className="hh-tk-paused" role="status">
      <span>{pauseText}</span>
      {paused?.reason === "out-of-quota" && <button onClick={() => void client.tasks.resumeQueues().catch(() => undefined)}>{t("parallel.resume")}</button>}
    </p>
  );
}

/**
 * The core inbox of open tasks in the top bar (parallel spec §9.2, UI refresh spec §4.1): the Inbox pill with the
 * waiting count (tasks waiting for the person and needs-you job results) and a polite live region that says it as it
 * changes. It reads only `client.tasks` and `client.jobs` (never the attention items' `read` flag, which the plugins
 * inbox shares); the pill opens the Inbox screen (`InboxBoard`), where the list's rows and actions are.
 */
export function Inbox({ client, state, tasks, onOpen }: { client: HarnessClient; state: AppState; tasks: TasksState | null; onOpen: () => void }) {
  const { t } = useTranslation();
  const jobs = useJobs(client, Boolean(state.jobs));
  const count = waitingCount(tasks, jobs);
  return (
    <div className="hh-pl-inbox">
      <InboxPill tasks={tasks} jobs={jobs} onOpen={onOpen} />
      <span className="hh-sr-only" aria-live="polite">
        {count > 0 ? t("parallel.waitingCount", { count }) : ""}
      </span>
    </div>
  );
}

/**
 * The Inbox's four sections (parallel spec §9.2), the Inbox screen's List: the queues' pause,
 * Waiting for you, Working, Queued, Jobs, and "New task". A row asks main to focus its task; `onFocused` hears once main
 * took it (null: the start view). "Start" on a needs-you job tells `onStarted` once the chat took it.
 */
export function InboxList({
  client,
  state,
  tasks,
  jobs,
  onFocused,
  onStarted,
  onRefill,
  onStartAction,
  newTask = true,
}: {
  client: HarnessClient;
  state: AppState;
  tasks: TasksState | null;
  jobs: readonly JobSummary[];
  onFocused?: (taskId: string | null) => void;
  onStarted?: () => void;
  /** A cancelled queued message of the focused task: its text goes back in the box (Decision 7). */
  onRefill?: (text: string) => void;
  /** Starts a needs-you job's action; false when it couldn't start (the list stays and says so). */
  onStartAction?: (action: string, scope: string | null) => boolean;
  /** Its own "New task" button (the Inbox screen has one in its header). */
  newTask?: boolean;
}) {
  const { t, i18n } = useTranslation();
  /** Why the last Start or Run now in the Jobs section didn't go through. */
  const [jobProblem, setJobProblem] = useState<string | null>(null);
  /** A focus is on its way to main: a second click asks nothing more. */
  const focusing = useRef(false);
  const id = useId();
  const language = shownLanguage(i18n);
  const hasScopes = Boolean(state.scopes);
  const scopeTitles = useScopeTitles(client, hasScopes);
  const { waiting, working, queued } = taskGroups(tasks?.tasks ?? []);

  const focus = async (taskId: string | null) => {
    if (focusing.current) return;
    focusing.current = true;
    try {
      await client.tasks.focus(taskId);
      onFocused?.(taskId);
    } catch {
      // Main refused (the task has just ended): the list stays, and its next change drops the row.
    } finally {
      focusing.current = false;
    }
  };
  const cancel = (task: TaskSummary) => {
    client.tasks.cancelQueued(task.id).then(
      (text) => {
        // Only the focused task's box: another task's text would be sent to the wrong task.
        if (text && task.focused) onRefill?.(text);
      },
      () => undefined,
    );
  };

  const stateText = (s: TaskSummary): string | null => {
    if (s.state === "waiting") return t(s.waitingFor === "answer" ? "parallel.hasQuestion" : s.waitingFor === "phase" ? "parallel.wantsPhase" : "parallel.yourTurn");
    if (s.state === "closing") return t("parallel.closing");
    if (s.state === "checkpoint") return t("parallel.checkpoint");
    return null;
  };
  const phaseLabel = (s: TaskSummary): string | null => {
    if (!s.phase) return null;
    const action = s.action && Object.hasOwn(state.actions, s.action) ? state.actions[s.action] : null;
    return action?.phases?.find((p) => p.id === s.phase)?.label ?? null;
  };

  const row = (s: TaskSummary, index: number, key: string) => {
    const labelId = `${id}-${key}-${index}`;
    const scope = hasScopes && Object.hasOwn(scopeTitles, s.scope) ? scopeTitles[s.scope] : null;
    const said = stateText(s);
    const phase = phaseLabel(s);
    return (
      <li key={s.id} className="hh-tk-item">
        <button className="hh-tk-row" aria-current={s.focused ? "true" : undefined} onClick={() => void focus(s.id)}>
          <span id={labelId} className="hh-tk-label" dir="auto">
            {s.label}
          </span>
          {(scope || said || phase) && (
            <span className="hh-tk-meta">
              {scope && <span dir="auto">{scope}</span>}
              {said && <span>{said}</span>}
              {phase && <span dir="auto">{phase}</span>}
            </span>
          )}
          {s.conflict && s.conflict.length > 0 && (
            <span className="hh-tk-conflict" title={s.conflict.join("\n")}>
              {t("parallel.conflictChip")}
            </span>
          )}
        </button>
        {s.state === "queued" && (
          <button className="hh-tk-cancel" aria-describedby={labelId} onClick={() => cancel(s)}>
            {t("parallel.cancel")}
          </button>
        )}
      </li>
    );
  };
  const when = (iso: string) => jobTime(iso, language);
  const runNow = (j: JobSummary) => {
    setJobProblem(null);
    void client.jobs.run(j.id, ...(j.scope !== null ? [j.scope] : [])).then(
      (queued) => {
        if (!queued) setJobProblem(t("parallel.runFailed"));
      },
      () => setJobProblem(t("parallel.runFailed")),
    );
  };
  const jobRow = (j: JobSummary, index: number) => {
    const labelId = `${id}-job-${index}`;
    const scope = j.scope !== null && hasScopes && Object.hasOwn(scopeTitles, j.scope) ? scopeTitles[j.scope] : null;
    const action = startableAction(state, j);
    return (
      <li key={`${j.id}:${j.scope ?? "-"}`} className="hh-tk-item">
        <div className="hh-tk-row">
          <span id={labelId} className="hh-tk-label" dir="auto">
            {j.label}
          </span>
          <span className="hh-tk-meta">
            {scope && <span dir="auto">{scope}</span>}
            {j.running ? <span>{t("parallel.jobRunning")}</span> : j.last && <span>{t(JOB_STATUS[j.last.status])}</span>}
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
              setJobProblem(null);
              if (onStartAction?.(action, j.scope) === false) setJobProblem(t("parallel.startFailed"));
              else onStarted?.();
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
  const section = (key: string, title: string, list: TaskSummary[], empty: string) => (
    <section className="hh-tk-section" aria-labelledby={`${id}-${key}`}>
      <h3 id={`${id}-${key}`}>{title}</h3>
      {list.length === 0 ? <p className="hh-tk-empty">{empty}</p> : <ul className="hh-tk-list">{list.map((s, i) => row(s, i, key))}</ul>}
    </section>
  );

  return (
    <>
      <QueuePause client={client} tasks={tasks} />
      {section("waiting", t("parallel.waitingTitle"), waiting, t("parallel.none"))}
      {section("working", t("parallel.workingTitle"), working, t("parallel.none"))}
      {section("queued", t("parallel.queuedTitle"), queued, t("parallel.none"))}
      <section className="hh-tk-section" aria-labelledby={`${id}-jobs`}>
        <h3 id={`${id}-jobs`}>{t("parallel.jobsTitle")}</h3>
        {jobs.length === 0 ? <p className="hh-tk-empty">{t("parallel.noJobs")}</p> : <ul className="hh-tk-list">{jobs.map(jobRow)}</ul>}
        {jobProblem && <p role="alert">{jobProblem}</p>}
      </section>
      {newTask && (
        <button className="hh-tk-new" onClick={() => void focus(null)}>
          {t("parallel.newTask")}
        </button>
      )}
    </>
  );
}
