import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { HarnessClient, SidekickLearned } from "../client";
import { Group, Row, Rx } from "../guide";

type Level = SidekickLearned["level"];

/**
 * "What Sidekick learned" (spec §6.4, mockup board 6): both levels, "Forget this" per item, "Edit" as an editable
 * list (edited items become the person's), and "Forget everything" after one confirmation.
 *
 * Radix stage 2d: the two levels are loose lists one under the other (a settings column is too narrow for two); Forget
 * everything is the danger button and asks inline.
 */
export function LearnedList({ client }: { client: HarnessClient }) {
  const { t } = useTranslation();
  const [items, setItems] = useState<SidekickLearned[]>([]);
  /** The texts being edited by id (only the touched ones); null when not editing. */
  const [editing, setEditing] = useState<Record<string, string> | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [loads, setLoads] = useState(0);
  const reload = useCallback(() => setLoads((n) => n + 1), []);
  const ids = useId();
  const confirmTextId = `${ids}-confirm`;
  const yesRef = useRef<HTMLButtonElement>(null);
  const forgetAllRef = useRef<HTMLButtonElement>(null);
  const editRef = useRef<HTMLButtonElement>(null);
  const firstInputRef = useRef<HTMLInputElement>(null);
  /** The button that opened the closing view, to focus once it is back (it is not mounted while the view is open). */
  const back = useRef<"edit" | "forgetAll" | null>(null);
  const isEditing = editing !== null;

  // Every view switch moves focus into the new view, and back to its opener when it closes (as in HistoryPanel).
  useEffect(() => {
    if (confirm) yesRef.current?.focus();
    else if (isEditing) firstInputRef.current?.focus();
    else if (back.current) {
      (back.current === "edit" ? editRef : forgetAllRef).current?.focus();
      back.current = null;
    }
  }, [confirm, isEditing]);

  useEffect(() => {
    let live = true;
    client.sidekick.learned().then(
      (list) => live && setItems(list),
      () => live && setItems([]),
    );
    return () => {
      live = false;
    };
  }, [client, loads]);

  // Every change: the list is read again afterwards, whatever happened; a failure says why.
  const run = (change: () => Promise<void>) => {
    setFailed(null);
    change()
      .catch((err: unknown) => setFailed(err instanceof Error ? err.message : String(err)))
      .finally(reload);
  };

  const save = () => {
    if (!editing) return;
    const changes = Object.entries(editing)
      .map(([id, text]) => ({ id, text: text.trim() }))
      .filter(({ id, text }) => text && items.find((i) => i.id === id)?.text !== text);
    back.current = "edit";
    setEditing(null);
    if (changes.length) run(() => client.sidekick.editLearned(changes));
  };

  // The first input on screen: the "About you" list comes first.
  const first = items.find((i) => i.level === "you") ?? items[0];
  const list = (level: Level, label: string) => {
    const mine = items.filter((i) => i.level === level);
    return (
      <Group
        loose
        title={label}
        {...(mine.length === 0
          ? {
              after: (
                <Rx.Text as="p" size="1" color="gray">
                  {t("sidekick.learned.empty")}
                </Rx.Text>
              ),
            }
          : {})}
      >
        {mine.map((i) =>
          editing ? (
            <Row
              key={i.id}
              as="li"
              aria-label={i.text}
              label={
                <Rx.TextField.Root
                  ref={i === first ? firstInputRef : undefined}
                  value={editing[i.id] ?? i.text}
                  aria-label={i.text}
                  maxLength={300}
                  onChange={(e) => setEditing({ ...editing, [i.id]: e.target.value })}
                />
              }
            />
          ) : (
            <Row
              key={i.id}
              as="li"
              aria-label={i.text}
              label={
                <>
                  {i.kind && (
                    <Rx.Badge color="blue" mr="2">
                      {t(`sidekick.kinds.${i.kind}`, { defaultValue: i.kind })}
                    </Rx.Badge>
                  )}
                  <span id={`${ids}-${i.id}`} dir="auto">
                    {i.text}
                  </span>
                  {i.source === "person" && (
                    <Rx.Text color="gray" size="1">
                      {" "}
                      · {t("sidekick.learned.yours")}
                    </Rx.Text>
                  )}
                </>
              }
            >
              <Rx.Button variant="ghost" color="gray" size="1" aria-describedby={`${ids}-${i.id}`} onClick={() => run(() => client.sidekick.forget(i.id))}>
                {t("sidekick.learned.forget")}
              </Rx.Button>
            </Row>
          ),
        )}
      </Group>
    );
  };

  return (
    <div>
      <Rx.Heading as="h3" size="3" mb="3">
        {t("sidekick.learned.title")}
      </Rx.Heading>
      {/* A save error is a red notice above what it affects (DESIGN.md "Settings"). */}
      {failed !== null && (
        <Rx.Callout.Root color="red" role="alert" mb="3">
          <Rx.Callout.Text>{t("sidekick.settings.failed", { message: failed })}</Rx.Callout.Text>
        </Rx.Callout.Root>
      )}
      {list("you", t("sidekick.learned.you"))}
      {list("harness", t("sidekick.learned.harness"))}
      {editing ? (
        <Rx.Flex gap="2" justify="end">
          <Rx.Button
            variant="outline"
            color="gray"
            onClick={() => {
              back.current = "edit";
              setEditing(null);
            }}
          >
            {t("sidekick.learned.cancel")}
          </Rx.Button>
          <Rx.Button variant="solid" onClick={save}>
            {t("sidekick.learned.save")}
          </Rx.Button>
        </Rx.Flex>
      ) : confirm ? (
        <Rx.Flex align="center" justify="between" gap="3" wrap="wrap">
          <Rx.Text as="p" size="2" id={confirmTextId}>
            {t("sidekick.learned.confirmAllText")}
          </Rx.Text>
          <Rx.Flex gap="2">
            <Rx.Button
              ref={yesRef}
              variant="soft"
              color="red"
              size="1"
              aria-describedby={confirmTextId}
              onClick={() => {
                setConfirm(false);
                run(() => client.sidekick.forgetAll());
              }}
            >
              {t("sidekick.learned.confirmAll")}
            </Rx.Button>
            <Rx.Button
              variant="outline"
              color="gray"
              size="1"
              onClick={() => {
                back.current = "forgetAll";
                setConfirm(false);
              }}
            >
              {t("sidekick.learned.cancel")}
            </Rx.Button>
          </Rx.Flex>
        </Rx.Flex>
      ) : (
        <Rx.Flex gap="2">
          <Rx.Button ref={editRef} size="1" variant="outline" color="gray" onClick={() => setEditing({})} disabled={items.length === 0}>
            {t("sidekick.learned.edit")}
          </Rx.Button>
          <Rx.Button ref={forgetAllRef} size="1" variant="soft" color="red" onClick={() => setConfirm(true)} disabled={items.length === 0}>
            {t("sidekick.learned.forgetAll")}
          </Rx.Button>
        </Rx.Flex>
      )}
    </div>
  );
}
