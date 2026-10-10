import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { HarnessClient, HistoryItem } from "./client";

export function HistoryPanel({ client, onClose }: { client: HarnessClient; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const [items, setItems] = useState<HistoryItem[] | null>(null);
  useEffect(() => {
    void client.history().then(setItems);
  }, [client]);
  return (
    <aside className="hh-history" aria-label={t("history.title")}>
      <header>
        <h2>{t("history.title")}</h2>
        <button onClick={onClose}>{t("history.close")}</button>
      </header>
      {items?.length === 0 && <p>{t("history.empty")}</p>}
      <ol>
        {items?.map((item) => (
          <li key={item.sha}>
            <span>{item.message}</span>
            <time>{new Date(item.date).toLocaleString(i18n.language)}</time>
            <button onClick={() => void client.restore(item.sha).then(onClose)}>{t("history.restore")}</button>
          </li>
        ))}
      </ol>
    </aside>
  );
}
