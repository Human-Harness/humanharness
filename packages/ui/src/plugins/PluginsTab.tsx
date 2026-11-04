import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { HarnessClient, PluginResult, PluginReview, PluginRow } from "../client";
import { Group, Icon, Row, Rx, SectionHead } from "../guide";
import { shownLanguage } from "../language";
import { Plain, PermissionReview } from "./PermissionReview";
import { PluginDetail, when } from "./PluginDetail";
import { usePluginsRescan } from "./usePlugins";

/**
 * Each state's badge (DESIGN.md "Badge": green ok, orange needs attention, gray off). A plugin turned off after
 * crashes, or in error, says so in a red line under its row instead: its words are a sentence, not a tag.
 */
const STATUS_BADGE: Partial<Record<PluginRow["status"], "green" | "gray" | "orange">> = { on: "green", off: "gray", review: "orange" };

/** A review's `from`: the row whose switch asked for it (focus goes back there); none for Add from folder. */
type Screen = { kind: "list" } | { kind: "review"; review: PluginReview; token?: string; from?: string } | { kind: "detail"; id: string };

/** A screen inside the section: the top bar's Volver names the list and goes back to it (DESIGN.md "Settings"). */
export interface SettingsSub {
  label: string;
  back: () => void;
}

/**
 * Settings › Plugins (plugins spec §7): the list (opening it rescans), Add from folder (main shows the dialog and
 * answers a review and a one-time token, never a path from here), the permission review and each plugin's detail.
 * Only shown with `state.plugins` (D0).
 *
 * Radix stage 2e: the list is loose, one row per plugin (its name opens the detail; its state as a badge; its switch on
 * the right); Add from folder is an outline button under it. A review or a detail takes the list's place and hands
 * `onSub` the way back, so the top bar reads "← Plugins" and Escape goes back to the list.
 */
export function PluginsTab({ client, onSub }: { client: HarnessClient; onSub?: (sub: SettingsSub | null) => void }) {
  const { t, i18n } = useTranslation();
  const language = shownLanguage(i18n);
  const { view, failed: loadFailed } = usePluginsRescan(client);
  const [screen, setScreen] = useState<Screen>({ kind: "list" });
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  busyRef.current = busy;
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [addError, setAddError] = useState<string | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  /**
   * Where focus goes on the way back to the list: the row it came from (`row`), else Add from folder. Null: nowhere
   * (the list was not left).
   */
  const back = useRef<{ row?: string } | null>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const failed = t("plugins.failed");

  const showReview = (review: PluginReview, opts: { token?: string; from?: string } = {}) => {
    setReviewError(null);
    setScreen({ kind: "review", review, ...(opts.token ? { token: opts.token } : {}), ...(opts.from ? { from: opts.from } : {}) });
  };
  const toList = (row?: string) => {
    setReviewError(null);
    back.current = row ? { row } : {};
    setScreen({ kind: "list" });
  };

  // Away from the list, the top bar goes back to it (not while Turn on is in flight: it could still end with the
  // plugin on). Read through a ref, so the top bar always runs this screen's way back.
  const leave = useRef<() => void>(() => {});
  leave.current = () => {
    if (screen.kind === "list" || busyRef.current) return;
    toList(screen.kind === "detail" ? screen.id : screen.from);
  };
  const away = screen.kind !== "list";
  const subLabel = t("plugins.tab");
  useEffect(() => {
    onSub?.(away ? { label: subLabel, back: () => leave.current() } : null);
  }, [away, subLabel]);
  useEffect(() => () => onSub?.(null), []);

  const add = () => {
    if (busy) return;
    setBusy(true);
    setAddError(null);
    client.plugins.pick().then(
      (r) => {
        setBusy(false);
        if (r.ok) showReview(r.review, { token: r.token });
        else if (!("cancelled" in r)) setAddError(r.message);
      },
      () => {
        setBusy(false);
        setAddError(failed);
      },
    );
  };

  const setOn = (row: PluginRow, on: boolean) => {
    setRowErrors(({ [row.id]: _gone, ...rest }) => rest);
    client.plugins.setOn(row.id, on).then(
      (r) => {
        if (!r.ok && "review" in r) showReview(r.review, { from: row.id });
        else if (!r.ok) setRowErrors((e) => ({ ...e, [row.id]: r.message }));
      },
      () => setRowErrors((e) => ({ ...e, [row.id]: failed })),
    );
  };

  /** Turn on: a picked folder is added first (its token, once); then exactly the reviewed dist is approved. */
  const turnOn = async (s: Extract<Screen, { kind: "review" }>) => {
    setBusy(true);
    setReviewError(null);
    const from = s.from ? { from: s.from } : {};
    const settle = (r: PluginResult): boolean => {
      if (r.ok) return true;
      // A review in the answer replaces this one (the plugin changed since); its message says why.
      if ("review" in r) showReview(r.review, from);
      if (r.message) setReviewError(r.message);
      return false;
    };
    try {
      if (s.token) {
        if (!settle(await client.plugins.add(s.token))) return;
        // The token is spent: a second try only approves.
        setScreen({ kind: "review", review: s.review, ...from });
      }
      if (settle(await client.plugins.approve(s.review.id, s.review.distHash))) toList(s.from);
    } catch {
      setReviewError(failed);
    } finally {
      setBusy(false);
    }
  };

  // A detail whose plugin is gone (removed here or elsewhere): the list again, and the top bar with it.
  useEffect(() => {
    if (screen.kind === "detail" && view && !view.plugins.some((p) => p.id === screen.id)) toList();
  }, [view, screen]);

  // Back on the list (from a detail, a review or a removal): focus the row it came from, else Add from folder.
  useEffect(() => {
    if (screen.kind !== "list" || back.current === null) return;
    const { row } = back.current;
    back.current = null;
    const to = row === undefined ? null : document.querySelector<HTMLElement>(`[data-plugin-open="${CSS.escape(row)}"]`);
    (to ?? addButton.current)?.focus();
  }, [screen]);

  const head = <SectionHead line={t("settings.line.plugins")} />;
  if (!view) {
    return loadFailed ? (
      <div data-setting="plugins.plugins">
        {head}
        <Rx.Callout.Root color="red" role="alert">
          <Rx.Callout.Text>{failed}</Rx.Callout.Text>
        </Rx.Callout.Root>
      </div>
    ) : (
      <div data-setting="plugins.plugins" aria-busy="true">
        {head}
      </div>
    );
  }

  if (screen.kind === "review") {
    return (
      <div data-setting="plugins.plugins">
        <PermissionReview review={screen.review} busy={busy} error={reviewError} onTurnOn={() => void turnOn(screen)} onCancel={() => toList(screen.from)} />
      </div>
    );
  }
  // A detail takes the list's place (gone, removed here or elsewhere: the list again).
  const open = screen.kind === "detail" ? view.plugins.find((p) => p.id === screen.id) : undefined;
  if (open) {
    return (
      <div data-setting="plugins.plugins">
        <PluginDetail key={open.id} client={client} row={open} onRemoved={() => toList()} />
      </div>
    );
  }

  const addRow = view.local && (
    <Rx.Flex direction="column" align="start" gap="3" mt={view.plugins.length > 0 ? "3" : undefined}>
      <Rx.Button ref={addButton} variant="outline" color="gray" size="1" aria-disabled={busy} onClick={add}>
        <Icon name="add" size={14} />
        {t("plugins.add")}
      </Rx.Button>
      {addError && (
        <Rx.Callout.Root color="red" role="alert">
          <Rx.Callout.Text>{addError}</Rx.Callout.Text>
        </Rx.Callout.Root>
      )}
    </Rx.Flex>
  );

  return (
    <div data-setting="plugins.plugins">
      {head}
      {view.plugins.length === 0 ? (
        <>
          <Rx.Text as="p" size="2" color="gray" mb="3">
            {t("plugins.empty")}
          </Rx.Text>
          {addRow}
        </>
      ) : (
        <Group loose after={addRow}>
          {view.plugins.map((p) => {
            const badge = STATUS_BADGE[p.status];
            const lines = [
              p.status === "crashed" ? t("plugins.status.crashed") : null,
              p.status === "error" ? (
                <>
                  {t("plugins.status.error")} <Plain>{p.error ?? failed}</Plain>
                </>
              ) : null,
              p.lastError ? (
                <>
                  {t("plugins.lastError")} <Plain>{p.lastError}</Plain>
                </>
              ) : null,
            ].filter((l) => l !== null);
            const rowError = Object.hasOwn(rowErrors, p.id) ? rowErrors[p.id] : undefined;
            return (
              <Row
                key={p.id}
                as="li"
                aria-label={p.name}
                label={
                  <Rx.Flex as="span" align="center" gap="2" wrap="wrap" minWidth="0">
                    <Rx.Button variant="ghost" color="gray" highContrast size="2" data-plugin-open={p.id} onClick={() => setScreen({ kind: "detail", id: p.id })}>
                      <Rx.Text weight="bold">
                        <Plain>{p.name}</Plain>
                      </Rx.Text>
                    </Rx.Button>
                    {badge && <Rx.Badge color={badge}>{t(`plugins.status.${p.status}`)}</Rx.Badge>}
                    {p.updated && (
                      <Rx.Badge variant="outline" color="gray">
                        {t("plugins.updated")}
                      </Rx.Badge>
                    )}
                  </Rx.Flex>
                }
                hint={
                  <>
                    {p.version && t("plugins.version", { version: p.version })}
                    {p.version && " · "}
                    {p.origin === "bundled" ? (
                      t("plugins.origin.bundled")
                    ) : (
                      <>
                        {t(`plugins.origin.${p.origin}`)} <span className="hh-gd-path">{p.folder ?? ""}</span>
                      </>
                    )}
                    {p.lastSync && ` · ${t("plugins.lastSync", { time: when(p.lastSync, language) })}`}
                  </>
                }
                below={
                  (lines.length > 0 || rowError) && (
                    <Rx.Flex direction="column" gap="1">
                      {lines.map((l, i) => (
                        <Rx.Text as="p" size="1" color="red" key={i}>
                          {l}
                        </Rx.Text>
                      ))}
                      {rowError && (
                        <Rx.Text as="p" size="1" color="red" role="alert">
                          {rowError}
                        </Rx.Text>
                      )}
                    </Rx.Flex>
                  )
                }
              >
                <Rx.Switch aria-label={p.name} checked={p.status === "on"} onCheckedChange={(on) => setOn(p, on)} />
              </Row>
            );
          })}
        </Group>
      )}
    </div>
  );
}
