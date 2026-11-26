import { createContext, useContext, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

/**
 * "Sends anyway in N s · ⌘⏎ sends now": the review countdown's text equivalent (accessibility). Without `sendKey` (the
 * answer form, whose Send now is a button) only the countdown. Who reviews (`ReviewerName`) is said while the wait has no end.
 */
export function ReviewHint({ until, sendKey }: { until: number | null; sendKey?: string }) {
  const { t } = useTranslation();
  const name = useContext(ReviewerName);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, []);
  const left = until === null ? null : Math.max(0, Math.ceil((until - now) / 1000));
  const wait = left === null ? (name ? t("chat.reviewWaitingFor", { name }) : t("chat.reviewWaiting")) : t("chat.reviewCountdown", { seconds: left });
  return <p className="hh-sk-composer-hint">{sendKey === undefined ? wait : `${wait} · ${t("chat.sendNowKey", { key: sendKey })}`}</p>;
}

/** Who reviews the open task's sends (the reviewer's `name`), for the hints of the composer and the answer forms. */
export const ReviewerName = createContext<string | undefined>(undefined);
