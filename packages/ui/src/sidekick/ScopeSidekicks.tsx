import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { HarnessClient, SidekickInScope } from "../client";
import { Group, Row, Rx } from "../guide";
import { SidekickMark, markIcon } from "./mark";

/** The longest purpose text (the SDK's SIDEKICK_PURPOSE_TEXT_MAX; the UI imports only types). */
const PURPOSE_MAX = 600;

/**
 * "Sidekicks in this <scope>" (spec §2a.4, Decision 8): for the open scope, each sidekick on or off there and its
 * purpose text there (saved on blur). Nothing is written until the person changes something.
 *
 * Radix stage 2d: a loose list titled by the scope; a row is the mark and the name with its switch, and the purpose
 * text full-width under it.
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
    <Group
      loose
      title={t("sidekick.scope.title", { noun: scopeNoun })}
      hint={
        <>
          <span>{scope.label}</span> · <span id={`${ids}-hint`}>{t("sidekick.scope.purposeHint", { noun: scopeNoun })}</span>
        </>
      }
      {...(failed !== null
        ? {
            after: (
              <Rx.Callout.Root color="red" role="alert" mt="3">
                <Rx.Callout.Text>{t("sidekick.settings.failed", { message: failed })}</Rx.Callout.Text>
              </Rx.Callout.Root>
            ),
          }
        : {})}
    >
      {rows.map((r) => (
        <ScopeRow key={r.id} client={client} scope={scope.id} row={r} hintId={`${ids}-hint`} onFailed={setFailed} />
      ))}
    </Group>
  );
}

type Value = { on: boolean; text: string };
const same = (a: Value, b: Value) => a.on === b.on && a.text.trim() === b.text.trim();

/**
 * One sidekick's row. Its values are local from the first read; one save at a time, and a change made while one runs
 * is saved after it (only the latest value, and only when it differs), so a quick double click never writes twice nor
 * gets lost. A refusal puts the switch and the text back and says why. A row gone (another scope opened) still saves
 * its latest change, typed text included, to its own scope.
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
  /** The save in flight (settled when none), and the value it sent. */
  const inflight = useRef<Promise<unknown>>(Promise.resolve());
  const tried = useRef<Value | null>(null);
  /** The text as typed, blurred or not. */
  const typed = useRef(text);
  typed.current = text;
  const write = (v: Value) => {
    const purposeText = v.text.trim();
    return client.sidekick.setScope(scope, row.id, { on: v.on, ...(purposeText ? { purposeText } : {}), ...(row.places ? { places: row.places } : {}) });
  };
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      // Fire and forget, after the save in flight: only a change not saved nor already tried (and refused).
      const last = { ...wanted.current, text: typed.current };
      void inflight.current.then(() => {
        if (same(last, saved.current) || (tried.current && same(last, tried.current))) return;
        write(last).catch(() => undefined);
      });
    };
  }, []);
  const boxId = useId();
  const switchId = useId();

  const flush = () => {
    if (running.current || !live.current) return;
    const next = wanted.current;
    if (same(next, saved.current)) return;
    running.current = true;
    tried.current = next;
    setBusy(true);
    onFailed(null);
    const fail = (message: string) => {
      wanted.current = saved.current;
      if (!live.current) return;
      setOn(saved.current.on);
      setText(saved.current.text);
      onFailed(message);
    };
    inflight.current = write(next)
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
    <Row
      as="li"
      aria-label={row.name}
      busy={busy}
      htmlFor={switchId}
      label={
        <Rx.Flex as="span" align="center" gap="2">
          <SidekickMark icon={markIcon(row.mark)} off={!on} />
          <bdi dir="auto">{row.name}</bdi>
        </Rx.Flex>
      }
      below={
        <Rx.Flex direction="column" gap="1">
          <Rx.Text as="label" size="1" color="gray" htmlFor={boxId}>
            {t("sidekick.scope.purpose", { name: row.name })}
          </Rx.Text>
          <Rx.TextArea
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
        </Rx.Flex>
      }
    >
      <Rx.Switch
        id={switchId}
        checked={on}
        onCheckedChange={(next) => {
          setOn(next);
          wanted.current = { ...wanted.current, on: next };
          flush();
        }}
      />
    </Row>
  );
}
