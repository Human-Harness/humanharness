import { type FormEvent, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ConnectionResult, ConnectionView } from "../client";

/**
 * One declared key (tools spec §9): its label, help and whether it is set, never its value. The typed value lives only
 * in this password field until Save, which clears it before the answer comes (S1).
 */
export function SecretField({
  connection,
  onSave,
  onDelete,
}: {
  connection: ConnectionView;
  onSave: (value: string) => Promise<ConnectionResult>;
  onDelete: () => Promise<ConnectionResult>;
}) {
  const { t } = useTranslation();
  const id = useId();
  const [value, setValue] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const v = value;
    setValue("");
    if (v.trim() === "") return;
    void onSave(v);
  };
  return (
    <div className="hh-row hh-row-wrap" role="group" aria-labelledby={`${id}-label`}>
      <span className="hh-row-label" id={`${id}-label`}>
        <bdi dir="auto">{connection.label}</bdi>
      </span>
      <span className="hh-caption" id={`${id}-state`}>
        {connection.set ? t("connections.set") : t("connections.notSet")}
      </span>
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
        <button type="submit" disabled={value.trim() === ""}>
          {connection.set ? t("connections.replace") : t("connections.save")}
        </button>
        {connection.set && (
          // Delete goes away once the key is gone: focus moves to the field, not to the page.
          <button type="button" onClick={() => void onDelete().then((r) => r.ok && input.current?.focus())}>
            {t("connections.delete")}
          </button>
        )}
      </form>
      {connection.help && (
        <p className="hh-caption hh-row-note" id={`${id}-help`} dir="auto">
          {connection.help}
        </p>
      )}
    </div>
  );
}
