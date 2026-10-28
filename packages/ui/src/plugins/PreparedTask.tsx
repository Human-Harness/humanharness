import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { HarnessClient, PreparedTaskView } from "../client";

/**
 * The prepared task a plugin proposed (plugins part 2, Decision 10): its title, who proposed it, the full prompt and the
 * tier, with Start and Cancel. Nothing starts without the person's click on Start (P6), and what is shown is exactly
 * main's prompt, as plain text (P9, P13): Start sends only the token, so main starts what this card showed. The card
 * leaves when main's surface push clears it (taken or cancelled); a refusal keeps it, with main's message.
 */
export function PreparedTask({
  client,
  prepared,
  blocked,
  needScope,
  closesTask,
}: {
  client: HarnessClient;
  prepared: PreparedTaskView;
  /** A turn runs, a task closes…: Start waits. */
  blocked: boolean;
  /** The card needs the open scope and none is open: the scope's label, for the hint. */
  needScope: string | null;
  /** A task is open, and Start closes it first. */
  closesTask: boolean;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Set at once on click (before any render), so a double click starts nothing twice. */
  const starting = useRef(false);
  const token = prepared.token;

  const start = async () => {
    if (starting.current) return;
    starting.current = true;
    setBusy(true);
    setError(null);
    let ok = false;
    try {
      const r = await client.plugins.startPrepared(token);
      ok = r.ok;
      if (!r.ok) setError(r.message || t("plugins.failed"));
    } catch {
      setError(t("plugins.failed"));
    } finally {
      // Started: the token is spent and main's push takes the card away; nothing more to click.
      if (!ok) {
        starting.current = false;
        setBusy(false);
      }
    }
  };
  const cancel = () => {
    if (starting.current) return;
    void client.plugins.cancelPrepared(token).catch(() => undefined);
  };

  const tier = (["light", "standard", "deep"] as const).includes(prepared.tier) ? t(`models.tier.${prepared.tier}`) : prepared.tier;
  return (
    <section className="hh-pl-prepared" role="region" aria-label={t("plugins.prepared.region")}>
      <p className="hh-pl-prepared-title" dir="auto">
        <strong>{prepared.title}</strong>
      </p>
      <p className="hh-pl-prepared-meta">
        {/* The plugin's name in its own direction (first-strong isolate), so it can't flip the line around it. */}
        <span>{t("plugins.prepared.by", { name: `⁨${prepared.pluginName}⁩` })}</span>
        <span>{t("plugins.prepared.tier", { tier })}</span>
      </p>
      <pre className="hh-pl-prepared-prompt" dir="auto" tabIndex={0} aria-label={t("plugins.prepared.prompt")}>
        {prepared.prompt}
      </pre>
      {closesTask && <p className="hh-pl-prepared-note">{t("plugins.prepared.closes")}</p>}
      {needScope !== null && <p className="hh-pl-prepared-note">{t("plugins.prepared.needScope", { scope: needScope })}</p>}
      {error !== null && (
        <p className="hh-pl-prepared-error" role="alert" dir="auto">
          {error}
        </p>
      )}
      <div className="hh-pl-actions">
        <button type="button" className="hh-primary" disabled={busy || blocked || needScope !== null} onClick={() => void start()}>
          {t("plugins.prepared.start")}
        </button>
        <button type="button" disabled={busy} onClick={cancel}>
          {t("plugins.prepared.cancel")}
        </button>
      </div>
    </section>
  );
}
