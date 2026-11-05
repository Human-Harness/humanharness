import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { type AppState, type HarnessClient, type JobSummary, type TaskSummary, type TasksState, timeAgo } from "../client";
import { Hidden, Rx, SecondaryPage } from "../guide";
import { shownLanguage } from "../language";
import { JobRunSteps } from "../tools/JobRunSteps";
import { taskGroups } from "./board";
import { useJobs } from "./useJobs";

export { WORKING } from "./board";

/** Waiting for the person: tasks waiting for them, and needs-you job results (a job turned off, as the Dock badge, waits for no one). */
export function waitingCount(tasks: TasksState | null, jobs: readonly JobSummary[] = []): number {
  return (tasks?.tasks ?? []).filter((s) => s.state === "waiting").length + jobsWaiting(jobs).length;
}

/** The job results that wait for the person: needs-you, and the job not turned off. */
function jobsWaiting(jobs: readonly JobSummary[]): JobSummary[] {
  return jobs.filter((j) => j.last?.status === "needs-you" && j.paused !== "off");
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

/** A needs-you result's action, when the harness declares it (the summary is the agent's; its action is checked here too). */
export function startableAction(state: AppState, j: JobSummary): string | null {
  const action = j.last?.status === "needs-you" ? j.last.action : undefined;
  return action !== undefined && Object.hasOwn(state.actions, action) ? action : null;
}

/** The queues' pause (out of quota, a folder move) as an orange notice, with Resume when quota is what stopped them. */
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
    <Rx.Callout.Root color="orange" role="status" mb="5">
      <Rx.Flex align="center" justify="between" gap="3" wrap="wrap">
        <Rx.Callout.Text>{pauseText}</Rx.Callout.Text>
        {paused?.reason === "out-of-quota" && (
          <Rx.Button variant="outline" color="gray" size="1" onClick={() => void client.tasks.resumeQueues().catch(() => undefined)}>
            {t("parallel.resume")}
          </Rx.Button>
        )}
      </Rx.Flex>
    </Rx.Callout.Root>
  );
}

/** The rail's Inbox count said aloud as it changes (a polite live region; the rail's badge shows it). */
export function InboxAnnouncer({ count }: { count: number }) {
  const { t } = useTranslation();
  return (
    <span className="hh-sr-only" aria-live="polite">
      {count > 0 ? t("parallel.waitingCount", { count }) : ""}
    </span>
  );
}

const TIER_COLOR = { light: "green", standard: "blue", deep: "violet" } as const;
const SECTION_COLOR = { waiting: "orange", working: "blue", queued: "gray", jobs: "orange" } as const;

/**
 * The Inbox page (rail › Inbox; DESIGN.md "Secondary pages", stage 4a): a list only, in sections by state, each with
 * its tag and counter: Waiting for you, Working, Queued, and the job results that wait for you. A task row asks main
 * to focus its task, and `onOpened` hears once main took it (the chat follows main's tasks change). A queued row has
 * Cancel; a needs-you job result has Start, its declared action. Jobs themselves live on their own page.
 */
export function InboxPage({
  client,
  state,
  tasks,
  focusKey,
  onNewTask,
  onOpened,
  onBack,
  onStartAction,
  onRefill,
}: {
  client: HarnessClient;
  state: AppState;
  tasks: TasksState | null;
  /** Each rail pick is a new number: the focus goes to the title again. */
  focusKey?: number;
  /** "New task" (a harness with parallel tasks). Absent: no button. */
  onNewTask?: () => void;
  /** A task was focused, or a job's action started: the chat shows again. */
  onOpened: () => void;
  /** Escape on the page: back to the chat. */
  onBack?: () => void;
  /** Starts a needs-you job's action through the chat's start path; false when it couldn't. */
  onStartAction?: (action: string, scope: string | null) => boolean;
  /** A cancelled queued message of the focused task: its text goes back in the box (parallel spec, Decision 7). */
  onRefill?: (text: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const language = shownLanguage(i18n);
  const id = useId();
  const jobs = useJobs(client, Boolean(state.jobs));
  const hasScopes = Boolean(state.scopes);
  const scopeTitles = useScopeTitles(client, hasScopes);
  /** Why the last Start on a job result didn't go through, by its row's key. */
  const [problem, setProblem] = useState<{ key: string; text: string } | null>(null);
  /** A focus is on its way to main: a second click asks nothing more. */
  const focusing = useRef(false);

  const { waiting, working, queued } = taskGroups(tasks?.tasks ?? []);
  const results = jobsWaiting(jobs);
  const summary = t("inbox.summary", { waiting: waitingCount(tasks, jobs), working: working.length });

  const focus = async (taskId: string) => {
    if (focusing.current) return;
    focusing.current = true;
    try {
      await client.tasks.focus(taskId);
      onOpened();
    } catch {
      // Main refused (the task has just ended): the page stays, and its next change drops the row.
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

  const action = (s: TaskSummary) => (s.action && Object.hasOwn(state.actions, s.action) ? state.actions[s.action] : null);
  const scopeOf = (scope: string | null) => (scope !== null && hasScopes && Object.hasOwn(scopeTitles, scope) ? scopeTitles[scope] : null);
  /** What the task waits for, or what a working one does now, as a badge. */
  const stateBadge = (s: TaskSummary) => {
    if (s.state === "waiting") {
      if (s.waitingFor === "answer") return <Rx.Badge color="blue">{t("parallel.hasQuestion")}</Rx.Badge>;
      return <Rx.Badge color="orange">{t(s.waitingFor === "phase" ? "parallel.wantsPhase" : "parallel.yourTurn")}</Rx.Badge>;
    }
    if (s.state === "closing") return <Rx.Badge color="blue">{t("parallel.closing")}</Rx.Badge>;
    if (s.state === "checkpoint") return <Rx.Badge color="blue">{t("parallel.checkpoint")}</Rx.Badge>;
    return null;
  };

  const taskRow = (s: TaskSummary, key: string, index: number) => {
    const labelId = `${id}-${key}-${index}`;
    const a = action(s);
    const phases = a?.phases ?? [];
    const step = s.phase ? phases.findIndex((p) => p.id === s.phase) : -1;
    const scope = scopeOf(s.scope);
    const conflict = s.conflict && s.conflict.length > 0 ? s.conflict : null;
    const progress = s.state !== "waiting" && s.state !== "queued" && step >= 0 ? t("inbox.progress", { step: step + 1, total: phases.length }) : null;
    return (
      <li key={s.id}>
        <Rx.Flex align="start" gap="2">
          <button type="button" className="hh-inbox-row" aria-current={s.focused ? "true" : undefined} onClick={() => void focus(s.id)}>
            <Rx.Flex direction="column" gap="2" minWidth="0">
              <Rx.Flex align="baseline" justify="between" gap="3">
                <Rx.Text id={labelId} size="2" weight="bold" dir="auto">
                  {s.label}
                </Rx.Text>
                <Rx.Text size="1" color="gray" wrap="nowrap">
                  {t("inbox.started", { ago: timeAgo(s.startedAt, language) })}
                </Rx.Text>
              </Rx.Flex>
              <Rx.Flex align="center" gap="2" wrap="wrap">
                {s.focused && (
                  <Rx.Badge color="gray" variant="outline">
                    {t("inbox.onScreen")}
                  </Rx.Badge>
                )}
                {stateBadge(s)}
                {step >= 0 && (
                  <Rx.Badge color="gray" variant="outline" dir="auto">
                    {phases[step].label}
                  </Rx.Badge>
                )}
                {scope && (
                  <Rx.Badge color="gray" variant="outline" dir="auto">
                    {scope}
                  </Rx.Badge>
                )}
                {a?.tier && <Rx.Badge color={TIER_COLOR[a.tier]}>{t(`models.tier.${a.tier}`)}</Rx.Badge>}
                {conflict && <Rx.Badge color="orange">{t("parallel.conflictChip")}</Rx.Badge>}
              </Rx.Flex>
              {progress && (
                <Rx.Flex align="center" gap="3">
                  <Rx.Box flexGrow="1" maxWidth="240px">
                    <Rx.Progress size="1" value={((step + 1) / phases.length) * 100} aria-label={progress} />
                  </Rx.Box>
                  <Rx.Text size="1" color="gray" aria-hidden="true">
                    {progress}
                  </Rx.Text>
                </Rx.Flex>
              )}
              {conflict && (
                <Rx.Text as="p" size="1" color="gray" dir="auto">
                  {conflict.join(", ")}
                </Rx.Text>
              )}
              {s.state === "queued" && (
                <Rx.Text as="p" size="1" color="gray">
                  {t("inbox.startsWhen", { cap: tasks?.caps.tasks ?? 1 })}
                </Rx.Text>
              )}
            </Rx.Flex>
          </button>
          {s.state === "queued" && (
            <Rx.Box pt="3" pr="3">
              <Rx.Button variant="ghost" color="gray" size="1" aria-describedby={labelId} onClick={() => cancel(s)}>
                {t("parallel.cancel")}
              </Rx.Button>
            </Rx.Box>
          )}
        </Rx.Flex>
      </li>
    );
  };

  const jobRow = (j: JobSummary, index: number) => {
    const key = `${j.id}:${j.scope ?? "-"}`;
    const labelId = `${id}-job-${index}`;
    const scope = scopeOf(j.scope);
    const start = onStartAction ? startableAction(state, j) : null;
    return (
      <li key={key}>
        <Rx.Box px="4" py="3">
          <Rx.Flex align="start" justify="between" gap="3">
            <Rx.Flex direction="column" gap="2" minWidth="0">
              <Rx.Text id={labelId} size="2" weight="bold" dir="auto">
                {j.label}
              </Rx.Text>
              <Rx.Flex align="center" gap="2" wrap="wrap">
                <Rx.Badge color="orange">{t("parallel.statusNeedsYou")}</Rx.Badge>
                {scope && (
                  <Rx.Badge color="gray" variant="outline" dir="auto">
                    {scope}
                  </Rx.Badge>
                )}
                {j.last && (
                  <Rx.Text size="1" color="gray">
                    {t("parallel.lastRun", { time: jobTime(j.last.at, language) })}
                  </Rx.Text>
                )}
              </Rx.Flex>
              {j.last && (
                <Rx.Text as="p" size="2" dir="auto">
                  {j.last.summary}
                </Rx.Text>
              )}
            </Rx.Flex>
            {start && (
              <Rx.Button
                variant="outline"
                color="gray"
                size="1"
                aria-describedby={labelId}
                onClick={() => {
                  setProblem(null);
                  if (onStartAction?.(start, j.scope) === false) setProblem({ key, text: t("parallel.startFailed") });
                  else onOpened();
                }}
              >
                {t("parallel.start")}
              </Rx.Button>
            )}
          </Rx.Flex>
          {j.last?.run ? <JobRunSteps client={client} run={j.last.run} describedBy={labelId} /> : null}
          {problem?.key === key && (
            <Rx.Text as="p" size="1" color="red" role="alert" mt="2">
              {problem.text}
            </Rx.Text>
          )}
        </Rx.Box>
      </li>
    );
  };

  const section = (key: keyof typeof SECTION_COLOR, title: string, count: number, rows: ReactNode) => (
    <Rx.Box asChild mb="5" key={key}>
      <section aria-labelledby={`${id}-${key}`}>
        <Rx.Flex asChild align="center" gap="2" mb="2">
          <h2 id={`${id}-${key}`} className="hh-inbox-head">
            <Rx.Badge color={SECTION_COLOR[key]} size="2">
              {title}
            </Rx.Badge>
            <Rx.Badge color="gray" variant="outline" size="2" aria-hidden="true">
              {count}
            </Rx.Badge>
            <Hidden>{t("inbox.count", { count })}</Hidden>
          </h2>
        </Rx.Flex>
        {count === 0 ? (
          <Rx.Text as="p" size="1" color="gray">
            {t("parallel.none")}
          </Rx.Text>
        ) : (
          <ul className="hh-gd-list">{rows}</ul>
        )}
      </section>
    </Rx.Box>
  );

  return (
    <SecondaryPage
      title={t("inbox.title")}
      line={summary}
      focusKey={focusKey}
      {...(onBack ? { onBack } : {})}
      action={
        onNewTask && (
          <Rx.Button size="2" onClick={onNewTask}>
            {t("parallel.newTask")}
          </Rx.Button>
        )
      }
    >
      <QueuePause client={client} tasks={tasks} />
      {section("waiting", t("parallel.waitingTitle"), waiting.length, waiting.map((s, i) => taskRow(s, "waiting", i)))}
      {section("working", t("parallel.workingTitle"), working.length, working.map((s, i) => taskRow(s, "working", i)))}
      {section("queued", t("parallel.queuedTitle"), queued.length, queued.map((s, i) => taskRow(s, "queued", i)))}
      {results.length > 0 && section("jobs", t("inbox.jobsTitle"), results.length, results.map(jobRow))}
    </SecondaryPage>
  );
}
