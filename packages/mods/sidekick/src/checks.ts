/** What the local check flags (sidekick spec §4.1). The model adds `other`. */
export type SidekickFlagKind = "vague" | "missing-context" | "two-asks" | "off-phase";
export const SIDEKICK_FLAG_KINDS: readonly SidekickFlagKind[] = ["vague", "missing-context", "two-asks", "off-phase"];

export interface SidekickFlag {
  kind: SidekickFlagKind;
  /** The words that raised it, as typed. */
  match: string;
  /** [start, end) in the prompt, for the underline in the composer. */
  span: [number, number];
}

export interface CheckContext {
  /** Below this many words a vague word is flagged even beside something concrete. */
  minWords: number;
  /** Titles a reference may point at: the scope's note titles and the data tables the agent sees. */
  known: readonly string[];
  /** The open task's phases, when its action has them. */
  phases?: { open: { id: string; label: string }; others: readonly { id: string; label: string }[] };
  /** Kinds the person muted (part 2). */
  muted?: readonly SidekickFlagKind[];
}

// English lists (spec §12 Q2: other languages come with the language spec's agentic translation).
const VAGUE = ["better", "improve", "fix it", "fix this", "the stuff", "stuff", "etc", "something", "things", "make it good", "clean it up", "whatever", "nicer"];
const REFERENCES = ["that file", "this file", "the file", "the sources", "the source", "like before", "as before", "the document", "the doc", "that one", "the other one", "the previous one", "what we discussed", "the usual"];
const VERBS = new Set([
  "add", "analyze", "build", "change", "check", "compare", "create", "delete", "describe", "draft", "edit", "explain", "find", "fix",
  "generate", "list", "make", "move", "outline", "plan", "read", "remove", "rename", "review", "rewrite", "run", "search", "send",
  "show", "summarize", "test", "translate", "update", "write",
]);
const STOP = new Set(["with", "from", "into", "that", "this", "your", "their", "about", "phase", "step", "final", "first"]);
const JOINERS = /\band also\b|\band then\b|\n+/giu;

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Whole words or phrases in any script: letters and digits on either side don't count. */
const wordRe = (phrase: string) => new RegExp(`(?<![\\p{L}\\p{N}])${escape(phrase).replace(/ /g, "\\s+")}(?![\\p{L}\\p{N}])`, "iu");

function find(prompt: string, phrases: readonly string[]): { match: string; span: [number, number] } | null {
  let best: { match: string; span: [number, number] } | null = null;
  for (const phrase of phrases) {
    const m = wordRe(phrase).exec(prompt);
    if (m && (!best || m.index < best.span[0])) best = { match: m[0], span: [m.index, m.index + m[0].length] };
  }
  return best;
}

const words = (s: string): string[] => s.match(/[\p{L}\p{N}]+/gu) ?? [];

/**
 * A number, a quoted phrase, a path or file name, inline code or a URL: something the model can hold on to.
 * Only paired quotes count (a contraction's `'` is not a quote), and a file name needs at least two characters
 * before its dot, so "e.g." and "i.e." are not file names.
 */
const CONCRETE = new RegExp(
  [
    String.raw`\p{N}`,
    String.raw`"[^"\n]+"`,
    String.raw`“[^”\n]+”`,
    String.raw`«[^»\n]+»`,
    String.raw`(?<![\p{L}\p{N}])'[^'\n]+'(?![\p{L}\p{N}])`,
    "`[^`\\n]+`",
    String.raw`[\\/]`,
    String.raw`[\p{L}\p{N}_-]{2,}\.[a-z0-9]{1,5}(?![\p{L}\p{N}])`,
    "https?:",
  ].join("|"),
  "iu",
);
function concrete(prompt: string): boolean {
  return CONCRETE.test(prompt);
}

function namesKnown(prompt: string, known: readonly string[]): boolean {
  const lower = prompt.toLowerCase();
  return known.some((title) => title.trim().length > 2 && lower.includes(title.trim().toLowerCase()));
}

function labelWords(label: string): string[] {
  return words(label.toLowerCase()).filter((w) => w.length >= 4 && !STOP.has(w));
}

function vague(prompt: string, ctx: CheckContext): SidekickFlag | null {
  const hit = find(prompt, VAGUE);
  if (!hit) return null;
  return words(prompt).length < ctx.minWords || !concrete(prompt) ? { kind: "vague", ...hit } : null;
}

function missingContext(prompt: string, ctx: CheckContext): SidekickFlag | null {
  const hit = find(prompt, REFERENCES);
  if (!hit || concrete(prompt) || namesKnown(prompt, ctx.known)) return null;
  return { kind: "missing-context", ...hit };
}

function twoAsks(prompt: string): SidekickFlag | null {
  const parts: { text: string; joiner?: { match: string; span: [number, number] } }[] = [];
  let last = 0;
  for (const m of prompt.matchAll(JOINERS)) {
    parts.push({ text: prompt.slice(last, m.index), joiner: { match: m[0], span: [m.index, m.index + m[0].length] } });
    last = m.index + m[0].length;
  }
  parts.push({ text: prompt.slice(last) });
  const imperative = (s: string) => VERBS.has((words(s)[0] ?? "").toLowerCase());
  for (let i = 0; i + 1 < parts.length; i++) {
    if (imperative(parts[i].text) && imperative(parts[i + 1].text)) {
      const j = parts[i].joiner!;
      // A bare new line shows no text: underline the second clause's first word instead.
      if (j.match.trim() === "") {
        const start = j.span[1];
        const first = words(parts[i + 1].text)[0] ?? "";
        return { kind: "two-asks", match: first, span: [start, start + first.length] };
      }
      return { kind: "two-asks", ...j };
    }
  }
  return null;
}

function offPhase(prompt: string, ctx: CheckContext): SidekickFlag | null {
  if (!ctx.phases) return null;
  const own = labelWords(ctx.phases.open.label);
  if (find(prompt, own)) return null;
  for (const other of ctx.phases.others) {
    const hit = find(prompt, labelWords(other.label));
    if (hit) return { kind: "off-phase", ...hit };
  }
  return null;
}

/** The deterministic check (spec §4.1): 0 tokens, under 50 ms. At most one flag per kind, in a fixed order. */
export function localCheck(prompt: string, ctx: CheckContext): SidekickFlag[] {
  const muted = new Set(ctx.muted ?? []);
  const flags = [vague(prompt, ctx), missingContext(prompt, ctx), twoAsks(prompt), offPhase(prompt, ctx)];
  return flags.filter((f): f is SidekickFlag => f !== null && !muted.has(f.kind));
}
