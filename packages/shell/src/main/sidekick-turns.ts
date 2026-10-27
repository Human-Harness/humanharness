import { z } from "@humanharness/harness-sdk";
import { type SidekickFlag, estimateTokens } from "@humanharness/workspace";

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
    ...i.flags.map((f) => `- ${f.kind}: ${JSON.stringify(f.match)} at [${f.span[0]}, ${f.span[1]}]`),
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
        span: z
          .tuple([z.number().int().min(0), z.number().int().min(0)])
          .refine(([start, end]) => start <= end, "span start after its end")
          .optional(),
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
  let r = parseJson(text, reviewSchema);
  if (!r) return null;
  if (r.rewrite !== undefined && prompt !== undefined && r.rewrite.trim() === prompt.trim()) {
    const { rewrite: _echo, ...rest } = r;
    r = rest;
  }
  // Nothing to show is a send.
  if (r.verdict === "suggest" && !r.rewrite && r.issues.length === 0 && !r.queued?.length) return { ...r, verdict: "send" };
  return r;
}

/** Shared by every JSON reply: the object between the first "{" and the last "}", parsed with `schema`; null otherwise. */
export function parseJson<T>(text: string, schema: z.ZodType<T>): T | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const r = schema.safeParse(JSON.parse(text.slice(start, end + 1)));
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}

/** The first line of every after-reply turn (mock mode and the e2e scripts match on it). */
export const SIDEKICK_AFTER_MARK = "Sidekick: after the reply";
/** How much of the task's reply an after-reply turn reads (spec §4.2). */
export const SIDEKICK_REPLY_TOKENS = 1500;

/** The reply cut to about `maxTokens` (spec §4.2): its head and tail, plus every heading in between. */
export function cutReply(reply: string, maxTokens: number = SIDEKICK_REPLY_TOKENS): string {
  if (estimateTokens(reply) <= maxTokens) return reply;
  const chars = maxTokens * 4;
  const head = reply.slice(0, Math.floor(chars * 0.45));
  const tail = reply.slice(-Math.floor(chars * 0.45));
  const middle = reply.slice(head.length, reply.length - tail.length);
  const headings = middle.split("\n").filter((l) => /^#{1,6}\s/.test(l));
  return [head, "[…]", ...headings, "[…]", tail].join("\n");
}

export interface AfterInput {
  harness: { name: string; tagline?: string };
  phase?: { label: string; brief?: string };
  prompt: string;
  reply: string;
  /** The task's earlier prompts, oldest first; the last three first lines go in. */
  lastPrompts: readonly string[];
  uiLanguage: string;
  /** The scope's purpose text for this sidekick (§2a.4), when any. */
  purposeText?: string;
}

/** The after-reply turn (spec §4.2): the person's prompt and the cut reply, never the task's history. */
export function afterReplyPrompt(i: AfterInput): string {
  return [
    SIDEKICK_AFTER_MARK,
    "",
    `App: ${i.harness.name}${i.harness.tagline ? ` — ${i.harness.tagline}` : ""}`,
    ...(i.phase ? [`Open phase: ${i.phase.label}${i.phase.brief ? ` — ${i.phase.brief.split("\n")[0]}` : ""}`] : []),
    ...(i.purposeText ? [`Scope purpose: ${i.purposeText}`] : []),
    "Earlier prompts (first lines):",
    ...list(i.lastPrompts.slice(-3).map((p) => p.split("\n")[0])),
    `UI language: ${i.uiLanguage}`,
    "",
    "<prompt>",
    i.prompt,
    "</prompt>",
    "<reply>",
    cutReply(i.reply),
    "</reply>",
    "",
    'Answer with the JSON object only: {"gap":{"title":string,"text":string}?,"next":string?,"repeated":{"topic":string,"decision":string}?}. Leave out what you have nothing useful for; {} is a fine answer.',
  ].join("\n");
}

export const afterSchema = z.object({
  gap: z.object({ title: z.string().min(1).max(80), text: z.string().min(1).max(400) }).optional(),
  next: z.string().min(1).max(4000).optional(),
  repeated: z.object({ topic: z.string().min(1).max(80), decision: z.string().min(1).max(400) }).optional(),
});
export type SidekickAfter = z.output<typeof afterSchema>;

/** The after-reply reply, parsed; null when it isn't the contract. */
export const parseAfter = (text: string): SidekickAfter | null => parseJson(text, afterSchema);

/** The first line of every learning turn (mock mode and the e2e scripts match on it). */
export const SIDEKICK_LEARN_MARK = "Sidekick: learn";
/** The new events a learning turn needs (spec §6.4). */
export const SIDEKICK_LEARN_MIN = 5;

export interface LearnInput {
  /** The learned items, with their ids; `source: "person"` items are the person's own. */
  items: readonly { id: string; text: string; level: string; source: string }[];
  /** The events since the last update, oldest first. */
  events: readonly { kind: string; outcome: string; moment: string; sidekick: string }[];
}

/** The learning turn (spec §6.4): what Sidekick knows and what the person did since, for at most 3 changes. */
export function learnPrompt(i: LearnInput): string {
  return [
    SIDEKICK_LEARN_MARK,
    "",
    "What you know about the person (ids in brackets; items marked (person) are theirs: never change or remove them):",
    ...(i.items.length ? i.items.map((it) => `- [${it.id}] (${it.source === "person" ? "person" : it.level}) ${it.text}`) : ["- (nothing yet)"]),
    "What they did with your suggestions since then:",
    ...i.events.map((e) => `- ${e.moment} ${e.kind} → ${e.outcome}`),
    "",
    'Answer with the JSON object only: {"add":[{"text":string,"level":"you"|"harness","kind":string?}],"update":[{"id":string,"text":string}],"remove":[string]}. "you": about the person in general; "harness": how they work in this app. One short sentence per item; at most 3 changes; {} when nothing changes.',
  ].join("\n");
}

export const learnSchema = z.object({
  add: z
    .array(z.object({ text: z.string().min(1).max(300), level: z.enum(["you", "harness"]), kind: z.string().max(40).optional() }))
    .max(3)
    .default([]),
  update: z
    .array(z.object({ id: z.string().min(1).max(80), text: z.string().min(1).max(300) }))
    .max(3)
    .default([]),
  remove: z.array(z.string().min(1).max(80)).max(3).default([]),
});
export type SidekickLearn = z.output<typeof learnSchema>;

/** The learning reply, parsed; null when it isn't the contract. */
export const parseLearn = (text: string): SidekickLearn | null => parseJson(text, learnSchema);
