import { type ReactNode, useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import type { FileTimelineResult, HarnessClient, TimelineAuthor, TimelineEntry } from "./client";
import { entryLabel } from "./HistoryPanel";

export interface FileTimelineProps {
  client: HarnessClient;
  /** The file, relative to the folder. */
  path: string;
  /** The entry whose diff shows now (its `to`). */
  selected?: string;
  /** Picking an entry; absent: the list is read-only. */
  onPick?: (entry: TimelineEntry) => void;
}

/** Who made an entry, in the window's language (§3.1). */
export function authorName(t: TFunction, a: TimelineAuthor): string {
  if (a.kind === "person") return t("timeline.you");
  if (a.kind === "outside") return t("timeline.outsideAuthor");
  return a.action ? a.label : t("history.question");
}

/** "20 minutes ago", "now", "3 days ago"; "" for a date that doesn't parse. */
export function timeAgo(iso: string, language: string, now = Date.now()): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms) || !Number.isFinite(now)) return "";
  const seconds = Math.round((ms - now) / 1000);
  const f = new Intl.RelativeTimeFormat(language, { numeric: "auto" });
  const abs = Math.abs(seconds);
  if (abs < 60) return f.format(0, "second");
  if (abs < 3600) return f.format(Math.round(seconds / 60), "minute");
  if (abs < 86_400) return f.format(Math.round(seconds / 3600), "hour");
  return f.format(Math.round(seconds / 86_400), "day");
}

/** The date and time, or "" for a date that doesn't parse. */
export function clock(iso: string, language: string): string {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? new Intl.DateTimeFormat(language, { dateStyle: "medium", timeStyle: "short" }).format(new Date(ms)) : "";
}

/** The entry's own line (the chips say the rest). */
function entryText(t: TFunction, e: TimelineEntry, language: string): string | null {
  if (e.deleted) return null;
  if (e.kind === "task") return t("timeline.changes", { count: e.commits.length });
  if (e.kind === "answers") return t("timeline.answers", { count: e.commits.length });
  if (e.kind === "goBack") {
    if (e.back?.version !== undefined) return t("timeline.wentBackVersion", { version: e.back.version });
    if (e.back?.at !== undefined) return t("timeline.wentBackTime", { time: clock(e.back.at, language) });
    return t("timeline.wentBack");
  }
  return null;
}

function chips(t: TFunction, e: TimelineEntry): ReactNode {
  const out: ReactNode[] = [];
  if (e.unapproved) out.push(<span key="u" className="hh-timeline-chip hh-timeline-chip-amber">{t("timeline.unapproved")}</span>);
  if (e.kind === "approval") out.push(<span key="a" className="hh-timeline-chip hh-timeline-chip-green">{t(e.reason ? "timeline.approvedReason" : "timeline.approved", { version: e.version })}</span>);
  if (e.kind === "outside") out.push(<span key="o" className="hh-timeline-chip hh-timeline-chip-grey">{t("timeline.outside")}</span>);
  if (e.deleted) out.push(<span key="d" className="hh-timeline-chip hh-timeline-chip-grey">{t("timeline.deleted")}</span>);
  return out;
}

/** A turn's subject in plain language (the History panel's words), else the subject itself. */
function turnText(t: TFunction, subject: string): string {
  const l = entryLabel(subject);
  return l ? t(l.key, l.values) : subject;
}

/** A file's timeline (file-timeline spec §6.1), newest first; an entry expands into its turns. */
export function FileTimeline({ client, path, selected, onPick }: FileTimelineProps) {
  const { t, i18n } = useTranslation();
  const [result, setResult] = useState<FileTimelineResult | null>(null);
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const id = useId();
  useEffect(() => {
    let live = true;
    let seq = 0;
    const load = () => {
      const mine = ++seq;
      // A reload that fails keeps the last list it had.
      const done = (r: FileTimelineResult) => live && mine === seq && setResult((prev) => (!r.ok && prev?.ok ? prev : r));
      client.files.timeline(path).then(done, () => done({ ok: false, reason: "failed" }));
    };
    setResult(null);
    setOpen(new Set());
    load();
    const off = client.files.onChange(path, load);
    return () => {
      live = false;
      off();
    };
  }, [client, path]);
  if (!result) return <p className="hh-caption" role="status">{t("timeline.loading")}</p>;
  if (!result.ok) {
    const none = result.reason === "untracked" || result.reason === "outside";
    return <p className={none ? "hh-caption" : "hh-warn"} role={none ? undefined : "alert"}>{t(none ? "timeline.noHistory" : "timeline.loadFailed")}</p>;
  }
  if (result.entries.length === 0) return <p className="hh-caption">{t("timeline.empty")}</p>;
  const toggle = (key: string) =>
    setOpen((o) => {
      const next = new Set(o);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  return (
    <ol className="hh-timeline" aria-label={t("timeline.entries")}>
      {result.entries.map((e, i) => {
        const turnsId = `${id}-turns-${i}`;
        const text = entryText(t, e, i18n.language);
        const summary = (
          <>
            <span className="hh-timeline-author">{authorName(t, e.author)}</span>
            {text && <span className="hh-timeline-text">{text}</span>}
            {chips(t, e)}
            <time className="hh-caption" dateTime={e.at}>
              {clock(e.at, i18n.language)}
            </time>
          </>
        );
        return (
          <li key={e.to} className={`hh-timeline-entry${selected === e.to ? " hh-timeline-selected" : ""}`}>
            {onPick ? (
              <button type="button" className="hh-timeline-pick" aria-current={selected === e.to ? "true" : undefined} onClick={() => onPick(e)}>
                {summary}
              </button>
            ) : (
              <div className="hh-timeline-pick" aria-current={selected === e.to ? "true" : undefined}>
                {summary}
              </div>
            )}
            {e.commits.length > 1 && (
              <button type="button" className="hh-link hh-timeline-more" aria-expanded={open.has(e.to)} aria-controls={turnsId} onClick={() => toggle(e.to)}>
                {t("timeline.turns", { count: e.commits.length })}
              </button>
            )}
            {open.has(e.to) && (
              <ol id={turnsId} className="hh-timeline-turns">
                {e.commits.map((c) => (
                  <li key={c.id}>
                    {turnText(t, c.subject)}{" "}
                    <time className="hh-caption" dateTime={c.at}>
                      {clock(c.at, i18n.language)}
                    </time>
                  </li>
                ))}
              </ol>
            )}
          </li>
        );
      })}
    </ol>
  );
}
