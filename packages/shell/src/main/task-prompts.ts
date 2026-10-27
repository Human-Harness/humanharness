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
 * Fills `{{language}}`, `{{notesIndex}}`, `{{question}}` and a phase brief's `{{phase}}`, `{{previousPhase}}`,
 * `{{timeLeft}}` in one pass (inserted text is never filled again). Only the template is tidied, before filling:
 * a line holding just a placeholder whose value is empty goes away and blank runs collapse; inserted text stays
 * exactly as given. A brief without `{{notesIndex}}` gets the index appended, so every new session starts with it.
 * The language is named in English ("pt-BR" → "Brazilian Portuguese").
 */
export function fillPrompt(
  template: string,
  vars: { language: Language; notesIndex: string; question?: string; phase?: string; previousPhase?: string; timeLeft?: string },
): string {
  const values: Record<string, string> = {
    language: languageName(vars.language),
    notesIndex: vars.notesIndex,
    ...(vars.question !== undefined ? { question: vars.question } : {}),
    // A phase's brief (task-phases spec §4.4): its label, the previous one's and the time left. Absent: left as written (D0).
    ...(vars.phase !== undefined ? { phase: vars.phase } : {}),
    ...(vars.previousPhase !== undefined ? { previousPhase: vars.previousPhase } : {}),
    ...(vars.timeLeft !== undefined ? { timeLeft: vars.timeLeft } : {}),
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
  /** The list of parts and the current part's section (task-phases spec §6), after the mode's. */
  phase?: string;
  message: string;
}): string {
  const line = fillPrompt(RESUME_PROMPT, { language: vars.language, notesIndex: "" });
  const question = vars.question ? `## The question that opened this topic\n${vars.question}${vars.questionCut ? `\n${QUESTION_CUT}` : ""}` : null;
  const head =
    vars.brief !== undefined
      ? [
          fillPrompt(vars.brief, { language: vars.language, notesIndex: vars.notesIndex }),
          ...(vars.mode ? [vars.mode] : []),
          ...(vars.phase ? [vars.phase] : []),
          line,
        ]
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

/** A manifest text on one line: a newline in a label or hint must not break the prompt's heading or list. */
export const oneLine = (s: string): string => s.replace(/\s*\n\s*/g, " ").trim();

/** A mode's brief filled like an action's (`{{language}}`); it never gets the notes index: the session has it. */
const modeBrief = (brief: string, language: Language): string => fillPrompt(brief, { language, notesIndex: "" });
const settingLines = (settings: readonly string[]): string[] => (settings.length > 0 ? [settings.map((s) => `- ${s}`).join("\n")] : []);

/**
 * The switch's message (spec §5.4): one turn in the same session with the new mode's brief and settings. `soFar`: the
 * last checkpoint note's summary, when the task has one (spec §10.1), each point on one line. Inserted text is never
 * filled again. Labels and hints come one-lined from their only caller (the task manager's `modeText`, `hintOf`).
 */
export function modePrompt(mode: ModeText, vars: { language: Language; soFar?: readonly string[] }): string {
  return [
    MODE_PROMPT.replace("{{label}}", () => mode.label),
    ...(vars.soFar && vars.soFar.length > 0 ? [`What is clear so far (the last checkpoint): ${vars.soFar.map(oneLine).join("; ")}`] : []),
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

/** A part as a prompt carries it: its id, its label (one line) and its brief (the file's text, "" without one). */
export interface PhaseText {
  id: string;
  label: string;
  brief: string;
}

/** How the agent moves between parts (task-phases spec §4.1); in the first message and a resumed one. */
export const PHASES_HOW =
  "This task has parts, in order. When the current part is done, call `set_phase` at the end of your answer with the next part's id and a short reason; the app moves the task, and may ask the person first. In the last part, call `set_phase` with its own id when the task is done.";
/** A change's first line (spec §4.4). The mock replay knows a change by this start. */
export const PHASE_PROMPT = 'Next part of this task: "{{label}}" (`{{phase}}`).';
/** Said when the person went back to an earlier part (spec §4.2). */
export const PHASE_BACK = "The person went back to this part.";
/** A change's last line. */
export const PHASE_END = "Then continue with the person in this part.";
/** The time box's wrap-up turn (spec §5). The mock replay knows it by its start. */
export const WRAP_UP_PROMPT =
  "Time is almost up: finish the current point briefly, in {{language}}. Do not start anything new and do not call `show_choices`; the app moves on after your answer.";

interface PhaseVars {
  language: Language;
  /** The label of the part the task comes from. */
  previous?: string;
  /** "about 12 minutes", or "" / absent without a time box. */
  timeLeft?: string;
}

/** A part's brief filled (spec §4.4): the language, its label, the previous one's and the time left. Never the notes index. */
const phaseBrief = (p: PhaseText, vars: PhaseVars): string =>
  fillPrompt(p.brief, { language: vars.language, notesIndex: "", phase: p.label, previousPhase: vars.previous ?? "", timeLeft: vars.timeLeft ?? "" });

/** The list of the task's parts (spec §4.1): ids, labels, the current one marked. Labels come one-lined from the caller. */
export function phasesSection(phases: readonly { id: string; label: string }[], current: string): string {
  const lines = phases.map((p) => `- \`${p.id}\` (${p.label})${p.id === current ? " ← now" : ""}`).join("\n");
  return ["## Parts of this task", PHASES_HOW, lines].join("\n\n");
}

/** The current part's heading and brief: at a task's start and in a resumed session. */
export function phaseSection(p: PhaseText, vars: PhaseVars): string {
  return [`## Part: ${p.label}`, ...(p.brief ? [phaseBrief(p, vars)] : [])].join("\n\n");
}

/**
 * A change's message (spec §4.4): one turn of the same session. `extra`: sections that ride on it (a mode coming back,
 * a recommendation, modes spec §7). Inserted text is never filled again.
 */
export function phasePrompt(p: PhaseText, vars: PhaseVars & { back?: boolean; extra?: readonly string[] }): string {
  return [
    PHASE_PROMPT.replace(/\{\{(label|phase)\}\}/g, (_all, key: string) => (key === "label" ? p.label : p.id)),
    ...(vars.back ? [PHASE_BACK] : []),
    ...(vars.timeLeft ? [`Time left: ${vars.timeLeft}.`] : []),
    ...(p.brief ? [phaseBrief(p, vars)] : []),
    ...(vars.extra ?? []),
    PHASE_END,
  ].join("\n\n");
}

/** The wrap-up's message (spec §5). */
export const wrapUpPrompt = (language: Language): string => fillPrompt(WRAP_UP_PROMPT, { language, notesIndex: "" });
