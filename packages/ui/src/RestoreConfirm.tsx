import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { FileRestorePrompt } from "./client";
import { authorName, timeAgo } from "./FileTimeline";

/**
 * The core's "go back?" (file-timeline spec §5): says which file, to whose version and when, and that nothing else in
 * the folder changes. Cancel has focus first; Esc cancels.
 */
export function RestoreConfirm({ prompt, onAnswer }: { prompt: FileRestorePrompt; onAnswer: (yes: boolean) => void }) {
  const { t, i18n } = useTranslation();
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => cancel.current?.focus(), []);
  const author = prompt.kind === "approval" && prompt.version ? t("timeline.approved", { version: prompt.version }) : authorName(t, prompt.author);
  return (
    <div className="hh-restore-backdrop">
      <div
        className="hh-restore-confirm"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="hh-restore-confirm-text"
        onKeyDown={(e) => {
          if (e.key !== "Escape") return;
          e.preventDefault();
          onAnswer(false);
        }}
      >
        <p id="hh-restore-confirm-text">{t("timeline.confirm", { file: prompt.path, author, ago: timeAgo(prompt.at, i18n.language) })}</p>
        <div className="hh-restore-actions">
          <button type="button" ref={cancel} onClick={() => onAnswer(false)}>
            {t("timeline.cancel")}
          </button>
          <button type="button" className="hh-primary" onClick={() => onAnswer(true)}>
            {t("timeline.confirmYes")}
          </button>
        </div>
      </div>
    </div>
  );
}
