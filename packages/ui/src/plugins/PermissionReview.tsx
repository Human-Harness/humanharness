import { Fragment, type ReactNode, useEffect, useId, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { PluginLine, PluginReview } from "../client";
import { Group, Row, Rx } from "../guide";

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
 * The permission lines of a review, as a loose list under `title` (DESIGN.md "Settings rows": a list is loose). With no
 * permission at all, a line says so; what is searchable is about the plugin's own data, so it doesn't count as one and
 * is listed after that line.
 */
export function PermissionList({ lines, title }: { lines: PluginLine[]; title: ReactNode }) {
  const { t } = useTranslation();
  const none = lines.every((l) => l.kind === "searchable");
  const noneLine = t("plugins.review.none");
  if (lines.length === 0) {
    return (
      <Group loose title={title}>
        <Row as="li" label={<Rx.Text color="gray">{noneLine}</Rx.Text>} />
      </Group>
    );
  }
  return (
    <Group loose title={title} hint={none ? noneLine : undefined}>
      {lines.map((line, i) => (
        <Row key={i} as="li" label={<PermissionText line={line} />} />
      ))}
    </Group>
  );
}

const ADDED_KINDS = new Set(["host", "exec", "secret", "tasks"]);

/**
 * The permission review (plugins spec §7): exactly what Turn on approves. Turn on hands the review back to the caller,
 * which approves this review's `distHash` (main refuses it if the plugin changed since).
 *
 * Radix stage 2e: it takes the list's place in Settings › Plugins (the top bar's Volver reads "Plugins"). The name, the
 * version line, what this version adds as an orange notice, the permissions as a loose list, then Cancel and Turn on at
 * the end, right-aligned, Turn on rightmost (DESIGN.md "Card": primary rightmost).
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
    <section aria-labelledby={`${id}-name`}>
      <Rx.Heading as="h2" size="5" id={`${id}-name`} ref={head} tabIndex={-1} mb="1">
        <Plain>{review.name}</Plain>
      </Rx.Heading>
      <Rx.Text as="p" size="1" color="gray" mb="5">
        {t("plugins.version", { version: review.version })}
        {review.folder && (
          <>
            {" · "}
            {t("plugins.review.from")} <span className="hh-gd-path">{review.folder}</span>
          </>
        )}
      </Rx.Text>
      {added.length > 0 && (
        <Rx.Callout.Root color="orange" mb="5">
          {/* One line per addition: the notice has room for a few, and a bullet would need a class of its own. */}
          <Rx.Box>
            <Rx.Callout.Text weight="bold">{t("plugins.review.more")}</Rx.Callout.Text>
            {added.map((a, i) => (
              <Rx.Callout.Text key={i}>
                {t(`plugins.review.added.${a.kind}`)}
                {a.kind !== "tasks" && (
                  <>
                    {" "}
                    <Plain>{a.value}</Plain>
                  </>
                )}
              </Rx.Callout.Text>
            ))}
          </Rx.Box>
        </Rx.Callout.Root>
      )}
      <PermissionList lines={review.lines} title={t("plugins.review.intro")} />
      {error && (
        <Rx.Callout.Root color="red" role="alert" mb="3">
          <Rx.Callout.Text>{error}</Rx.Callout.Text>
        </Rx.Callout.Root>
      )}
      <Rx.Flex justify="end" gap="2">
        {/* Not while Turn on is in flight: it could still end with the plugin on. */}
        <Rx.Button variant="outline" color="gray" aria-disabled={busy} onClick={() => !busy && onCancel()}>
          {t("plugins.review.cancel")}
        </Rx.Button>
        <Rx.Button aria-disabled={busy} onClick={() => !busy && onTurnOn()}>
          {t("plugins.review.turnOn")}
        </Rx.Button>
      </Rx.Flex>
    </section>
  );
}
