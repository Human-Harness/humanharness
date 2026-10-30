import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { SetupStepStatus, SetupStepsState } from "@humanharness/protocol";
import { setupFile } from "@humanharness/workspace";

/** What a person did with a step. Absent: not done yet. */
export type StepMark = "done" | "skipped";

/** `.harness/setup.json` (setup-steps spec §4). */
export interface SetupFile {
  version: 1;
  steps: Record<string, { state: StepMark; at: string }>;
  /** The setup screen reached "All set" (or the folder ran tasks before these steps existed). */
  finishedAt?: string;
  /** The step ids the person has seen: after setup finished, only these can block Home (spec §8 Q3). */
  known?: string[];
}

export const emptySetup = (): SetupFile => ({ version: 1, steps: {} });

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isDate = (v: unknown): v is string => typeof v === "string" && v.length <= 40 && !Number.isNaN(Date.parse(v));

/** Only what the app understands: the manifest's steps (`ids`), known states, real dates. */
export function cleanSetup(raw: unknown, ids: readonly string[]): SetupFile {
  const out = emptySetup();
  if (!isRecord(raw)) return out;
  const steps = isRecord(raw.steps) ? raw.steps : {};
  for (const id of ids) {
    if (!Object.hasOwn(steps, id)) continue;
    const s = steps[id];
    if (isRecord(s) && (s.state === "done" || s.state === "skipped") && isDate(s.at)) out.steps[id] = { state: s.state, at: s.at };
  }
  if (isDate(raw.finishedAt)) out.finishedAt = raw.finishedAt;
  if (Array.isArray(raw.known)) {
    const known = raw.known;
    out.known = ids.filter((id) => known.includes(id));
  }
  return out;
}

/** Each step's status, by id. */
export function stepStatuses(file: SetupFile, steps: readonly { id: string }[]): Record<string, SetupStepStatus> {
  return Object.fromEntries(steps.map((s) => [s.id, Object.hasOwn(file.steps, s.id) ? file.steps[s.id].state : "missing"]));
}

/**
 * The required steps not done that keep Home on "Set up" (D5), in manifest order. After setup finished, a step counts only
 * once the person has seen it (spec §8 Q3: a step an update adds doesn't lock anyone out).
 */
export function blockingSteps(file: SetupFile, steps: readonly { id: string; required: boolean }[]): string[] {
  const seen = (id: string) => file.finishedAt === undefined || (file.known ?? []).includes(id);
  const done = (id: string) => Object.hasOwn(file.steps, id) && file.steps[id].state === "done";
  return steps.filter((s) => s.required && !done(s.id) && seen(s.id)).map((s) => s.id);
}

/** Both: each step's status and the steps that block Home. */
export function setupState(file: SetupFile, steps: readonly { id: string; required: boolean }[]): SetupStepsState {
  return { steps: stepStatuses(file, steps), blocking: blockingSteps(file, steps) };
}

/** One folder's `setup.json`. */
export class SetupStore {
  private readonly file: string;

  constructor(
    base: string,
    private readonly ids: readonly string[],
  ) {
    this.file = setupFile(base);
  }

  /** Null when there is no file. One that isn't JSON is set aside as `setup.json.corrupt-<time>` and reads as none. */
  async load(): Promise<SetupFile | null> {
    let text: string;
    try {
      text = await fs.readFile(this.file, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
    try {
      return cleanSetup(JSON.parse(text), this.ids);
    } catch {
      await fs.rename(this.file, `${this.file}.corrupt-${Date.now()}`);
      return null;
    }
  }

  /** Atomic: temp file + rename. */
  async save(file: SetupFile): Promise<void> {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(tmp, `${JSON.stringify(file, null, 2)}\n`);
      await fs.rename(tmp, this.file);
    } catch (err) {
      await fs.rm(tmp, { force: true });
      throw err;
    }
  }
}
