import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

// Revoking a scope's engine approval (hatches spec §5.3). The approval sits in `.harness/scopes.json`, which the agent
// can write: after a revoke it could paste the old signed entry back. So each scope's approvals carry an epoch, kept
// here in the app's data folder (outside the folder the agent writes) and folded into the approval's and the pins'
// tags (approval.ts); a revoke bumps it, and every tag made before stops verifying. No file or no entry: epoch 0, the
// tags made before epochs existed. The file is made only by the first revoke (D0: never without enginePresets).

/** The record's file in `<userData>`. */
export const EPOCHS_FILE = "engine-epochs.json";
const ENTRIES_MAX = 10_000;
const ID_MAX = 200;

/** Epochs by profile ("" without profiles) and scope; `floor` is the least epoch of every scope. */
interface EpochRecord {
  floor: number;
  epochs: Map<string, number>;
}

const keyOf = (profile: string, scope: string) => JSON.stringify([profile, scope]);
const isEpoch = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const isId = (v: unknown): v is string => typeof v === "string" && v.length <= ID_MAX;

/** The record in `text`, or null when it isn't one the app wrote. */
function parse(text: string): EpochRecord | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const r = raw as { version?: unknown; floor?: unknown; epochs?: unknown };
  if (r.version !== 1 || !isEpoch(r.floor) || !Array.isArray(r.epochs) || r.epochs.length > ENTRIES_MAX) return null;
  const epochs = new Map<string, number>();
  for (const e of r.epochs as unknown[]) {
    if (!Array.isArray(e) || e.length !== 3 || !isId(e[0]) || !isId(e[1]) || !isEpoch(e[2])) return null;
    epochs.set(keyOf(e[0], e[1]), e[2]);
  }
  return { floor: r.floor, epochs };
}

export class EngineEpochs {
  private writes: Promise<unknown> = Promise.resolve();
  constructor(private readonly file: string) {}

  /** The record; a missing file is the empty one, a damaged or unreadable one null. */
  private async read(): Promise<EpochRecord | null> {
    let text: string;
    try {
      text = await fs.readFile(this.file, "utf8");
    } catch (err) {
      return (err as NodeJS.ErrnoException).code === "ENOENT" ? { floor: 0, epochs: new Map() } : null;
    }
    return parse(text);
  }

  private static epochIn(r: EpochRecord, profile: string, scope: string): number {
    return Math.max(r.floor, r.epochs.get(keyOf(profile, scope)) ?? 0);
  }

  /** The scope's epoch, to check a tag with; null when the record is damaged (no approval verifies then). */
  async get(profile: string, scope: string): Promise<number | null> {
    await this.writes;
    const r = await this.read();
    return r && EngineEpochs.epochIn(r, profile, scope);
  }

  /** The scope's epoch, to sign a new approval or pin with. A damaged record is replaced first (see `repaired`). */
  sign(profile: string, scope: string): Promise<number> {
    return this.change(profile, scope, (e) => e, false);
  }

  /** Revokes: the scope's next epoch, written before it is returned. */
  bump(profile: string, scope: string): Promise<number> {
    return this.change(profile, scope, (e) => e + 1, true);
  }

  private change(profile: string, scope: string, next: (epoch: number) => number, write: boolean): Promise<number> {
    if (!isId(profile) || !isId(scope)) return Promise.reject(new Error("Invalid scope"));
    const run = this.writes.then(async () => {
      let r = await this.read();
      if (!r) {
        // Damaged: the epochs it held are unknown, so every scope starts above any counter it could hold (a time
        // in milliseconds), and every approval made before needs approving again.
        console.error(`The engine approvals record was damaged; every scope's approval is void: ${this.file}`);
        r = { floor: Date.now(), epochs: new Map() };
        write = true;
      }
      const epoch = next(EngineEpochs.epochIn(r, profile, scope));
      if (!write) return epoch;
      r.epochs.set(keyOf(profile, scope), epoch);
      if (r.epochs.size > ENTRIES_MAX) throw new Error("Too many scopes");
      const epochs = [...r.epochs].map(([k, v]) => [...(JSON.parse(k) as [string, string]), v]);
      await fs.mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 });
      const tmp = `${this.file}.${randomUUID()}.tmp`;
      try {
        await fs.writeFile(tmp, JSON.stringify({ version: 1, floor: r.floor, epochs }), { mode: 0o600, flag: "wx" });
        await fs.rename(tmp, this.file);
      } catch (err) {
        await fs.rm(tmp, { force: true });
        throw err;
      }
      return epoch;
    });
    this.writes = run.catch(() => undefined);
    return run;
  }
}
