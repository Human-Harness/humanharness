import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ConnectionResult, ConnectionsView, HarnessClient } from "../client";
import { SecretField } from "./SecretField";

export interface Connections {
  /** null until the first answer. */
  view: ConnectionsView | null;
  /** Main couldn't give the view (get answered null or failed). */
  unavailable: boolean;
  /** The last refusal's text; cleared by the next answer that worked. */
  error: string | null;
  save: (id: string, value: string) => Promise<ConnectionResult>;
  remove: (id: string) => Promise<ConnectionResult>;
}

/**
 * The harness's keys as main has them. Pushes may arrive out of order (overlapping set/delete), so neither a push nor
 * an answer is shown as is: each asks main for the view again, and only the answer to the latest ask is kept.
 */
export function useConnections(client: HarnessClient): Connections {
  const { t } = useTranslation();
  const [view, setView] = useState<ConnectionsView | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const asked = useRef(0);
  const live = useRef(true);

  const refresh = useCallback(() => {
    const n = ++asked.current;
    client.connections.get().then(
      (v) => {
        if (!live.current || n !== asked.current) return;
        setUnavailable(v === null);
        if (v) setView(v);
      },
      () => {
        if (live.current && n === asked.current) setUnavailable(true);
      },
    );
  }, [client]);

  useEffect(() => {
    live.current = true;
    refresh();
    const off = client.connections.onChange(() => refresh());
    return () => {
      live.current = false;
      off();
    };
  }, [client, refresh]);

  const answer = useCallback(
    async (call: () => Promise<ConnectionResult>): Promise<ConnectionResult> => {
      let result: ConnectionResult;
      try {
        result = await call();
      } catch {
        result = { ok: false, message: t("connections.failed") };
      }
      if (live.current) {
        setError(result.ok ? null : result.message);
        refresh();
      }
      return result;
    },
    [refresh, t],
  );

  return {
    view,
    unavailable,
    error,
    save: (id, value) => answer(() => client.connections.set(id, value)),
    remove: (id) => answer(() => client.connections.delete(id)),
  };
}

/** Settings › Connections (tools spec §9): one row per declared key, in manifest order. Only with `state.connections`. */
export function ConnectionsTab({ client }: { client: HarnessClient }) {
  const { t } = useTranslation();
  const { view, unavailable, error, save, remove } = useConnections(client);
  return (
    <div className="hh-tab">
      <p className="hh-caption">{t("connections.intro")}</p>
      {unavailable && <p role="alert">{t("connections.unavailable")}</p>}
      {view && !unavailable && (
        <div className="hh-rows">
          {view.connections.map((c) => (
            <SecretField key={c.id} connection={c} onSave={(value) => save(c.id, value)} onDelete={() => remove(c.id)} />
          ))}
        </div>
      )}
      {error && (
        <p className="hh-field-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
