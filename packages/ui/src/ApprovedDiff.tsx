import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { type DiffLine, lineDiff } from "@humanharness/harness-sdk/review";
import type { HarnessClient } from "./client";

/** Unchanged lines kept on each side of a change. */
const CONTEXT = 2;

/** The changed lines and up to CONTEXT unchanged ones around each; null marks a gap ("…") between kept runs. */
export function aroundChanges(lines: DiffLine[]): (DiffLine | null)[] {
  const keep = new Array<boolean>(lines.length).fill(false);
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].kind === "same") continue;
    for (let j = Math.max(0, i - CONTEXT); j <= Math.min(lines.length - 1, i + CONTEXT); j++) keep[j] = true;
  }
  const out: (DiffLine | null)[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (keep[i]) out.push(lines[i]);
    else if (out.length > 0 && out.at(-1) !== null) out.push(null);
  }
  if (out.at(-1) === null) out.pop();
  return out;
}

/** "See what changed" (§5.4): the approved version against the current one, line by line. Text only, never HTML. */
export function ApprovedDiff({ client, path, current }: { client: HarnessClient; path: string; current: string }) {
  const { t } = useTranslation();
  const [approved, setApproved] = useState<string | null | "loading">("loading");
  useEffect(() => {
    let live = true;
    setApproved("loading");
    client.documents.approvedText(path).then(
      (r) => live && setApproved(r.ok ? r.text : null),
      () => live && setApproved(null),
    );
    return () => {
      live = false;
    };
  }, [client, path]);
  // null: too long to compare; "missing": the approved version can't be read (approvedText failed).
  const lines = useMemo(() => {
    if (approved === "loading") return approved;
    if (approved === null) return "missing" as const;
    const all = lineDiff(approved, current);
    return all && aroundChanges(all);
  }, [approved, current]);
  if (lines === "loading") return null;
  return (
    <section className="hh-diff" aria-label={t("review.diff")}>
      {lines === "missing" ? (
        <p className="hh-caption">{t("review.noApproved")}</p>
      ) : lines === null ? (
        <p className="hh-caption">{t("review.noDiff")}</p>
      ) : (
        <ol>
          {lines.map((l, i) =>
            l === null ? (
              <li key={i} className="hh-diff-gap" aria-hidden="true">
                …
              </li>
            ) : (
              <li key={i} className={`hh-diff-${l.kind}`}>
                {l.text}
              </li>
            ),
          )}
        </ol>
      )}
    </section>
  );
}
