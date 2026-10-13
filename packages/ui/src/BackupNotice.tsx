import { type ReactNode, type RefObject, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { AppState, HarnessClient, MoveError, SyncLocationView } from "./client";

/** The folder's own name (its last path segment): it keeps it when it moves. */
const folderName = (folder: string) => folder.replace(/\/+$/, "").split("/").pop() || folder;
const parentOf = (folder: string) => folder.replace(/\/+$/, "").replace(/\/[^/]*$/, "") || "/";
const inside = (place: string, name: string) => `${place.replace(/\/+$/, "")}/${name}`;

/** The notice shows when the folder is only on this computer and the person hasn't said they keep a copy. */
export function needsBackupNotice(state: AppState): boolean {
  return Boolean(state.config.folder) && state.backup?.status?.kind === "local" && state.config.backupDismissed !== true;
}

/** Why a move didn't happen: what the main process said, or the place picker didn't open ("pick"). */
export type MoveProblem = MoveError | "pick";

/**
 * Moving the folder (spec 3d §2), kept by the app (HarnessApp) so a move in progress, its failure and how it
 * ended survive a change of view: closing Settings, another tab, Home.
 */
export interface FolderMove {
  moving: boolean;
  error: MoveProblem | null;
  /** The last move that worked: where the folder is now, and what stayed behind. */
  moved: { folder: string; leftBehind?: string; historyLeftBehind: boolean } | null;
  /** Counts failed moves: focus goes back once the buttons are enabled again. */
  failures: number;
  /** The control that started the last move. */
  trigger: RefObject<HTMLElement | null>;
  move(to: string): Promise<void>;
  /** The person picks the place; the folder goes inside it with its own name (the main process checks the place). */
  chooseAnother(folder: string): Promise<void>;
}

export function useFolderMove(client: HarnessClient, onChange: (s: AppState) => void): FolderMove {
  const [moving, setMoving] = useState(false);
  const [error, setError] = useState<MoveProblem | null>(null);
  const [moved, setMoved] = useState<FolderMove["moved"]>(null);
  const [failures, setFailures] = useState(0);
  const trigger = useRef<HTMLElement | null>(null);
  const running = useRef(false);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const fail = (problem: MoveProblem) => {
    setError(problem);
    setFailures((n) => n + 1);
  };
  const focused = () => (document.activeElement instanceof HTMLElement ? document.activeElement : null);

  const run = async (to: string, from: HTMLElement | null) => {
    if (running.current) return;
    running.current = true;
    trigger.current = from;
    setMoving(true);
    setError(null);
    setMoved(null);
    try {
      const result = await client.moveFolder(to);
      if (result.ok) {
        setMoved({
          folder: result.state.config.folder ?? to,
          ...(result.leftBehind ? { leftBehind: result.leftBehind } : {}),
          historyLeftBehind: result.historyLeftBehind === true,
        });
        onChangeRef.current(result.state);
      } else {
        fail(result.error);
        // The state as it is now: the folder stayed, but what the window shows may be stale.
        if (result.state) onChangeRef.current(result.state);
      }
    } catch {
      fail("failed");
    } finally {
      running.current = false;
      setMoving(false);
    }
  };

  return {
    moving,
    error,
    moved,
    failures,
    trigger,
    move: (to) => run(to, focused()),
    chooseAnother: async (folder) => {
      if (running.current) return;
      const from = focused();
      let picked;
      try {
        picked = await client.pickFolder(parentOf(folder));
      } catch {
        trigger.current = from;
        setMoved(null);
        return fail("pick");
      }
      if (picked) await run(inside(picked.folder, folderName(folder)), from);
    },
  };
}

/** The places the folder can move to: each synced place (but the one it is in) and "Choose another place…". */
export function MovePlaces({ state, move, children }: { state: AppState; move: FolderMove; children?: ReactNode }) {
  const { t } = useTranslation();
  const folder = state.config.folder;
  if (!folder) return null;
  // Two accounts of one provider would read the same: the account tells them apart.
  const moveLabel = (l: SyncLocationView) => {
    const provider = t(`backup.provider.${l.provider}`);
    return l.account ? t("backup.moveToAccount", { provider, account: l.account }) : t("backup.moveTo", { provider });
  };
  const places = (state.backup?.locations ?? []).filter((l) => inside(l.path, folderName(folder)) !== folder);
  return (
    <div className="hh-backup-actions" aria-busy={move.moving}>
      {places.map((l) => (
        <button key={l.path} disabled={move.moving} onClick={() => void move.move(inside(l.path, folderName(folder)))}>
          {moveLabel(l)}
        </button>
      ))}
      <button disabled={move.moving} onClick={() => void move.chooseAnother(folder)}>
        {t("backup.chooseAnother")}
      </button>
      {children}
    </div>
  );
}

const inert = (el: Element) => el.closest("[inert]") !== null;

/**
 * The quiet backup notice (spec 3d §2): move the folder to a synced place or another place the person picks,
 * or say there is already a copy. Its status line is always there (screen readers hear it change): a move
 * running, where the folder is now and what stayed behind. Each failed move shows its own message; the
 * folder stays where it was. `move` is the app's (HarnessApp); without it the notice keeps its own.
 */
export function BackupNotice({ client, state, onChange, move: shared }: { client: HarnessClient; state: AppState; onChange: (s: AppState) => void; move?: FolderMove }) {
  const { t } = useTranslation();
  const own = useFolderMove(client, onChange);
  const move = shared ?? own;
  const [dismissFailed, setDismissFailed] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const statusRef = useRef<HTMLParagraphElement>(null);
  const alertRef = useRef<HTMLDivElement>(null);
  const handled = useRef(move.failures);
  const folder = state.config.folder;
  const show = needsBackupNotice(state);

  // A failed move: focus goes back to the button that started it, or to the message when that button is gone.
  useEffect(() => {
    if (move.moving || move.failures === handled.current) return;
    handled.current = move.failures;
    const alert = alertRef.current;
    if (!alert || inert(alert)) return;
    const from = move.trigger.current;
    if (from?.isConnected && !(from as HTMLButtonElement).disabled && !inert(from)) from.focus();
    else alert.focus();
  }, [move.failures, move.moving]);

  // "I already have a copy": the notice goes away, so focus goes to the line saying what happened.
  useEffect(() => {
    if (dismissed && !show && statusRef.current && !inert(statusRef.current)) statusRef.current.focus();
  }, [dismissed, show]);

  if (!folder) return null;

  const dismiss = () => {
    setDismissFailed(false);
    client.saveConfig({ backupDismissed: true }).then(
      (s) => {
        setDismissed(true);
        onChange(s);
      },
      () => setDismissFailed(true),
    );
  };

  const moved = move.moved;
  const status = move.moving
    ? t("backup.moving")
    : moved
      ? [
          t("backup.moved", { path: moved.folder }),
          ...(moved.leftBehind ? [t("backup.leftBehind", { path: moved.leftBehind })] : []),
          ...(moved.historyLeftBehind ? [t("backup.historyLeftBehind")] : []),
        ].join(" ")
      : dismissed && !show
        ? t("backup.dismissedNow")
        : "";
  const problem = move.error ? t(`backup.moveError.${move.error}`) : dismissFailed && show ? t("backup.dismissError") : null;

  // The notice comes and goes; the status line and the alert keep their places, so the status stays mounted.
  return (
    <>
      {show && (
        <section className="hh-backup-notice" aria-label={t("backup.title")}>
          <p>{t("backup.notice")}</p>
          <MovePlaces state={state} move={move}>
            <button disabled={move.moving} onClick={dismiss}>
              {t("backup.dismiss")}
            </button>
          </MovePlaces>
        </section>
      )}
      <p ref={statusRef} className="hh-backup-status" role="status" tabIndex={-1}>
        {status}
      </p>
      {problem && (
        <div ref={alertRef} className="hh-error" role="alert" tabIndex={-1}>
          <p>{problem}</p>
        </div>
      )}
    </>
  );
}
