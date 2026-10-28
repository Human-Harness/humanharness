import { readAnswer } from "@humanharness/harness-sdk";
import type { MockBlock, MockNote, MockTurn, MockUsage, MockWrite, Recording } from "./mock";

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
  usage: MockUsage;
  delayMs: number;
}

/**
 * The app's fixed prompts start with these (CLOSE_PROMPT, CHECKPOINT_PROMPT, PHASE_PROMPT and WRAP_UP_PROMPT in the
 * shell's task-prompts.ts; a shell test pins them).
 */
export function promptKind(prompt: string): "close" | "checkpoint" | "phase" | "wrap-up" | "reply" {
  if (prompt.startsWith("We are closing this topic.")) return "close";
  if (prompt.startsWith("Checkpoint:")) return "checkpoint";
  if (prompt.startsWith("Next part of this task:")) return "phase";
  if (prompt.startsWith("Time is almost up:")) return "wrap-up";
  return "reply";
}

/**
 * The sentence that opens the "how to end" part of a background job's first message (shell `jobFirstMessage` in
 * jobs/job-prompt.ts; a copy: fake-agent never imports the shell; shell job-prompt.test pins it).
 */
export const MOCK_JOB_MARK = "This is a background job: nobody reads this conversation and nobody can answer.";
/** What a job's turn reports in mock mode (parallel part 3 Decision 10): tests that need another result use scripts. */
export const MOCK_JOB_RESULT = { status: "ok", summary: "Mock run" } as const;

/** A background job's turn: a line of the prompt starts with the mark (the brief comes first, so not the prompt's start). */
export const isMockJobTurn = (prompt: string): boolean => prompt.split("\n").some((line) => line.startsWith(MOCK_JOB_MARK));

/** The phase id a phase change prompt names: its first line ends with (`<id>`). */
const phaseOfPrompt = (prompt: string): string | undefined => /^Next part of this task: .*\(`([a-z][a-z0-9_-]{0,63})`\)/.exec(prompt)?.[1];

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
    usage: turn.usage ?? FALLBACK_USAGE,
    delayMs: turn.delayMs ?? DEFAULT_DELAY,
  };
}

const quiet = (text: string, blocks: MockBlock[] = [], note?: MockNote): Play => ({
  text,
  blocks,
  ...(note ? { note } : {}),
  writes: [],
  usage: FALLBACK_USAGE,
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

/**
 * One engine turn of mock mode. `newSession`: the run opened a session (`--session-id`), so the prompt is a
 * task's first message and picks the recording; otherwise `position` says where the session is.
 */
export function replay(recordings: Recording[], position: SessionPosition | undefined, prompt: string, newSession: boolean): { play: Play; session: SessionPosition } {
  // A job's turn never plays a recording, whatever its brief names: it reports the canned result and ends.
  if (isMockJobTurn(prompt)) {
    return { play: { ...quiet(""), blocks: [{ tool: "job_result", input: { ...MOCK_JOB_RESULT } }] }, session: position ?? { action: null, turn: null } };
  }
  if (newSession || !position) {
    // `!newSession && !position` (a lost state file) is treated as a first message too.
    // The longest match wins, so "# Topic: engines" never shadows "# Topic: engines and more".
    const rec = [...recordings].sort((a, b) => b.match.length - a.match.length).find((r) => prompt.includes(r.match));
    const turn = rec && firstTurn(rec);
    if (!rec || !turn) return { play: quiet(rec?.fallback?.text ?? DEFAULT_FALLBACK), session: { action: rec?.action ?? null, turn: null } };
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
  return { play: quiet(rec?.fallback?.text ?? DEFAULT_FALLBACK, choicesOf(current)), session: position };
}
