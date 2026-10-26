import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

/** Folders the app owns in a work folder: a recording never writes there. */
export const APP_FOLDERS = [".claude", ".harness"] as const;

/** A path inside the work folder: relative, with no `..` part, and not in an app-owned folder. */
const folderPath = z
  .string()
  .min(1)
  .refine(
    (p) =>
      !path.isAbsolute(p) &&
      !path.win32.isAbsolute(p) &&
      !/^[A-Za-z]:/.test(p) &&
      !p.startsWith("\\\\") &&
      !p.split(/[\\/]/).includes("..") &&
      !(APP_FOLDERS as readonly string[]).includes(p.split(/[\\/]/).filter((x) => x && x !== ".")[0] ?? "") &&
      !["", "."].includes(path.posix.normalize(p.replaceAll("\\", "/")).replace(/\/+$/, "")),
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

export const mockTurnSchema = z.strictObject({
  id: z.string().min(1),
  text: z.string().default(""),
  blocks: z.array(blockSchema).default([]),
  note: noteSchema.optional(),
  writes: z.array(writeSchema).default([]),
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

export type Recording = z.infer<typeof recordingSchema>;
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
