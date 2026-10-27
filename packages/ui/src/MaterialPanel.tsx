import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import type { HarnessClient, MaterialAddResult, MaterialChoice, MaterialInfo, MaterialResult, MaterialSourceView, MaterialView } from "./client";
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

type Translate = (k: string, o?: Record<string, unknown>) => string;
type ConfirmChoice = Parameters<HarnessClient["material"]["confirm"]>[2];

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

/** The usage window's name the way Settings › Usage says it ("5-hour"), or a plain "Limit". */
function windowLabel(t: Translate, kind: string): string {
  return t(`usage.long.${kind}`, { defaultValue: t(`usage.${kind}`, { defaultValue: t("usage.limit") }) });
}

/** A source waiting for the person (§7): what it costs, where it goes, and what to process. */
function WaitingCard({
  client,
  scope,
  source,
  view,
  maxPages,
  disabled,
}: {
  client: HarnessClient;
  scope: string;
  source: MaterialSourceView;
  view: MaterialView;
  maxPages: number;
  disabled: boolean;
}) {
  const { t, i18n } = useTranslation();
  const fmt = (n: number) => n.toLocaleString(shownLanguage(i18n));
  // At the hard limit a range must be shorter than `maxPages`: the main process leaves a wider one waiting.
  const widest = source.notice === "max" ? Math.max(1, maxPages - 1) : source.pages;
  const [from, setFrom] = useState(1);
  const [to, setTo] = useState(Math.max(1, Math.min(source.pages, 50, widest)));
  const [busy, setBusy] = useState(false);
  /** The answer that didn't go through, to send again with Try again. */
  const [failed, setFailed] = useState<(() => Promise<MaterialResult>) | null>(null);
  const vars = {
    name: source.name,
    pages: fmt(source.pages),
    rows: fmt(source.rows ?? 0),
    tokens: fmt(source.estimate),
    limit: fmt(widest),
    count: source.fragments,
    fragments: fmt(source.fragments),
  };
  const text =
    source.notice === "max"
      ? t("material.max", vars)
      : source.notice === "rows"
        ? t("material.rows", vars)
        : source.notice === "no-text-pages"
          ? t("material.noTextPages", vars)
          : source.notice === "full-review"
            ? t("material.fullReview", vars)
            : t("material.warn", vars);
  const ranged = source.notice === "warn" || source.notice === "max";
  const rangeOk = Number.isInteger(from) && Number.isInteger(to) && from >= 1 && from <= to && to <= source.pages && to - from + 1 <= widest;
  const off = disabled || busy;
  const send = (answer: () => Promise<MaterialResult>) => {
    setBusy(true);
    setFailed(null);
    answer().then(
      (r) => {
        setBusy(false);
        if (!r.ok) setFailed(() => answer);
      },
      () => {
        setBusy(false);
        setFailed(() => answer);
      },
    );
  };
  const confirm = (choice: ConfirmChoice) => send(() => client.material.confirm(scope, source.id, choice));
  return (
    <div className="hh-material-card" role="group" aria-label={source.name} aria-busy={busy || undefined}>
      <p>{text}</p>
      {view.window && <p>{t("material.window", { window: windowLabel(t, view.window.kind), percent: Math.round(view.window.utilization * 100) })}</p>}
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
          <button type="button" disabled={off || !rangeOk} onClick={() => confirm({ pageRange: [from, to] })}>
            {t("material.range")}
          </button>
        </div>
      )}
      <div className="hh-material-actions">
        {source.notice === "rows" && (
          <button type="button" disabled={off} onClick={() => confirm({ sheets: "summary" })}>
            {t("material.summary")}
          </button>
        )}
        {/* At the hard limit only a page range goes on. */}
        {source.notice === "full-review" ? (
          <>
            <button type="button" disabled={off} onClick={() => confirm({})}>
              {t("material.checkAll")}
            </button>
            {/* Without it, the source goes on with what the sample found. */}
            <button type="button" disabled={off} onClick={() => send(() => client.material.decide(scope, source.id, null, "use"))}>
              {t("material.skipFullReview")}
            </button>
          </>
        ) : (
          source.notice !== "max" && (
            <button type="button" disabled={off} onClick={() => confirm({})}>
              {source.notice === "no-text-pages" ? t("material.goOn") : t("material.all")}
            </button>
          )
        )}
      </div>
      {busy && (
        <p className="hh-material-notice" role="status">
          {t("material.sending")}
        </p>
      )}
      {failed && (
        <p className="hh-material-notice" role="status">
          {t("material.confirmFailed")}{" "}
          <button type="button" disabled={off} onClick={() => send(failed)}>
            {t("material.retry")}
          </button>
        </p>
      )}
    </div>
  );
}

/** A question for the person (§6.2 `ask`), about one fragment or the whole source; it goes away once answered. */
function AskCard({
  client,
  scope,
  source,
  ask,
  disabled,
}: {
  client: HarnessClient;
  scope: string;
  source: MaterialSourceView;
  ask: MaterialSourceView["asks"][number];
  disabled: boolean;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  /** The answer that didn't go through, to send again with Try again. */
  const [failed, setFailed] = useState<MaterialChoice | null>(null);
  const answer = (choice: MaterialChoice) => {
    setBusy(true);
    setFailed(null);
    client.material.decide(scope, source.id, ask.fragment ?? null, choice).then(
      (r) => {
        setBusy(false);
        if (!r.ok) setFailed(choice);
      },
      () => {
        setBusy(false);
        setFailed(choice);
      },
    );
  };
  const off = disabled || busy;
  return (
    <div className="hh-material-card" role="group" aria-label={ask.question} aria-busy={busy || undefined}>
      <p>{ask.question}</p>
      <div className="hh-material-actions">
        {ask.choices.map((c) => (
          <button key={c} type="button" disabled={off} onClick={() => answer(c)}>
            {t(`material.choice.${c}`)}
          </button>
        ))}
      </div>
      {busy && (
        <p className="hh-material-notice" role="status">
          {t("material.sending")}
        </p>
      )}
      {failed && (
        <p className="hh-material-notice" role="status">
          {t("material.confirmFailed")}{" "}
          <button type="button" disabled={off} onClick={() => answer(failed)}>
            {t("material.retry")}
          </button>
        </p>
      )}
    </div>
  );
}

/** Under a source's status line: its questions, then what the check found and fixed, folded (§11). */
function SourceDetails({ client, scope, source, disabled }: { client: HarnessClient; scope: string; source: MaterialSourceView; disabled: boolean }) {
  const { t } = useTranslation();
  const found = [...source.issues, ...source.fixes];
  return (
    <>
      {source.asks.map((a) => (
        <AskCard key={`${a.fragment ?? "-"}:${a.question}`} client={client} scope={scope} source={source} ask={a} disabled={disabled} />
      ))}
      {found.length > 0 && (
        <details className="hh-material-found">
          <summary>{t("material.found")}</summary>
          <ul>
            {found.map((line, i) => (
              <li key={`${i}:${line}`}>{line}</li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}

/** One line per source (§11). */
export function statusLine(t: Translate, s: MaterialSourceView): string {
  if (s.status === "refused") {
    const reason = s.refusal && REFUSALS.includes(s.refusal) ? s.refusal : "unreadable";
    return t("material.status.refused", { name: s.name, message: t(`material.refusal.${reason}`) });
  }
  if (s.status === "ready") return s.failed ? t("material.status.readyFailed", { name: s.name }) : t("material.status.ready", { name: s.name, count: s.fragments });
  if (s.status === "validating") return t(`material.status.${s.stage ?? "review"}`, { name: s.name });
  return t(`material.status.${s.status}`, { name: s.name });
}

/** The default material panel (material spec §11): add a file or a link, the waiting sources' cards, a line per source. */
export function MaterialPanel({ client, scope, info, disabled }: MaterialPanelProps) {
  const { t } = useTranslation();
  const headingId = useId();
  const view = useMaterial(client, scope);
  const [linking, setLinking] = useState(false);
  const [url, setUrl] = useState("");
  const [notice, setNotice] = useState<string[]>([]);
  const [adding, setAdding] = useState(false);
  const [retrying, setRetrying] = useState<string[]>([]);
  const [grounding, setGrounding] = useState(false);
  const addFailed = () => {
    setAdding(false);
    setNotice([t("material.addFailed")]);
  };
  /** Takes the answer of an add; true when it went through. */
  const report = (r: MaterialAddResult): boolean => {
    setAdding(false);
    if (!r.ok) {
      setNotice([r.reason === "fetch" ? t("material.linkFailed") : t("material.addFailed")]);
      return false;
    }
    setNotice([
      ...r.refused.map((x) => t("material.refusedFile", { name: x.name, message: x.message })),
      // §13.3: a source processed at once still tells the person, once, where its parts go.
      ...(r.added.length > 0 && view ? [t("material.privacy", { provider: view.provider })] : []),
    ]);
    return true;
  };
  const closeLink = () => {
    setLinking(false);
    setUrl("");
  };
  const retry = (id: string) => {
    setRetrying((now) => [...now, id]);
    const done = () => setRetrying((now) => now.filter((x) => x !== id));
    client.material.retry(scope, id).then(done, done);
  };
  const off = disabled || adding;
  // A removed source is gone for the person (its original is in the Trash).
  const sources = (view?.sources ?? []).filter((s) => s.status !== "removed");
  return (
    <section className="hh-material" aria-labelledby={headingId} aria-busy={adding || undefined}>
      <h2 id={headingId} className="hh-flow-heading">
        {t("material.title")}
      </h2>
      <div className="hh-material-actions">
        <button
          type="button"
          disabled={off}
          onClick={() => {
            setAdding(true);
            client.material.add(scope).then(report, addFailed);
          }}
        >
          {t("material.addFile")}
        </button>
        <button type="button" disabled={off} aria-expanded={linking} onClick={() => (linking ? closeLink() : setLinking(true))}>
          {t("material.addLink")}
        </button>
      </div>
      {linking && (
        <form
          className="hh-material-link"
          onSubmit={(e) => {
            e.preventDefault();
            const link = url.trim();
            if (off || !link) return;
            setAdding(true);
            // The form and its link stay until the add goes through, so a failed one can be fixed and sent again.
            client.material.addLink(scope, link).then((r) => {
              if (report(r)) closeLink();
            }, addFailed);
          }}
        >
          {/* The person just asked for the link field. */}
          <input type="url" aria-label={t("material.link")} value={url} autoFocus onChange={(e) => setUrl(e.target.value)} />
          <button type="submit" disabled={off || !url.trim()}>
            {t("material.add")}
          </button>
          <button type="button" onClick={closeLink}>
            {t("material.cancel")}
          </button>
        </form>
      )}
      {/* §9 Ground: the scope's mode, when the harness lets the person change it; the next task's first message carries it. */}
      {view?.grounding.canChange && (
        <fieldset className="hh-material-grounding" disabled={disabled || grounding}>
          <legend>{t("material.grounding.label")}</legend>
          {(["strict", "mixed"] as const).map((mode) => (
            <label key={mode}>
              <input
                type="radio"
                name={`grounding-${scope}`}
                checked={view.grounding.mode === mode}
                onChange={() => {
                  setGrounding(true);
                  const done = () => setGrounding(false);
                  client.material.setGrounding(scope, mode).then(done, done);
                }}
              />
              {t(`material.grounding.${mode}`)}
            </label>
          ))}
        </fieldset>
      )}
      {notice.map((n) => (
        <p key={n} className="hh-material-notice" role="status">
          {n}
        </p>
      ))}
      {sources.map((s) =>
        s.status === "pending" && view ? (
          <WaitingCard key={s.id} client={client} scope={scope} source={s} view={view} maxPages={info.maxPages} disabled={disabled} />
        ) : (
          <div key={s.id} className="hh-material-source">
            <p className="hh-material-line">
              <span>{statusLine(t, s)}</span>
              {/* A stage that failed is not retried on its own (§13): the person asks for it. */}
              {s.status === "ready" && s.failed && (
                <>
                  {" "}
                  <button
                    type="button"
                    disabled={disabled || retrying.includes(s.id)}
                    aria-busy={retrying.includes(s.id) || undefined}
                    onClick={() => retry(s.id)}
                  >
                    {t("material.retry")}
                  </button>
                </>
              )}
            </p>
            <SourceDetails client={client} scope={scope} source={s} disabled={disabled} />
          </div>
        ),
      )}
      {/* Coverage (§8): the harness's items no fragment covers yet. */}
      {view?.uncovered && view.uncovered.length > 0 && <p className="hh-material-notice">{t("material.uncovered", { list: view.uncovered.join(", ") })}</p>}
    </section>
  );
}
