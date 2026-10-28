import { readAnswer } from "@humanharness/harness-sdk";
import { type MockBlock, type MockNote, type MockTurn, type MockUsage, type MockWrite, type Recording, folderRelative } from "./mock";

/** Played when a reply isn't recorded and the recording has no `fallback` (spec 3e §2). */
export const DEFAULT_FALLBACK = "Not recorded in this test.";
const FALLBACK_USAGE: MockUsage = { input: 400, output: 20, cacheRead: 0, cacheWrite: 0 };
const DEFAULT_DELAY = 600;

/** Where one engine session is: its recording's action and the last turn played (null: none matched). */
export interface SessionPosition {
  action: string | null;
  turn: string | null;
}

/** What the fake prints and does for one engine turn. */
export interface Play {
  text: string;
  blocks: MockBlock[];
  note?: MockNote;
  writes: MockWrite[];
  /** Folder-relative paths the turn reads (context-panel spec §7). */
  reads: string[];
  usage: MockUsage;
  delayMs: number;
}

/**
 * The app's fixed prompts start with these (CLOSE_PROMPT, CHECKPOINT_PROMPT, PHASE_PROMPT, WRAP_UP_PROMPT and
 * CONTEXT_ADD_PROMPT in the shell's task-prompts.ts; a shell test pins them).
 */
export function promptKind(prompt: string): "close" | "checkpoint" | "phase" | "wrap-up" | "context-add" | "reply" {
  if (prompt.startsWith("We are closing this topic.")) return "close";
  if (prompt.startsWith("Checkpoint:")) return "checkpoint";
  if (phasePrompt(prompt) !== undefined) return "phase";
  if (prompt.startsWith("Time is almost up:")) return "wrap-up";
  if (afterKept(prompt, CONTEXT_ADD_START) !== undefined) return "context-add";
  return "reply";
}

const PHASE_START = "Next part of this task:";
const CONTEXT_ADD_START = "The person wants you to take `";
/** The only line the app keeps for a task today (task-manager.ts `documentApproved`). */
const KEPT_LINE = "The person approved ";
/**
 * The app's prompt that starts with `start` in `prompt`: at its start, or after the lines the app kept for the task
 * (review spec §5.4), which are one block of single lines followed by a blank line.
 */
function afterKept(prompt: string, start: string): string | undefined {
  if (prompt.startsWith(start)) return prompt;
  const gap = prompt.indexOf("\n\n");
  if (gap === -1 || !prompt.startsWith(start, gap + 2)) return undefined;
  return prompt
    .slice(0, gap)
    .split("\n")
    .every((line) => line.startsWith(KEPT_LINE))
    ? prompt.slice(gap + 2)
    : undefined;
}

/** The phase change prompt in `prompt`, after any kept lines. */
const phasePrompt = (prompt: string): string | undefined => afterKept(prompt, PHASE_START);

/** The path the Add now prompt names: up to the next backtick, on one line, inside the folder. */
function addedPath(prompt: string): string | undefined {
  const rest = (afterKept(prompt, CONTEXT_ADD_START) ?? "").slice(CONTEXT_ADD_START.length);
  const end = rest.indexOf("`");
  const p = end > 0 ? rest.slice(0, end) : "";
  return p && !p.includes("\n") && folderRelative.safeParse(p).success ? p : undefined;
}

/** The phase id a phase change prompt names: its first line ends with (`<id>`). */
const phaseOfPrompt = (prompt: string): string | undefined => /^Next part of this task: .*\(`([a-z][a-z0-9_-]{0,63})`\)/.exec(phasePrompt(prompt) ?? "")?.[1];

const defaultNote = (action: string): MockNote => ({ title: action, summary: ["Recorded test run"], decisions: [], files: [], open: [] });
/** A setPhase or timeUp turn answers the app's own prompt, never a first message or a reply. */
const firstTurn = (r: Recording) => r.turns.find((t) => t.id !== "close" && !t.setPhase && !t.timeUp);
const closeNote = (r: Recording) => r.turns.find((t) => t.id === "close")?.note ?? defaultNote(r.action);
/** The options of every `show_choices` block, in order: what the person can pick. */
export function choiceOptions(blocks: MockBlock[]): { label: string; followUp?: string }[] {
  return blocks
    .filter((b) => b.tool === "show_choices")
    .flatMap((b) => (Array.isArray(b.input.options) ? (b.input.options as { label?: unknown; followUp?: unknown }[]) : []))
    .filter((o): o is { label: string; followUp?: string } => typeof o.label === "string")
    .map((o) => ({ label: o.label, ...(typeof o.followUp === "string" ? { followUp: o.followUp } : {}) }));
}

/** The labels a turn's choices offer: the keys its `next` may use. */
export const choiceLabels = (blocks: MockBlock[]): string[] => choiceOptions(blocks).map((o) => o.label);

const choicesOf = (turn: MockTurn | undefined) => turn?.blocks.filter((b) => b.tool === "show_choices") ?? [];

function playTurn(turn: MockTurn): Play {
  return {
    text: turn.text,
    blocks: turn.blocks,
    ...(turn.note ? { note: turn.note } : {}),
    writes: turn.writes,
    reads: turn.reads ?? [],
    usage: turn.usage ?? FALLBACK_USAGE,
    delayMs: turn.delayMs ?? DEFAULT_DELAY,
  };
}

/**
 * A built-in reply. `usage`: the recorded turn the session stays at, when it has one, so the context the app sees
 * doesn't fall to the fallback's and read as a compaction.
 */
const quiet = (text: string, blocks: MockBlock[] = [], note?: MockNote, usage?: MockUsage): Play => ({
  text,
  blocks,
  ...(note ? { note } : {}),
  writes: [],
  reads: [],
  usage: usage ?? FALLBACK_USAGE,
  delayMs: DEFAULT_DELAY / 2,
});

/** The label a reply stands for: the option whose followUp (or, without one, label) is the reply. */
function replyKey(turn: MockTurn, prompt: string): string | undefined {
  const reply = prompt.trim();
  return choiceOptions(turn.blocks).find((o) => (o.followUp?.trim() ? o.followUp.trim() : o.label.trim()) === reply)?.label;
}

/** The same JSON, key order aside. */
function canonical(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonical);
  if (typeof v === "object" && v !== null) {
    return Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical((v as Record<string, unknown>)[k])]));
  }
  return v;
}
const sameJson = (a: unknown, b: unknown) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

/** The turn a recorded answer leads to: the prompt carries an answer (its json fence) equal to one the turn recorded. */
function answerTarget(turn: MockTurn, prompt: string): string | undefined {
  const answer = readAnswer(prompt);
  return answer ? turn.respond?.find((r) => r.block === answer.block && sameJson(r.value, answer.value))?.next : undefined;
}

/** A harness action and the line its brief always puts in the task's first message (`briefMatch`, as `--record` writes). */
export interface ActionMatch {
  action: string;
  match: string;
}

/** The longest `match` in `prompt`, so "# Topic: engines" never shadows "# Topic: engines and more". */
const longestMatch = <T extends { match: string }>(items: readonly T[], prompt: string): T | undefined =>
  [...items].filter((i) => i.match.trim()).sort((a, b) => b.match.length - a.match.length).find((i) => prompt.includes(i.match));

/**
 * One engine turn of mock mode. `newSession`: the run opened a session (`--session-id`), so the prompt is a
 * task's first message and picks the recording; otherwise `position` says where the session is. `actions`: the
 * harness's actions by their brief's match, so a task of an action with no recording still knows its action
 * (its closing note is titled after it); a free question matches none.
 */
export function replay(
  recordings: Recording[],
  position: SessionPosition | undefined,
  prompt: string,
  newSession: boolean,
  actions: readonly ActionMatch[] = [],
): { play: Play; session: SessionPosition } {
  if (newSession || !position) {
    // `!newSession && !position` (a lost state file) is treated as a first message too.
    const rec = longestMatch(recordings, prompt);
    const turn = rec && firstTurn(rec);
    const action = rec?.action ?? longestMatch(actions, prompt)?.action ?? null;
    if (!rec || !turn) return { play: quiet(rec?.fallback?.text ?? DEFAULT_FALLBACK), session: { action, turn: null } };
    return { play: playTurn(turn), session: { action: rec.action, turn: turn.id } };
  }
  const rec = recordings.find((r) => r.action === position.action);
  const kind = promptKind(prompt);
  if (kind === "close") {
    const close = rec?.turns.find((t) => t.id === "close");
    if (close && rec) return { play: playTurn({ ...close, blocks: [], note: close.note ?? defaultNote(rec.action) }), session: position };
    return { play: quiet("", [], defaultNote(position.action ?? "question")), session: position };
  }
  if (kind === "checkpoint") return { play: quiet("", [], rec ? closeNote(rec) : defaultNote(position.action ?? "question")), session: position };
  // "Add now" (context-panel spec §5.2) is the app's prompt: a built-in reply that reads the file; the session stays,
  // and the turn's choices come back, as after an off-script reply, so the walk goes on.
  if (kind === "context-add") {
    const p = addedPath(prompt);
    const text = p ? `I read ${p} and will take it into account.` : (rec?.fallback?.text ?? DEFAULT_FALLBACK);
    const current = rec?.turns.find((t) => t.id === position.turn);
    return { play: { ...quiet(text, choicesOf(current), undefined, current?.usage), reads: p ? [p] : [] }, session: position };
  }
  // A phase change or the wrap-up is the app's prompt, not a reply: it plays the turn recorded for it (spec §6).
  if (kind === "phase" || kind === "wrap-up") {
    const id = kind === "phase" ? phaseOfPrompt(prompt) : undefined;
    const turn = rec?.turns.find((t) => (kind === "phase" ? id !== undefined && t.setPhase === id : t.timeUp === true));
    if (turn) return { play: playTurn(turn), session: { ...position, turn: turn.id } };
    return { play: quiet(rec?.fallback?.text ?? DEFAULT_FALLBACK), session: position };
  }
  const current = rec?.turns.find((t) => t.id === position.turn);
  const key = current ? replyKey(current, prompt) : undefined;
  const answered = current ? answerTarget(current, prompt) : undefined;
  const target = answered ?? (current?.next && ((key !== undefined && Object.hasOwn(current.next, key) ? current.next[key] : undefined) ?? current.next["*"]));
  const turn = target ? rec?.turns.find((t) => t.id === target) : undefined;
  if (turn) return { play: playTurn(turn), session: { ...position, turn: turn.id } };
  return { play: quiet(rec?.fallback?.text ?? DEFAULT_FALLBACK, choicesOf(current), undefined, current?.usage), session: position };
}
