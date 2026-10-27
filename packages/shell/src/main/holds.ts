/** Where each hold comes from (the main process's guards). Every one is read synchronously. */
export interface HoldSources {
  quitting(): boolean;
  /** A task operation or a turn runs (`TaskManager.isBusy`). */
  tasksBusy(): boolean;
  /** A folder move runs. */
  moving(): boolean;
  /** An engine change, a folder change or an engine update holds turns (`EngineGuards.turnBlocked`). */
  engine(): string | null;
  /** A restore runs (`RestoreGuard.turnBlocked`). */
  restore(): string | null;
  /** A profile switch runs (`ProfileSwitch.turnBlocked`). */
  profileSwitch(): string | null;
  /** A profile is being archived, brought back or deleted (`Profiles.changing`). */
  profileChange(): boolean;
}

/**
 * What waits for what (profiles spec §5), in one place so every guard reads the same holds. A guard's own hold is never
 * among its sources: each one checks and sets its own flag with no await in between.
 */
export function holds(s: HoldSources) {
  return {
    /**
     * Why a turn the window asks for can't start now. Not for the runtime's own start: a switch's closing turn runs
     * under the switch's hold.
     */
    turnBlocked: (): string | null => s.engine() ?? s.restore() ?? s.profileSwitch(),
    /** `RestoreGuard`'s turnBlocked: an engine change or a profile switch. */
    restoreHeld: (): string | null => s.engine() ?? s.profileSwitch(),
    /** `ProfileSwitch`'s busy: a turn, a move, an archive or a delete. */
    switchBusy: (): boolean => s.tasksBusy() || s.moving() || s.profileChange(),
    /** `ProfileSwitch`'s turnBlocked: an engine change or a restore. */
    switchHeld: (): string | null => s.engine() ?? s.restore(),
    /**
     * An engine change, or an update or sign-out of the engine in use: a turn, or a profile switch (once its task has
     * closed, no turn runs, yet its runtime is still to close and its profile to save).
     */
    engineBusy: (): boolean => s.tasksBusy() || s.profileSwitch() !== null,
    /** A folder change or move: a turn, a restore, a profile switch, an archive or a delete. */
    folderBusy: (): boolean => s.tasksBusy() || s.restore() !== null || s.profileSwitch() !== null || s.profileChange(),
    /** Archiving or deleting a profile: anything else that runs. */
    profileChangeBlocked: (): boolean =>
      s.quitting() || s.tasksBusy() || s.moving() || s.engine() !== null || s.restore() !== null || s.profileSwitch() !== null,
  };
}

export type Holds = ReturnType<typeof holds>;
