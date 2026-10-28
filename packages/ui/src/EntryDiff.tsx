import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { FileRestoreResult, HarnessClient, TimelineEntry } from "./client";
import { FileDiff } from "./FileDiff";

/** One entry's diff (file-timeline spec §4.1, §6.1): what changed here or against now, and going back to it. */
export function EntryDiff({
  client,
  path,
  entry,
  busy = false,
  backLabel,
  onBack,
  onRestored,
}: {
  client: HarnessClient;
  path: string;
  entry: TimelineEntry;
  /** A turn runs: going back waits. */
  busy?: boolean;
  /** "Back to the document" (default) or "Back to the list". */
  backLabel?: string;
  onBack: () => void;
  onRestored?: () => void;
}) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<"here" | "current">("here");
  const [status, setStatus] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  // Another entry or file: the last go-back's answer belonged to the one before.
  useEffect(() => setStatus(null), [path, entry.to]);
  const from = mode === "here" ? entry.from : entry.to;
  const to = mode === "here" ? entry.to : "current";
  const goBack = async () => {
    setWorking(true);
    setStatus(null);
    const r: FileRestoreResult = await client.files.restore(path, entry.to).catch(() => ({ refused: "failed" as const }));
    if (!live.current) return;
    setWorking(false);
    if (r === "cancelled") return;
    if (r === "restored") {
      setStatus(t("timeline.restored", { file: path }));
      onRestored?.();
      return;
    }
    const known = r.refused === "busy" || r.refused === "deleted" || r.refused === "unsafe";
    setStatus(t(known ? `timeline.refused.${r.refused}` : "timeline.refused.other"));
  };
  return (
    <div className="hh-entrydiff">
      <div className="hh-entrydiff-tools">
        <div className="hh-segmented" role="group" aria-label={t("timeline.compare")}>
          <button type="button" aria-pressed={mode === "here"} onClick={() => setMode("here")}>
            {t("timeline.compareHere")}
          </button>
          <button type="button" aria-pressed={mode === "current"} onClick={() => setMode("current")}>
            {t("timeline.compareCurrent")}
          </button>
        </div>
        {/* A "Deleted" entry has no file to bring back (§3.1): the button stays, disabled. */}
        <button type="button" disabled={busy || working || entry.deleted === true} onClick={goBack}>
          {t("timeline.goBack")}
        </button>
        <button type="button" onClick={onBack}>
          {backLabel ?? t("timeline.backToDocument")}
        </button>
      </div>
      {busy && <p className="hh-caption">{t("timeline.busy")}</p>}
      {status && (
        <p className="hh-caption" role="status">
          {status}
        </p>
      )}
      {/* Keyed by the pair: a new entry, file or mode starts the diff afresh (its Source toggle included). */}
      <FileDiff key={`${path}:${from}:${to}`} client={client} path={path} from={from} to={to} />
    </div>
  );
}
