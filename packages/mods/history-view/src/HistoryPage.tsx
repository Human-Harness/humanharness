import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  type ActionOption,
  BEFORE_MESSAGE,
  CONTEXT_CHANGE_PREFIX,
  type HarnessClient,
  type HistoryItem,
  type HistoryTaskView,
  DATA_CHANGE_PREFIX,
  FILE_RESTORE_PREFIX,
  type HistoryFileChange,
  type LinkedHistoryView,
  NOTE,
  RESTORE_POINT,
  RESTORE_TASK,
  START,
  STOPPED_PREFIX,
  TURN_PREFIX,
  UNDO_PREFIX,
  type UndoRefusal,
} from "./client";
import { Hidden, Icon, Rx, SecondaryPage } from "./guide";
import { shownLanguage } from "./language";

/** The i18n key (and its values) that tells a history entry in plain language; null keeps the commit subject. */
export function entryLabel(message: string): { key: string; values?: Record<string, string> } | null {
  if (message === START) return { key: "history.entry.start" };
  if (message === BEFORE_MESSAGE) return { key: "history.entry.before" };
  if (message.startsWith(TURN_PREFIX)) return { key: "history.entry.turn" };
  if (message.startsWith(STOPPED_PREFIX)) return { key: "history.entry.stopped" };
  if (message.startsWith(UNDO_PREFIX)) return { key: "history.entry.undo" };
  if (message === RESTORE_TASK) return { key: "history.entry.restoredTask" };
  if (message === RESTORE_POINT) return { key: "history.entry.restored" };
  if (message.startsWith(DATA_CHANGE_PREFIX)) return { key: "history.entry.data", values: { collection: message.slice(DATA_CHANGE_PREFIX.length) } };
  if (message.startsWith(CONTEXT_CHANGE_PREFIX)) return { key: "history.entry.context", values: { change: message.slice(CONTEXT_CHANGE_PREFIX.length) } };
  if (message.startsWith(FILE_RESTORE_PREFIX)) {
    // `Go back: <path> to <target>`: the target never holds " to " (v2, "the version of <ISO time>"), so the last one splits.
    const rest = message.slice(FILE_RESTORE_PREFIX.length);
    const cut = rest.lastIndexOf(" to ");
    return { key: "history.entry.fileBack", values: { file: cut < 0 ? rest : rest.slice(0, cut) } };
  }
  const note = NOTE.exec(message);
  if (note) return { key: "history.entry.note", values: { title: note[1] } };
  return null;
}

const keyOf = (g: HistoryTaskView) => g.taskId ?? "other";

/** The scope picker's "every scope" (Radix Select keeps no empty value). */
const ALL = "__all__";

const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** The groups split by local day, keeping their order (newest first). */
export function byDay(groups: HistoryTaskView[]): { day: Date; items: HistoryTaskView[] }[] {
  const days: { day: Date; items: HistoryTaskView[] }[] = [];
  for (const g of groups) {
    const d = new Date(g.date);
    const last = days[days.length - 1];
    if (last && sameDay(last.day, d)) last.items.push(g);
    else days.push({ day: new Date(d.getFullYear(), d.getMonth(), d.getDate()), items: [g] });
  }
  return days;
}

type Restore = { kind: "task" | "point"; id: string };

/** The page's switch (UI refresh spec §5.7): every group, the tasks' groups, or the one outside any task. */
type Kind = "all" | "tasks" | "outside";

/** The id of a "go back" button, so focus can return to it when its confirmation is cancelled. */
const triggerId = (r: Restore) => `hh-history-back-${r.kind}-${r.id}`;

/**
 * History (spec 3d §1) as a secondary page (DESIGN.md "Secondary pages", stage 4b1): days with one foldable row per
 * task, with the files it changed, its entries and both ways back.
 */
export function HistoryPage({
  client,
  actions,
  onBack,
  onRestored,
  disabled = false,
  currentTask,
  jobs = [],
  onOpenFile,
  linkedFolders,
  openTask,
}: {
  client: HarnessClient;
  /** The harness's actions: a task's row shows its action's label. */
  actions: Record<string, ActionOption>;
  /** The open task's id: its row says it is open now. */
  currentTask?: string;
  /** Volver, Escape, or a restore that went through: back to the chat. */
  onBack: () => void;
  /** Called after a restore succeeded, before the page goes back. */
  onRestored?: (kind: Restore["kind"]) => void;
  /** Going back is not allowed while a turn is live. */
  disabled?: boolean;
  /**
   * Board mode (parallel spec §5.3): "Undo this task" takes back only the task's own files and never another task's.
   * Main refuses when a later change touched them, and the panel then says why; main's dialog lists no later tasks.
   * Only main acts on it now (the dialog is main's); the panel takes it so callers can say which mode they are in.
   */
  undoByFiles?: boolean;
  /** The harness's jobs (part 3): a job run's row shows its job's label. */
  jobs?: { id: string; label: string }[];
  /** A changed file was picked: its timeline opens (file-timeline spec §6.2). Absent: the paths stay plain text. */
  onOpenFile?: (path: string, kind: HistoryFileChange["kind"]) => void;
  /** Search opened a past task (search spec §3): its row starts open and scrolls into view instead of the newest. */
  openTask?: string;
  /**
   * The harness's declared linked folders (hatches spec §3.4): what undo covers in them shows too, and a partial undo
   * names them by label. Absent: none (D0).
   */
  linkedFolders?: Record<string, { label: string }>;
}) {
  const { t, i18n } = useTranslation();
  const pageId = useId();
  const [groups, setGroups] = useState<HistoryTaskView[] | null>(null);
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const [failed, setFailed] = useState(false);
  /** Board mode: why main refused the last "Undo this task". */
  const [refused, setRefused] = useState<UndoRefusal | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  /** Hatches only: the open scope's linked folders; a failure shows nothing extra. */
  const [linked, setLinked] = useState<LinkedHistoryView | null>(null);
  /** The scope `linked` belongs to: its "not covered" lines hide while the filter shows another scope. */
  const [linkedScope, setLinkedScope] = useState<string | null>(null);
  const withLinked = linkedFolders !== undefined;
  const loadLinked = () => {
    client.scopes.linkedHistory().then(setLinked, () => undefined);
    client.scopes.current().then(setLinkedScope, () => undefined);
  };
  useEffect(() => {
    if (withLinked) loadLinked();
  }, [client, withLinked]);
  /** A restore was sent and hasn't answered: no other way back can be taken meanwhile. */
  const [restoring, setRestoring] = useState(false);
  /** Harnesses with scopes: the scope whose tasks show ("" for all), and the scopes' titles. */
  const [filter, setFilter] = useState("");
  const [titles, setTitles] = useState<Record<string, string>>({});
  const scopeIds = [...new Set((groups ?? []).flatMap((g) => (g.scopeId ? [g.scopeId] : [])))];
  const hasScopes = scopeIds.length > 0;
  useEffect(() => {
    if (!hasScopes) return;
    client.scopes.list().then(
      (list) => setTitles(Object.fromEntries(list.map((s) => [s.id, s.title]))),
      () => undefined,
    );
  }, [client, hasScopes]);
  // A reload can drop the selected scope: back to all.
  useEffect(() => {
    if (filter && !scopeIds.includes(filter)) setFilter("");
  });
  const [kind, setKind] = useState<Kind>("all");
  const inScope = filter ? (groups ?? []).filter((g) => g.scopeId === filter) : groups;
  const shown = kind === "all" ? inScope : inScope?.filter((g) => (kind === "tasks" ? g.taskId !== null : g.taskId === null));
  /** The button whose go-back was cancelled or failed: it gets focus back once it is enabled again. */
  const refocus = useRef<string | null>(null);
  const close = onBack;
  const loadGroups = (first: boolean) =>
    client.historyTasks().then(
      (g) => {
        setGroups(g);
        // The newest task starts open (what the person most likely wants to undo), or the one search asked for.
        const wanted = openTask ? g.find((x) => x.taskId === openTask) : undefined;
        const start = wanted ?? g[0];
        if (first && start) setOpen(new Set([keyOf(start)]));
        if (first && wanted) requestAnimationFrame(() => document.getElementById(`hh-history-${keyOf(wanted)}`)?.scrollIntoView?.({ block: "nearest" }));
      },
      () => setLoadFailed(true),
    );
  useEffect(() => {
    void loadGroups(true);
  }, [client]);
  useEffect(() => {
    if (restoring || !refocus.current) return;
    document.getElementById(refocus.current)?.focus();
    refocus.current = null;
  }, [restoring]);

  const toggle = (key: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  /**
   * Goes back; main asks first with a native dialog (what goes back, what later tasks are undone too). The person's
   * "Cancel" answers `cancelled`: nothing changed, so the panel stays as it was and the button gets focus back.
   */
  const restore = (r: Restore) => {
    if (restoring) return;
    setFailed(false);
    setRefused(null);
    setRestoring(true);
    (r.kind === "task" ? client.restoreTask(r.id) : client.restore(r.id)).then(
      (answer) => {
        // Board mode: main refused, naming why (spec §5.3); nothing changed.
        if (answer && "refused" in answer) {
          refocus.current = triggerId(r);
          setRestoring(false);
          setRefused(answer.refused);
          // Linked folders: part of the task was taken back, so the history changed (hatches spec §3.4).
          if (answer.refused.reason === "partial") {
            void loadGroups(false);
            if (withLinked) loadLinked();
          }
          return;
        }
        if (answer && answer.ok === false) {
          refocus.current = triggerId(r);
          setRestoring(false);
          return;
        }
        setRestoring(false);
        onRestored?.(r.kind);
        close();
      },
      () => {
        refocus.current = triggerId(r);
        setRestoring(false);
        setFailed(true);
      },
    );
  };

  /** "Undo this task" is an outline button under the task's points; "Go back here" a ghost one on each point. */
  const goBack = (r: Restore) => (
    <Rx.Button
      id={triggerId(r)}
      variant={r.kind === "task" ? "outline" : "ghost"}
      color="gray"
      size="1"
      disabled={disabled || restoring}
      onClick={() => restore(r)}
    >
      <Icon name="undo" size={14} />
      {t(r.kind === "task" ? "history.restoreTask" : "history.restore")}
    </Rx.Button>
  );

  const rowLabel = (g: HistoryTaskView) => {
    if (g.taskId === null) return t("history.other");
    if (g.jobId !== undefined) {
      // A job the harness no longer has is just "a background job".
      const job = jobs.find((j) => j.id === g.jobId);
      return job ? t("parallel.historyJob", { label: job.label }) : t("parallel.historyJobUnknown");
    }
    if (g.actionId === null) return t("history.question");
    // An action the harness no longer has (or a trailer such as "toString") is just "a task".
    return Object.hasOwn(actions, g.actionId) ? actions[g.actionId].label : t("history.task");
  };
  const entryText = (e: HistoryItem) => {
    const label = entryLabel(e.message);
    return label ? t(label.key, label.values ?? {}) : e.message;
  };
  /** A task's changes in the tracked linked folders (hatches): listed under each folder's label, counted on its row. */
  const linkedOf = (g: HistoryTaskView) => (g.taskId !== null && linked && Object.hasOwn(linked.tasks, g.taskId) ? linked.tasks[g.taskId] : []);
  const folderLabel = (key: string) => (linkedFolders && Object.hasOwn(linkedFolders, key) ? linkedFolders[key].label : key);
  const refusalText = (r: UndoRefusal): string => {
    if (r.reason === "partial") {
      // What was taken back, then the first folder that refused and why.
      const done = [...(r.workFolder ? [t("hatches.undoWorkFolder")] : []), ...r.restored.map(folderLabel)];
      const list = new Intl.ListFormat(language, { type: "conjunction" }).format(done);
      const why = t("hatches.undoNotDone", { folder: folderLabel(r.notRestored[0] ?? ""), cause: refusalText(r.cause) });
      return done.length > 0 ? `${t("hatches.undoDone", { folders: list })} ${why}` : why;
    }
    if (r.reason === "running") return t("parallel.undoRunning", { path: r.path });
    if (r.reason === "uncommitted") return t("parallel.undoUnsaved", { path: r.path });
    if (r.reason === "later") return t(r.by === "task" ? "parallel.undoLaterTask" : "parallel.undoLaterOutside", { path: r.path });
    return t(r.reason === "too-far" ? "parallel.undoTooFar" : "parallel.undoNothing");
  };
  const language = shownLanguage(i18n);
  /** The time alone; the day is its section's heading, and the full date shows on hover. */
  const when = (iso: string) => {
    const d = new Date(iso);
    return (
      <time dateTime={iso} title={d.toLocaleString(language)}>
        {d.toLocaleTimeString(language, { hour: "numeric", minute: "2-digit" })}
      </time>
    );
  };
  /** A task's time span, oldest point to newest; a single time when they share the minute. */
  const span = (g: HistoryTaskView) => {
    const first = g.taskId !== null ? g.entries[g.entries.length - 1]?.date : undefined;
    const same = (a: string, b: string) => Math.floor(Date.parse(a) / 60_000) === Math.floor(Date.parse(b) / 60_000);
    return first && !same(first, g.date) ? (
      <>
        {when(first)} – {when(g.date)}
      </>
    ) : (
      when(g.date)
    );
  };
  // Tasks under their day; the group outside any task always comes last, in a section of its own.
  // With a scope filter on, only that scope's tasks (going back still counts every later task).
  const days: { day: Date | null; items: HistoryTaskView[] }[] = shown ? byDay(shown.filter((g) => g.taskId !== null)) : [];
  const outside = shown?.find((g) => g.taskId === null);
  if (outside) days.push({ day: null, items: [outside] });
  const dayLabel = (day: Date) => {
    const today = new Date();
    if (sameDay(day, today)) return t("history.today");
    if (sameDay(day, new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1))) return t("history.yesterday");
    const year = day.getFullYear() === today.getFullYear() ? undefined : "numeric";
    return day.toLocaleDateString(language, { month: "short", day: "numeric", year });
  };

  const alert = (text: string) => (
    <Rx.Callout.Root color="red" role="alert" mb="4">
      <Rx.Callout.Text>{text}</Rx.Callout.Text>
    </Rx.Callout.Root>
  );
  const changeColor = { added: "green", modified: "gray", deleted: "orange" } as const;
  const change = (c: HistoryFileChange, id?: string) => (
    <Rx.Badge id={id} color={changeColor[c.kind]} variant="soft">
      {t(`history.change.${c.kind}`)}
    </Rx.Badge>
  );
  const many = (groups?.length ?? 0) > 0;

  return (
    <SecondaryPage title={t("history.title")} line={many ? t("history.intro") : undefined} onBack={close}>
      {disabled && (
        <Rx.Callout.Root color="gray" role="status" mb="4">
          <Rx.Callout.Icon>
            <Icon name="clock" size={18} />
          </Rx.Callout.Icon>
          <Rx.Callout.Text>{t("history.busy")}</Rx.Callout.Text>
        </Rx.Callout.Root>
      )}
      {failed && alert(t("history.restoreFailed"))}
      {refused && alert(refusalText(refused))}
      {loadFailed && alert(t("history.loadFailed"))}
      {(!filter || filter === linkedScope) &&
        linked?.uncovered.map((u) => (
          <Rx.Text key={u.key} as="p" size="1" color="gray" mb="3">
            {t(u.noGit ? "hatches.notCoveredNoGit" : "hatches.notCoveredFolder", { label: u.label })}
          </Rx.Text>
        ))}
      {groups?.length === 0 && (
        <Rx.Flex direction="column" gap="1">
          <Rx.Text as="p" size="2" weight="bold">
            {t("history.emptyTitle")}
          </Rx.Text>
          <Rx.Text as="p" size="2" color="gray">
            {t("history.empty")}
          </Rx.Text>
        </Rx.Flex>
      )}
      {many && (
        <Rx.Flex align="center" justify="between" gap="3" wrap="wrap" mb="5">
          <Rx.SegmentedControl.Root size="1" value={kind} onValueChange={(v) => setKind(v as Kind)} aria-label={t("history.filter.label")}>
            <Rx.SegmentedControl.Item value="all">{t("history.filter.all")}</Rx.SegmentedControl.Item>
            <Rx.SegmentedControl.Item value="tasks">{t("history.filter.tasks")}</Rx.SegmentedControl.Item>
            <Rx.SegmentedControl.Item value="outside">{t("history.filter.outside")}</Rx.SegmentedControl.Item>
          </Rx.SegmentedControl.Root>
          {hasScopes && (
            <Rx.Flex align="center" gap="2">
              <Rx.Text id={`${pageId}-scope`} size="1" color="gray">
                {t("history.scopeFilter")}
              </Rx.Text>
              {/* Radix Select keeps no empty value: "" (every scope) travels as ALL. */}
              <Rx.Select.Root size="1" value={filter || ALL} onValueChange={(v) => setFilter(v === ALL ? "" : v)}>
                <Rx.Select.Trigger variant="soft" color="gray" aria-labelledby={`${pageId}-scope`} />
                <Rx.Select.Content position="popper">
                  <Rx.Select.Item value={ALL}>{t("history.allScopes")}</Rx.Select.Item>
                  {scopeIds.map((id) => (
                    <Rx.Select.Item key={id} value={id}>
                      {id === "_app" ? t("history.appScope") : (titles[id] ?? id)}
                    </Rx.Select.Item>
                  ))}
                </Rx.Select.Content>
              </Rx.Select.Root>
            </Rx.Flex>
          )}
        </Rx.Flex>
      )}
      {shown?.length === 0 && many && (
        <Rx.Text as="p" size="1" color="gray">
          {t("history.emptyFilter")}
        </Rx.Text>
      )}
      {days.map(({ day, items }) => {
        const headId = `${pageId}-${day?.toDateString().replace(/\W/g, "") ?? "outside"}`;
        return (
          <Rx.Box asChild mb="5" key={day?.toDateString() ?? "outside"}>
            {/* The group outside any task has no day: its row already says what it is. */}
            <section {...(day ? { "aria-labelledby": headId } : { "aria-label": t("history.other") })}>
              {day && (
                <Rx.Heading as="h2" size="1" color="gray" weight="medium" mb="2" id={headId}>
                  {dayLabel(day)}
                </Rx.Heading>
              )}
              <ol className="hh-gd-list">
                {items.map((g) => {
                  const key = keyOf(g);
                  const expanded = open.has(key);
                  const bodyId = `hh-history-${key}`;
                  const total = g.changes.length + linkedOf(g).reduce((n, f) => n + f.changes.length, 0);
                  // Outside a task with nothing changed: the grey badge says it, no "0 files changed".
                  const nothing = g.taskId === null && total === 0;
                  return (
                    <li key={key}>
                      {/* aria-controls only names a body that is there. */}
                      <button type="button" className="hh-history-row" aria-expanded={expanded} aria-controls={expanded ? bodyId : undefined} onClick={() => toggle(key)}>
                        <Icon name="chevron" size={14} />
                        <Rx.Flex direction="column" gap="1" minWidth="0" flexGrow="1">
                          <Rx.Text size="2" weight="bold" dir="auto">
                            {rowLabel(g)}
                          </Rx.Text>
                          <Rx.Text size="1" color="gray">
                            {span(g)}
                            {!nothing && <> · {t("history.filesChanged", { count: total })}</>}
                          </Rx.Text>
                        </Rx.Flex>
                        <Rx.Flex gap="2" wrap="wrap" justify="end" flexShrink="0">
                          {currentTask !== undefined && g.taskId === currentTask && <Rx.Badge color="blue">{t("history.inProgress")}</Rx.Badge>}
                          {g.noteTitle && (
                            <Rx.Badge color="green" title={g.noteTitle}>
                              {t("history.noteSaved")}
                              <Hidden>: {g.noteTitle}</Hidden>
                            </Rx.Badge>
                          )}
                          {nothing && (
                            <Rx.Badge color="gray" variant="outline">
                              {t("history.noChanges")}
                            </Rx.Badge>
                          )}
                        </Rx.Flex>
                      </button>
                      {expanded && (
                        <Rx.Flex id={bodyId} className="hh-history-body" direction="column" gap="4" pl="7" pr="4" pb="4">
                          {g.changes.length > 0 && (
                            <Rx.Flex asChild direction="column" gap="1">
                              <ul aria-label={t("history.changedFiles")}>
                                {g.changes.map((c, i) => (
                                  <Rx.Flex asChild key={c.path} align="center" gap="2" minWidth="0">
                                    <li>
                                      {change(c, `${bodyId}-k${i}`)}
                                      {onOpenFile ? (
                                        <Rx.Button
                                          variant="ghost"
                                          color="gray"
                                          size="1"
                                          className="hh-history-file"
                                          title={c.path}
                                          aria-label={t("history.openTimeline", { file: c.path })}
                                          aria-describedby={`${bodyId}-k${i}`}
                                          onClick={() => onOpenFile(c.path, c.kind)}
                                        >
                                          {c.path}
                                        </Rx.Button>
                                      ) : (
                                        <Rx.Text size="1" color="gray" truncate title={c.path}>
                                          {c.path}
                                        </Rx.Text>
                                      )}
                                    </li>
                                  </Rx.Flex>
                                ))}
                              </ul>
                            </Rx.Flex>
                          )}
                          {/* A linked folder's files are plain text: the file timeline reads only the main folder's history. */}
                          {linkedOf(g).map((f, j) => (
                            <Rx.Flex key={`${f.key}-${j}`} direction="column" gap="1">
                              <Rx.Text id={`${bodyId}-l${j}`} size="1" color="gray">
                                {f.label}
                              </Rx.Text>
                              <Rx.Flex asChild direction="column" gap="1">
                                <ul aria-labelledby={`${bodyId}-l${j}`}>
                                  {f.changes.map((c) => (
                                    <Rx.Flex asChild key={c.path} align="center" gap="2" minWidth="0">
                                      <li>
                                        {change(c)}
                                        <Rx.Text size="1" color="gray" truncate title={c.path}>
                                          {c.path}
                                        </Rx.Text>
                                      </li>
                                    </Rx.Flex>
                                  ))}
                                </ul>
                              </Rx.Flex>
                            </Rx.Flex>
                          ))}
                          {/* A task that changed only linked folders has no entry in the work folder's history. */}
                          {g.entries.length > 0 && (
                            <Rx.Flex asChild direction="column" gap="1">
                              <ol aria-label={t("history.points")}>
                                {g.entries.map((e) => (
                                  <Rx.Flex asChild key={e.sha} align="center" justify="between" gap="3">
                                    <li>
                                      <Rx.Flex align="baseline" gap="3" minWidth="0">
                                        <Rx.Text size="1" color="gray" className="hh-history-time">
                                          {when(e.date)}
                                        </Rx.Text>
                                        <Rx.Text size="2">{entryText(e)}</Rx.Text>
                                        {/* The part the task was in (task-phases spec §6); none for a part the manifest no longer has. */}
                                        {e.phase && g.actionId && Object.hasOwn(actions, g.actionId) && (
                                          <Rx.Text size="1" color="gray">
                                            {actions[g.actionId].phases?.find((p) => p.id === e.phase)?.label}
                                          </Rx.Text>
                                        )}
                                      </Rx.Flex>
                                      {goBack({ kind: "point", id: e.sha })}
                                    </li>
                                  </Rx.Flex>
                                ))}
                              </ol>
                            </Rx.Flex>
                          )}
                          {g.taskId !== null && g.start !== null && <Rx.Box>{goBack({ kind: "task", id: g.taskId })}</Rx.Box>}
                        </Rx.Flex>
                      )}
                    </li>
                  );
                })}
              </ol>
            </section>
          </Rx.Box>
        );
      })}
    </SecondaryPage>
  );
}
