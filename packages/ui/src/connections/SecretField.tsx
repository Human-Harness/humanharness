import { type FormEvent, useId, useState } from "react";
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
      <span className="hh-caption">{connection.set ? t("connections.set") : t("connections.notSet")}</span>
      <form className="hh-pl-key-form" onSubmit={submit}>
        <input
          type="password"
          value={value}
          autoComplete="off"
          spellCheck={false}
          placeholder={t("connections.paste")}
          aria-labelledby={`${id}-label`}
          aria-describedby={connection.help ? `${id}-help` : undefined}
          onChange={(e) => setValue(e.target.value)}
        />
        <button type="submit">{connection.set ? t("connections.replace") : t("connections.save")}</button>
        {connection.set && (
          <button type="button" onClick={() => void onDelete()}>
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
