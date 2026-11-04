import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ConnectionResult, ConnectionView } from "../client";
import { Icon, Row, Rx } from "../guide";

/**
 * One declared key (tools spec §9): its label, help and whether it is set, never its value. The typed value lives only
 * in this password field until Save, which clears it before the answer comes (S1). With `onTest` (a connect step names
 * a test for this key), Test connection runs it and the outcome shows under the row: this click's answer, else the
 * last test main kept.
 *
 * Radix stage 2d (DESIGN.md "Secret"): a settings row with the key's letter, its name and its state as a badge; under
 * it the hidden field and one button (Save when empty, Replace when set), plus More (⋯) with Test connection and
 * Delete. Delete asks inline under the row first. The frame (a Settings card, the assistant's step) is the caller's.
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
  const more = useRef<HTMLButtonElement>(null);
  const [testing, setTesting] = useState(false);
  const [tested, setTested] = useState<ConnectionResult | null>(null);
  const [asking, setAsking] = useState(false);
  // A new kept test, or the key stored or deleted: main's record is the outcome again.
  const lastAt = connection.lastTest?.at;
  useEffect(() => setTested(null), [lastAt, connection.set]);
  // A key that is gone has nothing left to delete.
  useEffect(() => {
    if (!connection.set) setAsking(false);
  }, [connection.set]);
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
  const remove = () => {
    setAsking(false);
    // Delete goes away once the key is gone: focus moves to the field, not to the page.
    void onDelete().then((r) => {
      if (r.ok) input.current?.focus();
    });
  };
  const cancel = () => {
    setAsking(false);
    more.current?.focus();
  };
  const hasMenu = connection.set || Boolean(onTest);
  const letter = [...connection.label.trim()][0]?.toUpperCase() ?? "?";
  return (
    <Row
      aria-label={connection.label}
      label={
        <Rx.Flex as="span" align="center" gap="2" minWidth="0">
          {/* The key's first letter: decoration only, the label names it. */}
          <Rx.Avatar size="1" variant="soft" color="gray" fallback={letter} aria-hidden="true" />
          <bdi dir="auto" id={`${id}-label`}>
            {connection.label}
          </bdi>
          {/* The id is what the field is described by. */}
          <Rx.Badge color={connection.set ? "green" : "orange"} id={`${id}-state`}>
            {connection.set ? t("connections.set") : t("connections.notSet")}
          </Rx.Badge>
        </Rx.Flex>
      }
      {...(connection.help ? { hint: <bdi dir="auto">{connection.help}</bdi>, hintId: `${id}-help` } : {})}
      below={
        <Rx.Flex direction="column" gap="3">
          <form onSubmit={submit}>
            <Rx.Flex align="center" gap="2">
              <Rx.Box flexGrow="1" minWidth="0">
                <Rx.TextField.Root
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
              </Rx.Box>
              <Rx.Button type="submit" {...(connection.set ? { variant: "outline", color: "gray" } : { variant: "solid" })} disabled={value.trim() === ""}>
                {connection.set ? t("connections.replace") : t("connections.save")}
              </Rx.Button>
              {hasMenu && (
                <Rx.DropdownMenu.Root>
                  <Rx.DropdownMenu.Trigger>
                    <Rx.IconButton ref={more} type="button" variant="ghost" color="gray" aria-label={t("connections.more", { name: connection.label })}>
                      <Icon name="more" size={18} />
                    </Rx.IconButton>
                  </Rx.DropdownMenu.Trigger>
                  <Rx.DropdownMenu.Content align="end">
                    {onTest && (
                      <Rx.DropdownMenu.Item disabled={testing} onSelect={runTest}>
                        {t("connections.test")}
                      </Rx.DropdownMenu.Item>
                    )}
                    {onTest && connection.set && <Rx.DropdownMenu.Separator />}
                    {connection.set && (
                      // Danger last (DESIGN.md "Menu"); it only opens the question under the row.
                      <Rx.DropdownMenu.Item color="red" onSelect={() => setAsking(true)}>
                        {t("connections.delete")}
                      </Rx.DropdownMenu.Item>
                    )}
                  </Rx.DropdownMenu.Content>
                </Rx.DropdownMenu.Root>
              )}
            </Rx.Flex>
          </form>
          {asking && (
            <Rx.Flex align="center" justify="between" gap="3" wrap="wrap">
              <Rx.Text as="p" size="2">
                <bdi dir="auto">{t("connections.deleteAsk", { name: connection.label })}</bdi>
              </Rx.Text>
              <Rx.Flex gap="2">
                <Rx.Button variant="soft" color="red" size="1" onClick={remove}>
                  {t("connections.deleteConfirm")}
                </Rx.Button>
                <Rx.Button variant="outline" color="gray" size="1" onClick={cancel}>
                  {t("connections.cancel")}
                </Rx.Button>
              </Rx.Flex>
            </Rx.Flex>
          )}
          {onTest && (testing || outcome) && (
            <Rx.Text as="p" size="1" role="status" dir="auto" color={testing ? "gray" : outcome?.ok ? "green" : "red"}>
              {testing ? t("connections.testing") : outcome?.ok ? t("connections.works") : t("connections.testFailed", { message: outcome?.message })}
            </Rx.Text>
          )}
        </Rx.Flex>
      }
    />
  );
}
