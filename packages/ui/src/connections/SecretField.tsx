import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Tag } from "../chrome";
import type { ConnectionResult, ConnectionView } from "../client";

/**
 * One declared key (tools spec §9): its label, help and whether it is set, never its value. The typed value lives only
 * in this password field until Save, which clears it before the answer comes (S1). With `onTest` (a connect step names
 * a test for this key), Test connection runs it and the outcome shows under the row: this click's answer, else the
 * last test main kept.
 */
export function SecretField({
  connection,
  onSave,
  onDelete,
  onTest,
}: {
  connection: ConnectionView;
  onSave: (value: string) => Promise<ConnectionResult>;
  onDelete: () => Promise<ConnectionResult>;
  onTest?: () => Promise<ConnectionResult>;
}) {
  const { t } = useTranslation();
  const id = useId();
  const [value, setValue] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const [testing, setTesting] = useState(false);
  const [tested, setTested] = useState<ConnectionResult | null>(null);
  // A new kept test, or the key stored or deleted: main's record is the outcome again.
  const lastAt = connection.lastTest?.at;
  useEffect(() => setTested(null), [lastAt, connection.set]);
  const live = useRef(true);
  useEffect(() => {
    // Set again on each mount: StrictMode unmounts and mounts once more.
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  const runTest = () => {
    if (!onTest || testing) return;
    setTesting(true);
    void onTest().then((r) => {
      if (!live.current) return;
      setTesting(false);
      setTested(r);
    });
  };
  const last = connection.lastTest;
  const outcome: ConnectionResult | null = tested ?? (last ? (last.ok ? { ok: true } : { ok: false, message: last.message ?? "" }) : null);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const v = value;
    setValue("");
    if (v.trim() === "") return;
    void onSave(v);
  };
  return (
    <div className="hh-row hh-row-wrap hh-secret" role="group" aria-labelledby={`${id}-label`}>
      {/* The key's first letter, as a tile: decoration only, the label names it. */}
      <span className="hh-letter-tile" aria-hidden="true">
        {[...connection.label.trim()][0]?.toUpperCase() ?? "?"}
      </span>
      <span className="hh-row-label" id={`${id}-label`}>
        <bdi dir="auto">{connection.label}</bdi>
      </span>
      {/* The id is what the field is described by. */}
      <Tag tone={connection.set ? "green" : "orange"} id={`${id}-state`}>
        {connection.set ? t("connections.set") : t("connections.notSet")}
      </Tag>
      <form className="hh-pl-key-form" onSubmit={submit}>
        <input
          ref={input}
          type="password"
          value={value}
          autoComplete="off"
          spellCheck={false}
          placeholder={t("connections.paste")}
          aria-labelledby={`${id}-label`}
          aria-describedby={connection.help ? `${id}-state ${id}-help` : `${id}-state`}
          onChange={(e) => setValue(e.target.value)}
        />
        <button type="submit" className={connection.set ? undefined : "hh-cta"} disabled={value.trim() === ""}>
          {connection.set ? t("connections.replace") : t("connections.save")}
        </button>
        {connection.set && (
          // Delete goes away once the key is gone: focus moves to the field, not to the page.
          <button type="button" onClick={() => void onDelete().then((r) => r.ok && input.current?.focus())}>
            {t("connections.delete")}
          </button>
        )}
        {onTest && (
          <button type="button" disabled={testing} onClick={runTest}>
            {t("connections.test")}
          </button>
        )}
      </form>
      {onTest && outcome && (
        <p className="hh-caption hh-row-note" role="status" dir="auto">
          {outcome.ok ? t("connections.works") : t("connections.testFailed", { message: outcome.message })}
        </p>
      )}
      {connection.help && (
        <p className="hh-caption hh-row-note" id={`${id}-help`} dir="auto">
          {connection.help}
        </p>
      )}
    </div>
  );
}
