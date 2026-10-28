import {
  type FileRestoreAnswer,
  type FileRestorePrompt,
  type FileRestorePromptResult,
  type GoBackResult,
  type HistoryTaskView,
  authorName,
  laterTasks,
  timeAgo,
} from "@humanharness/ui/client";
import { isSha } from "./history-view";

/**
 * Every go-back is confirmed here, in main, with a native dialog attached to the window that asked (Marco,
 * 2026-10-28). Harness UI code runs in the same window and JS realm as the core, so a confirmation drawn in the window
 * could be skipped; this one can't. Three go-backs: one file (`hh:fileRestore`), the whole folder (`hh:restore`) and
 * one task (`hh:restoreTask`). A "Cancel" is data: `{ ok: false, reason: "cancelled" }`, and nothing changes.
 */

/** What a go-back dialog is about: the file's version, or the tasks a folder or task go-back undoes. */
export type GoBackAsk =
  | { kind: "file"; prompt: FileRestorePrompt }
  | { kind: "point"; later: HistoryTaskView[] }
  | { kind: "task"; task: HistoryTaskView; later: HistoryTaskView[] };

/** The dialog's words, in the person's language. */
export interface GoBackText {
  message: string;
  detail: string;
  yes: string;
  cancel: string;
}

export type Translate = (key: string, values?: Record<string, unknown>) => string;

/** The person's answer to one go-back dialog: true only for "Go back". `S` is whoever asked (the window's sender). */
export type ConfirmGoBack<S> = (sender: S, ask: GoBackAsk) => Promise<boolean>;

export const CANCELLED = { ok: false, reason: "cancelled" } as const;

/** Tasks listed by name in the dialog; the rest are counted only. */
const MAX_LISTED = 10;
/** The longest path and label a dialog shows; longer ones lose their middle. */
const MAX_PATH = 160;
const MAX_LABEL = 80;

/** Controls (C0, C1), line and paragraph separators, and bidi marks, embeddings, overrides and isolates. */
const UNSAFE = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;

/**
 * A file name or label as a dialog may show it: no character that could break a line or reorder the text (each
 * becomes U+FFFD, so the person sees something was there), and at most `max` characters, the middle cut with "…".
 */
export function dialogSafe(s: string, max: number): string {
  const chars = Array.from(s.replace(UNSAFE, "�"));
  if (chars.length <= max) return chars.join("");
  const head = Math.ceil((max - 1) / 2);
  const tail = max - 1 - head;
  return `${chars.slice(0, head).join("")}…${tail > 0 ? chars.slice(-tail).join("") : ""}`;
}

/** A task's name as the History panel shows its row. */
function taskName(t: Translate, g: HistoryTaskView, actions: Record<string, { label: string }>): string {
  if (g.taskId === null) return t("history.other");
  if (g.actionId === null) return t("history.question");
  return dialogSafe(Object.hasOwn(actions, g.actionId) ? actions[g.actionId].label : t("history.task"), MAX_LABEL);
}

/**
 * What the dialog says: what goes back (the file, the whole folder, the task) and what else changes with it (the rest
 * of the folder stays, or the later tasks that are undone too, by name).
 */
export function goBackText(t: Translate, ask: GoBackAsk, actions: Record<string, { label: string }>, language: string, now = Date.now()): GoBackText {
  const buttons = { yes: t("goBack.yes"), cancel: t("goBack.cancel") };
  if (ask.kind === "file") {
    const p = ask.prompt;
    const ago = timeAgo(p.at, language, now);
    const file = dialogSafe(p.path, MAX_PATH);
    const detail =
      p.kind === "approval" && p.version
        ? t("timeline.confirmApproval", { file, version: p.version, ago })
        : t("timeline.confirm", { file, author: dialogSafe(authorName(t, p.author), MAX_LABEL), ago });
    return { message: t("timeline.confirmTitle"), detail, ...buttons };
  }
  const later = ask.later;
  let first = t(ask.kind === "task" ? "history.confirmTask" : "history.confirmFolder");
  if (later.length > 0) first += ` ${t("history.laterTasks", { count: later.length })}`;
  const undone = later.length > 0 ? [...(ask.kind === "task" ? [ask.task] : []), ...later] : [];
  const lines = undone.slice(0, MAX_LISTED).map((g) => `• ${taskName(t, g, actions)} · ${t("history.filesChanged", { count: g.changes.length })}`);
  if (undone.length > MAX_LISTED) lines.push("…");
  const message = ask.kind === "task" ? t("history.confirmTaskTitle", { name: taskName(t, ask.task, actions) }) : t("history.confirmFolderTitle");
  return { message, detail: [first, ...(lines.length > 0 ? ["", ...lines] : [])].join("\n"), ...buttons };
}

/** The part of Electron's `dialog` used here: e2e tests replace `showMessageBox` on the real one. */
export interface MessageBoxDialog<W> {
  showMessageBox(window: W, options: MessageBoxOptions): Promise<{ response: number }>;
  showMessageBox(options: MessageBoxOptions): Promise<{ response: number }>;
}
interface MessageBoxOptions {
  type: "question";
  message: string;
  detail: string;
  buttons: string[];
  defaultId: number;
  cancelId: number;
  noLink: boolean;
}

/**
 * Shows the dialog, a sheet on the asking window when there is one (modal on macOS). Cancel is the default and the
 * cancel id (Esc, closing it); only "Go back" says yes. The dialog is looked up at call time, so a test can replace it.
 */
export async function askNatively<W>(dialog: MessageBoxDialog<W>, window: W | null, text: GoBackText): Promise<boolean> {
  const options: MessageBoxOptions = {
    type: "question",
    message: text.message,
    detail: text.detail,
    buttons: [text.yes, text.cancel],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
  };
  const r = window ? await dialog.showMessageBox(window, options) : await dialog.showMessageBox(options);
  return r.response === 0;
}

export interface GoBackDeps<S> {
  confirm: ConfirmGoBack<S>;
  /** Going back can't run now (quitting, a turn or task operation, a hold): the folder and task go-backs ask nothing. */
  blocked(): boolean;
  /** The History panel's groups, newest first (none when there is no history). */
  groups(): Promise<HistoryTaskView[]>;
  /** The whole folder back to `sha` (index.ts: through the restore guard). */
  restorePoint(sha: string): Promise<void>;
  /** The folder back to before the task (index.ts: through the restore guard, which checks the task again). */
  restoreTask(taskId: string): Promise<void>;
  /** The file timeline's own checks and go-back (FileTimelineService). */
  file: {
    restorePrompt(file: unknown, commit: unknown): Promise<FileRestorePromptResult>;
    restore(file: unknown, commit: unknown): Promise<FileRestoreAnswer>;
  };
}

export const GO_BACK_CHANNELS = ["hh:restore", "hh:restoreTask", "hh:fileRestore"] as const;
export type GoBackChannel = (typeof GO_BACK_CHANNELS)[number];

/**
 * The three go-back handlers, each told which window asked. Bad input, an unlisted point and a blocked go-back are
 * refused before any dialog. One dialog at a time: a go-back asked while one is open answers cancelled. A yes is
 * cancelled too when more later tasks appeared while the dialog was open (it would undo what the person never saw).
 * The folder and task go-backs throw on failure as before (the panel says it couldn't); the file go-back answers every
 * failure as data.
 */
export function goBackHandlers<S>(d: GoBackDeps<S>): Record<GoBackChannel, (sender: S, ...args: unknown[]) => Promise<unknown>> {
  let open = false;
  const confirm = async (sender: S, ask: GoBackAsk): Promise<boolean> => {
    if (open) return false;
    open = true;
    try {
      return (await d.confirm(sender, ask)) === true;
    } finally {
      open = false;
    }
  };
  /** Whether `after` names a task `before` didn't. */
  const grew = (before: HistoryTaskView[], after: HistoryTaskView[]) => {
    const seen = new Set(before.map((g) => g.taskId));
    return after.some((g) => !seen.has(g.taskId));
  };
  const notBlocked = () => {
    if (d.blocked()) throw new Error("Going back can't run now");
  };
  /** A point's own group and the later tasks going back to it undoes; null when no listed point has `sha`. */
  const pointIn = (groups: HistoryTaskView[], sha: string): HistoryTaskView[] | null => {
    const own = groups.find((g) => g.entries.some((e) => e.sha === sha));
    const at = own?.entries.find((e) => e.sha === sha)?.date;
    return own && at ? laterTasks(groups, own.taskId, at) : null;
  };
  return {
    "hh:restore": async (sender, sha): Promise<GoBackResult> => {
      if (!isSha(sha)) throw new Error("Invalid point");
      const later = pointIn(await d.groups(), sha);
      if (!later) throw new Error("Invalid point");
      notBlocked();
      if (!(await confirm(sender, { kind: "point", later }))) return CANCELLED;
      const now = pointIn(await d.groups(), sha);
      if (!now || grew(later, now)) return CANCELLED;
      await d.restorePoint(sha);
      return { ok: true };
    },
    "hh:restoreTask": async (sender, taskId): Promise<GoBackResult> => {
      if (typeof taskId !== "string" || !taskId || taskId.length > 200) throw new Error("Invalid task");
      const groups = await d.groups();
      const task = groups.find((g) => g.taskId === taskId);
      if (!task?.start) throw new Error("Nothing to go back to");
      notBlocked();
      const later = laterTasks(groups, taskId, task.date);
      if (!(await confirm(sender, { kind: "task", task, later }))) return CANCELLED;
      const now = await d.groups();
      const again = now.find((g) => g.taskId === taskId);
      if (!again || grew(later, laterTasks(now, taskId, again.date))) return CANCELLED;
      await d.restoreTask(taskId);
      return { ok: true };
    },
    "hh:fileRestore": (sender, file, commit): Promise<FileRestoreAnswer> =>
      Promise.resolve()
        .then(async (): Promise<FileRestoreAnswer> => {
          // The service's checks first (shape, tracked, on the timeline, not busy): a refused go-back asks nothing.
          const asked = await d.file.restorePrompt(file, commit);
          if (!asked.ok) return asked;
          if (!(await confirm(sender, { kind: "file", prompt: asked.prompt }))) return CANCELLED;
          // The service checks everything again: the folder may have changed while the dialog was open.
          return d.file.restore(file, commit);
        })
        .catch((err: unknown) => {
          console.error("A file go-back failed", err);
          return { ok: false as const, reason: "failed" as const };
        }),
  };
}
