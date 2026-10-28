import { useEffect, useId, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { FileRestorePrompt } from "./client";
import { authorName, timeAgo } from "./FileTimeline";
import { trapTab } from "./SettingsSheet";

/**
 * The core's "go back?" (file-timeline spec §5): says which file, to whose version and when, and that nothing else in
 * the folder changes. Cancel has focus first; Esc cancels; Tab stays inside; on close, focus goes back to what had it.
 */
export function RestoreConfirm({ prompt, onAnswer }: { prompt: FileRestorePrompt; onAnswer: (yes: boolean) => void }) {
  const { t, i18n } = useTranslation();
  const dialog = useRef<HTMLDivElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const id = useId();
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    cancel.current?.focus();
    return () => {
      // Still there and usable: it gets focus back (EntryDiff refocuses its own button once the restore settles).
      if (opener?.isConnected && !(opener as HTMLButtonElement).disabled && opener.closest("[inert]") === null) opener.focus();
    };
  }, []);
  const ago = timeAgo(prompt.at, i18n.language);
  const text =
    prompt.kind === "approval" && prompt.version
      ? t("timeline.confirmApproval", { file: prompt.path, version: prompt.version, ago })
      : t("timeline.confirm", { file: prompt.path, author: authorName(t, prompt.author), ago });
  return (
    <div className="hh-restore-backdrop">
      <div
        ref={dialog}
        className="hh-restore-confirm"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-text`}
        onKeyDown={(e) => {
          if (e.key === "Tab" && dialog.current) trapTab(dialog.current, e.nativeEvent);
          if (e.key !== "Escape") return;
          e.preventDefault();
          onAnswer(false);
        }}
      >
        <p id={`${id}-title`}>
          <strong>{t("timeline.confirmTitle")}</strong>
        </p>
        <p id={`${id}-text`}>{text}</p>
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
