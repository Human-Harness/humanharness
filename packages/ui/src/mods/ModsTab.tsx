import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { HarnessClient, LayoutView, ModReview, ModRow } from "../client";
import { Group, Icon, Row, Rx, SectionHead } from "../guide";
import type { SettingsSub } from "../plugins/PluginsTab";
import { useLayoutPick, useMods } from "./useMods";

/** A review's token is spent by Turn on, once. */
type Screen = { kind: "list" } | { kind: "review"; review: ModReview; token: string };

/** A string from a mod (its name, a reason) shown as-is, isolated from the text around it. */
function Plain({ children }: { children: string }) {
  return <bdi dir="auto">{children}</bdi>;
}

/**
 * Settings › Mods (minimal-core spec §4, §6): every mod, on or off; Add from folder (main shows the dialog and answers
 * a review and a one-time token, never a path from here) and the warning before a local mod turns on.
 *
 * Laid out as Settings › Plugins (Radix stage 2e): one loose row per mod (its name, a gray "Local" badge for a folder
 * the person added, what it uses as the hint, its switch on the right); a failure is a red line under the row. Add
 * from folder is an outline button under the list. The review takes the list's place and hands `onSub` the way back,
 * so the top bar reads "← Mods" and Escape goes back to the list.
 */
export function ModsTab({ client, onSub }: { client: HarnessClient; onSub?: (sub: SettingsSub | null) => void }) {
  const { t } = useTranslation();
  const mods = useMods(client);
  const { view } = mods;
  const [screen, setScreen] = useState<Screen>({ kind: "list" });
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  busyRef.current = busy;
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [addError, setAddError] = useState<string | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  /** Where focus goes back on the list: Add from folder (the only way into a review). Null: the list was not left. */
  const back = useRef<boolean>(false);
  const addButton = useRef<HTMLButtonElement>(null);
  const error = t("mods.error");

  const toList = () => {
    setReviewError(null);
    back.current = true;
    setScreen({ kind: "list" });
  };

  // In the review, the top bar goes back to the list (not while Turn on is in flight: it could still end with the mod on).
  const leave = useRef<() => void>(() => {});
  leave.current = () => {
    if (screen.kind === "list" || busyRef.current) return;
    toList();
  };
  const away = screen.kind !== "list";
  const subLabel = t("mods.tab");
  useEffect(() => {
    onSub?.(away ? { label: subLabel, back: () => leave.current() } : null);
  }, [away, subLabel]);
  useEffect(() => () => onSub?.(null), []);

  useEffect(() => {
    if (screen.kind !== "list" || !back.current) return;
    back.current = false;
    addButton.current?.focus();
  }, [screen]);

  const add = () => {
    if (busy) return;
    setBusy(true);
    setAddError(null);
    mods.review().then(
      (r) => {
        setBusy(false);
        if (r === null) return;
        if ("problem" in r) setAddError(r.problem);
        else {
          setReviewError(null);
          setScreen({ kind: "review", review: r.review, token: r.token });
        }
      },
      () => {
        setBusy(false);
        setAddError(error);
      },
    );
  };

  const rowAction = (id: string, act: () => Promise<void>) => {
    setRowErrors(({ [id]: _gone, ...rest }) => rest);
    act().catch(() => setRowErrors((e) => ({ ...e, [id]: error })));
  };

  /** A home-folder mod not yet reviewed goes through the same warning as a folder added by hand. */
  const turnOnRow = async (id: string) => {
    const r = await mods.turnOn(id);
    if (!r) return;
    setReviewError(null);
    setScreen({ kind: "review", review: r.review, token: r.token });
  };

  const turnOn = async (s: Extract<Screen, { kind: "review" }>) => {
    setBusy(true);
    setReviewError(null);
    try {
      await mods.add(s.token);
      toList();
    } catch {
      setReviewError(error);
    } finally {
      setBusy(false);
    }
  };

  const head = <SectionHead line={t("mods.line")} />;
  if (!view) {
    return mods.failed ? (
      <div>
        {head}
        <Rx.Callout.Root color="red" role="alert">
          <Rx.Callout.Text>{error}</Rx.Callout.Text>
        </Rx.Callout.Root>
      </div>
    ) : (
      <div aria-busy="true">
        {head}
      </div>
    );
  }

  if (screen.kind === "review") {
    return (
      <div>
        <ModReviewScreen review={screen.review} busy={busy} error={reviewError} onTurnOn={() => void turnOn(screen)} onCancel={toList} />
      </div>
    );
  }

  const addRow = (
    <Rx.Flex direction="column" align="start" gap="3" mt={view.mods.length > 0 ? "3" : undefined}>
      <Rx.Button ref={addButton} variant="outline" color="gray" size="1" aria-disabled={busy} onClick={add}>
        <Icon name="add" size={14} />
        {t("mods.add")}
      </Rx.Button>
      {addError && (
        <Rx.Callout.Root color="red" role="alert">
          <Rx.Callout.Text>
            <Plain>{addError}</Plain>
          </Rx.Callout.Text>
        </Rx.Callout.Root>
      )}
    </Rx.Flex>
  );

  const rows = [
    ...view.mods.map((m) => <ModItem key={m.id} mod={m} error={Object.hasOwn(rowErrors, m.id) ? rowErrors[m.id] : undefined} onSet={(on) => rowAction(m.id, () => (on ? turnOnRow(m.id) : mods.set(m.id, on)))} onRemove={() => rowAction(m.id, () => mods.remove(m.id))} />),
    // A folder that couldn't be read as a mod: its id and why, nothing to switch.
    ...view.problems.map((p) => (
      <Row
        key={`problem:${p.id}`}
        as="li"
        aria-label={p.id}
        label={
          <Rx.Text weight="bold">
            <Plain>{p.id}</Plain>
          </Rx.Text>
        }
        below={
          <Rx.Text as="p" size="1" color="red">
            {t("mods.problem", { reason: p.reason })}
          </Rx.Text>
        }
      />
    )),
  ];

  return (
    <div>
      {head}
      <LayoutSection client={client} />
      {rows.length === 0 ? (
        <>
          <Rx.Text as="p" size="2" color="gray" mb="3">
            {t("mods.empty")}
          </Rx.Text>
          {addRow}
        </>
      ) : (
        <Group loose title={t("mods.listTitle")} after={addRow}>
          {rows}
        </Group>
      )}
    </div>
  );
}

/** The Select's value for "no pick": the harness's `main`, else the app's. Not a valid layout name. */
const DEFAULT = "-default";

/**
 * Settings › Mods › Layout (0b2): a card with one row, "Layout to show", whose hint says what is shown and from which
 * layer, and whose control is a Select of every layout (Default first, then each name once, from the first layer that
 * has it). The files passed over are red lines under the row. Only when main has the layout channel.
 */
function LayoutSection({ client }: { client: HarnessClient }) {
  const { t } = useTranslation();
  const { view, pick } = useLayoutPick(client);
  const [error, setError] = useState<string | null>(null);
  const id = useId();
  if (!view) return null;
  const layer = (s: LayoutView["source"]) => t(`mods.layout.layer.${s}`);
  const short = (s: LayoutView["source"]) => t(`mods.layout.short.${s}`);
  const names = new Map<string, LayoutView["source"]>();
  for (const c of view.choices) if (!names.has(c.name)) names.set(c.name, c.source);
  const items = [...names].map(([name, source]) => ({ name, label: t("mods.layout.choice", { name, layer: short(source) }) }));
  if (view.picked !== undefined && !names.has(view.picked)) items.unshift({ name: view.picked, label: t("mods.layout.choice", { name: view.picked, layer: t("mods.layout.missing") }) });
  const onPick = (v: string) => {
    setError(null);
    pick(v === DEFAULT ? null : v).catch(() => setError(t("mods.error")));
  };
  const lines = view.problems.map((p) => t("mods.layout.passedOver", { reason: p }));
  return (
    <Group title={t("mods.layout.title")}>
      <Row
        htmlFor={id}
        hintId={`${id}-hint`}
        label={t("mods.layout.pick")}
        hint={t("mods.layout.showing", { name: view.name, layer: layer(view.source) })}
        below={
          (lines.length > 0 || error) && (
            <Rx.Flex direction="column" gap="1">
              {lines.map((l, i) => (
                <Rx.Text as="p" size="1" color="red" key={i}>
                  <Plain>{l}</Plain>
                </Rx.Text>
              ))}
              {error && (
                <Rx.Text as="p" size="1" color="red" role="alert">
                  {error}
                </Rx.Text>
              )}
            </Rx.Flex>
          )
        }
      >
        <Rx.Select.Root value={view.picked ?? DEFAULT} onValueChange={onPick}>
          <Rx.Select.Trigger id={id} aria-label={t("mods.layout.pick")} aria-describedby={`${id}-hint`} />
          <Rx.Select.Content position="popper">
            <Rx.Select.Item value={DEFAULT}>{t("mods.layout.default")}</Rx.Select.Item>
            {items.map((it) => (
              <Rx.Select.Item key={it.name} value={it.name}>
                {it.label}
              </Rx.Select.Item>
            ))}
          </Rx.Select.Content>
        </Rx.Select.Root>
      </Row>
    </Group>
  );
}

function ModItem({ mod, error, onSet, onRemove }: { mod: ModRow; error?: string; onSet: (on: boolean) => void; onRemove: () => void }) {
  const { t } = useTranslation();
  const uses = [...mod.registers.hooks, ...mod.registers.ipc];
  const lines = [mod.failed ? t("mods.failed", { reason: mod.failed }) : null, mod.problem ? t("mods.problem", { reason: mod.problem }) : null].filter((l) => l !== null);
  return (
    <Row
      as="li"
      aria-label={mod.name}
      label={
        <Rx.Flex as="span" align="center" gap="2" wrap="wrap" minWidth="0">
          <Rx.Text weight="bold">
            <Plain>{mod.name}</Plain>
          </Rx.Text>
          {/* Only a folder the person added is marked (Marco, 2026-11-08): Core and Harness mods carry no badge. */}
          {mod.origin === "local" && <Rx.Badge color="gray">{t("mods.origin.local")}</Rx.Badge>}
        </Rx.Flex>
      }
      {...(uses.length > 0 ? { hint: t("mods.registers", { list: uses.join(", ") }) } : {})}
      below={
        (lines.length > 0 || error) && (
          <Rx.Flex direction="column" gap="1">
            {lines.map((l, i) => (
              <Rx.Text as="p" size="1" color="red" key={i}>
                {l}
              </Rx.Text>
            ))}
            {error && (
              <Rx.Text as="p" size="1" color="red" role="alert">
                {error}
              </Rx.Text>
            )}
          </Rx.Flex>
        )
      }
    >
      {mod.origin === "local" && (
        <Rx.Button variant="ghost" color="gray" size="1" onClick={onRemove}>
          {t("mods.remove")}
        </Rx.Button>
      )}
      <Rx.Switch aria-label={mod.name} checked={mod.on} onCheckedChange={onSet} />
    </Row>
  );
}

/**
 * The warning before a local mod turns on (spec D2, §6): its name as the question, version and folder, the warning as
 * an orange Callout above the buttons (Marco, 2026-11-08), then Cancel and Turn on right-aligned, Turn on rightmost.
 */
function ModReviewScreen({ review, busy, error, onTurnOn, onCancel }: { review: ModReview; busy: boolean; error: string | null; onTurnOn: () => void; onCancel: () => void }) {
  const { t } = useTranslation();
  const id = useId();
  const head = useRef<HTMLHeadingElement>(null);
  useEffect(() => head.current?.focus(), [review.id]);
  return (
    <section aria-labelledby={`${id}-name`}>
      <Rx.Heading as="h2" size="5" id={`${id}-name`} ref={head} tabIndex={-1} mb="1">
        {t("mods.review.title", { name: review.name })}
      </Rx.Heading>
      <Rx.Text as="p" size="1" color="gray" mb="5">
        {t("plugins.version", { version: review.version })}
        {" · "}
        <span className="hh-gd-path">{t("mods.review.folder", { folder: review.folder })}</span>
      </Rx.Text>
      <Rx.Callout.Root color="orange" mb="5">
        <Rx.Callout.Text>{t("mods.review.warning")}</Rx.Callout.Text>
      </Rx.Callout.Root>
      {error && (
        <Rx.Callout.Root color="red" role="alert" mb="3">
          <Rx.Callout.Text>{error}</Rx.Callout.Text>
        </Rx.Callout.Root>
      )}
      <Rx.Flex justify="end" gap="2">
        {/* Not while Turn on is in flight: it could still end with the mod on. */}
        <Rx.Button variant="outline" color="gray" aria-disabled={busy} onClick={() => !busy && onCancel()}>
          {t("mods.review.cancel")}
        </Rx.Button>
        <Rx.Button aria-disabled={busy} onClick={() => !busy && onTurnOn()}>
          {t("mods.review.on")}
        </Rx.Button>
      </Rx.Flex>
    </section>
  );
}
