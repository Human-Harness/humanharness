import { useEffect, useId, useRef } from "react";
import { Trans, useTranslation } from "react-i18next";
import type { Language } from "@humanharness/harness-sdk/language";
import { ownName } from "./language";
import { trapTab } from "./SettingsSheet";

/**
 * The notice before a translation run (spec §4, D3): what will run, on whose engine, and that legal texts stay English.
 * Nothing is sent before Translate. Cancel has focus first; Escape cancels; Tab stays inside; focus returns on close.
 * The one bold word is a `<b>` the translation must keep (Decision 16); only `b` maps to an element and no other tag is
 * kept as HTML. The names are escaped before the markup is read and unescaped as text, so a harness or engine name
 * with `<…>` in it shows as written and makes no element.
 */
export function TranslateNotice({
  tag,
  harnessName,
  engineName,
  onTranslate,
  onCancel,
  busy = false,
  error = null,
}: {
  tag: Language;
  harnessName: string;
  engineName: string;
  onTranslate: () => void;
  onCancel: () => void;
  /** The run is starting: Translate is off. */
  busy?: boolean;
  /** Why the last Translate started nothing, shown inside the dialog. */
  error?: string | null;
}) {
  const { t } = useTranslation();
  const id = useId();
  const dialog = useRef<HTMLDivElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    cancel.current?.focus();
    return () => {
      if (opener?.isConnected && opener.closest("[inert]") === null) opener.focus();
    };
  }, []);
  return (
    <div className="hh-langnotice-backdrop" onMouseDown={(e) => e.target === e.currentTarget && e.preventDefault()}>
      <div
        ref={dialog}
        className="hh-langnotice"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-text`}
        aria-busy={busy || undefined}
        onKeyDown={(e) => {
          if (e.key === "Tab" && dialog.current) {
            e.stopPropagation();
            trapTab(dialog.current, e.nativeEvent);
          }
          if (e.key !== "Escape") return;
          e.preventDefault();
          e.stopPropagation();
          onCancel();
        }}
      >
        <p id={`${id}-title`}>
          <strong>{t("language.noticeTitle")}</strong>
        </p>
        <p id={`${id}-text`}>
          <Trans
            i18nKey="language.notice"
            values={{ name: harnessName, language: ownName(tag), engine: engineName }}
            tOptions={{ interpolation: { escapeValue: true } }}
            shouldUnescape
            components={{ b: <strong lang={tag} /> }}
          />
        </p>
        {error && (
          <p className="hh-save-error" role="alert">
            {error}
          </p>
        )}
        <div className="hh-langnotice-actions">
          <button type="button" ref={cancel} onClick={onCancel}>
            {t("language.cancel")}
          </button>
          <button type="button" className="hh-primary" disabled={busy} onClick={onTranslate}>
            {t("language.translate")}
          </button>
        </div>
      </div>
    </div>
  );
}
