// packages/fake-agent/src/mock.ts
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

/** A path inside the work folder: relative, with no `..` part. */
const folderPath = z
  .string()
  .min(1)
  .refine((p) => !path.isAbsolute(p) && !p.split(/[\\/]/).includes(".."), "must be a relative path inside the folder");

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

export const mockTurnSchema = z.strictObject({
  id: z.string().min(1),
  text: z.string().default(""),
  blocks: z.array(blockSchema).default([]),
  note: noteSchema.optional(),
  writes: z.array(writeSchema).default([]),
  usage: usageSchema.optional(),
  delayMs: z.number().int().min(0).max(60_000).optional(),
  /** Reply → next turn id: a choice's label, or `*` for anything else. */
  next: z.record(z.string(), z.string()).optional(),
});

/** One action's recorded conversation (spec 3e §2). */
export const recordingSchema = z.strictObject({
  version: z.literal(1),
  action: z.string().min(1),
  /** Plain text that the task's first message (its brief) contains. */
  match: z.string().min(1),
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
