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

/** A task's name as the History panel shows its row. */
function taskName(t: Translate, g: HistoryTaskView, actions: Record<string, { label: string }>): string {
  if (g.taskId === null) return t("history.other");
  if (g.actionId === null) return t("history.question");
  return Object.hasOwn(actions, g.actionId) ? actions[g.actionId].label : t("history.task");
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
    const detail =
      p.kind === "approval" && p.version
        ? t("timeline.confirmApproval", { file: p.path, version: p.version, ago })
        : t("timeline.confirm", { file: p.path, author: authorName(t, p.author), ago });
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
 * The three go-back handlers, each told which window asked. Bad input is refused before any dialog. The folder and
 * task go-backs throw on failure as before (the panel says it couldn't); the file go-back answers every failure as data.
 */
export function goBackHandlers<S>(d: GoBackDeps<S>): Record<GoBackChannel, (sender: S, ...args: unknown[]) => Promise<unknown>> {
  return {
    "hh:restore": async (sender, sha): Promise<GoBackResult> => {
      if (!isSha(sha)) throw new Error("Invalid point");
      const groups = await d.groups();
      const own = groups.find((g) => g.entries.some((e) => e.sha === sha));
      const at = own?.entries.find((e) => e.sha === sha)?.date;
      const later = own && at ? laterTasks(groups, own.taskId, at) : [];
      if (!(await d.confirm(sender, { kind: "point", later }))) return CANCELLED;
      await d.restorePoint(sha);
      return { ok: true };
    },
    "hh:restoreTask": async (sender, taskId): Promise<GoBackResult> => {
      if (typeof taskId !== "string" || !taskId || taskId.length > 200) throw new Error("Invalid task");
      const groups = await d.groups();
      const task = groups.find((g) => g.taskId === taskId);
      if (!task?.start) throw new Error("Nothing to go back to");
      if (!(await d.confirm(sender, { kind: "task", task, later: laterTasks(groups, taskId, task.date) }))) return CANCELLED;
      await d.restoreTask(taskId);
      return { ok: true };
    },
    "hh:fileRestore": (sender, file, commit): Promise<FileRestoreAnswer> =>
      Promise.resolve()
        .then(async (): Promise<FileRestoreAnswer> => {
          // The service's checks first (shape, tracked, on the timeline, not busy): a refused go-back asks nothing.
          const asked = await d.file.restorePrompt(file, commit);
          if (!asked.ok) return asked;
          if (!(await d.confirm(sender, { kind: "file", prompt: asked.prompt }))) return CANCELLED;
          // The service checks everything again: the folder may have changed while the dialog was open.
          return d.file.restore(file, commit);
        })
        .catch((err: unknown) => {
          console.error("A file go-back failed", err);
          return { ok: false as const, reason: "failed" as const };
        }),
  };
}
