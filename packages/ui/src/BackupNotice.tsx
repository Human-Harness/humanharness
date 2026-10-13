import { useState } from "react";
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

/**
 * The quiet backup notice (spec 3d §2): move the folder to a synced place or another place the person picks,
 * or say there is already a copy. Each failed move shows its own message; the folder stays where it was.
 */
export function BackupNotice({ client, state, onChange }: { client: HarnessClient; state: AppState; onChange: (s: AppState) => void }) {
  const { t } = useTranslation();
  const [moving, setMoving] = useState(false);
  const [error, setError] = useState<MoveError | null>(null);
  const [leftBehind, setLeftBehind] = useState<string | null>(null);
  const folder = state.config.folder;

  if (!folder) return null;
  if (!needsBackupNotice(state)) {
    return leftBehind ? (
      <p className="hh-backup-notice" role="status">
        {t("backup.leftBehind", { path: leftBehind })}
      </p>
    ) : null;
  }

  const move = async (to: string) => {
    setMoving(true);
    setError(null);
    try {
      const result = await client.moveFolder(to);
      if (result.ok) {
        if (result.leftBehind) setLeftBehind(result.leftBehind);
        onChange(result.state);
      } else setError(result.error);
    } catch {
      setError("failed");
    } finally {
      setMoving(false);
    }
  };
  // The person picks the place; the folder goes inside it with its own name (the main process checks the place).
  const chooseAnother = async () => {
    const picked = await client.pickFolder(parentOf(folder)).catch(() => null);
    if (picked) await move(inside(picked.folder, folderName(folder)));
  };
  const dismiss = () => void client.saveConfig({ backupDismissed: true }).then(onChange, () => {});
  // Two accounts of one provider would read the same: the account tells them apart.
  const moveLabel = (l: SyncLocationView) => {
    const provider = t(`backup.provider.${l.provider}`);
    return l.account ? t("backup.moveToAccount", { provider, account: l.account }) : t("backup.moveTo", { provider });
  };

  return (
    <section className="hh-backup-notice" aria-label={t("backup.title")}>
      <p>{t("backup.notice")}</p>
      {error && (
        <div className="hh-error" role="alert">
          <p>{t(`backup.moveError.${error}`)}</p>
        </div>
      )}
      {moving ? (
        <p role="status">{t("backup.moving")}</p>
      ) : (
        <div className="hh-backup-actions">
          {(state.backup?.locations ?? []).map((l) => (
            <button key={l.path} onClick={() => void move(inside(l.path, folderName(folder)))}>
              {moveLabel(l)}
            </button>
          ))}
          <button onClick={() => void chooseAnother()}>{t("backup.chooseAnother")}</button>
          <button onClick={dismiss}>{t("backup.dismiss")}</button>
        </div>
      )}
    </section>
  );
}
