import { lstatSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { JOB_ID, TOOL_ID } from "@humanharness/harness-sdk";
import { z } from "zod";

/** Folders the app owns in a work folder: a recording never writes there. */
export const APP_FOLDERS = [".claude", ".harness"] as const;

/** `p` without its trailing slashes: a loop, never a regex (no backtracking on a long run). */
function trimSlashes(p: string): string {
  let end = p.length;
  while (end > 0 && p.charCodeAt(end - 1) === 47) end--;
  return p.slice(0, end);
}

/** A path inside the work folder: relative, no `..` part, no drive or UNC, not the folder itself. */
export const folderRelative = z
  .string()
  .min(1)
  .refine(
    (p) =>
      !path.isAbsolute(p) &&
      !path.win32.isAbsolute(p) &&
      !/^[A-Za-z]:/.test(p) &&
      !p.startsWith("\\\\") &&
      !p.split(/[\\/]/).includes("..") &&
      !["", "."].includes(trimSlashes(path.posix.normalize(p.replaceAll("\\", "/")))),
    "must be a relative path to a file inside the folder",
  );

/** A path a recording may write: inside the work folder and not in an app-owned folder. */
const folderPath = folderRelative.refine(
  (p) => !(APP_FOLDERS as readonly string[]).includes(p.split(/[\\/]/).filter((x) => x && x !== ".")[0] ?? ""),
  "must be a relative path to a file inside the folder, outside .claude/ and .harness/",
);

const blockSchema = z.strictObject({ tool: z.string().min(1), input: z.record(z.string(), z.unknown()) });
const writeSchema = z.strictObject({ path: folderPath, content: z.string().nullable() });
const usageSchema = z.strictObject({
  input: z.number().int().nonnegative(),
  output: z.number().int().nonnegative(),
  cacheRead: z.number().int().nonnegative().default(0),
  cacheWrite: z.number().int().nonnegative().default(0),
});
/** The `save_note` arguments; the app validates them as it does for a real engine. */
const noteSchema = z.looseObject({ title: z.string().min(1) });

/** A recorded answer to an input block this turn shows, and the turn it leads to (input-blocks spec §8). */
const respondSchema = z.strictObject({
  block: z.string().regex(/^[a-z][a-z0-9_]*$/),
  value: z.record(z.string(), z.unknown()),
  next: z.string().min(1),
});

/** A JSON object; checked on the raw input first: zod's record silently drops a `__proto__` key. */
const jsonObject = z
  .unknown()
  .refine((o) => typeof o !== "object" || o === null || !Object.hasOwn(o, "__proto__"), "\"__proto__\" is not a valid key")
  .pipe(z.record(z.string(), z.unknown()));

/** One call the agent made on the `tools` MCP server (tools spec §12). */
const toolCallSchema = z.strictObject({ tool: z.string().regex(TOOL_ID), args: jsonObject });

export const mockTurnSchema = z.strictObject({
  id: z.string().min(1),
  text: z.string().default(""),
  blocks: z.array(blockSchema).default([]),
  note: noteSchema.optional(),
  writes: z.array(writeSchema).default([]),
  /**
   * Files the turn reads (context-panel spec §7): printed as Read tool calls, so the app records them. Optional, not
   * defaulted: a recording without reads parses (and is written by `--record`) exactly as before.
   */
  reads: z.array(folderRelative).max(20).optional(),
  /**
   * The agent's tool calls this turn (tools spec §12, Decision 9), made on the `tools` MCP server before the turn's
   * blocks, in order. Optional, not defaulted: a recording without them parses (and is written by `--record`) exactly as
   * before.
   */
  tools: z.array(toolCallSchema).max(20).optional(),
  usage: usageSchema.optional(),
  delayMs: z.number().int().min(0).max(60_000).optional(),
  /**
   * Reply → next turn id: a choice's label, or `*` for anything else.
   * Checked on the raw input: zod's record silently drops a `__proto__` key.
   */
  next: z
    .unknown()
    .refine((n) => typeof n !== "object" || n === null || !Object.hasOwn(n, "__proto__"), "\"__proto__\" is not a valid reply label")
    .pipe(z.record(z.string(), z.string()))
    .optional(),
  /** Answers to this turn's input blocks: an answer equal to one of these plays its `next`; others follow `next["*"]`. */
  respond: z.array(respondSchema).optional(),
  /** The recorded answer to the app's move into this part (task-phases spec §6): played for that phase change turn. */
  setPhase: z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/).optional(),
  /** The recorded answer to the time box's wrap-up turn. */
  timeUp: z.literal(true).optional(),
});

/** One action's recorded conversation (spec 3e §2). */
export const recordingSchema = z.strictObject({
  version: z.literal(1),
  action: z.string().min(1),
  /** Plain text that the task's first message (its brief) contains. */
  match: z.string().refine((m) => m.trim().length > 0, "must not be blank"),
  recordedWith: z.string().optional(),
  fallback: z.strictObject({ text: z.string().min(1) }).optional(),
  turns: z.array(mockTurnSchema).min(1),
});

/** A recipe's AI step in mock mode (tools Decision 11): `mock/steps/<job>.json`. */
export const stepRecordingSchema = z.strictObject({
  version: z.literal(1),
  job: z.string().regex(JOB_ID),
  /** step_output's input for a first round. */
  output: jsonObject,
  /** step_output's input for a round a post-step asked for; `output` when absent. */
  request: jsonObject.optional(),
});

export type Recording = z.infer<typeof recordingSchema>;
export type StepRecording = z.infer<typeof stepRecordingSchema>;
export type MockToolCall = z.infer<typeof toolCallSchema>;
export type MockTurn = z.infer<typeof mockTurnSchema>;
export type MockBlock = z.infer<typeof blockSchema>;
export type MockWrite = z.infer<typeof writeSchema>;
export type MockUsage = z.infer<typeof usageSchema>;
export type MockNote = z.infer<typeof noteSchema>;
export type MockRespond = z.infer<typeof respondSchema>;

/** Every `*.json` in `dir` that parses as a recording; the others are named in `problems`. */
export function loadRecordings(dir: string): { recordings: Recording[]; problems: string[] } {
  let names: string[];
  try {
    names = readdirSync(dir).filter((n) => n.endsWith(".json")).sort();
  } catch {
    return { recordings: [], problems: [] };
  }
  const recordings: Recording[] = [];
  const problems: string[] = [];
  for (const name of names) {
    try {
      const parsed = recordingSchema.safeParse(JSON.parse(readFileSync(path.join(dir, name), "utf8")));
      if (parsed.success) recordings.push(parsed.data);
      else problems.push(`${name}: ${parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"} ${i.message}`).join("; ")}`);
    } catch (err) {
      problems.push(`${name}: ${(err as Error).message}`);
    }
  }
  return { recordings, problems };
}

/** The folder of step recordings inside a mock folder, and a step recording's size cap (the plugin fixture files' 10 MB). */
export const STEP_RECORDINGS_DIR = "steps";
export const STEP_RECORDING_BYTES = 10 * 1024 * 1024;

/**
 * `<dir>/steps/<job>.json` (tools Decision 11), or null when there is none. `job` is checked against the job id pattern
 * before it joins a path; a linked folder or file, a folder, a file over the cap, one that doesn't parse or one whose
 * `job` isn't `job` throws with its problem.
 */
export function loadStepRecording(dir: string, job: string): StepRecording | null {
  if (!JOB_ID.test(job)) throw new Error(`"${job}" is not a job id.`);
  const folder = path.join(dir, STEP_RECORDINGS_DIR);
  const name = `${STEP_RECORDINGS_DIR}/${job}.json`;
  const folderStat = lstatSync(folder, { throwIfNoEntry: false });
  if (!folderStat) return null;
  if (!folderStat.isDirectory()) throw new Error(`${STEP_RECORDINGS_DIR} is not a folder.`);
  const file = path.join(folder, `${job}.json`);
  const stat = lstatSync(file, { throwIfNoEntry: false });
  if (!stat) return null;
  if (!stat.isFile()) throw new Error(`${name} is not a file.`);
  if (stat.size > STEP_RECORDING_BYTES) throw new Error(`${name} is too big (over ${STEP_RECORDING_BYTES / 1024 / 1024} MB).`);
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch (err) {
    throw new Error(`${name}: ${(err as Error).message}`);
  }
  const parsed = stepRecordingSchema.safeParse(raw);
  if (!parsed.success) throw new Error(`${name}: ${parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"} ${i.message}`).join("; ")}`);
  if (parsed.data.job !== job) throw new Error(`${name}: its job is "${parsed.data.job}", not "${job}" (it must be named after its job).`);
  return parsed.data;
}
