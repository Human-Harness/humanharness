import { useEffect, useId, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { AppState, HarnessClient } from "../client";
import { trapTab } from "../focus";
import { LinkedFolders } from "./LinkedFolders";

/**
 * A scope's settings (hatches spec §3.2), opened from the scope picker: its linked folders (part 3 adds the engine
 * section). A dialog like the Settings sheet: Tab stays inside, Escape closes, focus goes back to what opened it.
 */
export function ScopeSettings({
  client,
  state,
  scope,
  title,
  onClose,
}: {
  client: HarnessClient;
  state: AppState;
  scope: string;
  /** The scope's title, in the dialog's name. */
  title: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const titleId = useId();
  const sheetRef = useRef<HTMLDivElement>(null);
  const doneRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    // What opened it gets focus back (never the page itself: the caller may have put focus somewhere already).
    const opener = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
    doneRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      const sheet = sheetRef.current;
      if (!sheet) return;
      if (e.key === "Escape") {
        // Handled: focus mode's window listener leaves this Escape alone.
        e.preventDefault();
        onCloseRef.current();
      }
      if (e.key === "Tab") trapTab(sheet, e);
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      if (opener?.isConnected) opener.focus();
    };
  }, []);
  const linked = state.hatches?.linkedFolders;
  return (
    <div
      className="hh-sheet-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div ref={sheetRef} className="hh-sheet hh-scope-settings" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="hh-sheet-head">
          <h2 id={titleId}>{t("hatches.scopeSettings", { scope: title })}</h2>
          <button ref={doneRef} className="hh-primary" onClick={onClose}>
            {t("settings.done")}
          </button>
        </div>
        {linked && <LinkedFolders client={client} scope={scope} declared={linked} scopeLabel={state.scopes?.label ?? ""} />}
      </div>
    </div>
  );
}
