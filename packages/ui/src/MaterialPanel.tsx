import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import type { HarnessClient, MaterialAddResult, MaterialInfo, MaterialSourceView, MaterialView } from "./client";
import { shownLanguage } from "./language";

export interface MaterialPanelProps {
  client: HarnessClient;
  /** The scope whose material is shown (`main` without scopes). */
  scope: string;
  /** What the harness takes (manifest `material`). */
  info: MaterialInfo;
  /** A turn or a switch runs: adding waits. */
  disabled: boolean;
}

/** The refusal reasons the strings know; anything else reads as "unreadable". */
const REFUSALS = ["media", "old-office", "binary", "unreadable", "scanned", "protected", "too-big", "not-accepted", "fetch", "storage"];

/** The scope's material, kept up to date from the main process (`hh:materialStatus`). */
export function useMaterial(client: HarnessClient, scope: string): MaterialView | null {
  const [view, setView] = useState<MaterialView | null>(null);
  useEffect(() => {
    let live = true;
    setView(null);
    const off = client.material.onChange((v) => {
      if (live && v.scope === scope) setView(v);
    });
    client.material.list(scope).then(
      // An update that has arrived is newer than the first reply, which may have been in flight before it.
      (v) => live && setView((now) => now ?? v),
      () => undefined,
    );
    return () => {
      live = false;
      off();
    };
  }, [client, scope]);
  return view;
}

/** A source waiting for the person (§7): what it costs, where it goes, and what to process. */
function WaitingCard({ client, scope, source, view }: { client: HarnessClient; scope: string; source: MaterialSourceView; view: MaterialView }) {
  const { t, i18n } = useTranslation();
  const fmt = (n: number) => n.toLocaleString(shownLanguage(i18n));
  const [from, setFrom] = useState(1);
  const [to, setTo] = useState(Math.max(1, Math.min(source.pages, 50)));
  const vars = { name: source.name, pages: fmt(source.pages), rows: fmt(source.rows ?? 0), tokens: fmt(source.estimate) };
  const text =
    source.notice === "max"
      ? t("material.max", vars)
      : source.notice === "rows"
        ? t("material.rows", vars)
        : source.notice === "no-text-pages"
          ? t("material.noTextPages", vars)
          : t("material.warn", vars);
  const ranged = source.notice === "warn" || source.notice === "max";
  const rangeOk = Number.isInteger(from) && Number.isInteger(to) && from >= 1 && from <= to && to <= source.pages;
  return (
    <div className="hh-material-card" role="group" aria-label={source.name}>
      <p>{text}</p>
      {view.window && <p>{t("material.window", { window: view.window.kind, percent: Math.round(view.window.utilization * 100) })}</p>}
      <p className="hh-material-privacy">{t("material.privacy", { provider: view.provider })}</p>
      {ranged && (
        <div className="hh-material-range">
          <label>
            {t("material.from")}
            <input type="number" min={1} max={source.pages} value={from} onChange={(e) => setFrom(Number(e.target.value))} />
          </label>
          <label>
            {t("material.to")}
            <input type="number" min={1} max={source.pages} value={to} onChange={(e) => setTo(Number(e.target.value))} />
          </label>
          <button type="button" disabled={!rangeOk} onClick={() => void client.material.confirm(scope, source.id, { pageRange: [from, to] })}>
            {t("material.range")}
          </button>
        </div>
      )}
      <div className="hh-material-actions">
        {source.notice === "rows" && (
          <button type="button" onClick={() => void client.material.confirm(scope, source.id, { sheets: "summary" })}>
            {t("material.summary")}
          </button>
        )}
        {/* At the hard limit only a page range goes on. */}
        {source.notice !== "max" && (
          <button type="button" onClick={() => void client.material.confirm(scope, source.id, {})}>
            {source.notice === "no-text-pages" ? t("material.goOn") : t("material.all")}
          </button>
        )}
      </div>
    </div>
  );
}

/** One line per source (§11). */
export function statusLine(t: (k: string, o?: Record<string, unknown>) => string, s: MaterialSourceView): string {
  if (s.status === "refused") {
    const reason = s.refusal && REFUSALS.includes(s.refusal) ? s.refusal : "unreadable";
    return t("material.status.refused", { name: s.name, message: t(`material.refusal.${reason}`) });
  }
  if (s.status === "ready") return s.failed ? t("material.status.readyFailed", { name: s.name }) : t("material.status.ready", { name: s.name, count: s.fragments });
  if (s.status === "validating") return t(`material.status.${s.stage ?? "review"}`, { name: s.name });
  return t(`material.status.${s.status}`, { name: s.name });
}

/** The default material panel (material spec §11): add a file or a link, the waiting sources' cards, a line per source. */
export function MaterialPanel({ client, scope, disabled }: MaterialPanelProps) {
  const { t } = useTranslation();
  const headingId = useId();
  const view = useMaterial(client, scope);
  const [linking, setLinking] = useState(false);
  const [url, setUrl] = useState("");
  const [notice, setNotice] = useState<string[]>([]);
  const report = (r: MaterialAddResult) => {
    if (!r.ok) setNotice(r.reason === "fetch" ? [t("material.linkFailed")] : []);
    else
      setNotice([
        ...r.refused.map((x) => t("material.refusedFile", { name: x.name, message: x.message })),
        // §13.3: a source processed at once still tells the person, once, where its parts go.
        ...(r.added.length > 0 && view ? [t("material.privacy", { provider: view.provider })] : []),
      ]);
  };
  // A removed source is gone for the person (its original is in the Trash).
  const sources = (view?.sources ?? []).filter((s) => s.status !== "removed");
  return (
    <section className="hh-material" aria-labelledby={headingId}>
      <h2 id={headingId} className="hh-flow-heading">
        {t("material.title")}
      </h2>
      <div className="hh-material-actions">
        <button type="button" disabled={disabled} onClick={() => void client.material.add(scope).then(report, () => undefined)}>
          {t("material.addFile")}
        </button>
        <button type="button" disabled={disabled} onClick={() => setLinking((v) => !v)}>
          {t("material.addLink")}
        </button>
      </div>
      {linking && (
        <form
          className="hh-material-link"
          onSubmit={(e) => {
            e.preventDefault();
            if (disabled || !url.trim()) return;
            void client.material.addLink(scope, url.trim()).then(report, () => undefined);
            setLinking(false);
            setUrl("");
          }}
        >
          <input type="url" aria-label={t("material.link")} value={url} onChange={(e) => setUrl(e.target.value)} />
          <button type="submit" disabled={disabled || !url.trim()}>
            {t("material.add")}
          </button>
        </form>
      )}
      {notice.map((n) => (
        <p key={n} className="hh-material-notice" role="status">
          {n}
        </p>
      ))}
      {sources.map((s) =>
        s.status === "pending" && view ? (
          <WaitingCard key={s.id} client={client} scope={scope} source={s} view={view} />
        ) : (
          <p key={s.id} className="hh-material-line">
            <span>{statusLine(t, s)}</span>
            {/* A stage that failed is not retried on its own (§13): the person asks for it. */}
            {s.status === "ready" && s.failed && (
              <>
                {" "}
                <button type="button" disabled={disabled} onClick={() => void client.material.retry(scope, s.id).catch(() => undefined)}>
                  {t("material.retry")}
                </button>
              </>
            )}
          </p>
        ),
      )}
    </section>
  );
}
