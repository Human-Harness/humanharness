import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

/**
 * "Sends anyway in N s · ⌘⏎ sends now": the countdown's text equivalent (sidekick spec §7 accessibility). Without
 * `sendKey` (the answer form, whose Send now is a button) only the countdown.
 */
export function ReviewHint({ until, sendKey }: { until: number | null; sendKey?: string }) {
  const { t } = useTranslation();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, []);
  const left = until === null ? null : Math.max(0, Math.ceil((until - now) / 1000));
  const wait = left === null ? t("sidekick.composer.waitingLong") : t("sidekick.composer.countdown", { seconds: left });
  return <p className="hh-sk-composer-hint">{sendKey === undefined ? wait : `${wait} · ${t("sidekick.sendNow", { key: sendKey })}`}</p>;
}
