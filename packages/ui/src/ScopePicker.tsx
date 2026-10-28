import { type FormEvent, type KeyboardEvent, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { AppState, HarnessClient, ScopeView } from "./client";
import { ScopeSettings } from "./hatches/ScopeSettings";

/**
 * The top bar's scope picker (spec §3.4): the active scopes, "none", and a new one. The minimum a harness with
 * scopes needs to work; a harness can build its own (a topics home, a map) on `client.scopes`.
 */
export function ScopePicker({
  client,
  state,
  open,
  disabled = false,
}: {
  client: HarnessClient;
  /** The harness state: its `scopes.label` is what the harness calls a scope. */
  state: AppState;
  open: string | null;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const [list, setList] = useState<ScopeView[]>([]);
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [failed, setFailed] = useState(false);
  /** Hatches only: the open scope's settings dialog is showing. */
  const [settings, setSettings] = useState(false);
  const addButton = useRef<HTMLButtonElement>(null);
  const settingsButton = useRef<HTMLButtonElement>(null);
  /** Focus goes back to the Add button once the form is gone. */
  const refocus = useRef(false);
  useEffect(() => {
    if (!adding && refocus.current) {
      refocus.current = false;
      addButton.current?.focus();
    }
  }, [adding]);
  useEffect(() => {
    let live = true;
    // A change that has arrived is newer than the first reply, which may have been in flight before it.
    let seen = false;
    client.scopes.list().then(
      (l) => {
        if (live && !seen) setList(l);
      },
      () => undefined,
    );
    const off = client.scopes.onChange((v) => {
      seen = true;
      setList(v.list);
    });
    return () => {
      live = false;
      off();
    };
  }, [client]);
  const name = state.scopes?.label ?? "";
  // An archived scope still shows while it is the open one, so the select never lies.
  const shown = list.filter((s) => !s.archived || s.id === open);
  // Hatches only (D0: no button without them): the open scope's settings.
  const openTitle = open === null ? null : (list.find((s) => s.id === open)?.title ?? open);
  const withSettings = state.hatches !== undefined && open !== null && openTitle !== null;
  const closeSettings = () => {
    setSettings(false);
    settingsButton.current?.focus();
  };
  const pick = (id: string | null) => {
    setFailed(false);
    client.scopes.open(id).catch(() => setFailed(true));
  };
  const close = () => {
    refocus.current = true;
    setAdding(false);
    setTitle("");
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      close();
    }
  };
  const create = async (e: FormEvent) => {
    e.preventDefault();
    const clean = title.trim();
    if (!clean) return;
    setFailed(false);
    try {
      const made = await client.scopes.create(clean);
      refocus.current = true;
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
      {withSettings && (
        <button ref={settingsButton} type="button" aria-label={t("hatches.scopeSettings", { scope: openTitle })} onClick={() => setSettings(true)}>
          {t("settings.title")}
        </button>
      )}
      {withSettings && settings && <ScopeSettings client={client} state={state} scope={open} title={openTitle} onClose={closeSettings} />}
      {adding ? (
        <form onSubmit={(e) => void create(e)} onKeyDown={onKey}>
          <input aria-label={t("scopes.titleLabel")} value={title} maxLength={120} autoFocus onChange={(e) => setTitle(e.target.value)} />
          <button type="submit" disabled={disabled || !title.trim()}>
            {t("scopes.create")}
          </button>
          <button type="button" onClick={close}>
            {t("scopes.cancel")}
          </button>
        </form>
      ) : (
        <button ref={addButton} disabled={disabled} onClick={() => setAdding(true)}>
          {t("scopes.add", { label: name })}
        </button>
      )}
      {failed && <p role="alert">{t("scopes.failed")}</p>}
    </div>
  );
}
