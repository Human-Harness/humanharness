import { type ReactNode, useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { authorName, type FileTimelineResult, type HarnessClient, type TimelineEntry, timeAgo } from "./client";
import { entryLabel } from "./HistoryPage";
import { Rx } from "./guide";

// Shared with main's native go-back confirmation, so both say who and when the same way.
export { authorName, timeAgo };

export interface FileTimelineProps {
  client: HarnessClient;
  /** The file, relative to the folder. */
  path: string;
  /** The entry whose diff shows now (its `to`). */
  selected?: string;
  /** Picking an entry; absent: the list is read-only. */
  onPick?: (entry: TimelineEntry) => void;
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
  // The spec's label (§3), not a chip that repeats the author.
  if (e.kind === "outside") return t("timeline.outside");
  if (e.kind === "goBack") {
    if (e.back?.version !== undefined) return t("timeline.wentBackVersion", { version: e.back.version });
    if (e.back?.at !== undefined) return t("timeline.wentBackTime", { time: clock(e.back.at, language) });
    return t("timeline.wentBack");
  }
  return null;
}

function chips(t: TFunction, e: TimelineEntry): ReactNode {
  const out: ReactNode[] = [];
  if (e.unapproved) out.push(<Rx.Badge key="u" color="orange">{t("timeline.unapproved")}</Rx.Badge>);
  if (e.kind === "approval") out.push(<Rx.Badge key="a" color="green">{t(e.reason ? "timeline.approvedReason" : "timeline.approved", { version: e.version })}</Rx.Badge>);
  if (e.deleted) out.push(<Rx.Badge key="d" color="gray" variant="outline">{t("timeline.deleted")}</Rx.Badge>);
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
  const note = (text: string, role?: "status") => (
    <Rx.Text as="p" size="1" color="gray" role={role}>
      {text}
    </Rx.Text>
  );
  if (!result) return note(t("timeline.loading"), "status");
  if (!result.ok) {
    if (result.reason === "untracked" || result.reason === "outside") return note(t("timeline.noHistory"));
    return (
      <Rx.Callout.Root color="red" role="alert" size="1">
        <Rx.Callout.Text>{t("timeline.loadFailed")}</Rx.Callout.Text>
      </Rx.Callout.Root>
    );
  }
  if (result.entries.length === 0) return note(t("timeline.empty"));
  const toggle = (key: string) =>
    setOpen((o) => {
      const next = new Set(o);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  return (
    <ol className="hh-gd-list" aria-label={t("timeline.entries")}>
      {result.entries.map((e, i) => {
        const turnsId = `${id}-turns-${i}`;
        const text = entryText(t, e, i18n.language);
        const current = selected === e.to ? "true" : undefined;
        const summary = (
          <Rx.Flex direction="column" gap="1" minWidth="0">
            <Rx.Flex align="baseline" justify="between" gap="3">
              <Rx.Text size="2" weight="bold">
                {authorName(t, e.author)}
              </Rx.Text>
              <Rx.Text size="1" color="gray" wrap="nowrap">
                <time dateTime={e.at}>{clock(e.at, i18n.language)}</time>
              </Rx.Text>
            </Rx.Flex>
            {(text || chips(t, e)) && (
              <Rx.Flex align="center" gap="2" wrap="wrap">
                {text && <Rx.Text size="1">{text}</Rx.Text>}
                {chips(t, e)}
              </Rx.Flex>
            )}
          </Rx.Flex>
        );
        return (
          <li key={e.to}>
            {onPick ? (
              <button type="button" className="hh-timeline-pick" aria-current={current} onClick={() => onPick(e)}>
                {summary}
              </button>
            ) : (
              <div className="hh-timeline-pick" aria-current={current}>
                {summary}
              </div>
            )}
            {e.commits.length > 1 && (
              <Rx.Box px="4" pb="3">
                <Rx.Button variant="ghost" color="gray" size="1" aria-expanded={open.has(e.to)} aria-controls={turnsId} onClick={() => toggle(e.to)}>
                  {t("timeline.turns", { count: e.commits.length })}
                </Rx.Button>
                {open.has(e.to) && (
                  <Rx.Flex asChild direction="column" gap="1" mt="2">
                    <ol id={turnsId}>
                      {e.commits.map((c) => (
                        <li key={c.id}>
                          <Rx.Text size="1">{turnText(t, c.subject)} </Rx.Text>
                          <Rx.Text size="1" color="gray">
                            <time dateTime={c.at}>{clock(c.at, i18n.language)}</time>
                          </Rx.Text>
                        </li>
                      ))}
                    </ol>
                  </Rx.Flex>
                )}
              </Rx.Box>
            )}
          </li>
        );
      })}
    </ol>
  );
}
