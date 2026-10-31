import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Segmented, Tag, type TagTone } from "../chrome";
import { type AppState, type HarnessClient, type JobSummary, type TaskSummary, type TasksState, timeAgo } from "../client";
import { shownLanguage } from "../language";
import { JobRunSteps } from "../tools/JobRunSteps";
import { boardColumns } from "./board";
import { InboxList, JOB_STATUS, QueuePause, jobTime, startableAction, useScopeTitles, waitingCount } from "./Inbox";
import { useJobs } from "./useJobs";

const RESULT_TONE: Record<NonNullable<JobSummary["last"]>["status"], TagTone> = { ok: "green", "needs-you": "orange", failed: "red" };
const TIER_TONE = { light: "green", standard: "blue", deep: "violet" } as const;

/**
 * The Inbox screen (UI refresh spec §5.4, rail › Inbox): the open tasks and the jobs as a board, or as the drop-down's
 * four sections (List). Its data and actions are the list's: a task card asks main to focus its task and `onOpened`
 * hears once main took it (the chat follows main's tasks change); a job card has its one action, Run now, Open for a
 * needs-you result's action, or Resume for a paused job (Settings › Jobs, where its on/off and cap are). A job is
 * whatever the harness declared (a prompt or steps): the card shows its result and steps, never assumes an AI run.
 */
export function InboxBoard({
  client,
  state,
  tasks,
  column,
  onNewTask,
  onOpened,
  onStartAction,
  onRefill,
  onJobSettings,
}: {
  client: HarnessClient;
  state: AppState;
  tasks: TasksState | null;
  /** Rail › Jobs: the Jobs column gets the focus. */
  column?: "jobs";
  /** "New task" (a harness with parallel tasks). Absent: no button. */
  onNewTask?: () => void;
  /** A task was focused, or a job's action started: the chat shows again. */
  onOpened: () => void;
  /** Starts a needs-you job's action through the chat's start path; false when it couldn't. */
  onStartAction?: (action: string, scope: string | null) => boolean;
  /** A cancelled queued message of the focused task (List's Cancel): its text goes back in the box. */
  onRefill?: (text: string) => void;
  /** Resume on a paused job: Settings › Jobs. Absent: no Resume. */
  onJobSettings?: () => void;
}) {
  const { t, i18n } = useTranslation();
  const language = shownLanguage(i18n);
  const id = useId();
  const [view, setView] = useState<"board" | "list">("board");
  const jobs = useJobs(client, Boolean(state.jobs));
  const hasScopes = Boolean(state.scopes);
  const scopeTitles = useScopeTitles(client, hasScopes);
  /** Why the last Open or Run now on a job card didn't go through, by its card's key. */
  const [problem, setProblem] = useState<{ key: string; text: string } | null>(null);
  /** A focus is on its way to main: a second click asks nothing more. */
  const focusing = useRef(false);
  const jobsColumn = useRef<HTMLElement>(null);

  const all = tasks?.tasks ?? [];
  const columns = boardColumns<TaskSummary, JobSummary>({ tasks: all, jobs: state.jobs ? jobs : null });
  const working = columns[1].items.length;
  const summary = state.jobs
    ? t("inbox.board.summary", { waiting: waitingCount(tasks, jobs), working, jobs: jobs.length })
    : t("inbox.board.summaryNoJobs", { waiting: waitingCount(tasks, jobs), working });

  useEffect(() => {
    if (column !== "jobs" || view !== "board") return;
    jobsColumn.current?.focus();
    jobsColumn.current?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [column, view]);

  const focus = async (taskId: string) => {
    if (focusing.current) return;
    focusing.current = true;
    try {
      await client.tasks.focus(taskId);
      onOpened();
    } catch {
      // Main refused (the task has just ended): the board stays, and its next change drops the card.
    } finally {
      focusing.current = false;
    }
  };

  const action = (s: TaskSummary) => (s.action && Object.hasOwn(state.actions, s.action) ? state.actions[s.action] : null);
  const reason = (s: TaskSummary) => {
    if (s.state !== "waiting") return null;
    if (s.waitingFor === "answer") return <Tag tone="blue">{t("parallel.hasQuestion")}</Tag>;
    return <Tag tone="orange">{t(s.waitingFor === "phase" ? "parallel.wantsPhase" : "parallel.yourTurn")}</Tag>;
  };
  /** What a working task does now, as far as the list knows it. */
  const activity = (s: TaskSummary) => (s.state === "closing" ? t("parallel.closing") : s.state === "checkpoint" ? t("parallel.checkpoint") : null);

  const taskCard = (s: TaskSummary) => {
    const a = action(s);
    const phases = a?.phases ?? [];
    const step = s.phase ? phases.findIndex((p) => p.id === s.phase) : -1;
    const scope = hasScopes && Object.hasOwn(scopeTitles, s.scope) ? scopeTitles[s.scope] : null;
    const doing = s.state !== "waiting" && s.state !== "queued" ? activity(s) : null;
    return (
      <button key={s.id} type="button" className="hh-board-card" aria-current={s.focused ? "true" : undefined} onClick={() => void focus(s.id)}>
        <span className="hh-board-title" dir="auto">
          {s.label}
        </span>
        <span className="hh-board-tags">
          {reason(s)}
          {step >= 0 && (
            <span className="hh-chip" dir="auto">
              {phases[step].label}
            </span>
          )}
          {doing && <Tag tone="blue">{doing}</Tag>}
          {scope && (
            <span className="hh-chip" dir="auto">
              {scope}
            </span>
          )}
        </span>
        {s.state !== "waiting" && s.state !== "queued" && step >= 0 && (
          <span role="img" aria-label={t("inbox.board.progress", { step: step + 1, total: phases.length })} className="hh-progress">
            <i style={{ width: `${((step + 1) / phases.length) * 100}%` }} />
          </span>
        )}
        {s.state === "queued" && <span className="hh-caption">{t("inbox.board.startsWhen", { cap: tasks?.caps.tasks ?? 1 })}</span>}
        <span className="hh-board-foot">
          {a?.tier && <Tag tone={TIER_TONE[a.tier]}>{t(`models.tier.${a.tier}`)}</Tag>}
          <span className="hh-caption">{t("inbox.board.started", { ago: timeAgo(s.startedAt, language) })}</span>
        </span>
      </button>
    );
  };
  /** The parallel spec's same-files notice: a dashed card in Working with the files. */
  const conflictNote = (s: TaskSummary) => (
    <div key={`${s.id}-conflict`} className="hh-board-card hh-board-note" role="note">
      <strong>{t("parallel.conflictChip")}</strong>
      <span dir="auto">{s.label}</span>
      <span className="hh-board-files" dir="auto">
        {s.conflict!.join(", ")}
      </span>
    </div>
  );

  const runNow = (j: JobSummary, key: string) => {
    setProblem(null);
    void client.jobs.run(j.id, ...(j.scope !== null ? [j.scope] : [])).then(
      (queued) => {
        if (!queued) setProblem({ key, text: t("parallel.runFailed") });
      },
      () => setProblem({ key, text: t("parallel.runFailed") }),
    );
  };
  const jobCard = (j: JobSummary, index: number) => {
    const key = `${j.id}:${j.scope ?? "-"}`;
    const labelId = `${id}-job-${index}`;
    const scope = j.scope !== null && hasScopes && Object.hasOwn(scopeTitles, j.scope) ? scopeTitles[j.scope] : null;
    const every = state.jobs?.jobs.find((d) => d.id === j.id)?.every;
    const schedule = [
      every && t("parallel.every", { interval: every }),
      j.last && t("parallel.lastRun", { time: jobTime(j.last.at, language) }),
      j.paused === "daily-cap" ? t("parallel.pausedTomorrow") : j.paused === "off" ? t("parallel.jobOff") : j.next && t("parallel.nextRun", { time: jobTime(j.next, language) }),
    ].filter(Boolean);
    const start = startableAction(state, j);
    const pill = start
      ? (
          <button
            type="button"
            className="hh-pill"
            aria-describedby={labelId}
            onClick={() => {
              setProblem(null);
              if (onStartAction?.(start, j.scope) === false) setProblem({ key, text: t("parallel.startFailed") });
              else onOpened();
            }}
          >
            {t("inbox.board.open")}
          </button>
        )
      : j.manual && !j.running && j.paused !== "off"
        ? (
            <button type="button" className="hh-pill" aria-describedby={labelId} onClick={() => runNow(j, key)}>
              {t("parallel.runNow")}
            </button>
          )
        : j.paused && onJobSettings
          ? (
              <button type="button" className="hh-pill" aria-describedby={labelId} onClick={onJobSettings}>
                {t("parallel.resume")}
              </button>
            )
          : null;
    return (
      <div key={key} className="hh-board-card hh-board-job">
        <span id={labelId} className="hh-board-title" dir="auto">
          {j.label}
        </span>
        <span className="hh-board-tags">
          {j.running ? (
            <Tag tone="blue">{t("parallel.jobRunning")}</Tag>
          ) : j.last ? (
            <Tag tone={RESULT_TONE[j.last.status]}>{t(JOB_STATUS[j.last.status])}</Tag>
          ) : (
            <Tag tone="gray">{t("parallel.notRunYet")}</Tag>
          )}
          {scope && (
            <span className="hh-chip" dir="auto">
              {scope}
            </span>
          )}
        </span>
        {j.last && (
          <span className="hh-tk-summary" dir="auto">
            {j.last.summary}
          </span>
        )}
        {schedule.length > 0 && <span className="hh-caption">{schedule.join(" · ")}</span>}
        {j.last?.run ? <JobRunSteps client={client} run={j.last.run} describedBy={labelId} /> : null}
        {pill && <span className="hh-board-foot">{pill}</span>}
        {problem?.key === key && <p role="alert">{problem.text}</p>}
      </div>
    );
  };

  const TITLES = { waiting: "parallel.waitingTitle", working: "parallel.workingTitle", queued: "parallel.queuedTitle", jobs: "parallel.jobsTitle" } as const;
  const conflicts = all.filter((s) => s.conflict && s.conflict.length > 0);

  return (
    <div className="hh-inbox-screen">
      <header className="hh-inbox-head">
        <div className="hh-inbox-head-text">
          <h1>{t("inbox.title")}</h1>
          <p className="hh-caption">{summary}</p>
        </div>
        <Segmented
          label={t("inbox.board.view")}
          options={[
            { value: "board", label: t("inbox.board.board") },
            { value: "list", label: t("inbox.board.list") },
          ]}
          value={view}
          onChange={setView}
        />
        {onNewTask && (
          <button type="button" className="hh-primary" onClick={onNewTask}>
            {t("parallel.newTask")}
          </button>
        )}
      </header>
      {view === "list" ? (
        <div className="hh-inbox-list">
          <InboxList
            client={client}
            state={state}
            tasks={tasks}
            jobs={jobs}
            newTask={false}
            onFocused={(taskId) => (taskId === null ? onNewTask?.() : onOpened())}
            onStarted={onOpened}
            {...(onRefill ? { onRefill } : {})}
            {...(onStartAction ? { onStartAction } : {})}
          />
        </div>
      ) : (
        <>
          <QueuePause client={client} tasks={tasks} />
          <div className="hh-board">
            {columns.map((col) => (
              <section
                key={col.id}
                className="hh-board-col"
                aria-labelledby={`${id}-${col.id}`}
                {...(col.id === "jobs" ? { ref: jobsColumn, tabIndex: -1 } : {})}
              >
                <h2 id={`${id}-${col.id}`} className="hh-board-head">
                  <Tag tone={col.tone}>{t(TITLES[col.id])}</Tag> <Tag tone="gray">{col.items.length}</Tag>
                </h2>
                {col.id === "jobs"
                  ? (col.items as JobSummary[]).map(jobCard)
                  : (col.items as TaskSummary[]).map(taskCard)}
                {col.id === "working" && conflicts.map(conflictNote)}
                {col.items.length === 0 && !(col.id === "working" && conflicts.length > 0) && (
                  <p className="hh-tk-empty">{t(col.id === "jobs" ? "parallel.noJobs" : "parallel.none")}</p>
                )}
              </section>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
