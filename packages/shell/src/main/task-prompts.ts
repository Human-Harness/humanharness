import type { Language } from "@humanharness/harness-sdk";

const LANGUAGE_NAMES: Record<Language, string> = { es: "Spanish", en: "English" };

/** The first message of a free-question task (a question that isn't one of the harness's actions). */
export const QUESTION_PROMPT = [
  "The person asked a question that is not one of the guided topics. Answer it in {{language}}, reading only what you need, then end with `show_choices`.",
  "",
  "{{notesIndex}}",
  "",
  "## Question",
  "{{question}}",
].join("\n");

/** The fixed core prompt of a task's closing turn. */
export const CLOSE_PROMPT =
  "We are closing this topic. Call the `save_note` tool once with what this conversation made clear: a short title, at most 5 summary points, the decisions taken, the files that back them and the questions left open. Do not write any file yourself and do not call `show_choices`. Then reply with one short sentence.";

/**
 * Fills `{{language}}`, `{{notesIndex}}` and `{{question}}` in one pass (inserted text is never filled
 * again). A brief without `{{notesIndex}}` gets the index appended, so every new session starts with it.
 */
export function fillPrompt(template: string, vars: { language: Language; notesIndex: string; question?: string }): string {
  const values: Record<string, string> = {
    language: LANGUAGE_NAMES[vars.language],
    notesIndex: vars.notesIndex,
    ...(vars.question !== undefined ? { question: vars.question } : {}),
  };
  const hasIndex = /\{\{\s*notesIndex\s*\}\}/.test(template);
  const filled = template
    .replace(/\{\{\s*(\w+)\s*\}\}/g, (all, key: string) => (Object.hasOwn(values, key) ? values[key] : all))
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return hasIndex || !vars.notesIndex ? filled : `${filled}\n\n${vars.notesIndex}`;
}
