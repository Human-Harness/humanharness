import { HIDDEN_CHARS, JOB_ID, JOB_RESULT_TOOL } from "@humanharness/harness-sdk";

/** The longest brief a job's first message carries: the rest is cut (a prompt file is the harness's text). */
export const JOB_BRIEF_CHARS = 20_000;
/** The longest action label the "how to end" part names. */
const LABEL_CHARS = 80;

const HIDDEN = new RegExp(HIDDEN_CHARS.source, "gu");
/** The brief as prose: tab and newline kept, the rest of HIDDEN_CHARS gone (B12), cut to JOB_BRIEF_CHARS. */
const prose = (t: string) =>
  t
    .replace(/\r\n?|[\u2028\u2029]/g, "\n")
    .replace(/[^\t\n]+/g, (run) => run.replace(HIDDEN, ""))
    .trim()
    .slice(0, JOB_BRIEF_CHARS);
/** A label on one plain line: controls and separators as spaces, hidden characters gone, cut to LABEL_CHARS. */
const plain = (t: string) => {
  const line = t
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, " ")
    .replace(HIDDEN, "")
    .replace(/\s+/g, " ")
    .trim();
  return line.length > LABEL_CHARS ? `${line.slice(0, LABEL_CHARS - 1)}…` : line;
};

/**
 * A job run's first message (parallel spec §8): its brief, the same context an action's first message carries (notes
 * index, data, material of its scope) and how to end. No question to the person, no note: nobody reads the run.
 */
export async function jobFirstMessage(o: {
  brief: string;
  scope: string;
  /** The notes part of the context (`notesIndexFor` of task-manager.ts, as a task's first message has it). */
  notesIndex(scope: string): Promise<string>;
  dataContext?(scope: string): Promise<string>;
  materialContext?(scope: string): Promise<string>;
  /** The actions a needs-you result may name: id → label. */
  actions: Record<string, string>;
}): Promise<string> {
  const load = async (what: string, f: ((scope: string) => Promise<string>) | undefined) =>
    f
      ? await f(o.scope).catch((err: unknown) => {
          console.error(`Could not load the ${what} for the job`, err);
          return "";
        })
      : "";
  const named = Object.entries(o.actions)
    .filter(([id]) => JOB_ID.test(id))
    .map(([id, label]) => `${id} (${plain(label)})`);
  const end = [
    "This is a background job: nobody reads this conversation and nobody can answer. Don't ask anything.",
    `Do the work, then call ${JOB_RESULT_TOOL} once with status ok, needs-you or failed and a one-line summary.`,
    named.length > 0
      ? `With needs-you, name the action the person should start, one of: ${named.join(", ")}.`
      : "With needs-you, leave action out: this harness has no action to name.",
  ].join("\n");
  const parts = [prose(o.brief), await load("notes", o.notesIndex), await load("data", o.dataContext), await load("material", o.materialContext), end];
  return parts.filter((p) => p.trim()).join("\n\n");
}
