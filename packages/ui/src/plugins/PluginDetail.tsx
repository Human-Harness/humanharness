import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type {
  ConnectionResult,
  HarnessClient,
  PluginDetail as Detail,
  PluginResult,
  PluginRow,
  PluginTestResult,
  PluginWorkHours,
  SettingFieldView,
} from "../client";
import { SecretField } from "../connections/SecretField";
import { Group, Row, Rx } from "../guide";
import { groups, HarnessFieldRow } from "../HarnessSettingsTab";
import { shownLanguage } from "../language";
import { PermissionList, Plain } from "./PermissionReview";

const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);
const message = (r: PluginResult, failed: string) =>
  r.ok ? null : "message" in r && r.message ? r.message : failed;

/** "28 Oct, 10:42" in the shown language; the raw text when it doesn't parse. */
export function when(iso: string, language: string): string {
  const at = Date.parse(iso);
  return Number.isNaN(at)
    ? iso
    : new Date(at).toLocaleString(language, {
        dateStyle: "medium",
        timeStyle: "short",
      });
}

/** A save error: a red notice above the card it is about (DESIGN.md "Settings": "A save error is a red notice above the card"). */
function Refused({ text }: { text: string | undefined }) {
  if (!text) return null;
  return (
    <Rx.Callout.Root color="red" role="alert" mb="3">
      <Rx.Callout.Text>{text}</Rx.Callout.Text>
    </Rx.Callout.Root>
  );
}

/**
 * One plugin's detail (plugins spec §7): what it may do, its settings, work hours, keys, a connection test, its last
 * errors, notifications and (local only) Remove. Everything a plugin wrote is plain, isolated text (B12); a key's value
 * goes only to `setSecret` and is never kept or shown (B6).
 *
 * Radix stage 2e (DESIGN.md "Settings": plugins as list and detail): it takes the list's place, and the top bar's
 * Volver turns into "← Plugins" (the caller's). The name and a version line, then the permissions as a loose list, the
 * settings and work hours as cards, the keys as Connections' secret rows, Test connection, the last errors as a loose
 * list, Notify me, and Remove as a danger row that asks inline.
 */
export function PluginDetail({
  client,
  row,
  onRemoved,
}: {
  client: HarnessClient;
  row: PluginRow;
  onRemoved: () => void;
}) {
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
  const removeRef = useRef<HTMLButtonElement>(null);
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
        setErrors(({ [key]: _gone, ...rest }) =>
          m === null ? rest : { ...rest, [key]: m },
        );
        if (m === null) void load();
        return m === null;
      },
      () => {
        setErrors((e) => ({ ...e, [key]: failed }));
        return false;
      },
    );
  /** The same change, answered the way Connections' secret row reads it. */
  const keyChange = (
    key: string,
    call: () => Promise<PluginResult>,
  ): Promise<ConnectionResult> =>
    change(key, call).then((ok) =>
      ok ? { ok: true } : { ok: false, message: failed },
    );

  const test = () => {
    if (testing) return;
    setTesting(true);
    client.plugins.test(row.id).then(
      (r) => {
        setTests(r);
        setErrors(({ test: _gone, ...rest }) => rest);
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
  // Cancel puts focus back on Remove…, which only comes back once the question is gone.
  const focusRemove = useRef(false);
  useEffect(() => {
    if (confirm || !focusRemove.current) return;
    focusRemove.current = false;
    removeRef.current?.focus();
  }, [confirm]);
  const cancelRemove = () => {
    focusRemove.current = true;
    setConfirm(false);
    setRemoveError(null);
  };

  const err = (key: string) =>
    Object.hasOwn(errors, key) ? errors[key] : undefined;
  const settings = detail?.settings;
  const valueOf = (f: SettingFieldView) =>
    detail && Object.hasOwn(detail.values, f.name)
      ? detail.values[f.name]
      : f.default;
  const keyError = detail?.secrets
    .map((s) => err(`key:${s.id}`))
    .find((e) => e !== undefined);

  return (
    <section
      aria-labelledby={`${id}-name`}
      aria-busy={detail === null && !loadFailed}
    >
      <Rx.Flex justify="between" align="start" gap="4" mb="5">
        <Rx.Box minWidth="0">
          <Rx.Heading
            as="h2"
            size="5"
            id={`${id}-name`}
            ref={head}
            tabIndex={-1}
            mb="1"
          >
            <Plain>{row.name}</Plain>
          </Rx.Heading>
          <Rx.Text as="p" size="1" color="gray">
            {row.version && t("plugins.version", { version: row.version })}
            {row.folder && (
              <>
                {row.version && " · "}
                <span className="hh-gd-path">{row.folder}</span>
              </>
            )}
          </Rx.Text>
          {detail && (
            <Rx.Box mt="2">
              <div aria-live="polite">
                {err("test") && (
                  <Rx.Text as="p" size="1" color="red" role="alert">
                    {err("test")}
                  </Rx.Text>
                )}
                {tests && tests.length === 0 && (
                  <Rx.Text as="p" size="1" color="gray">
                    {t("plugins.test.none")}
                  </Rx.Text>
                )}
                {tests && tests.length > 0 && (
                  // A flex list: its items lose their bullets; one status line per source, green or red.
                  <Rx.Flex asChild direction="column" gap="1" m="0" p="0">
                    <ul aria-label={t("plugins.test.button")}>
                      {tests.map((r, i) => (
                        <li key={i}>
                          <Rx.Text size="1" color={r.ok ? "green" : "red"}>
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
                          </Rx.Text>
                        </li>
                      ))}
                    </ul>
                  </Rx.Flex>
                )}
              </div>
            </Rx.Box>
          )}
        </Rx.Box>
        {detail && (
          <Rx.Button
            variant="outline"
            color="gray"
            size="1"
            aria-disabled={testing}
            onClick={test}
          >
            {testing ? t("plugins.test.running") : t("plugins.test.button")}
          </Rx.Button>
        )}
      </Rx.Flex>
      {detail === null && loadFailed && <Refused text={failed} />}
      {detail && (
        <>
          <PermissionList
            lines={detail.review.lines}
            title={t("plugins.detail.permissions")}
          />

          {settings && settings.fields.length > 0 && (
            <>
              {groups(settings, settings.fields).map((g) => (
                // The fields with no section of their own go under "Settings"; a section keeps the plugin's name for it.
                <Group
                  key={g.id ?? ""}
                  title={
                    g.label !== undefined ? (
                      <bdi dir="auto">{g.label}</bdi>
                    ) : (
                      t("plugins.detail.settings")
                    )
                  }
                >
                  {g.fields.map((f) => (
                    <HarnessFieldRow
                      key={f.name}
                      field={f}
                      value={valueOf(f)}
                      error={err(`setting:${f.name}`)}
                      pending={false}
                      onSave={(v) => {
                        if (!same(valueOf(f), v))
                          void change(`setting:${f.name}`, () =>
                            client.plugins.setSetting(row.id, f.name, v),
                          );
                      }}
                      onDrop={() =>
                        setErrors(
                          ({ [`setting:${f.name}`]: _gone, ...rest }) => rest,
                        )
                      }
                    />
                  ))}
                </Group>
              ))}
              {settings.fields.some((f) => !same(valueOf(f), f.default)) && (
                <Rx.Flex direction="column" align="start" gap="3" mb="5">
                  <Refused text={err("reset")} />
                  <Rx.Button
                    variant="ghost"
                    color="gray"
                    size="1"
                    onClick={() =>
                      void change("reset", () =>
                        client.plugins.resetSettings(row.id),
                      )
                    }
                  >
                    {t("plugins.detail.reset")}
                  </Rx.Button>
                </Rx.Flex>
              )}
            </>
          )}

          {detail.workHours && (
            <>
              <Refused text={err("workHours")} />
              <WorkHours
                value={detail.workHours}
                language={language}
                onSave={(wh) =>
                  void change("workHours", () =>
                    client.plugins.setWorkHours(row.id, wh),
                  )
                }
              />
            </>
          )}

          {detail.secrets.length > 0 && (
            <>
              <Refused text={keyError} />
              <Group title={t("plugins.keys.title")}>
                <Rx.Text as="p" size="1" color="gray" mb="3">
                  {t("plugins.keys.note")}
                </Rx.Text>
                {detail.secrets.map((s) => (
                  <SecretField
                    key={s.id}
                    connection={{
                      id: s.id,
                      label: s.label,
                      ...(s.help ? { help: s.help } : {}),
                      set: s.stored,
                    }}
                    onSave={(value) =>
                      keyChange(`key:${s.id}`, () =>
                        client.plugins.setSecret(row.id, s.id, value),
                      )
                    }
                    onDelete={() =>
                      keyChange(`key:${s.id}`, () =>
                        client.plugins.deleteSecret(row.id, s.id),
                      )
                    }
                  />
                ))}
              </Group>
            </>
          )}

          <Group loose title={t("plugins.errors.title")}>
            {detail.errors.length === 0 ? (
              <Row
                as="li"
                label={
                  <Rx.Text color="gray">{t("plugins.errors.empty")}</Rx.Text>
                }
              />
            ) : (
              [...detail.errors]
                .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
                .slice(0, 50)
                .map((e, i) => (
                  <Row
                    key={i}
                    as="li"
                    label={<bdi dir="auto">{e.message}</bdi>}
                    hint={
                      <>
                        {when(e.at, language)}
                        {e.source && (
                          <>
                            {" · "}
                            <Plain>{e.source}</Plain>
                          </>
                        )}
                      </>
                    }
                  />
                ))
            )}
          </Group>

          <Refused text={err("notify")} />
          <Group>
            <Row
              label={t("plugins.notify")}
              htmlFor={`${id}-notify`}
              hint={t("plugins.notifyHelp")}
              hintId={`${id}-notify-help`}
            >
              <Rx.Switch
                id={`${id}-notify`}
                checked={detail.notify}
                aria-describedby={`${id}-notify-help`}
                onCheckedChange={(on) =>
                  void change("notify", () =>
                    client.plugins.setNotify(row.id, on),
                  )
                }
              />
            </Row>
            {row.origin === "local" && (
              <Row
                label={t("plugins.remove.text")}
                below={
                  confirm && (
                    <Rx.Flex direction="column" gap="2">
                      <Rx.Flex
                        align="center"
                        justify="between"
                        gap="3"
                        wrap="wrap"
                        role="group"
                        aria-labelledby={`${id}-rm-title`}
                      >
                        <Rx.Text
                          as="p"
                          size="2"
                          weight="bold"
                          id={`${id}-rm-title`}
                        >
                          {t("plugins.remove.title")}
                        </Rx.Text>
                        <Rx.Flex gap="2">
                          <ConfirmYes
                            label={t("plugins.remove.yes")}
                            onClick={() => void remove()}
                          />
                          <Rx.Button
                            variant="outline"
                            color="gray"
                            size="1"
                            onClick={cancelRemove}
                          >
                            {t("plugins.remove.no")}
                          </Rx.Button>
                        </Rx.Flex>
                      </Rx.Flex>
                      {removeError && (
                        <Rx.Text as="p" size="1" color="red" role="alert">
                          {removeError}
                        </Rx.Text>
                      )}
                    </Rx.Flex>
                  )
                }
              >
                {!confirm && (
                  <Rx.Button
                    ref={removeRef}
                    variant="soft"
                    color="red"
                    size="1"
                    onClick={() => setConfirm(true)}
                  >
                    {t("plugins.remove.button")}
                  </Rx.Button>
                )}
              </Row>
            )}
          </Group>
        </>
      )}
    </section>
  );
}

/** The confirmation's Remove takes focus when it shows. */
function ConfirmYes({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => ref.current?.focus(), []);
  return (
    <Rx.Button ref={ref} variant="soft" color="red" size="1" onClick={onClick}>
      {label}
    </Rx.Button>
  );
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** The time zones this computer knows, with `current` always among them. */
function timeZones(current: string): string[] {
  let all: string[] = [];
  try {
    all =
      (
        Intl as { supportedValuesOf?: (k: string) => string[] }
      ).supportedValuesOf?.("timeZone") ?? [];
  } catch {
    all = [];
  }
  return all.includes(current) ? all : [current, ...all];
}

/**
 * Work hours (plugins Decision 4): seven day toggles (Sunday first), from/to and a time zone; each change saves. A card
 * of rows; the days are seven toggle buttons (Marco, 2026-11-04: a SegmentedControl picks one, the days are several),
 * soft when chosen and outline gray when not, each named by the whole day.
 */
function WorkHours({
  value,
  language,
  onSave,
}: {
  value: PluginWorkHours;
  language: string;
  onSave: (wh: PluginWorkHours) => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const [from, setFrom] = useState(value.from);
  const [to, setTo] = useState(value.to);
  useEffect(() => setFrom(value.from), [value.from]);
  useEffect(() => setTo(value.to), [value.to]);
  // 2023-01-01 was a Sunday: day i's name is that date plus i days.
  const dayName = (i: number, style: "short" | "long") =>
    new Date(Date.UTC(2023, 0, 1 + i)).toLocaleDateString(language, {
      weekday: style,
      timeZone: "UTC",
    });
  const toggle = (d: number) => {
    const days = value.days.includes(d)
      ? value.days.filter((x) => x !== d)
      : [...value.days, d].sort((a, b) => a - b);
    onSave({ ...value, days });
  };
  const time = (key: "from" | "to", v: string, set: (v: string) => void) => {
    set(v);
    if (TIME.test(v) && v !== value[key]) onSave({ ...value, [key]: v });
  };
  return (
    <Group title={t("plugins.workHours.title")}>
      <Row
        label={t("plugins.workHours.days")}
        hint={t("plugins.workHours.help")}
        hintId={`${id}-help`}
      >
        <Rx.Flex
          gap="1"
          wrap="wrap"
          role="group"
          aria-label={t("plugins.workHours.days")}
          aria-describedby={`${id}-help`}
        >
          {[0, 1, 2, 3, 4, 5, 6].map((d) => {
            const on = value.days.includes(d);
            return (
              <Rx.Button
                key={d}
                size="1"
                variant={on ? "soft" : "outline"}
                color={on ? undefined : "gray"}
                aria-pressed={on}
                aria-label={dayName(d, "long")}
                onClick={() => toggle(d)}
              >
                {dayName(d, "short")}
              </Rx.Button>
            );
          })}
        </Rx.Flex>
      </Row>
      <Row label={t("plugins.workHours.from")} htmlFor={`${id}-from`}>
        <Rx.TextField.Root
          id={`${id}-from`}
          type="time"
          value={from}
          onChange={(e) => time("from", e.target.value, setFrom)}
        />
      </Row>
      <Row label={t("plugins.workHours.to")} htmlFor={`${id}-to`}>
        <Rx.TextField.Root
          id={`${id}-to`}
          type="time"
          value={to}
          onChange={(e) => time("to", e.target.value, setTo)}
        />
      </Row>
      <Row label={t("plugins.workHours.timezone")} htmlFor={`${id}-tz`}>
        <Rx.Select.Root
          value={value.timezone}
          onValueChange={(z) => onSave({ ...value, timezone: z })}
        >
          <Rx.Select.Trigger
            id={`${id}-tz`}
            aria-label={t("plugins.workHours.timezone")}
          />
          <Rx.Select.Content position="popper">
            {timeZones(value.timezone).map((z) => (
              <Rx.Select.Item key={z} value={z}>
                {z}
              </Rx.Select.Item>
            ))}
          </Rx.Select.Content>
        </Rx.Select.Root>
      </Row>
    </Group>
  );
}
