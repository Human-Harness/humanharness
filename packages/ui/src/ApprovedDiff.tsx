import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { HarnessClient } from "./client";
import { FileDiff } from "./FileDiff";

/**
 * "See what changed" (review spec §5.4, file-timeline spec §9): the last approved version against the file now, drawn
 * with the timeline's diff. The approval is the newest `approval` entry of the file's timeline. `refresh` changes when
 * the document on disk does, so the comparison with the file now is asked again.
 */
export function ApprovedDiff({ client, path, refresh }: { client: HarnessClient; path: string; refresh?: unknown }) {
  const { t } = useTranslation();
  const [from, setFrom] = useState<string | null | "loading">("loading");
  useEffect(() => {
    let live = true;
    const load = () =>
      client.files.timeline(path).then(
        (r) => live && setFrom((r.ok ? r.entries.find((e) => e.kind === "approval")?.to : undefined) ?? null),
        () => live && setFrom(null),
      );
    setFrom("loading");
    load();
    const off = client.files.onChange(path, load);
    return () => {
      live = false;
      off();
    };
  }, [client, path]);
  if (from === "loading") return null;
  return (
    <section className="hh-diff" aria-label={t("review.diff")}>
      {from === null ? <p className="hh-caption">{t("review.noApproved")}</p> : <FileDiff client={client} path={path} from={from} to="current" refresh={refresh} />}
    </section>
  );
}
