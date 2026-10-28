import { type FocusEvent, type KeyboardEvent, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { AppState, HarnessClient, JobSummary, TaskSummary, TasksState } from "../client";
import { shownLanguage } from "../language";
import { useJobs } from "./useJobs";

const WORKING: TaskSummary["state"][] = ["running", "closing", "checkpoint"];

/**
 * The core inbox of open tasks (parallel spec §9.2): a top-bar button with the waiting count, opening four sections.
 * It reads only `client.tasks` (never the attention items' `read` flag, which the plugins inbox shares). A row asks
 * main to focus its task and closes the list; the chat follows main's tasks change, never the click ("New task" excepted:
 * the start view is no task, so `onStartView` tells the app once main took it). Its Jobs section lists `client.jobs`
 * (part 3): each job × scope's last result, "Run now" for manual jobs and "Start" for a needs-you result's action.
 */
export function Inbox({
  client,
  state,
  tasks,
  onRefill,
  onStartView,
  onStartAction,
}: {
  client: HarnessClient;
  state: AppState;
  tasks: TasksState | null;
  /** A cancelled queued message of the focused task: its text goes back in the box (Decision 7). */
  onRefill?: (text: string) => void;
  /** "New task" went through: main shows the start view, and the chat on screen must follow (it has no task change to see). */
  onStartView?: () => void;
  /** "Start" on a needs-you job row: the action starts through the chat's own start path, in the row's scope. */
  onStartAction?: (action: string, scope: string | null) => void;
}) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const [scopeTitles, setScopeTitles] = useState<Record<string, string>>({});
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  /** A focus is on its way to main: a second click asks nothing more. */
  const focusing = useRef(false);
  const id = useId();
  const language = shownLanguage(i18n);

  const all = tasks?.tasks ?? [];
  // Main lists the tasks oldest first.
  const waiting = all.filter((s) => s.state === "waiting").reverse();
  const working = all.filter((s) => WORKING.includes(s.state));
  const queued = all.filter((s) => s.state === "queued");
  const jobs = useJobs(client, Boolean(state.jobs));
  const needsYou = jobs.filter((j) => j.last?.status === "needs-you");
  const count = waiting.length + needsYou.length;

  const hasScopes = Boolean(state.scopes);
  useEffect(() => {
    if (!open || !hasScopes) return;
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
  }, [client, open, hasScopes]);

  useLayoutEffect(() => {
    if (open) (dialog.current?.querySelector<HTMLButtonElement>("button.hh-tk-row") ?? dialog.current)?.focus();
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (e.target instanceof Node && !wrap.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const close = () => {
    setOpen(false);
    button.current?.focus();
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== "Escape" || !open) return;
    e.preventDefault();
    close();
  };
  const onBlur = (e: FocusEvent) => {
    if (open && e.relatedTarget instanceof Node && !wrap.current?.contains(e.relatedTarget)) setOpen(false);
  };
  const focus = async (taskId: string | null) => {
    if (focusing.current) return;
    focusing.current = true;
    try {
      await client.tasks.focus(taskId);
      setOpen(false);
      if (taskId === null) onStartView?.();
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
  /** A time today alone; another day with its weekday. */
  const when = (iso: string): string => {
    const at = new Date(iso);
    const time = at.toLocaleTimeString(language, { hour: "numeric", minute: "2-digit" });
    return at.toDateString() === new Date().toDateString() ? time : `${at.toLocaleDateString(language, { weekday: "long" })} ${time}`;
  };
  const STATUS = { ok: "parallel.statusOk", "needs-you": "parallel.statusNeedsYou", failed: "parallel.statusFailed" } as const;
  /** A needs-you result's action, when the harness declares it (the summary is the agent's; its action is checked here too). */
  const startable = (j: JobSummary): string | null => {
    const action = j.last?.status === "needs-you" ? j.last.action : undefined;
    return action !== undefined && Object.hasOwn(state.actions, action) ? action : null;
  };
  const runNow = (j: JobSummary) => {
    void client.jobs.run(j.id, ...(j.scope !== null ? [j.scope] : [])).catch(() => undefined);
  };
  const jobRow = (j: JobSummary, index: number) => {
    const labelId = `${id}-job-${index}`;
    const scope = j.scope !== null && hasScopes && Object.hasOwn(scopeTitles, j.scope) ? scopeTitles[j.scope] : null;
    const action = startable(j);
    return (
      <li key={`${j.id}:${j.scope ?? "-"}`} className="hh-tk-item">
        <div className="hh-tk-row">
          <span id={labelId} className="hh-tk-label" dir="auto">
            {j.label}
          </span>
          <span className="hh-tk-meta">
            {scope && <span dir="auto">{scope}</span>}
            {j.running ? <span>{t("parallel.jobRunning")}</span> : j.last && <span>{t(STATUS[j.last.status])}</span>}
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
              onStartAction?.(action, j.scope);
              close();
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

  return (
    <div className="hh-pl-inbox" ref={wrap} onKeyDown={onKeyDown} onBlur={onBlur}>
      <button
        ref={button}
        className="hh-tk-button"
        aria-label={t("parallel.inboxButton", { count })}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? `${id}-list` : undefined}
        onClick={() => (open ? close() : setOpen(true))}
      >
        {t("parallel.inbox")}
        {count > 0 && (
          <span className="hh-tk-badge" aria-hidden="true">
            {count}
          </span>
        )}
      </button>
      <span className="hh-sr-only" aria-live="polite">
        {count > 0 ? t("parallel.waitingCount", { count }) : ""}
      </span>
      {open && (
        <div id={`${id}-list`} ref={dialog} className="hh-pl-popover" role="dialog" aria-label={t("parallel.inbox")} tabIndex={-1}>
          {pauseText && (
            <p className="hh-tk-paused" role="status">
              <span>{pauseText}</span>
              {paused?.reason === "out-of-quota" && (
                <button onClick={() => void client.tasks.resumeQueues().catch(() => undefined)}>{t("parallel.resume")}</button>
              )}
            </p>
          )}
          {section("waiting", t("parallel.waitingTitle"), waiting, t("parallel.none"))}
          {section("working", t("parallel.workingTitle"), working, t("parallel.none"))}
          {section("queued", t("parallel.queuedTitle"), queued, t("parallel.none"))}
          <section className="hh-tk-section" aria-labelledby={`${id}-jobs`}>
            <h3 id={`${id}-jobs`}>{t("parallel.jobsTitle")}</h3>
            {jobs.length === 0 ? <p className="hh-tk-empty">{t("parallel.noJobs")}</p> : <ul className="hh-tk-list">{jobs.map(jobRow)}</ul>}
          </section>
          <button className="hh-tk-new" onClick={() => void focus(null)}>
            {t("parallel.newTask")}
          </button>
        </div>
      )}
    </div>
  );
}
