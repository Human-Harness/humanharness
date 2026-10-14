import type { MockBlock, MockNote, MockTurn, MockUsage, MockWrite, Recording } from "./mock";

/** Played when a reply isn't recorded and the recording has no `fallback` (spec 3e §2). */
export const DEFAULT_FALLBACK = "Respuesta no grabada en esta prueba · Not recorded in this test.";
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
 * The app's fixed prompts start with these (CLOSE_PROMPT and CHECKPOINT_PROMPT in the shell's
 * task-prompts.ts; a shell test pins them).
 */
export function promptKind(prompt: string): "close" | "checkpoint" | "reply" {
  if (prompt.startsWith("We are closing this topic.")) return "close";
  if (prompt.startsWith("Checkpoint:")) return "checkpoint";
  return "reply";
}

const defaultNote = (action: string): MockNote => ({ title: action, summary: ["Recorded test run"], decisions: [], files: [], open: [] });
const firstTurn = (r: Recording) => r.turns.find((t) => t.id !== "close");
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

/**
 * One engine turn of mock mode. `newSession`: the run opened a session (`--session-id`), so the prompt is a
 * task's first message and picks the recording; otherwise `position` says where the session is.
 */
export function replay(recordings: Recording[], position: SessionPosition | undefined, prompt: string, newSession: boolean): { play: Play; session: SessionPosition } {
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
  const current = rec?.turns.find((t) => t.id === position.turn);
  const key = current ? replyKey(current, prompt) : undefined;
  const target = current?.next && ((key !== undefined && Object.hasOwn(current.next, key) ? current.next[key] : undefined) ?? current.next["*"]);
  const turn = target ? rec?.turns.find((t) => t.id === target) : undefined;
  if (turn) return { play: playTurn(turn), session: { ...position, turn: turn.id } };
  return { play: quiet(rec?.fallback?.text ?? DEFAULT_FALLBACK, choicesOf(current)), session: position };
}
