import type { TimelineAuthor } from "@humanharness/workspace";
import type { ActionStatus, AnswerPart, AppConfig, ChatEntry, ConfiguredApp, HistoryTaskView, ReaderPrefs, TextSize, ToolsInfo } from "./views";

/** Settings › General › Text size: the whole window is zoomed by this factor (chrome, chat and the harness's blocks alike). */
export const TEXT_SIZES = { normal: 1, large: 1.15, larger: 1.3, largest: 1.5 } as const;
const TEXT_SIZE_ORDER = Object.keys(TEXT_SIZES) as TextSize[];

export function isTextSize(value: unknown): value is TextSize {
  return typeof value === "string" && (TEXT_SIZE_ORDER as string[]).includes(value);
}

/** One size bigger or smaller (staying put at either end), or back to normal: what ⌘+, ⌘− and ⌘0 do. */
export function stepTextSize(current: TextSize | undefined, step: "in" | "out" | "reset"): TextSize {
  if (step === "reset") return "normal";
  const i = TEXT_SIZE_ORDER.indexOf(current ?? "normal");
  return TEXT_SIZE_ORDER[Math.min(Math.max(i + (step === "in" ? 1 : -1), 0), TEXT_SIZE_ORDER.length - 1)];
}

/** The valid part of saved reading preferences; null when nothing is valid. */
export function cleanReaderPrefs(value: unknown): ReaderPrefs | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  const out: ReaderPrefs = {
    ...(v.font === "sans" || v.font === "serif" ? { font: v.font } : {}),
    ...(v.size === "normal" || v.size === "large" ? { size: v.size } : {}),
  };
  return Object.keys(out).length > 0 ? out : null;
}

/** The entry is the person's line or the agent's reply, not a notice the app added. */
export const isTurnEntry = (e: Pick<ChatEntry, "notice">): boolean => e.notice === undefined;

/**
 * `parts` with a text delta added: it extends the text run at the end, or starts one. A run never starts
 * with whitespace alone, so trimming the runs at the end never removes one.
 */
export function addText(parts: AnswerPart[], delta: string): AnswerPart[] {
  const last = parts.at(-1);
  if (last && "text" in last) return [...parts.slice(0, -1), { text: last.text + delta }];
  return delta.trim() ? [...parts, { text: delta.trimStart() }] : parts;
}

/** `parts` with a paragraph break: only inside a text run (a block already separates what comes after it). */
export function addParagraph(parts: AnswerPart[]): AnswerPart[] {
  const last = parts.at(-1);
  return last && "text" in last ? [...parts.slice(0, -1), { text: `${last.text}\n\n` }] : parts;
}

/** The text runs trimmed, as the entry saves them. */
export function finishParts(parts: AnswerPart[]): AnswerPart[] {
  return parts.map((p) => ("text" in p ? { text: p.text.trim() } : p));
}

// The history's commit subjects (raw git data, English; the History panel shows them through i18n keys).
export { BEFORE_MESSAGE, CONTEXT_CHANGE_PREFIX, DATA_CHANGE_PREFIX, FILE_RESTORE_PREFIX, NOTE, RESTORE_POINT, RESTORE_TASK, START, STOPPED_PREFIX, TURN_PREFIX, UNDO_PREFIX } from "@humanharness/workspace/subjects";

/** The action to start after `current` on the guided path: the next one, or else the first one not done yet. */
export function nextInPath(path: string[], current: string | undefined, statuses: Record<string, ActionStatus>): string | null {
  const i = current ? path.indexOf(current) : -1;
  if (i >= 0 && i + 1 < path.length) return path[i + 1];
  return path.find((id) => id !== current && statuses[id] !== "done") ?? null;
}

/**
 * Files "Open" may hand to the system: text, data and images. Never apps, scripts or installers
 * (`.app`, `.command`, `.sh`, `.pkg`…), which the system would run instead of showing, nor pages,
 * SVGs and JavaScript or TypeScript sources, which may open in a browser or a script runner (macOS
 * may even take `.ts` for a video). Anything else can only be shown in Finder.
 */
export const OPENABLE_EXTENSIONS: ReadonlySet<string> = new Set([
  ".md", ".txt", ".json", ".jsonl", ".yaml", ".yml", ".toml", ".csv",
  ".css",
  ".png", ".jpg", ".jpeg", ".gif", ".pdf",
]);

/** Whether the app opens this file (by its extension); the rest can only be shown in Finder. */
export function canOpenFile(file: string): boolean {
  const name = file.slice(file.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot > 0 && OPENABLE_EXTENSIONS.has(name.slice(dot).toLowerCase());
}

export function isConfigured(config: AppConfig): config is ConfiguredApp {
  return Boolean(config.language && config.folder && config.engineId);
}

/** `ToolsInfo.off` when the tools host crashed too often: the chat's top line says so (tools Decision 7). */
export const TOOLS_OFF_CRASHES = "Tools are off after repeated crashes";
/** Who made a timeline entry, as the go-back confirmation and the timeline say it. */
export function authorName(t: (key: string) => string, a: TimelineAuthor): string {
  if (a.kind === "person") return t("timeline.you");
  if (a.kind === "outside") return t("timeline.outsideAuthor");
  // A harness tool's write (tools spec §8.3): its id.
  if (a.kind === "tool") return a.label;
  return a.action ? a.label : t("history.question");
}

/** "20 minutes ago", "now", "3 days ago"; "" for a date that doesn't parse. */
export function timeAgo(iso: string, language: string, now = Date.now()): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms) || !Number.isFinite(now)) return "";
  const seconds = Math.round((ms - now) / 1000);
  const f = new Intl.RelativeTimeFormat(language, { numeric: "auto" });
  const abs = Math.abs(seconds);
  if (abs < 60) return f.format(0, "second");
  if (abs < 3600) return f.format(Math.round(seconds / 60), "minute");
  if (abs < 86_400) return f.format(Math.round(seconds / 3600), "hour");
  return f.format(Math.round(seconds / 86_400), "day");
}

/** The tasks other than `own` that changed something after `after` (an ISO date), newest first: going back undoes them too. */
export function laterTasks(groups: HistoryTaskView[], own: string | null, after: string): HistoryTaskView[] {
  const t = Date.parse(after);
  return groups.filter((g) => g.taskId !== null && g.taskId !== own && Date.parse(g.date) > t);
}
