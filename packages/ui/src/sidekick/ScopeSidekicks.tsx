import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { HarnessClient, SidekickInScope } from "../client";
import { SidekickMark } from "./mark";

/** The longest purpose text (the SDK's SIDEKICK_PURPOSE_TEXT_MAX; the UI imports only types). */
const PURPOSE_MAX = 600;

/**
 * "Sidekicks in this <scope>" (spec §2a.4, Decision 8): for the open scope, each sidekick on or off there and its
 * purpose text there (saved on blur). Nothing is written until the person changes something.
 */
export function ScopeSidekicks({ client, scope, scopeNoun }: { client: HarnessClient; scope: { id: string; label: string }; scopeNoun: string }) {
  const { t } = useTranslation();
  const [rows, setRows] = useState<SidekickInScope[]>([]);
  const [failed, setFailed] = useState<string | null>(null);
  const ids = useId();

  // Read again whenever the sidekicks change (one added, removed or renamed in the list above).
  useEffect(() => {
    let live = true;
    let seq = 0;
    const load = () => {
      const mine = ++seq;
      client.sidekick.scope(scope.id).then(
        (list) => live && mine === seq && setRows(list),
        () => undefined,
      );
    };
    load();
    const off = client.sidekick.onChange(load);
    return () => {
      live = false;
      off();
    };
  }, [client, scope.id]);

  return (
    <section aria-labelledby={`${ids}-head`} className="hh-sk-list hh-sk-scope">
      <h3 id={`${ids}-head`}>{t("sidekick.scope.title", { noun: scopeNoun })}</h3>
      <p className="hh-caption">{scope.label}</p>
      <p className="hh-caption" id={`${ids}-hint`}>
        {t("sidekick.scope.purposeHint", { noun: scopeNoun })}
      </p>
      <ul className="hh-sk-list-rows">
        {rows.map((r) => (
          <ScopeRow key={r.id} client={client} scope={scope.id} row={r} hintId={`${ids}-hint`} onFailed={setFailed} />
        ))}
      </ul>
      {failed !== null && <p role="alert">{t("sidekick.settings.failed", { message: failed })}</p>}
    </section>
  );
}

type Value = { on: boolean; text: string };
const same = (a: Value, b: Value) => a.on === b.on && a.text.trim() === b.text.trim();

/**
 * One sidekick's row. Its values are local from the first read; one save at a time, and a change made while one runs
 * is saved after it (only the latest value, and only when it differs), so a quick double click never writes twice nor
 * gets lost. A refusal puts the switch back and says why.
 */
function ScopeRow({
  client,
  scope,
  row,
  hintId,
  onFailed,
}: {
  client: HarnessClient;
  scope: string;
  row: SidekickInScope;
  hintId: string;
  onFailed: (message: string | null) => void;
}) {
  const { t } = useTranslation();
  const [on, setOn] = useState(row.on);
  const [text, setText] = useState(row.purposeText ?? "");
  const [busy, setBusy] = useState(false);
  const saved = useRef<Value>({ on: row.on, text: row.purposeText ?? "" });
  const wanted = useRef<Value>(saved.current);
  const running = useRef(false);
  const live = useRef(true);
  useEffect(
    () => () => {
      live.current = false;
    },
    [],
  );
  const boxId = useId();

  const flush = () => {
    if (running.current || !live.current) return;
    const next = wanted.current;
    if (same(next, saved.current)) return;
    running.current = true;
    setBusy(true);
    onFailed(null);
    const purposeText = next.text.trim();
    const fail = (message: string) => {
      wanted.current = saved.current;
      if (!live.current) return;
      setOn(saved.current.on);
      onFailed(message);
    };
    client.sidekick
      .setScope(scope, row.id, { on: next.on, ...(purposeText ? { purposeText } : {}), ...(row.places ? { places: row.places } : {}) })
      .then(
        (r) => {
          if (r.ok) saved.current = next;
          else fail(r.message ?? "");
        },
        (err: unknown) => fail(err instanceof Error ? err.message : String(err)),
      )
      .finally(() => {
        running.current = false;
        if (!live.current) return;
        setBusy(false);
        flush();
      });
  };

  return (
    <li aria-busy={busy}>
      <div className="hh-sk-list-row">
        <SidekickMark mark={row.mark} off={!on} />
        <div className="hh-sk-list-text">
          <label>
            <input
              type="checkbox"
              checked={on}
              onChange={(e) => {
                setOn(e.target.checked);
                wanted.current = { ...wanted.current, on: e.target.checked };
                flush();
              }}
            />{" "}
            {row.name}
          </label>
          <label className="hh-caption" htmlFor={boxId}>
            {t("sidekick.scope.purpose", { name: row.name })}
          </label>
          <textarea
            id={boxId}
            rows={2}
            maxLength={PURPOSE_MAX}
            value={text}
            aria-describedby={hintId}
            onChange={(e) => setText(e.target.value)}
            onBlur={() => {
              wanted.current = { ...wanted.current, text };
              flush();
            }}
          />
        </div>
      </div>
    </li>
  );
}
