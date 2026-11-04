import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { HarnessClient, SidekickPurposeView, SidekickView } from "../client";
import { Group, Icon, Row, Rx } from "../guide";
import { ImportSidekick } from "./ImportSidekick";
import { SidekickMark, markIcon } from "./mark";
import { SidekickEditor } from "./SidekickEditor";

/** Where focus goes once a view closes or the list changes under it. */
type Back = { kind: "new" } | { kind: "import" } | { kind: "head" } | { kind: "edit" | "more"; id: string };

/**
 * Settings › Sidekicks (spec §8): the person's sidekicks by order (the higher one speaks when two could), each with
 * its purposes, Edit, Move up / down and Remove (with more than one; Remove asks first), "New sidekick" and "Import".
 * A sidekick imported from files shows "The original changed · Bring the changes" when its files changed since.
 * The list is read again after every change and whenever main sends a new Sidekick state (an adopted preset).
 *
 * Radix stage 2d: a loose list; a row is the mark, the name and the purposes, with Edit as a quiet action and More (⋯)
 * holding Move up, Move down and Remove (danger last). Remove asks inline under its row; an editor opens in a card.
 */
export function SidekickList({ client, places = [] }: { client: HarnessClient; places?: { id: string; label: string }[] }) {
  const { t } = useTranslation();
  const [list, setList] = useState<SidekickView[] | null>(null);
  /** The sidekick being edited, "new", or null. */
  const [editing, setEditing] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  /** The last read failed: main answers an empty list then (it always has the implicit default), or the call threw. */
  const [readFailed, setReadFailed] = useState(false);
  /** A change running: a second press (a double click) before the first answer does nothing. */
  const running = useRef(false);
  const [loads, setLoads] = useState(0);
  const reload = useCallback(() => setLoads((n) => n + 1), []);
  const head = useRef<HTMLParagraphElement>(null);
  const newRef = useRef<HTMLButtonElement>(null);
  const importRef = useRef<HTMLButtonElement>(null);
  const yesRef = useRef<HTMLButtonElement>(null);
  /** Row buttons by `<kind>/<id>`, to give focus back after a view closes or a reorder moves the row. */
  const rowButtons = useRef(new Map<string, HTMLButtonElement>());
  const back = useRef<Back | null>(null);
  /** A menu item chose where focus goes: the menu must not hand it back to its button when it closes. */
  const placed = useRef(false);
  /** Bumped by every read: an older answer never replaces a newer one. */
  const reads = useRef(0);

  useEffect(() => {
    const n = ++reads.current;
    const fail = () => {
      if (n !== reads.current) return;
      setReadFailed(true);
      setList((now) => now ?? []);
    };
    client.sidekick.list().then((l) => {
      if (n !== reads.current) return;
      if (l.length === 0) return fail();
      setReadFailed(false);
      setList(l);
    }, fail);
  }, [client, loads]);
  // A preset adopted, an import saved elsewhere: main pushes its state, and the list is read again.
  useEffect(() => client.sidekick.onChange(() => reload()), [client, reload]);

  // Focus: into the confirmation when it opens; back to the opener (or the moved row's More) when a view closes.
  useEffect(() => {
    if (confirm) {
      yesRef.current?.focus();
      return;
    }
    const b = back.current;
    if (!b || editing !== null) return;
    const row = (kind: string, id: string) => rowButtons.current.get(`${kind}/${id}`);
    let target: HTMLElement | null | undefined;
    if (b.kind === "new") target = newRef.current;
    else if (b.kind === "import") target = importRef.current;
    else if (b.kind === "head") target = head.current;
    else target = row(b.kind, b.id) ?? row("edit", b.id) ?? head.current;
    if (target) {
      back.current = null;
      target.focus();
    }
  }, [confirm, editing, importing, list]);

  /** Runs a change; the list is read again whatever happened, and a failure says why. */
  const run = async (change: () => Promise<void>) => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setFailed(null);
    try {
      await change();
    } catch (err) {
      setFailed(err instanceof Error ? err.message : String(err));
    } finally {
      running.current = false;
      setBusy(false);
      reload();
    }
  };

  if (!list) return null;

  const purpose = (p: SidekickPurposeView) => (p.id === "custom" ? t("sidekick.purposes.customText", { text: p.text ?? "" }) : t(`sidekick.purposes.${p.id}`, { defaultValue: p.id }));
  const move = (id: string, dir: "up" | "down") =>
    run(async () => {
      const at = list.findIndex((k) => k.id === id);
      const to = dir === "up" ? at - 1 : at + 1;
      if (at < 0 || to < 0 || to >= list.length) return;
      const next = list.map((k) => k.id);
      [next[at], next[to]] = [next[to]!, next[at]!];
      back.current = { kind: "more", id };
      await client.sidekick.reorder(next);
    });
  const remove = (id: string) =>
    run(async () => {
      setConfirm(null);
      back.current = { kind: "head" };
      const r = await client.sidekick.remove(id);
      if (!r.ok) {
        back.current = { kind: "more", id };
        throw new Error(r.message ?? "");
      }
    });
  const closeEditor = (saved: boolean) => {
    const was = editing;
    setEditing(null);
    back.current = was === "new" || was === null ? { kind: "new" } : { kind: "edit", id: was };
    if (saved) reload();
  };
  const ref = (kind: string, id: string) => (el: HTMLButtonElement | null) => {
    if (el) rowButtons.current.set(`${kind}/${id}`, el);
    else rowButtons.current.delete(`${kind}/${id}`);
  };
  /** A menu item that moves focus itself (a reorder, the Remove question). */
  const chose = (act: () => void) => () => {
    placed.current = true;
    act();
  };
  /** A daily-summary sidekick off by default never speaks at daily (the app has no scope records to turn it on). */
  const dailyOff = (k: SidekickView) => k.defaultOn === false && k.purposes.some((p) => p.id === "daily-summary" || (p.id === "custom" && p.moments?.includes("daily")));
  const editingOne = editing !== null && editing !== "new" ? list.find((k) => k.id === editing) : undefined;

  const after = (
    <>
      {editing === "new" && (
        <Rx.Box mt="3">
          <SidekickEditor key="new" client={client} places={places} onDone={closeEditor} />
        </Rx.Box>
      )}
      {failed !== null && (
        <Rx.Callout.Root color="red" role="alert" mt="3">
          <Rx.Callout.Text>{t("sidekick.settings.failed", { message: failed })}</Rx.Callout.Text>
        </Rx.Callout.Root>
      )}
      {readFailed && (
        <Rx.Callout.Root color="red" role="alert" mt="3">
          <Rx.Callout.Text>{t("sidekick.list.readFailed")}</Rx.Callout.Text>
        </Rx.Callout.Root>
      )}
      <Rx.Flex gap="2" mt="3">
        <Rx.Button size="1" variant="outline" color="gray" ref={newRef} aria-disabled={busy} onClick={() => !busy && (setImporting(false), setEditing("new"))}>
          <Icon name="add" size={14} />
          {t("sidekick.list.new")}
        </Rx.Button>
        <Rx.Button
          size="1"
          variant="outline"
          color="gray"
          ref={importRef}
          aria-expanded={importing}
          onClick={() => {
            if (importing) back.current = { kind: "import" };
            setImporting(!importing);
            setEditing(null);
          }}
        >
          {t("sidekick.import.title")}
        </Rx.Button>
      </Rx.Flex>
      {importing && (
        <Rx.Box mt="3">
          <ImportSidekick
            client={client}
            onSaved={() => {
              back.current = { kind: "import" };
              setImporting(false);
              reload();
            }}
          />
        </Rx.Box>
      )}
    </>
  );

  return (
    <Group loose title={t("sidekick.list.title")} titleRef={head} hint={t("sidekick.list.orderHint")} after={after}>
      {list.map((k, i) => {
        const canMove = list.length > 1;
        const below = (
          <>
            {confirm === k.id && (
              <Rx.Flex align="center" justify="between" gap="3" wrap="wrap">
                <Rx.Text as="p" size="2" id={`sk-confirm-${k.id}`}>
                  {t("sidekick.list.confirmRemove", { name: k.name })}
                </Rx.Text>
                <Rx.Flex gap="2">
                  <Rx.Button ref={yesRef} variant="soft" color="red" size="1" aria-describedby={`sk-confirm-${k.id}`} aria-disabled={busy} onClick={() => void remove(k.id)}>
                    {t("sidekick.list.confirmYes")}
                  </Rx.Button>
                  <Rx.Button
                    variant="outline"
                    color="gray"
                    size="1"
                    onClick={() => {
                      back.current = { kind: "more", id: k.id };
                      setConfirm(null);
                    }}
                  >
                    {t("sidekick.editor.cancel")}
                  </Rx.Button>
                </Rx.Flex>
              </Rx.Flex>
            )}
            {k.source?.kind === "files" && (
              <ImportSidekick
                client={client}
                original={{ id: k.id, ...(k.tier ? { tier: k.tier } : {}), ...(k.preset !== undefined ? { preset: k.preset } : {}), ...(k.defaultOn !== undefined ? { defaultOn: k.defaultOn } : {}) }}
                onSaved={reload}
              />
            )}
            {editingOne?.id === k.id && <SidekickEditor key={k.id} client={client} initial={editingOne} places={places} onDone={closeEditor} />}
          </>
        );
        const hasBelow = confirm === k.id || k.source?.kind === "files" || editingOne?.id === k.id;
        return (
          <Row
            key={k.id}
            as="li"
            aria-label={k.name}
            label={
              <Rx.Flex as="span" align="center" gap="2" minWidth="0">
                <SidekickMark icon={markIcon(k.mark)} />
                <Rx.Text weight="bold" truncate>
                  <bdi dir="auto">{k.name}</bdi>
                </Rx.Text>
              </Rx.Flex>
            }
            hint={
              <>
                {k.purposes.map(purpose).join(" · ")}
                {dailyOff(k) && (
                  <Rx.Box as="span" display="block">
                    {t("sidekick.list.dailyOff")}
                  </Rx.Box>
                )}
              </>
            }
            {...(hasBelow ? { below } : {})}
          >
            <Rx.Button variant="ghost" color="gray" size="1" ref={ref("edit", k.id)} aria-disabled={busy} onClick={() => !busy && (setImporting(false), setEditing(k.id))}>
              {t("sidekick.list.edit", { name: k.name })}
            </Rx.Button>
            {canMove && (
              <Rx.DropdownMenu.Root>
                <Rx.DropdownMenu.Trigger>
                  <Rx.IconButton ref={ref("more", k.id)} variant="ghost" color="gray" size="1" aria-label={t("sidekick.list.more", { name: k.name })}>
                    <Icon name="more" size={14} />
                  </Rx.IconButton>
                </Rx.DropdownMenu.Trigger>
                <Rx.DropdownMenu.Content
                  align="end"
                  onCloseAutoFocus={(e) => {
                    if (!placed.current) return;
                    placed.current = false;
                    e.preventDefault();
                    // The menu kept focus inside it until now: the Remove question, opened meanwhile, takes it.
                    yesRef.current?.focus();
                  }}
                >
                  {i > 0 && (
                    <Rx.DropdownMenu.Item disabled={busy} onSelect={chose(() => void move(k.id, "up"))}>
                      {t("sidekick.list.up", { name: k.name })}
                    </Rx.DropdownMenu.Item>
                  )}
                  {i < list.length - 1 && (
                    <Rx.DropdownMenu.Item disabled={busy} onSelect={chose(() => void move(k.id, "down"))}>
                      {t("sidekick.list.down", { name: k.name })}
                    </Rx.DropdownMenu.Item>
                  )}
                  <Rx.DropdownMenu.Separator />
                  <Rx.DropdownMenu.Item color="red" disabled={busy} onSelect={chose(() => setConfirm(k.id))}>
                    {t("sidekick.list.remove", { name: k.name })}
                  </Rx.DropdownMenu.Item>
                </Rx.DropdownMenu.Content>
              </Rx.DropdownMenu.Root>
            )}
          </Row>
        );
      })}
    </Group>
  );
}
