// Self-update of a packaged app from GitHub Releases (release-macos T6). Not packaged: nothing runs.
// `autoInstallOnAppQuit` stays at electron-updater's default (true); the channel is never set.

export interface UpdaterLike {
  checkForUpdatesAndNotify(): Promise<unknown>;
}

export interface UpdaterOptions {
  packaged: boolean;
  updater: UpdaterLike;
  log: (message: string, err: unknown) => void;
  intervalMs?: number;
}

const SIX_HOURS_MS = 6 * 3600_000;

/** Checks at start and every `intervalMs`; a failed check is logged, never thrown. Returns a stop function. */
export function startUpdater({ packaged, updater, log, intervalMs = SIX_HOURS_MS }: UpdaterOptions): () => void {
  if (!packaged) return () => undefined;
  const check = (): void => {
    try {
      void Promise.resolve(updater.checkForUpdatesAndNotify()).catch((err: unknown) => log("Could not check for updates", err));
    } catch (err) {
      log("Could not check for updates", err);
    }
  };
  check();
  const timer = setInterval(check, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}

/** Loads electron-updater (packaged builds only) and starts the checks. */
export async function startPackagedUpdater(log: UpdaterOptions["log"]): Promise<() => void> {
  const { autoUpdater } = await import("electron-updater");
  return startUpdater({ packaged: true, updater: autoUpdater, log });
}
