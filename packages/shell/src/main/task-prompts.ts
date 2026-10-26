import { type Language, languageName } from "@humanharness/harness-sdk";

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
  "We are closing this topic. Call the `save_note` tool once with what this conversation made clear: a short title, at most 5 summary points, the decisions taken, the files that back them and the questions left open. Write the note in English. Do not write any file yourself and do not call `show_choices`. Then reply with one short sentence.";

/** What the closing turn adds when the task used modes (task-modes spec §6): the note's summary says what each was good for. */
export const CLOSE_MODES = "Also list the modes used ({{modes}}) and what each was good for, as summary points.";

/** The closing turn's prompt: CLOSE_PROMPT, plus the modes used (their labels) when there were any (D0: exactly CLOSE_PROMPT). */
export function closePrompt(modes: readonly string[]): string {
  return modes.length === 0 ? CLOSE_PROMPT : `${CLOSE_PROMPT} ${CLOSE_MODES.replace("{{modes}}", () => modes.join(", "))}`;
}

/**
 * Fills `{{language}}`, `{{notesIndex}}` and `{{question}}` in one pass (inserted text is never filled
 * again). Only the template is tidied, before filling: a line holding just a placeholder whose value is
 * empty goes away and blank runs collapse; inserted text stays exactly as given. A brief without
 * `{{notesIndex}}` gets the index appended, so every new session starts with it. The language is named in English ("pt-BR" → "Brazilian Portuguese").
 */
export function fillPrompt(template: string, vars: { language: Language; notesIndex: string; question?: string }): string {
  const values: Record<string, string> = {
    language: languageName(vars.language),
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
  "Checkpoint: this conversation is getting long. Call the `save_note` tool once with what is clear so far: a short title, at most 5 summary points, the decisions taken, the files that back them and the questions still open. Write the note in English. Do not write any file yourself and do not call `show_choices`. Then reply with one short sentence; the conversation goes on after this.";

/** Said after a free question that tasks.json kept cut (it was longer than QUESTION_MAX). */
export const QUESTION_CUT = "(The question was longer; it was cut here.)";

/**
 * The line a resumed task's first message carries. Neutral on purpose: the session is also lost after a move
 * that failed (the runtime closes before moving), so it never says the folder moved.
 */
export const RESUME_PROMPT =
  "The earlier conversation of this topic is not available; continue from the notes and the files in the folder. Answer in {{language}}, then end with `show_choices`.";

/**
 * The first message of a task whose engine session was lost (spec 3d §2): what the task is (the action's
 * brief, filled as at its start, or the question that opened it), the resume line, the notes index and the
 * person's message. Inserted text (brief, question, message) is never filled again. A question kept cut
 * (`questionCut`) says so after it.
 */
export function resumeMessage(vars: {
  language: Language;
  notesIndex: string;
  brief?: string;
  question?: string;
  questionCut?: boolean;
  /** The current mode's section (modeSection), after the action's brief (task-modes spec §6). */
  mode?: string;
  message: string;
}): string {
  const line = fillPrompt(RESUME_PROMPT, { language: vars.language, notesIndex: "" });
  const question = vars.question ? `## The question that opened this topic\n${vars.question}${vars.questionCut ? `\n${QUESTION_CUT}` : ""}` : null;
  const head =
    vars.brief !== undefined
      ? [fillPrompt(vars.brief, { language: vars.language, notesIndex: vars.notesIndex }), ...(vars.mode ? [vars.mode] : []), line]
      : [line, ...(vars.notesIndex ? [vars.notesIndex] : []), ...(question ? [question] : [])];
  return [...head, `## The person's message\n${vars.message}`].join("\n\n");
}

/** A mode as a prompt carries it: its label, its brief (the file's text, not filled yet) and its settings' sentences. */
export interface ModeText {
  label: string;
  brief: string;
  settings: readonly string[];
}

/** The switch's first line (task-modes spec §5.4); `{{label}}` is the mode's label. */
export const MODE_PROMPT = 'From now on work in the mode "{{label}}". Keep everything decided so far in this conversation.';
/** The switch's last line. */
export const MODE_END = "Then continue with the person in this mode.";
/** The first message's ask for a recommendation (spec §4), with the action's modes after it. */
export const RECOMMEND_PROMPT =
  "Before you start the work, recommend how to work in this task: call `show_recommend_mode` with the mode that fits best, up to 3 short reasons and up to 2 alternatives, then end your answer and wait for the person's pick. Do not call `show_choices` in this answer.";

/** A mode's brief filled like an action's (`{{language}}`); it never gets the notes index: the session has it. */
const modeBrief = (brief: string, language: Language): string => fillPrompt(brief, { language, notesIndex: "" });
const settingLines = (settings: readonly string[]): string[] => (settings.length > 0 ? [settings.map((s) => `- ${s}`).join("\n")] : []);

/**
 * The switch's message (spec §5.4): one turn in the same session with the new mode's brief and settings. `soFar`: the
 * last checkpoint note's summary, when the task has one (spec §10.1). Inserted text is never filled again.
 */
export function modePrompt(mode: ModeText, vars: { language: Language; soFar?: readonly string[] }): string {
  return [
    MODE_PROMPT.replace("{{label}}", () => mode.label),
    ...(vars.soFar && vars.soFar.length > 0 ? [`What is clear so far (the last checkpoint): ${vars.soFar.join(" ")}`] : []),
    modeBrief(mode.brief, vars.language),
    ...settingLines(mode.settings),
    MODE_END,
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** What a task that starts (or resumes) in a mode carries after the action's brief (spec §3 `defaultMode`, §6). */
export function modeSection(mode: ModeText, language: Language): string {
  return [`## Mode: ${mode.label}`, "Work in this mode.", modeBrief(mode.brief, language), ...settingLines(mode.settings)].filter(Boolean).join("\n\n");
}

/** The first message's ask for a recommendation (spec §4): the action's modes with their hints, in this message only. */
export function recommendSection(modes: readonly { id: string; label: string; recommend?: string }[]): string {
  return ["## How to work", RECOMMEND_PROMPT, modes.map((m) => `- \`${m.id}\` (${m.label})${m.recommend ? `: ${m.recommend}` : ""}`).join("\n")].join("\n\n");
}
