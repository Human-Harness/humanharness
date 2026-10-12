import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { HarnessClient, HistoryItem } from "./client";

export function HistoryPanel({
  client,
  onClose,
  onRestored,
  disabled = false,
}: {
  client: HarnessClient;
  onClose: () => void;
  /** Called after a restore succeeded, before the panel closes. */
  onRestored?: () => void;
  /** Restoring is not allowed while a turn is live. */
  disabled?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const [items, setItems] = useState<HistoryItem[] | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  /** What had focus when the panel opened: it gets focus back when the panel closes. */
  const opener = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  // Reads only refs, so the Escape listener added on the first render can call it.
  const close = () => {
    const back = opener.current;
    onCloseRef.current();
    if (back?.isConnected) back.focus();
  };
  useEffect(() => {
    void client.history().then(setItems);
  }, [client]);
  useEffect(() => {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      // A dialog above it (the pre-flight question) handled this Escape itself.
      if (e.key === "Escape" && !e.defaultPrevented) close();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const restore = (sha: string) => {
    setFailed(false);
    client.restore(sha).then(
      () => {
        onRestored?.();
        close();
      },
      () => {
        setConfirming(null);
        setFailed(true);
      },
    );
  };

  return (
    <aside className="hh-history" role="dialog" aria-modal="true" aria-label={t("history.title")}>
      <header>
        <h2>{t("history.title")}</h2>
        <button ref={closeRef} onClick={close}>
          {t("history.close")}
        </button>
      </header>
      {failed && <p role="alert">{t("history.restoreFailed")}</p>}
      {items?.length === 0 && <p>{t("history.empty")}</p>}
      <ol>
        {items?.map((item) => (
          <li key={item.sha}>
            <span>{item.message}</span>
            <time>{new Date(item.date).toLocaleString(i18n.language)}</time>
            {confirming === item.sha && !disabled ? (
              <div className="hh-confirm">
                <p>{t("history.confirm")}</p>
                <button onClick={() => restore(item.sha)}>{t("history.confirmYes")}</button>
                <button onClick={() => setConfirming(null)}>{t("history.cancel")}</button>
              </div>
            ) : (
              <button disabled={disabled} onClick={() => setConfirming(item.sha)}>
                {t("history.restore")}
              </button>
            )}
          </li>
        ))}
      </ol>
    </aside>
  );
}
