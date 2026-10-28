import { promises as fs } from "node:fs";
import path from "node:path";
import { jobsFile } from "@humanharness/workspace";

export type JobTrigger = "start" | "manual" | "afterTask" | "every";
export type JobStatus = "ok" | "needs-you" | "failed";

/** One run in `.harness/jobs.jsonl` (parallel spec §8). */
export interface JobRunRecord {
  run: string;
  job: string;
  /** null: an app-wide run (`scope: "none"`). */
  scope: string | null;
  trigger: JobTrigger;
  status: JobStatus;
  summary: string;
  /** For needs-you: the action the person may start. */
  action?: string;
  tokens: number;
  /** ISO time (`toISOString()`); its local day is the daily cap's day (Decision 9). */
  startedAt: string;
  endedAt: string;
}

/** The key runs are deduped and summarised by: one per job and scope (`-` for an app-wide run). */
export const dedupeKey = (job: string, scope: string | null): string => `${job}:${scope ?? "-"}`;

const TRIGGERS: readonly string[] = ["start", "manual", "afterTask", "every"] satisfies JobTrigger[];
const STATUSES: readonly string[] = ["ok", "needs-you", "failed"] satisfies JobStatus[];

const isRecord = (r: unknown): r is JobRunRecord => {
  if (typeof r !== "object" || r === null || Array.isArray(r)) return false;
  const o = r as Record<string, unknown>;
  return (
    typeof o.run === "string" &&
    typeof o.job === "string" &&
    (typeof o.scope === "string" || o.scope === null) &&
    typeof o.trigger === "string" &&
    TRIGGERS.includes(o.trigger) &&
    typeof o.status === "string" &&
    STATUSES.includes(o.status) &&
    typeof o.summary === "string" &&
    (o.action === undefined || typeof o.action === "string") &&
    typeof o.tokens === "number" &&
    Number.isFinite(o.tokens) &&
    o.tokens >= 0 &&
    typeof o.startedAt === "string" &&
    typeof o.endedAt === "string"
  );
};

/** True when the file exists, is not empty and its last byte is not a newline: a torn last line. */
async function endsTorn(file: string): Promise<boolean> {
  const h = await fs.open(file, "r").catch(() => null);
  if (!h) return false;
  try {
    const { size } = await h.stat();
    if (size === 0) return false;
    const buf = Buffer.alloc(1);
    await h.read(buf, 0, 1, size - 1);
    return buf[0] !== 0x0a;
  } finally {
    await h.close();
  }
}

/** The log of job runs: appends only, one at a time. Nothing is written until a run ends (D0: no file without jobs). */
export class JobLog {
  private readonly file: string;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(base: string) {
    this.file = jobsFile(base);
  }

  append(r: JobRunRecord): Promise<void> {
    const run = this.queue.then(async () => {
      await fs.mkdir(path.dirname(this.file), { recursive: true });
      // A torn last line (a crash mid-write) is closed first, so this run is not glued onto it and lost.
      const lead = (await endsTorn(this.file)) ? "\n" : "";
      await fs.appendFile(this.file, lead + JSON.stringify(r) + "\n");
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  /** Every run, oldest first. A missing file is empty; a corrupt or malformed line is skipped. */
  async all(): Promise<JobRunRecord[]> {
    const raw = await fs.readFile(this.file, "utf8").catch(() => "");
    const out: JobRunRecord[] = [];
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      try {
        const r: unknown = JSON.parse(line);
        if (isRecord(r)) out.push(r);
      } catch {
        // A corrupt line is skipped.
      }
    }
    return out;
  }

  /** The last run of each job and scope, by `dedupeKey`. */
  async lastRuns(): Promise<Map<string, JobRunRecord>> {
    const out = new Map<string, JobRunRecord>();
    for (const r of await this.all()) out.set(dedupeKey(r.job, r.scope), r);
    return out;
  }

  /** The tokens `job`'s runs that started on `now`'s local day used (spec §8 daily cap). */
  async tokensToday(job: string, now: Date): Promise<number> {
    const day = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    const today = day(now);
    return (await this.all()).filter((r) => r.job === job && day(new Date(r.startedAt)) === today).reduce((s, r) => s + r.tokens, 0);
  }
}
