import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { HarnessClient, SidekickPreset } from "../client";
import { Rx } from "../guide";
import { SidekickMark, markIcon } from "./mark";

/** Clients whose harness has no presets: its manifest can't change while the app runs, so it isn't asked again. */
const noPresets = new WeakSet<HarnessClient>();

/**
 * "Suggested by the harness" (spec §2a.7): the harness's presets not adopted yet, each with "Add <name>", and "Not
 * now", which marks them offered. Nothing when the harness has none or all are adopted (D0). Its place (Settings ›
 * Sidekicks, while `presetsOffered` is false) is the caller's to decide.
 */
export function PresetOffer({ client, onDone, onShown }: { client: HarnessClient; onDone?: () => void; onShown?: () => void }) {
  const { t } = useTranslation();
  const [presets, setPresets] = useState<SidekickPreset[]>([]);
  const [busy, setBusy] = useState(false);
  /** A second press before the first answer (a double click) does nothing. */
  const running = useRef(false);
  /** The preset whose Add failed, or "" for Not now. */
  const [failed, setFailed] = useState<string | null>(null);
  const head = useRef<HTMLHeadingElement>(null);
  /** After an adoption the Add button is gone: focus goes back to the offer's heading. */
  const refocus = useRef(false);

  useEffect(() => {
    if (noPresets.has(client)) return;
    let live = true;
    client.sidekick.presets().then(
      (p) => {
        if (p.length === 0) noPresets.add(client);
        if (live) setPresets(p);
      },
      () => live && setPresets([]),
    );
    return () => {
      live = false;
    };
  }, [client]);

  const open = presets.filter((p) => !p.adopted);
  /** `onShown` fires once, when there is something to offer. */
  const shown = useRef(false);
  useEffect(() => {
    if (open.length === 0 || shown.current) return;
    shown.current = true;
    onShown?.();
  });
  useEffect(() => {
    if (!refocus.current) return;
    refocus.current = false;
    if (open.length > 0) head.current?.focus();
    else onDone?.();
  });

  if (open.length === 0) return null;

  const adopt = async (name: string) => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setFailed(null);
    try {
      await client.sidekick.adoptPreset(name);
      const next = await client.sidekick.presets();
      refocus.current = true;
      setPresets(next);
    } catch {
      setFailed(name);
    } finally {
      running.current = false;
      setBusy(false);
    }
  };

  const notNow = async () => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setFailed(null);
    const ok = await client.sidekick.set({ presetsOffered: true }).then(
      (r) => r.ok,
      () => false,
    );
    running.current = false;
    setBusy(false);
    if (ok) onDone?.();
    else setFailed("");
  };
  // Busy buttons stay focusable (aria-disabled): the one pressed keeps focus while the answer comes.
  const wait = busy ? { "aria-disabled": true as const } : {};

  // Radix stage 2d: one card, in Settings and in the Sidekick column alike: a title, a row per preset (mark, name,
  // personality, Add as a secondary) and Not now as a quiet action at its end.
  return (
    <Rx.Box asChild mb="5">
      <section aria-label={t("sidekick.presets.title")}>
        <Rx.Card size="2">
          <Rx.Heading as="h3" size="3" mb="3" ref={head} tabIndex={-1}>
            {t("sidekick.presets.title")}
          </Rx.Heading>
          <Rx.Flex direction="column" gap="3" role="list">
            {open.map((p) => (
              <Rx.Flex key={p.name} role="listitem" align="start" gap="3">
                <SidekickMark icon={markIcon(p.mark)} />
                <Rx.Box flexGrow="1" minWidth="0">
                  <Rx.Text as="p" size="2" weight="bold">
                    <bdi dir="auto">{p.name}</bdi>
                  </Rx.Text>
                  {p.personality && (
                    <Rx.Text as="p" size="1" color="gray" dir="auto">
                      {p.personality}
                    </Rx.Text>
                  )}
                </Rx.Box>
                <Rx.Button size="1" variant="outline" color="gray" {...wait} onClick={() => void adopt(p.name)}>
                  {t("sidekick.presets.add", { name: p.name })}
                </Rx.Button>
              </Rx.Flex>
            ))}
          </Rx.Flex>
          {failed !== null && (
            <Rx.Callout.Root color="red" role="alert" size="1" mt="3">
              <Rx.Callout.Text>{failed ? t("sidekick.presets.failed", { name: failed }) : t("sidekick.presets.notNowFailed")}</Rx.Callout.Text>
            </Rx.Callout.Root>
          )}
          <Rx.Flex justify="end" mt="3">
            <Rx.Button size="1" variant="ghost" color="gray" {...wait} onClick={() => void notNow()}>
              {t("sidekick.presets.notNow")}
            </Rx.Button>
          </Rx.Flex>
        </Rx.Card>
      </section>
    </Rx.Box>
  );
}

/**
 * The one-time offer in the panel (spec §2a.7 "the first time the person opens the Sidekick panel"): only while
 * `presetsOffered` is false when the panel opens, and marked offered as soon as it shows. Settings › Sidekicks may
 * have marked it already ("Not now", an adoption): then nothing. Once shown it stays until answered or the panel closes.
 */
export function FirstOpenOffer({ client, offered }: { client: HarnessClient; offered: boolean }) {
  const [show, setShow] = useState(!offered);
  if (!show) return null;
  return <PresetOffer client={client} onShown={() => void client.sidekick.set({ presetsOffered: true }).catch(() => undefined)} onDone={() => setShow(false)} />;
}
