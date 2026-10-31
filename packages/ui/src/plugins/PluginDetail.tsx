import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { HarnessClient, PluginDetail as Detail, PluginResult, PluginRow, PluginTestResult, PluginWorkHours, SettingFieldView } from "../client";
import { groups, HarnessFieldRow } from "../HarnessSettingsTab";
import { shownLanguage } from "../language";
import { PermissionList, Plain } from "./PermissionReview";

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const message = (r: PluginResult, failed: string) => (r.ok ? null : "message" in r && r.message ? r.message : failed);

/** "28 Oct, 10:42" in the shown language; the raw text when it doesn't parse. */
export function when(iso: string, language: string): string {
  const at = Date.parse(iso);
  return Number.isNaN(at) ? iso : new Date(at).toLocaleString(language, { dateStyle: "medium", timeStyle: "short" });
}

/**
 * One plugin's detail (plugins spec §7): what it may do, its settings, work hours, keys, a connection test, its last
 * errors, notifications and (local only) Remove. Everything a plugin wrote is plain, isolated text (B12); a key's value
 * goes only to `setSecret` and is never kept or shown (B6).
 */
export function PluginDetail({ client, row, onBack, onRemoved }: { client: HarnessClient; row: PluginRow; onBack: () => void; onRemoved: () => void }) {
  const { t, i18n } = useTranslation();
  const language = shownLanguage(i18n);
  const id = useId();
  const head = useRef<HTMLHeadingElement>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  /** The read was refused or answered nothing: say so instead of staying busy. */
  const [loadFailed, setLoadFailed] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [tests, setTests] = useState<PluginTestResult[] | null>(null);
  const [testing, setTesting] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const failed = t("plugins.failed");

  const loaded = (d: Detail | null) => {
    if (d) setDetail(d);
    setLoadFailed(d === null);
  };
  const load = () =>
    client.plugins.detail(row.id).then(loaded, () => setLoadFailed(true));
  // Read again whenever main's row for it changes (turned on/off, a sync, an error).
  const rowKey = JSON.stringify(row);
  useEffect(() => {
    let live = true;
    client.plugins.detail(row.id).then(
      (d) => {
        if (live) loaded(d);
      },
      () => {
        if (live) setLoadFailed(true);
      },
    );
    return () => {
      live = false;
    };
  }, [client, rowKey]);
  useEffect(() => head.current?.focus(), [row.id]);

  /** A change: on success the detail is read again; a refusal shows under `key`. */
  const change = (key: string, call: () => Promise<PluginResult>) =>
    call().then(
      (r) => {
        const m = message(r, failed);
        setErrors(({ [key]: _gone, ...rest }) => (m === null ? rest : { ...rest, [key]: m }));
        if (m === null) void load();
        return m === null;
      },
      () => {
        setErrors((e) => ({ ...e, [key]: failed }));
        return false;
      },
    );

  const test = () => {
    if (testing) return;
    setTesting(true);
    client.plugins.test(row.id).then(
      (r) => {
        setTests(r);
        setTesting(false);
      },
      () => {
        setTests(null);
        setErrors((e) => ({ ...e, test: failed }));
        setTesting(false);
      },
    );
  };
  const remove = () =>
    client.plugins.remove(row.id).then(
      (r) => {
        if (r.ok) onRemoved();
        else setRemoveError(message(r, failed));
      },
      () => setRemoveError(failed),
    );

  const err = (key: string) => (Object.hasOwn(errors, key) ? errors[key] : undefined);
  const settings = detail?.settings;
  const valueOf = (f: SettingFieldView) => (detail && Object.hasOwn(detail.values, f.name) ? detail.values[f.name] : f.default);

  return (
    <section className="hh-tab hh-card hh-pl-detail" aria-labelledby={`${id}-name`} aria-busy={detail === null && !loadFailed}>
      <div>
        <button type="button" className="hh-link" onClick={onBack}>
          ← {t("plugins.detail.back")}
        </button>
      </div>
      <h3 id={`${id}-name`} ref={head} tabIndex={-1}>
        <Plain>{row.name}</Plain>
      </h3>
      <p className="hh-caption hh-pl-meta">
        {row.version && t("plugins.version", { version: row.version })}
        {row.folder && (
          <>
            {" · "}
            <Plain>{row.folder}</Plain>
          </>
        )}
      </p>
      {detail === null && loadFailed && (
        <p className="hh-field-error" role="alert">
          {failed}
        </p>
      )}
      {detail && (
        <>
          <h4 id={`${id}-perms`}>{t("plugins.detail.permissions")}</h4>
          <PermissionList lines={detail.review.lines} labelledBy={`${id}-perms`} />

          {settings && settings.fields.length > 0 && (
            <>
              <h4>{t("plugins.detail.settings")}</h4>
              {groups(settings, settings.fields).map((g) => (
                <section key={g.id ?? ""} className="hh-settings-group">
                  {g.label && (
                    <h4 dir="auto">
                      {g.label}
                    </h4>
                  )}
                  <div className="hh-rows">
                    {g.fields.map((f) => (
                      <HarnessFieldRow
                        key={f.name}
                        field={f}
                        value={valueOf(f)}
                        error={err(`setting:${f.name}`)}
                        pending={false}
                        onSave={(v) => {
                          if (!same(valueOf(f), v)) void change(`setting:${f.name}`, () => client.plugins.setSetting(row.id, f.name, v));
                        }}
                        onDrop={() => setErrors(({ [`setting:${f.name}`]: _gone, ...rest }) => rest)}
                      />
                    ))}
                  </div>
                </section>
              ))}
              {settings.fields.some((f) => !same(valueOf(f), f.default)) && (
                <div>
                  <button type="button" onClick={() => void change("reset", () => client.plugins.resetSettings(row.id))}>
                    {t("plugins.detail.reset")}
                  </button>
                  {err("reset") && (
                    <p className="hh-field-error" role="alert">
                      {err("reset")}
                    </p>
                  )}
                </div>
              )}
            </>
          )}

          {detail.workHours && (
            <WorkHours
              value={detail.workHours}
              language={language}
              error={err("workHours")}
              onSave={(wh) => void change("workHours", () => client.plugins.setWorkHours(row.id, wh))}
            />
          )}

          {detail.secrets.length > 0 && (
            <div role="group" aria-labelledby={`${id}-keys`} className="hh-pl-keys">
              <h4 id={`${id}-keys`}>{t("plugins.keys.title")}</h4>
              <p className="hh-caption">{t("plugins.keys.note")}</p>
              <div className="hh-rows">
                {detail.secrets.map((s) => (
                  <KeyRow
                    key={s.id}
                    secret={s}
                    plugin={row.name}
                    error={err(`key:${s.id}`)}
                    onSave={(value) => change(`key:${s.id}`, () => client.plugins.setSecret(row.id, s.id, value))}
                    onDelete={() => void change(`key:${s.id}`, () => client.plugins.deleteSecret(row.id, s.id))}
                  />
                ))}
              </div>
            </div>
          )}

          <div className="hh-pl-test">
            <div>
              <button type="button" aria-disabled={testing} onClick={test}>
                {testing ? t("plugins.test.running") : t("plugins.test.button")}
              </button>
            </div>
            <div aria-live="polite">
              {err("test") && (
                <p className="hh-field-error" role="alert">
                  {err("test")}
                </p>
              )}
              {tests && tests.length === 0 && <p className="hh-caption">{t("plugins.test.none")}</p>}
              {tests && tests.length > 0 && (
                <ul className="hh-pl-plain">
                  {tests.map((r, i) => (
                    <li key={i}>
                      <Plain>{r.source}</Plain>
                      {": "}
                      {r.ok ? (
                        r.writes !== undefined ? (
                          t("plugins.test.records", { count: r.writes })
                        ) : (
                          t("plugins.test.ok")
                        )
                      ) : (
                        <Plain>{r.error ?? failed}</Plain>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <h4 id={`${id}-errors`}>{t("plugins.errors.title")}</h4>
          {detail.errors.length === 0 ? (
            <p className="hh-caption">{t("plugins.errors.empty")}</p>
          ) : (
            <ul className="hh-pl-plain hh-pl-errors" aria-labelledby={`${id}-errors`}>
              {[...detail.errors]
                .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
                .slice(0, 50)
                .map((e, i) => (
                  <li key={i}>
                    <span className="hh-caption">
                      {when(e.at, language)}
                      {e.source && (
                        <>
                          {" · "}
                          <Plain>{e.source}</Plain>
                        </>
                      )}
                    </span>
                    <span className="hh-pl-error-text" dir="auto">
                      {e.message}
                    </span>
                  </li>
                ))}
            </ul>
          )}

          <div className="hh-rows">
            <div className="hh-row hh-row-wrap">
              <label className="hh-row-label" htmlFor={`${id}-notify`}>
                {t("plugins.notify")}
              </label>
              <input
                id={`${id}-notify`}
                type="checkbox"
                role="switch"
                checked={detail.notify}
                aria-describedby={`${id}-notify-help`}
                onChange={(e) => void change("notify", () => client.plugins.setNotify(row.id, e.target.checked))}
              />
              <p className="hh-caption hh-row-note" id={`${id}-notify-help`}>
                {t("plugins.notifyHelp")}
              </p>
              {err("notify") && (
                <p className="hh-field-error hh-row-note" role="alert">
                  {err("notify")}
                </p>
              )}
            </div>
          </div>

          {row.origin === "local" && (
            <div className="hh-pl-remove">
              {confirm ? (
                <div role="group" aria-labelledby={`${id}-rm-title`} aria-describedby={`${id}-rm-text`}>
                  <p id={`${id}-rm-title`}>
                    <strong>{t("plugins.remove.title")}</strong>
                  </p>
                  <p id={`${id}-rm-text`}>{t("plugins.remove.text")}</p>
                  {removeError && (
                    <p className="hh-field-error" role="alert">
                      {removeError}
                    </p>
                  )}
                  <div className="hh-pl-actions">
                    <ConfirmYes label={t("plugins.remove.yes")} onClick={() => void remove()} />
                    <button
                      type="button"
                      onClick={() => {
                        setConfirm(false);
                        setRemoveError(null);
                      }}
                    >
                      {t("plugins.remove.no")}
                    </button>
                  </div>
                </div>
              ) : (
                <button type="button" className="hh-danger" onClick={() => setConfirm(true)}>
                  {t("plugins.remove.button")}
                </button>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}

/** The confirmation's Remove takes focus when it shows. */
function ConfirmYes({ label, onClick }: { label: string; onClick: () => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => ref.current?.focus(), []);
  return (
    <button ref={ref} type="button" onClick={onClick}>
      {label}
    </button>
  );
}

/**
 * One key: whether it is stored, never its value. The typed value lives only in this input until Save, which clears it
 * before the answer comes (B6).
 */
function KeyRow({
  secret,
  plugin,
  error,
  onSave,
  onDelete,
}: {
  secret: Detail["secrets"][number];
  /** The plugin's name: a missing key says what it's for. */
  plugin: string;
  error: string | undefined;
  onSave: (value: string) => Promise<boolean>;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const [replacing, setReplacing] = useState(false);
  const [value, setValue] = useState("");
  const editing = !secret.stored || replacing;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const v = value;
    setValue("");
    if (v.trim() === "") return;
    void onSave(v).then((ok) => {
      if (ok) setReplacing(false);
    });
  };
  const describedBy = [secret.help ? `${id}-help` : null, error ? `${id}-error` : null].filter(Boolean).join(" ") || undefined;
  return (
    <div className="hh-row hh-row-wrap">
      <span className="hh-row-label" id={`${id}-label`} dir="auto">
        {secret.label}
      </span>
      <span className="hh-caption">{secret.stored ? t("plugins.keys.stored") : t("plugins.keys.notStored", { plugin })}</span>
      {editing ? (
        <form className="hh-pl-key-form" onSubmit={submit}>
          <input
            type="password"
            value={value}
            autoComplete="off"
            spellCheck={false}
            placeholder={t("plugins.keys.input")}
            aria-labelledby={`${id}-label`}
            aria-describedby={describedBy}
            onChange={(e) => setValue(e.target.value)}
          />
          <button type="submit">{t("plugins.keys.save")}</button>
          {replacing && (
            <button
              type="button"
              onClick={() => {
                setValue("");
                setReplacing(false);
              }}
            >
              {t("plugins.keys.cancel")}
            </button>
          )}
        </form>
      ) : (
        <span className="hh-pl-actions">
          <button type="button" onClick={() => setReplacing(true)}>
            {t("plugins.keys.replace")}
          </button>
          <button type="button" onClick={onDelete}>
            {t("plugins.keys.delete")}
          </button>
        </span>
      )}
      {secret.help && (
        <p className="hh-caption hh-row-note" id={`${id}-help`} dir="auto">
          {secret.help}
        </p>
      )}
      {error && (
        <p className="hh-field-error hh-row-note" id={`${id}-error`} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** The time zones this computer knows, with `current` always among them. */
function timeZones(current: string): string[] {
  let all: string[] = [];
  try {
    all = (Intl as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.("timeZone") ?? [];
  } catch {
    all = [];
  }
  return all.includes(current) ? all : [current, ...all];
}

/** Work hours (plugins Decision 4): seven day toggles (Sunday first), from/to and a time zone; each change saves. */
function WorkHours({ value, language, error, onSave }: { value: PluginWorkHours; language: string; error: string | undefined; onSave: (wh: PluginWorkHours) => void }) {
  const { t } = useTranslation();
  const id = useId();
  const [from, setFrom] = useState(value.from);
  const [to, setTo] = useState(value.to);
  useEffect(() => setFrom(value.from), [value.from]);
  useEffect(() => setTo(value.to), [value.to]);
  // 2023-01-01 was a Sunday: day i's name is that date plus i days.
  const dayName = (i: number, style: "short" | "long") => new Date(Date.UTC(2023, 0, 1 + i)).toLocaleDateString(language, { weekday: style, timeZone: "UTC" });
  const toggle = (d: number) => {
    const days = value.days.includes(d) ? value.days.filter((x) => x !== d) : [...value.days, d].sort((a, b) => a - b);
    onSave({ ...value, days });
  };
  const time = (key: "from" | "to", v: string, set: (v: string) => void) => {
    set(v);
    if (TIME.test(v) && v !== value[key]) onSave({ ...value, [key]: v });
  };
  return (
    <div role="group" aria-labelledby={`${id}-title`} aria-describedby={`${id}-help`} className="hh-pl-hours">
      <h4 id={`${id}-title`}>{t("plugins.workHours.title")}</h4>
      <p className="hh-caption" id={`${id}-help`}>
        {t("plugins.workHours.help")}
      </p>
      <div className="hh-rows">
        <div className="hh-row hh-row-wrap">
          <span className="hh-row-label" id={`${id}-days`}>
            {t("plugins.workHours.days")}
          </span>
          <span className="hh-pl-days" role="group" aria-labelledby={`${id}-days`}>
            {[0, 1, 2, 3, 4, 5, 6].map((d) => (
              <button key={d} type="button" aria-pressed={value.days.includes(d)} aria-label={dayName(d, "long")} onClick={() => toggle(d)}>
                {dayName(d, "short")}
              </button>
            ))}
          </span>
        </div>
        <div className="hh-row">
          <label className="hh-row-label" htmlFor={`${id}-from`}>
            {t("plugins.workHours.from")}
          </label>
          <input id={`${id}-from`} type="time" value={from} onChange={(e) => time("from", e.target.value, setFrom)} />
        </div>
        <div className="hh-row">
          <label className="hh-row-label" htmlFor={`${id}-to`}>
            {t("plugins.workHours.to")}
          </label>
          <input id={`${id}-to`} type="time" value={to} onChange={(e) => time("to", e.target.value, setTo)} />
        </div>
        <div className="hh-row">
          <label className="hh-row-label" htmlFor={`${id}-tz`}>
            {t("plugins.workHours.timezone")}
          </label>
          <select id={`${id}-tz`} value={value.timezone} onChange={(e) => onSave({ ...value, timezone: e.target.value })}>
            {timeZones(value.timezone).map((z) => (
              <option key={z} value={z}>
                {z}
              </option>
            ))}
          </select>
        </div>
      </div>
      {error && (
        <p className="hh-field-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
