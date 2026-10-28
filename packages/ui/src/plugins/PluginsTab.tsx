import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { HarnessClient, PluginResult, PluginReview, PluginRow } from "../client";
import { shownLanguage } from "../language";
import { Plain, PermissionReview } from "./PermissionReview";
import { PluginDetail, when } from "./PluginDetail";
import { usePluginsRescan } from "./usePlugins";

type Screen = { kind: "list" } | { kind: "review"; review: PluginReview; token?: string } | { kind: "detail"; id: string };

/**
 * Settings › Plugins (plugins spec §7): the list (opening it rescans), Add from folder (main shows the dialog and
 * answers a review and a one-time token, never a path from here), the permission review and each plugin's detail.
 * Only shown with `state.plugins` (D0).
 */
export function PluginsTab({ client }: { client: HarnessClient }) {
  const { t, i18n } = useTranslation();
  const language = shownLanguage(i18n);
  const view = usePluginsRescan(client);
  const [screen, setScreen] = useState<Screen>({ kind: "list" });
  const [busy, setBusy] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [addError, setAddError] = useState<string | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  /** The row whose name opened the detail: focus goes back to it on the way back. */
  const back = useRef<string | null>(null);
  const failed = t("plugins.failed");

  const showReview = (review: PluginReview, token?: string) => {
    setReviewError(null);
    setScreen({ kind: "review", review, ...(token ? { token } : {}) });
  };
  const toList = () => {
    setReviewError(null);
    setScreen({ kind: "list" });
  };

  const add = () => {
    if (busy) return;
    setBusy(true);
    setAddError(null);
    client.plugins.pick().then(
      (r) => {
        setBusy(false);
        if (r.ok) showReview(r.review, r.token);
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
        if (!r.ok && "review" in r) showReview(r.review);
        else if (!r.ok) setRowErrors((e) => ({ ...e, [row.id]: r.message }));
      },
      () => setRowErrors((e) => ({ ...e, [row.id]: failed })),
    );
  };

  /** Turn on: a picked folder is added first (its token, once); then exactly the reviewed dist is approved. */
  const turnOn = async (s: Extract<Screen, { kind: "review" }>) => {
    setBusy(true);
    setReviewError(null);
    const settle = (r: PluginResult): boolean => {
      if (r.ok) return true;
      if ("review" in r) showReview(r.review);
      else setReviewError(r.message);
      return false;
    };
    try {
      if (s.token) {
        if (!settle(await client.plugins.add(s.token))) return;
        // The token is spent: a second try only approves.
        setScreen({ kind: "review", review: s.review });
      }
      if (settle(await client.plugins.approve(s.review.id, s.review.distHash))) toList();
    } catch {
      setReviewError(failed);
    } finally {
      setBusy(false);
    }
  };

  // Back on the list from a detail: focus the row's name again.
  useEffect(() => {
    if (screen.kind !== "list" || back.current === null) return;
    const id = back.current;
    back.current = null;
    document.querySelector<HTMLElement>(`[data-plugin-open="${CSS.escape(id)}"]`)?.focus();
  }, [screen]);

  if (!view) return <div className="hh-tab" aria-busy="true" />;

  if (screen.kind === "review") {
    return <PermissionReview review={screen.review} busy={busy} error={reviewError} onTurnOn={() => void turnOn(screen)} onCancel={toList} />;
  }
  if (screen.kind === "detail") {
    const row = view.plugins.find((p) => p.id === screen.id);
    // Gone (removed here or elsewhere): back to the list.
    if (row) {
      return (
        <PluginDetail
          client={client}
          row={row}
          onBack={() => {
            back.current = row.id;
            toList();
          }}
          onRemoved={toList}
        />
      );
    }
  }

  return (
    <div className="hh-tab">
      <p className="hh-caption">{t("plugins.intro")}</p>
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
          <button type="button" aria-disabled={busy} onClick={add}>
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
