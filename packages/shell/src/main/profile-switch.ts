export interface ProfileSwitchDeps {
  quitting(): boolean;
  /** A task operation or a turn is under way. */
  busy(): boolean;
  /** Why turns are held now (an engine change, a folder move, an engine update, a restore), or null. */
  turnBlocked(): string | null;
  /** Closes the open task with its closing turn and note (`tasks.finish()`); false when that turn was stopped. */
  closeTask(): Promise<boolean>;
  /** Closes the runtime, which runs in the old profile's folder; the next turn starts one in the new folder. */
  closeRuntime(): Promise<void>;
  /** Saves the active profile (`ConfigStore.setProfile`). */
  saveActive(id: string): Promise<void>;
  /** The new profile is active: settle its folder and tell the window. A failure is logged; the switch stands. */
  arrived(id: string): Promise<void>;
}

export type ProfileSwitchResult = { ok: true; id: string } | { ok: false; reason: "busy" | "open" | "failed" };

/**
 * Switching profiles against turns, restores and moves (profiles spec §5): refused while any of them runs, and all of
 * them held off from its first moment until it ends. The check and the flag happen with no await in between, so a
 * send, a restore or a move can't slip in (each one checks `turnBlocked()`).
 */
export class ProfileSwitch {
  private pending = false;

  constructor(private readonly d: ProfileSwitchDeps) {}

  /** Why a turn, a restore or a move can't start now because of a switch, or null. */
  turnBlocked(): string | null {
    return this.pending ? "Switching profiles" : null;
  }

  /**
   * Switches to the profile `target` names. `target` runs after the open task closed and before the runtime closes, so
   * creating a profile happens inside the switch: a refused switch makes nothing.
   */
  async run(target: () => Promise<string>): Promise<ProfileSwitchResult> {
    if (this.pending || this.d.quitting() || this.d.busy() || this.d.turnBlocked()) return { ok: false, reason: "busy" };
    this.pending = true;
    try {
      if (!(await this.d.closeTask())) return { ok: false, reason: "open" };
      const id = await target();
      await this.d.closeRuntime();
      await this.d.saveActive(id);
      await this.d.arrived(id).catch((err: unknown) => console.error("Could not settle the new profile", err));
      return { ok: true, id };
    } catch (err) {
      console.error("Could not switch profiles", err);
      return { ok: false, reason: "failed" };
    } finally {
      this.pending = false;
    }
  }
}
