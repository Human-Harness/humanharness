import { type FormEvent, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { HarnessClient, ScopeView } from "./client";

/**
 * The top bar's scope picker (spec §3.4): the active scopes, "none", and a new one. The minimum a harness with
 * scopes needs to work; a harness can build its own (a topics home, a map) on `client.scopes`.
 */
export function ScopePicker({
  client,
  label,
  open,
  disabled = false,
}: {
  client: HarnessClient;
  /** What the harness calls a scope (manifest `scopes.label`). */
  label: { es: string; en: string };
  open: string | null;
  disabled?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const [list, setList] = useState<ScopeView[]>([]);
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    client.scopes.list().then(
      (l) => {
        if (live) setList(l);
      },
      () => undefined,
    );
    const off = client.scopes.onChange((v) => setList(v.list));
    return () => {
      live = false;
      off();
    };
  }, [client]);
  const name = i18n.language.startsWith("es") ? label.es : label.en;
  // An archived scope still shows while it is the open one, so the select never lies.
  const shown = list.filter((s) => !s.archived || s.id === open);
  const pick = (id: string | null) => {
    setFailed(false);
    client.scopes.open(id).catch(() => setFailed(true));
  };
  const create = async (e: FormEvent) => {
    e.preventDefault();
    const clean = title.trim();
    if (!clean) return;
    setFailed(false);
    try {
      const made = await client.scopes.create(clean);
      setTitle("");
      setAdding(false);
      await client.scopes.open(made.id);
    } catch {
      setFailed(true);
    }
  };
  return (
    <div className="hh-scope-picker">
      <select aria-label={t("scopes.pick", { label: name })} value={open ?? ""} disabled={disabled} onChange={(e) => pick(e.target.value || null)}>
        <option value="">{t("scopes.none", { label: name })}</option>
        {shown.map((s) => (
          <option key={s.id} value={s.id}>
            {s.title}
          </option>
        ))}
      </select>
      {adding ? (
        <form onSubmit={(e) => void create(e)}>
          <input aria-label={t("scopes.titleLabel")} value={title} maxLength={120} autoFocus onChange={(e) => setTitle(e.target.value)} />
          <button type="submit" disabled={disabled || !title.trim()}>
            {t("scopes.create")}
          </button>
          <button
            type="button"
            onClick={() => {
              setAdding(false);
              setTitle("");
            }}
          >
            {t("scopes.cancel")}
          </button>
        </form>
      ) : (
        <button disabled={disabled} onClick={() => setAdding(true)}>
          {t("scopes.add", { label: name })}
        </button>
      )}
      {failed && <p role="alert">{t("scopes.failed")}</p>}
    </div>
  );
}
