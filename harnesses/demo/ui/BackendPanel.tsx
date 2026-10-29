import { type HarnessClient, useBackend } from "@humanharness/ui";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

/**
 * The side panel's Backend section: "Echo" calls the demo's backend and shows its answer, "Stream" asks for three
 * `tick` events and lists them as they come (hatches spec §4).
 */
export function BackendPanel({ client }: { client: HarnessClient }) {
  const { t } = useTranslation("harness");
  const backend = useBackend(client);
  const [echo, setEcho] = useState<string | null>(null);
  const [ticks, setTicks] = useState<number[]>([]);
  const [sent, setSent] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { on } = backend;
  useEffect(() => on("tick", (data) => setTicks((all) => [...all, Number((data as { i?: unknown } | null)?.i)])), [on]);
  const fail = (err: unknown) => setError(err instanceof Error ? err.message : String(err));
  const doEcho = () => {
    setError(null);
    backend.call("echo", { text: "hello" }).then((r) => {
      const answer = r as { echo?: { text?: unknown }; mock?: unknown };
      setEcho(t("backend.echoed", { text: String(answer.echo?.text), mock: String(answer.mock) }));
    }, fail);
  };
  const doStream = () => {
    setError(null);
    setTicks([]);
    setSent(null);
    backend.call("stream", { n: 3 }).then((r) => setSent(Number((r as { sent?: unknown }).sent)), fail);
  };
  return (
    <section className="demo-backend" aria-label={t("backend.title")}>
      <span className="demo-kicker">{t("backend.title")}</span>
      <div className="demo-backend-buttons">
        <button type="button" onClick={doEcho}>
          {t("backend.echo")}
        </button>
        <button type="button" onClick={doStream}>
          {t("backend.stream")}
        </button>
      </div>
      {echo !== null && <p data-testid="demo-backend-echo">{echo}</p>}
      {ticks.length > 0 && (
        <ol aria-label={t("backend.ticks")}>
          {ticks.map((i, n) => (
            <li key={n}>{t("backend.tick", { i })}</li>
          ))}
        </ol>
      )}
      {sent !== null && <p data-testid="demo-backend-sent">{t("backend.sent", { n: sent })}</p>}
      {error !== null && <p role="alert">{error}</p>}
    </section>
  );
}
