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
 * again). Only the template is tidied, before filling: a line holding just a placeholder whose value is
 * empty goes away and blank runs collapse; inserted text stays exactly as given. A brief without
 * `{{notesIndex}}` gets the index appended, so every new session starts with it. An unknown language reads as English.
 */
export function fillPrompt(template: string, vars: { language: Language; notesIndex: string; question?: string }): string {
  const values: Record<string, string> = {
    language: Object.hasOwn(LANGUAGE_NAMES, vars.language) ? LANGUAGE_NAMES[vars.language] : LANGUAGE_NAMES.en,
    notesIndex: vars.notesIndex,
    ...(vars.question !== undefined ? { question: vars.question } : {}),
  };
  const hasIndex = /\{\{\s*notesIndex\s*\}\}/.test(template);
  const tidy = template
    .split("\n")
    .filter((line) => {
      const only = /^\s*\{\{\s*(\w+)\s*\}\}\s*$/.exec(line);
      return !(only && Object.hasOwn(values, only[1]) && values[only[1]] === "");
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const filled = tidy.replace(/\{\{\s*(\w+)\s*\}\}/g, (all, key: string) => (Object.hasOwn(values, key) ? values[key] : all));
  return hasIndex || !vars.notesIndex ? filled : `${filled}\n\n${vars.notesIndex}`;
}

/** The quiet turn that saves what matters before the context reaches the task's cap (resources spec §6). */
export const CHECKPOINT_PROMPT =
  "Checkpoint: this conversation is getting long. Call the `save_note` tool once with what is clear so far: a short title, at most 5 summary points, the decisions taken, the files that back them and the questions still open. Do not write any file yourself and do not call `show_choices`. Then reply with one short sentence; the conversation goes on after this.";

/**
 * The line a resumed task's first message carries. Neutral on purpose: the session is also lost after a move
 * that failed (the runtime closes before moving), so it never says the folder moved.
 */
export const RESUME_PROMPT =
  "The earlier conversation of this topic is not available; continue from the notes and the files in the folder. Answer in {{language}}, then end with `show_choices`.";

/**
 * The first message of a task whose engine session was lost (spec 3d §2): what the task is (the action's
 * brief, filled as at its start, or the question that opened it), the resume line, the notes index and the
 * person's message. Inserted text (brief, question, message) is never filled again.
 */
export function resumeMessage(vars: { language: Language; notesIndex: string; brief?: string; question?: string; message: string }): string {
  const line = fillPrompt(RESUME_PROMPT, { language: vars.language, notesIndex: "" });
  const head =
    vars.brief !== undefined
      ? [fillPrompt(vars.brief, { language: vars.language, notesIndex: vars.notesIndex }), line]
      : [line, ...(vars.notesIndex ? [vars.notesIndex] : []), ...(vars.question ? [`## The question that opened this topic\n${vars.question}`] : [])];
  return [...head, `## The person's message\n${vars.message}`].join("\n\n");
}
