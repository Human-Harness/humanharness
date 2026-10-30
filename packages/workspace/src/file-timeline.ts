import { refusedShape } from "@humanharness/harness-sdk/documents";
import {
  ANSWER_PREFIX,
  ANSWER_SEPARATOR,
  APPROVED_PREFIX,
  BEFORE_MESSAGE,
  FILE_RESTORE_PREFIX,
  RESTORE_POINT,
  RESTORE_TASK,
  START,
  UNDO_PREFIX,
} from "./subjects";

export type TimelineKind = "task" | "answers" | "approval" | "outside" | "goBack";

/** Who made an entry (§3.1). `job` is for parallel jobs, which do not exist yet. `tool`: a harness tool's write (tools spec §8.3). */
export interface TimelineAuthor {
  kind: "agent" | "person" | "outside" | "tool";
  label: string;
  task?: string;
  action?: string;
  job?: string;
  /** The tool's id, only for `kind: "tool"` (its label too). */
  tool?: string;
}

/** One entry of a file's timeline (§3.2). Times are ISO strings. */
export interface TimelineEntry {
  kind: TimelineKind;
  author: TimelineAuthor;
  /** English, for harness views and logs; the window draws its own text from the other fields. */
  label: string;
  /** The time of its last commit. */
  at: string;
  /** The commit before the entry (the file's previous state); null before the history's first commit. */
  from: string | null;
  /** Its last commit. */
  to: string;
  /** Approvals only: 1, 2… */
  version?: number;
  /** Answers only, until an approval follows. */
  unapproved?: true;
  /** The file is not there at `to`. */
  deleted?: true;
  /** A go-back: the approval or the time of the version it brought back, when one matches. */
  back?: { version?: number; at?: string };
  /** An approval made with a reason (review spec §5.4); set by main from the review record, paired by blob. */
  reason?: true;
  /**
   * The approval the review record holds last ("See what changed" starts here); set by main, paired by blob. After a
   * whole-folder go-back it can be an older entry than the newest approval.
   */
  lastApproved?: true;
  /** git's blob id of the file at `to`; absent when it is not there. */
  blob?: string;
  /** The turns, newest first, for expanding. */
  commits: { id: string; subject: string; at: string }[];
}

/** A commit that touched the file, as `groupTimeline` needs it. `blob`: the file's blob id there, null when absent. */
export interface TimelineCommit {
  id: string;
  parent: string | null;
  subject: string;
  task: string | null;
  action: string | null;
  at: string;
  blob: string | null;
  /** The commit's `Tool:` trailer, only for a tool's write. */
  tool?: string;
}

/**
 * The path an `Answer:` or `Approved:` subject names; null for any other subject or a path the reader would refuse. An
 * answer's path ends at the first separator, so a name holding " · " reads short here (the index then lists a path that
 * doesn't exist); `classifyCommit` matches the whole path instead.
 */
export function namedPath(subject: string): string | null {
  let rest: string;
  if (subject.startsWith(APPROVED_PREFIX)) rest = subject.slice(APPROVED_PREFIX.length);
  else if (subject.startsWith(ANSWER_PREFIX)) {
    const body = subject.slice(ANSWER_PREFIX.length);
    const cut = body.indexOf(ANSWER_SEPARATOR);
    if (cut < 0) return null;
    rest = body.slice(0, cut);
  } else return null;
  return refusedShape(rest) ? null : rest;
}

const isGoBack = (s: string) => s.startsWith(FILE_RESTORE_PREFIX) || s === RESTORE_POINT || s === RESTORE_TASK || s.startsWith(UNDO_PREFIX);

/** A commit's kind for `file`, subject before trailer (§3.1), and the key that merges it with its neighbour. */
export function classifyCommit(c: TimelineCommit, file: string): { kind: TimelineKind; key: string } {
  const s = c.subject;
  // The whole path, then the separator: a name holding " · " still matches.
  if (s.startsWith(ANSWER_PREFIX)) {
    return s.startsWith(`${ANSWER_PREFIX}${file}${ANSWER_SEPARATOR}`) ? { kind: "answers", key: "answers" } : { kind: "outside", key: c.id };
  }
  if (s.startsWith(APPROVED_PREFIX)) return s === `${APPROVED_PREFIX}${file}` ? { kind: "approval", key: c.id } : { kind: "outside", key: c.id };
  if (isGoBack(s)) return { kind: "goBack", key: c.id };
  if (s === START || s === BEFORE_MESSAGE) return { kind: "outside", key: c.id };
  // A tool's write, in a task or not: its own entry, never merged with the task's turns.
  if (c.tool !== undefined) return { kind: "task", key: `tool:${c.tool}:${c.task ?? ""}` };
  if (c.task !== null) return { kind: "task", key: `task:${c.task}` };
  return { kind: "outside", key: c.id };
}

const YOU: TimelineAuthor = { kind: "person", label: "You" };
const OUTSIDE: TimelineAuthor = { kind: "outside", label: "Outside the app" };

function agent(c: TimelineCommit, actionLabel: (id: string | null) => string): TimelineAuthor {
  return { kind: "agent", label: actionLabel(c.action), ...(c.task ? { task: c.task } : {}), ...(c.action ? { action: c.action } : {}) };
}

function tool(c: TimelineCommit & { tool: string }): TimelineAuthor {
  return { kind: "tool", label: c.tool, tool: c.tool, ...(c.task ? { task: c.task } : {}), ...(c.action ? { action: c.action } : {}) };
}

/**
 * The commits that touched `file` (oldest first) as timeline entries, newest first (§3.1). `actionLabel` names a task's
 * action (null: a free question).
 */
export function groupTimeline(commits: TimelineCommit[], file: string, actionLabel: (id: string | null) => string): TimelineEntry[] {
  type Group = { kind: TimelineKind; key: string; commits: TimelineCommit[] };
  const groups: Group[] = [];
  for (const c of commits) {
    const { kind, key } = classifyCommit(c, file);
    const last = groups.at(-1);
    if (last && last.key === key && (kind === "task" || kind === "answers")) last.commits.push(c);
    else groups.push({ kind, key, commits: [c] });
  }
  const out: TimelineEntry[] = [];
  let version = 0;
  for (const g of groups) {
    const first = g.commits[0];
    const last = g.commits[g.commits.length - 1];
    const e: TimelineEntry = {
      kind: g.kind,
      author:
        g.kind === "task" && last.tool !== undefined
          ? tool({ ...last, tool: last.tool })
          : g.kind === "task" || (g.kind === "goBack" && last.subject.startsWith(UNDO_PREFIX) && last.task !== null)
          ? agent(last, actionLabel)
          : g.kind === "outside"
            ? OUTSIDE
            : YOU,
      label: "",
      at: last.at,
      from: first.parent,
      to: last.id,
      commits: g.commits.map((c) => ({ id: c.id, subject: c.subject, at: c.at })).reverse(),
    };
    if (g.kind === "approval") e.version = ++version;
    if (last.blob === null) e.deleted = true;
    else e.blob = last.blob;
    out.push(e);
  }
  // Answers stay unapproved until an approval follows; a go-back finds the newest earlier entry with its blob.
  const blobs = groups.map((g) => g.commits[g.commits.length - 1].blob);
  let lastApproval = -1;
  for (let i = 0; i < out.length; i++) if (out[i].kind === "approval") lastApproval = i;
  for (let i = 0; i < out.length; i++) {
    const e = out[i];
    if (e.kind === "answers" && i > lastApproval) e.unapproved = true;
    if (e.kind === "goBack" && blobs[i] !== null) {
      for (let j = i - 1; j >= 0; j--) {
        if (blobs[j] !== blobs[i]) continue;
        e.back = out[j].kind === "approval" ? { version: out[j].version } : { at: out[j].at };
        break;
      }
    }
    e.label = englishLabel(e);
  }
  return out.reverse();
}

function englishLabel(e: TimelineEntry): string {
  if (e.deleted) return "Deleted";
  switch (e.kind) {
    case "task":
      return e.commits.length === 1 ? "1 change" : `${e.commits.length} changes`;
    case "answers":
      return `Your answers (${e.commits.length})`;
    case "approval":
      return `v${e.version} approved`;
    case "outside":
      return "Changed outside the app";
    case "goBack":
      if (e.back?.version !== undefined) return `Went back to v${e.back.version}`;
      if (e.back?.at !== undefined) return `Went back to the version of ${e.back.at}`;
      return "Went back to an earlier version";
  }
}
