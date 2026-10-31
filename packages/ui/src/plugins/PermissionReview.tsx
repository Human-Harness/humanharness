import { Fragment, type ReactNode, useEffect, useId, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { PluginLine, PluginReview } from "../client";

/** Plugin text: plain, and isolated so a right-to-left or mixed string can't reorder what is around it (B12). */
export function Plain({ children }: { children: string }) {
  return <bdi dir="auto">{children}</bdi>;
}

/** Several plugin strings, each isolated, joined with ", ". */
function joined(items: string[]): ReactNode {
  return items.map((s, i) => (
    <Fragment key={i}>
      {i > 0 && ", "}
      <Plain>{s}</Plain>
    </Fragment>
  ));
}

/**
 * One permission in words. "read only" only when main says the line is (a pinned GET); a wide command says it takes
 * any arguments.
 */
export function PermissionText({ line }: { line: PluginLine }) {
  const { t } = useTranslation();
  switch (line.kind) {
    case "hosts":
      return (
        <>
          {t("plugins.review.hosts")} {joined(line.hosts)}
        </>
      );
    case "exec":
      return (
        <>
          {t("plugins.review.exec")} <Plain>{line.command}</Plain>
          {line.readOnly === true && ` ${t("plugins.review.readOnly")}`}
          {line.wide === true && ` ${t("plugins.review.wide")}`}
        </>
      );
    case "secrets":
      return (
        <>
          {t("plugins.review.secrets", { count: line.labels.length })} {joined(line.labels)}
        </>
      );
    case "tasks":
      return <>{t("plugins.review.tasks")}</>;
    case "searchable":
      // Collection and field names are the plugin's: each one isolated, never joined into the translated string.
      return (
        <>
          {t("plugins.review.searchable")}{" "}
          {line.collections.map((c, i) => (
            <Fragment key={i}>
              {i > 0 && "; "}
              <Plain>{c.name}</Plain> ({joined(c.fields)})
            </Fragment>
          ))}
        </>
      );
  }
}

/**
 * The permission lines of a review, as a list. With no permission at all, one line says so; what is searchable is about
 * the plugin's own data, so it doesn't count as one and is listed after that line.
 */
export function PermissionList({ lines, labelledBy }: { lines: PluginLine[]; labelledBy?: string }) {
  const { t } = useTranslation();
  const none = lines.every((l) => l.kind === "searchable");
  const list = lines.length > 0 && (
    <ul className="hh-pl-perms" aria-labelledby={labelledBy}>
      {lines.map((line, i) => (
        <li key={i}>
          <PermissionText line={line} />
        </li>
      ))}
    </ul>
  );
  if (!none) return list;
  return (
    <>
      <p className="hh-caption">{t("plugins.review.none")}</p>
      {list}
    </>
  );
}

const ADDED_KINDS = new Set(["host", "exec", "secret", "tasks"]);

/**
 * The permission review (plugins spec §7): exactly what Turn on approves. Turn on hands the review back to the caller,
 * which approves this review's `distHash` (main refuses it if the plugin changed since).
 */
export function PermissionReview({
  review,
  busy,
  error,
  onTurnOn,
  onCancel,
}: {
  review: PluginReview;
  busy: boolean;
  error: string | null;
  onTurnOn: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const head = useRef<HTMLHeadingElement>(null);
  useEffect(() => head.current?.focus(), [review.id]);
  const added = (review.added ?? []).filter((a) => ADDED_KINDS.has(a.kind));
  return (
    <section className="hh-tab hh-pl-review" aria-labelledby={`${id}-name`}>
      <h3 id={`${id}-name`} ref={head} tabIndex={-1}>
        <Plain>{review.name}</Plain>
      </h3>
      <p className="hh-caption hh-pl-meta">
        {t("plugins.version", { version: review.version })}
        {review.folder && (
          <>
            {" · "}
            {t("plugins.review.from")} <Plain>{review.folder}</Plain>
          </>
        )}
      </p>
      {added.length > 0 && (
        <div className="hh-pl-added">
          <p id={`${id}-more`}>{t("plugins.review.more")}</p>
          <ul aria-labelledby={`${id}-more`}>
            {added.map((a, i) => (
              <li key={i}>
                {t(`plugins.review.added.${a.kind}`)}
                {a.kind !== "tasks" && (
                  <>
                    {" "}
                    <Plain>{a.value}</Plain>
                  </>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      <p id={`${id}-intro`}>{t("plugins.review.intro")}</p>
      <PermissionList lines={review.lines} labelledBy={`${id}-intro`} />
      {error && (
        <p className="hh-field-error" role="alert">
          {error}
        </p>
      )}
      <div className="hh-pl-actions">
        <button type="button" className="hh-primary" aria-disabled={busy} onClick={() => !busy && onTurnOn()}>
          {t("plugins.review.turnOn")}
        </button>
        {/* Not while Turn on is in flight: it could still end with the plugin on. */}
        <button type="button" aria-disabled={busy} onClick={() => !busy && onCancel()}>
          {t("plugins.review.cancel")}
        </button>
      </div>
    </section>
  );
}
