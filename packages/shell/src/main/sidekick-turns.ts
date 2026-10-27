import { z } from "@humanharness/harness-sdk";
import type { SidekickFlag } from "@humanharness/workspace";

/** The first line of every pre-send turn (mock mode and the e2e scripts match on it). */
export const SIDEKICK_PRE_MARK = "Sidekick: pre-send review";

export interface PreSendInput {
  harness: { name: string; tagline?: string };
  phase?: { label: string; brief?: string };
  /** The scope's note titles (latest first), at most 20. */
  notes: readonly string[];
  /** The data tables the task agent sees. */
  data: readonly string[];
  flags: readonly SidekickFlag[];
  /** The app's UI language, by name ("English"); the brief's rules answer in it. */
  uiLanguage: string;
  prompt: string;
}

const list = (items: readonly string[]) => (items.length ? items.map((i) => `- ${i}`) : ["- (none)"]);

/** The per-turn context (spec §5): compact, never the task's history. */
export function preSendPrompt(i: PreSendInput): string {
  return [
    SIDEKICK_PRE_MARK,
    "",
    `App: ${i.harness.name}${i.harness.tagline ? ` — ${i.harness.tagline}` : ""}`,
    ...(i.phase ? [`Open phase: ${i.phase.label}${i.phase.brief ? ` — ${i.phase.brief.split("\n")[0]}` : ""}`] : []),
    "Notes in this scope:",
    ...list(i.notes.slice(0, 20)),
    "Data tables:",
    ...list(i.data),
    i.flags.length ? "Local flags:" : "Local flags: none (the person asked for a review)",
    ...i.flags.map((f) => `- ${f.kind}: "${f.match}" at [${f.span[0]}, ${f.span[1]}]`),
    `UI language: ${i.uiLanguage}`,
    "",
    "<prompt>",
    i.prompt,
    "</prompt>",
    "",
    // Spike A3 measured the JSON reliability with this line: keep it. Haiku echoes the prompt as `rewrite` on a send unless told not to.
    'Answer with the JSON object only: {"verdict":"send"|"suggest","issues":[{"kind":"vague"|"missing-context"|"two-asks"|"off-phase"|"other","text":string,"span":[start,end]?}],"rewrite":string?,"queued":string[]?,"confidence":number 0..1}. Omit "rewrite" when the verdict is "send".',
  ].join("\n");
}

export const reviewSchema = z.object({
  verdict: z.enum(["send", "suggest"]),
  issues: z
    .array(
      z.object({
        kind: z.enum(["vague", "missing-context", "two-asks", "off-phase", "other"]),
        text: z.string().min(1).max(400),
        span: z.tuple([z.number().int().min(0), z.number().int().min(0)]).optional(),
      }),
    )
    .max(6)
    .default([]),
  rewrite: z.string().min(1).max(8000).optional(),
  queued: z.array(z.string().min(1).max(4000)).max(5).optional(),
  confidence: z.number().min(0).max(1),
});
export type SidekickReviewReply = z.output<typeof reviewSchema>;

/**
 * The reply, parsed (spec §4.1 step 3); null when it isn't the contract. Fences and prose around one object are dropped.
 * A `rewrite` equal to `prompt` (trimmed) is the model echoing it and is dropped.
 */
export function parseReview(text: string, prompt?: string): SidekickReviewReply | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  const parsed = reviewSchema.safeParse(raw);
  if (!parsed.success) return null;
  let r = parsed.data;
  if (r.rewrite !== undefined && prompt !== undefined && r.rewrite.trim() === prompt.trim()) {
    const { rewrite: _echo, ...rest } = r;
    r = rest;
  }
  // Nothing to show is a send.
  if (r.verdict === "suggest" && !r.rewrite && r.issues.length === 0 && !r.queued?.length) return { ...r, verdict: "send" };
  return r;
}
