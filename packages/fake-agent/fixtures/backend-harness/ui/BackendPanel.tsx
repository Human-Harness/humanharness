// A type-only import: the parent passes `useBackend(client)` in, so this file needs no value import from the core
// (and the fake-agent package needs no dependency on the UI package, which would loop its node_modules).
import type { UseBackend } from "@humanharness/ui";
import { useEffect, useState } from "react";
import en from "../locales/en.json";

type Key = keyof typeof en.backend;
/** The fixture's own strings: the panel sits outside HarnessApp, so it has no i18n provider to read them from. */
const t = (key: `backend.${Key}`, vars: Record<string, unknown> = {}) =>
  en.backend[key.slice("backend.".length) as Key].replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(vars[name]));

/**
 * The fixture panel's Backend section: "Echo" calls the fixture's backend and shows its answer, "Stream" asks for three
 * `tick` events and lists them as they come (hatches spec §4).
 */
export function BackendPanel({ backend }: { backend: UseBackend }) {
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
    <section className="fx-backend" aria-label={t("backend.title")}>
      <span className="fx-backend-kicker">{t("backend.title")}</span>
      <div className="fx-backend-buttons">
        <button type="button" onClick={doEcho}>
          {t("backend.echo")}
        </button>
        <button type="button" onClick={doStream}>
          {t("backend.stream")}
        </button>
      </div>
      {echo !== null && <p data-testid="fx-backend-echo">{echo}</p>}
      {ticks.length > 0 && (
        <ol aria-label={t("backend.ticks")}>
          {ticks.map((i, n) => (
            <li key={n}>{t("backend.tick", { i })}</li>
          ))}
        </ol>
      )}
      {sent !== null && <p data-testid="fx-backend-sent">{t("backend.sent", { n: sent })}</p>}
      {error !== null && <p role="alert">{error}</p>}
    </section>
  );
}
