import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { HarnessClient, PluginResult, PluginReview, PluginRow } from "../client";
import { shownLanguage } from "../language";
import { Plain, PermissionReview } from "./PermissionReview";
import { PluginDetail, when } from "./PluginDetail";
import { usePluginsRescan } from "./usePlugins";
import { SectionHead } from "../settings-parts";

/** A review's `from`: the row whose switch asked for it (focus goes back there); none for Add from folder. */
type Screen = { kind: "list" } | { kind: "review"; review: PluginReview; token?: string; from?: string } | { kind: "detail"; id: string };

/**
 * Settings › Plugins (plugins spec §7): the list (opening it rescans), Add from folder (main shows the dialog and
 * answers a review and a one-time token, never a path from here), the permission review and each plugin's detail.
 * Only shown with `state.plugins` (D0).
 */
export function PluginsTab({ client }: { client: HarnessClient }) {
  const { t, i18n } = useTranslation();
  const language = shownLanguage(i18n);
  const { view, failed: loadFailed } = usePluginsRescan(client);
  const [screen, setScreen] = useState<Screen>({ kind: "list" });
  const [busy, setBusy] = useState(false);
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

  // Back on the list (from a detail, a review or a removal): focus the row it came from, else Add from folder.
  useEffect(() => {
    if (screen.kind !== "list" || back.current === null) return;
    const { row } = back.current;
    back.current = null;
    const to = row === undefined ? null : document.querySelector<HTMLElement>(`[data-plugin-open="${CSS.escape(row)}"]`);
    (to ?? addButton.current)?.focus();
  }, [screen]);

  if (!view) {
    return loadFailed ? (
      <div className="hh-tab" data-setting="plugins.plugins">
        <p className="hh-field-error" role="alert">
          {failed}
        </p>
      </div>
    ) : (
      <div className="hh-tab" data-setting="plugins.plugins" aria-busy="true" />
    );
  }

  if (screen.kind === "review") {
    return <PermissionReview review={screen.review} busy={busy} error={reviewError} onTurnOn={() => void turnOn(screen)} onCancel={() => toList(screen.from)} />;
  }
  if (screen.kind === "detail") {
    const row = view.plugins.find((p) => p.id === screen.id);
    // Gone (removed here or elsewhere): back to the list.
    if (row) {
      return (
        <PluginDetail
          client={client}
          row={row}
          onBack={() => toList(row.id)}
          onRemoved={() => toList()}
        />
      );
    }
  }

  return (
    <div className="hh-tab" data-setting="plugins.plugins">
      <SectionHead title={t("plugins.tab")} line={t("settings.line.plugins")} />
      {view.plugins.length === 0 ? (
        <p className="hh-pl-empty">{t("plugins.empty")}</p>
      ) : (
        <ul className="hh-rows hh-pl-list">
          {view.plugins.map((p) => (
            <li key={p.id} className="hh-row hh-row-wrap hh-pl-row">
              <span className="hh-pl-row-main">
                <button type="button" className="hh-link hh-pl-name" data-plugin-open={p.id} onClick={() => setScreen({ kind: "detail", id: p.id })}>
                  <Plain>{p.name}</Plain>
                </button>
                <span className="hh-caption hh-pl-meta">
                  {p.version && t("plugins.version", { version: p.version })}
                  {" · "}
                  {p.origin === "bundled" ? (
                    t("plugins.origin.bundled")
                  ) : (
                    <>
                      {t(`plugins.origin.${p.origin}`)} <Plain>{p.folder ?? ""}</Plain>
                    </>
                  )}
                </span>
                <span className="hh-pl-status">
                  {p.status === "error" ? (
                    <>
                      {t("plugins.status.error")} <Plain>{p.error ?? failed}</Plain>
                    </>
                  ) : (
                    t(`plugins.status.${p.status}`)
                  )}
                  {p.updated && <span className="hh-pl-tag">{t("plugins.updated")}</span>}
                  {p.lastSync && <span className="hh-caption"> · {t("plugins.lastSync", { time: when(p.lastSync, language) })}</span>}
                </span>
                {p.lastError && (
                  <span className="hh-caption hh-pl-error-text">
                    {t("plugins.lastError")} <Plain>{p.lastError}</Plain>
                  </span>
                )}
                {Object.hasOwn(rowErrors, p.id) && (
                  <span className="hh-field-error" role="alert">
                    {rowErrors[p.id]}
                  </span>
                )}
              </span>
              <input type="checkbox" role="switch" aria-label={p.name} checked={p.status === "on"} onChange={(e) => setOn(p, e.target.checked)} />
            </li>
          ))}
        </ul>
      )}
      {view.local && (
        <div>
          <button type="button" ref={addButton} aria-disabled={busy} onClick={add}>
            {t("plugins.add")}
          </button>
          {addError && (
            <p className="hh-field-error" role="alert">
              {addError}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
