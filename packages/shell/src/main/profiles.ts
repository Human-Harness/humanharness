import { promises as fs } from "node:fs";
import { type Collection, type DataRecord, type InputIssue, inputIssues } from "@humanharness/harness-sdk";
import { ProfileStore, cleanProfileTitle, isProfileId, prepareFolder, profileDir } from "@humanharness/workspace";
import type { ProfileRefusal, ProfilesState } from "@humanharness/ui/client";
import { profileOfBase } from "./profile-base";
import type { ProfileSwitchResult } from "./profile-switch";

export interface ProfilesDeps {
  /** The app's folder (`config.json` → `folder`); null before it is chosen. */
  root(): Promise<string | null>;
  /** The active profile (`config.json` → `profile`). */
  active(): Promise<string | undefined>;
  /** The harness's `profile` collection: its schema checks a new profile's fields before anything is made. */
  collection: Collection;
  /** The harness's seed folder, copied into a new profile's folder (`prepareFolder`). */
  seed?: string;
  /** Writes a new profile's record in its own folder: that folder's data store, as the person, app-wide. */
  writeRecord(base: string, record: DataRecord): Promise<void>;
  /** A profile's record, read from its own folder; null when there is none. */
  readRecord(base: string): Promise<DataRecord | null>;
  /** The switch (`ProfileSwitch.run`). */
  switchTo(target: () => Promise<string>): Promise<ProfileSwitchResult>;
  /** Puts a file or folder in the system Trash (Electron's `shell.trashItem`). Never a permanent delete. */
  trash(p: string): Promise<void>;
  /** Where the history of a folder lives (`historyDir`). */
  historyDir(folder: string): string;
  /** The profiles changed: the window's switcher redraws. */
  changed(state: ProfilesState): void;
  /** A switch, a turn, a restore, a move or an engine change runs: archiving and deleting wait (they would race it). */
  blocked(): boolean;
}

/** How a change went, before the main process adds the new app state. */
export type ProfileOutcome = { ok: true } | { ok: false; reason: ProfileRefusal; errors?: InputIssue[] };

const exists = (p: string) => fs.access(p).then(() => true, () => false);

/** The profiles of the app's folder (profiles spec §4, §5). Every refusal comes back as data. */
export class Profiles {
  private readonly stores = new Map<string, ProfileStore>();
  /** A profile is being archived, brought back or deleted. */
  private pending = false;

  constructor(private readonly d: ProfilesDeps) {}

  /**
   * A profile is being archived, brought back or deleted: a switch and a move wait (a switch to a profile whose folder
   * is going to the Trash would open it half gone).
   */
  changing(): boolean {
    return this.pending;
  }

  /** Runs an archive or a delete, one at a time and never beside a switch: checked and flagged with no await between. */
  private async held(run: () => Promise<ProfileOutcome>): Promise<ProfileOutcome> {
    if (this.pending || this.d.blocked()) return { ok: false, reason: "busy" };
    this.pending = true;
    try {
      return await run();
    } finally {
      this.pending = false;
    }
  }

  /** One registry per root, so its write queue orders every change. */
  private store(root: string): ProfileStore {
    let store = this.stores.get(root);
    if (!store) {
      store = new ProfileStore(root);
      this.stores.set(root, store);
    }
    return store;
  }

  async state(): Promise<ProfilesState> {
    const root = await this.d.root();
    if (!root) return { active: null, list: [] };
    const list = await this.store(root).list();
    const active = await this.d.active();
    return { active: active !== undefined && list.some((p) => p.id === active && !p.archived) ? active : null, list };
  }

  /** Whether `id` can be the active profile: registered and not archived. */
  async openable(id: string): Promise<boolean> {
    const root = await this.d.root();
    return root !== null && (await this.store(root).list()).some((p) => p.id === id && !p.archived);
  }

  /**
   * A new profile from the add form's fields (spec §5 "Creating a profile"), made inside the switch: the open task
   * closes first, then the registry entry, the folder (with the seed) and the record; then it is the active profile.
   */
  async create(values: unknown): Promise<ProfileOutcome> {
    const root = await this.d.root();
    if (!root) return { ok: false, reason: "not-ready" };
    const parsed = this.d.collection.schema.safeParse(values);
    if (!parsed.success) return { ok: false, reason: "invalid", errors: inputIssues(parsed.error) };
    const record = parsed.data as DataRecord;
    // The manifest only asks `name` to be a string: an empty or blank one is refused here (`cleanProfileTitle`).
    let title: string;
    try {
      title = cleanProfileTitle(record.name);
    } catch (err) {
      return { ok: false, reason: "invalid", errors: [{ path: "name", message: (err as Error).message }] };
    }
    return this.answer(
      await this.d.switchTo(async () => {
        const entry = await this.store(root).create(title, typeof record.color === "string" ? record.color : undefined);
        const base = profileDir(root, entry.id);
        await prepareFolder(base, this.d.seed);
        await this.d.writeRecord(base, { ...record, name: title });
        return entry.id;
      }),
    );
  }

  /** Makes `id` the active profile; the open task closes first. */
  async open(id: unknown): Promise<ProfileOutcome> {
    const root = await this.d.root();
    if (!root) return { ok: false, reason: "not-ready" };
    if (!isProfileId(id) || !(await this.openable(id))) return { ok: false, reason: "unknown" };
    if ((await this.d.active()) === id) return { ok: true };
    return this.answer(await this.d.switchTo(async () => id));
  }

  /** Hides a profile from the switcher, or brings it back. Never the active one. */
  setArchived(id: unknown, archived: boolean): Promise<ProfileOutcome> {
    return this.held(() => this.archiveNow(id, archived));
  }

  private async archiveNow(id: unknown, archived: boolean): Promise<ProfileOutcome> {
    const root = await this.d.root();
    if (!root) return { ok: false, reason: "not-ready" };
    if (!isProfileId(id) || !(await this.registered(root, id))) return { ok: false, reason: "unknown" };
    if ((await this.d.active()) === id) return { ok: false, reason: "active" };
    try {
      await this.store(root).setArchived(id, archived);
    } catch (err) {
      console.error("Could not archive the profile", err);
      return { ok: false, reason: "failed" };
    }
    this.d.changed(await this.state());
    return { ok: true };
  }

  /**
   * Deletes a profile (spec §5): its folder goes to the system Trash, then its history; then the entry goes. Never the
   * active one. A Trash that refuses the folder changes nothing; one that refuses the history leaves it (logged).
   */
  remove(id: unknown): Promise<ProfileOutcome> {
    return this.held(() => this.removeNow(id));
  }

  private async removeNow(id: unknown): Promise<ProfileOutcome> {
    const root = await this.d.root();
    if (!root) return { ok: false, reason: "not-ready" };
    if (!isProfileId(id) || !(await this.registered(root, id))) return { ok: false, reason: "unknown" };
    if ((await this.d.active()) === id) return { ok: false, reason: "active" };
    const dir = profileDir(root, id);
    try {
      if (await exists(dir)) await this.d.trash(dir);
    } catch (err) {
      console.error("Could not put the profile's folder in the Trash; nothing was changed", err);
      return { ok: false, reason: "failed" };
    }
    const history = this.d.historyDir(dir);
    if (await exists(history)) {
      await this.d.trash(history).catch((err: unknown) => console.error("Could not put the profile's history in the Trash", err));
    }
    try {
      await this.store(root).remove(id);
    } catch (err) {
      console.error("Could not drop the profile from the registry", err);
      return { ok: false, reason: "failed" };
    }
    this.d.changed(await this.state());
    return { ok: true };
  }

  /**
   * A profile's record changed (any writer): the registry copies its name and colour (spec §4). `base` is the folder
   * whose store changed; anything that isn't a registered profile's folder, or a record without a usable name, changes
   * nothing. It never rejects: a failure is logged.
   */
  async sync(base: string): Promise<void> {
    try {
      const root = await this.d.root();
      const id = root ? profileOfBase(root, base) : null;
      if (!root || !id || !(await this.registered(root, id))) return;
      const record = await this.d.readRecord(base);
      if (!record) return;
      try {
        cleanProfileTitle(record.name);
      } catch {
        return;
      }
      await this.store(root).setIdentity(id, { title: record.name, color: record.color });
      this.d.changed(await this.state());
    } catch (err) {
      console.error("Could not copy the profile's name and colour to the registry", err);
    }
  }

  private async registered(root: string, id: string): Promise<boolean> {
    return (await this.store(root).list()).some((p) => p.id === id);
  }

  /**
   * A switch's result as an outcome. The window hears the profiles on a failure too: a switch that failed after a new
   * profile was made leaves it registered but not active, and the person can open it.
   */
  private async answer(r: ProfileSwitchResult): Promise<ProfileOutcome> {
    if (!r.ok && r.reason !== "failed") return { ok: false, reason: r.reason };
    this.d.changed(await this.state());
    return r.ok ? { ok: true } : { ok: false, reason: "failed" };
  }
}
