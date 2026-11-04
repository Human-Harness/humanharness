import { type KeyboardEvent, type ReactNode, useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import type { AppConfig, AppState, HarnessClient, JobSettings, JobSummary, JobsInfo } from "../client";
import { useLatestConfig } from "../latest-config";
import { shownLanguage } from "../language";
import { JobRunSteps } from "../tools/JobRunSteps";
import { useJobs } from "./useJobs";
import { Group, Icon, Row, Rx, SectionHead } from "../guide";

/** The lowest daily cap the field takes: less would pause a periodic job after its first run. */
export const DAILY_CAP_MIN = 1000;
const STATUS = { ok: "parallel.statusOk", "needs-you": "parallel.statusNeedsYou", failed: "parallel.statusFailed" } as const;
/** A run's state as a badge (DESIGN.md colors): done green, your turn orange, error red, in progress blue. */
const STATUS_COLOR = { ok: "green", "needs-you": "orange", failed: "red" } as const;

/**
 * Settings › Jobs for a harness that declares jobs (parallel spec §8, §9): each job can be turned off, and an `every`
 * job's daily token cap changed (the person's over the manifest's). Under each job, its runs per scope as the inbox
 * shows them, with "Run now" and a needs-you result's "Start": a harness with jobs but no inbox (no `parallel`) has
 * only this place to see them. A change saves the person's whole `jobs` (the store merges the top level only), so the
 * other jobs' settings stay. Radix stage 2c: one card per job; each run a foldable row (scope, state badge, times),
 * open for its summary and steps.
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
  const { t } = useTranslation();
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
  const start = (j: JobSummary, action: string) => {
    setProblem(null);
    if (onStartAction?.(action, j.scope) === false) setProblem({ job: j.id, text: t("parallel.startFailed") });
  };

  return (
    <div data-setting="jobs.jobs">
      <SectionHead line={t("settings.line.jobs")} />
      {saveFailed && (
        <Rx.Callout.Root color="red" role="alert" mb="3">
          <Rx.Callout.Text>{t("parallel.saveFailed")}</Rx.Callout.Text>
        </Rx.Callout.Root>
      )}
      {state.jobs!.jobs.map((job) => (
        <JobGroup key={job.id} job={job} entry={settings[job.id] ?? {}} onOn={(on) => setOn(job.id, on)} onCap={(cap) => setCap(job.id, cap)}>
          {(labelId) => [
            ...runs
              .filter((r) => r.id === job.id)
              .map((r) => {
                const action = startable(r);
                return (
                  <RunRow
                    key={r.scope ?? "-"}
                    client={client}
                    run={r}
                    scope={r.scope !== null && Object.hasOwn(scopeTitles, r.scope) ? scopeTitles[r.scope] : null}
                    labelId={labelId}
                    onStart={action ? () => start(r, action) : undefined}
                    onRunNow={r.manual && !r.running && r.paused !== "off" ? () => runNow(r) : undefined}
                  />
                );
              }),
            problem?.job === job.id && (
              <Rx.Box key="problem" py="3">
                <Rx.Callout.Root color="red" role="alert" size="1">
                  <Rx.Callout.Text>{problem.text}</Rx.Callout.Text>
                </Rx.Callout.Root>
              </Rx.Box>
            ),
          ]}
        </JobGroup>
      ))}
    </div>
  );
}

/**
 * One job × scope: a foldable row. Folded it shows the scope, the state as a badge and the last and next run in grey;
 * open, the agent's one-line summary and the run's steps. Start and Run now stay on the right, outside the fold.
 * A job that has not run yet has nothing to open: the row has no fold.
 */
function RunRow({
  client,
  run: j,
  scope,
  labelId,
  onStart,
  onRunNow,
}: {
  client: HarnessClient;
  run: JobSummary;
  scope: string | null;
  labelId: string;
  onStart?: () => void;
  onRunNow?: () => void;
}) {
  const { t, i18n } = useTranslation();
  const language = shownLanguage(i18n);
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  /** A time today alone; another day with its weekday. */
  const when = (iso: string): string => {
    const at = new Date(iso);
    const time = at.toLocaleTimeString(language, { hour: "numeric", minute: "2-digit" });
    return at.toDateString() === new Date().toDateString() ? time : `${at.toLocaleDateString(language, { weekday: "long" })} ${time}`;
  };
  const badge = j.running ? (
    <Rx.Badge color="blue" variant="soft">
      {t("parallel.jobRunning")}
    </Rx.Badge>
  ) : j.last ? (
    <Rx.Badge color={STATUS_COLOR[j.last.status]} variant="soft">
      {t(STATUS[j.last.status])}
    </Rx.Badge>
  ) : (
    <Rx.Badge color="gray" variant="soft">
      {t("parallel.notRunYet")}
    </Rx.Badge>
  );
  const times = [
    j.last && t("parallel.lastRun", { time: when(j.last.at) }),
    j.paused === "daily-cap" && t("parallel.pausedTomorrow"),
    j.paused === "off" && t("parallel.jobOff"),
    !j.paused && j.next && t("parallel.nextRun", { time: when(j.next) }),
  ].filter(Boolean);
  const name = (
    <>
      {scope && (
        <Rx.Text size="2" weight="medium" dir="auto">
          {scope}
        </Rx.Text>
      )}
      {badge}
    </>
  );
  return (
    <Rx.Box py="3">
      <Rx.Flex align="center" justify="between" gap="3" wrap="wrap">
        <Rx.Flex align="center" gap="3" wrap="wrap" minWidth="0">
          {j.last ? (
            <Rx.Button variant="ghost" color="gray" highContrast size="1" aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen(!open)}>
              <Icon name="chevron" size={14} />
              {name}
            </Rx.Button>
          ) : (
            <Rx.Flex align="center" gap="2">
              {name}
            </Rx.Flex>
          )}
          {times.length > 0 && (
            <Rx.Text size="1" color="gray">
              {times.join(" · ")}
            </Rx.Text>
          )}
        </Rx.Flex>
        {(onStart || onRunNow) && (
          <Rx.Flex gap="2" flexShrink="0">
            {onStart && (
              <Rx.Button size="1" variant="outline" color="gray" aria-describedby={labelId} onClick={onStart}>
                {t("parallel.start")}
              </Rx.Button>
            )}
            {onRunNow && (
              <Rx.Button size="1" variant="outline" color="gray" aria-describedby={labelId} onClick={onRunNow}>
                {t("parallel.runNow")}
              </Rx.Button>
            )}
          </Rx.Flex>
        )}
      </Rx.Flex>
      {j.last && (
        // A plain div holds `hidden`: a Radix Box's display: block would show the folded body anyway.
        <div id={bodyId} hidden={!open}>
          <Rx.Box pt="2" pl="5">
            <Rx.Text as="p" size="2" dir="auto">
              {j.last.summary}
            </Rx.Text>
            {j.last.run ? <JobRunSteps client={client} run={j.last.run} describedBy={labelId} /> : null}
          </Rx.Box>
        </div>
      )}
    </Rx.Box>
  );
}

/** One job's card: its title, the On switch with an `every` job's interval, the daily cap, then its runs. */
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
  children: (labelId: string) => ReactNode[];
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
    <Group title={<span dir="auto">{job.label}</span>} titleId={labelId}>
      <Row label={t("parallel.jobOn")} htmlFor={`${id}-on`} {...(job.every ? { hint: t("parallel.every", { interval: job.every }) } : {})}>
        <Rx.Switch id={`${id}-on`} checked={entry.off !== true} aria-describedby={labelId} onCheckedChange={onOn} />
      </Row>
      {job.every && (
        <Row
          label={t("parallel.dailyCap")}
          htmlFor={`${id}-cap`}
          hintId={`${id}-cap-note`}
          hint={
            tooLow ? (
              <Rx.Text color="red" role="alert">
                {t("parallel.dailyCapMin", { min: DAILY_CAP_MIN.toLocaleString(shownLanguage(i18n)) })}
              </Rx.Text>
            ) : (
              t("parallel.dailyCapHint")
            )
          }
        >
          <Rx.Box width="140px">
            <Rx.TextField.Root
              id={`${id}-cap`}
              type="number"
              min={DAILY_CAP_MIN}
              step={1000}
              value={draft}
              color={tooLow ? "red" : undefined}
              aria-invalid={tooLow || undefined}
              aria-describedby={`${id}-cap-note`}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commit}
              onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
                if (e.key === "Enter") commit();
              }}
            />
          </Rx.Box>
        </Row>
      )}
      {children(labelId)}
    </Group>
  );
}
