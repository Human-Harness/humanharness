import { type ReactNode, useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import type { HarnessClient, ScopeView, SidekickSettings, SidekickSettingsPatch } from "../client";
import { Group, Hidden, Row, Rx, SectionHead } from "../guide";
import { shownLanguage } from "../language";
import { LearnedList } from "./LearnedList";
import { PresetOffer } from "./PresetOffer";
import { ScopeSidekicks } from "./ScopeSidekicks";
import { SidekickList } from "./SidekickList";
import { useSidekick } from "./useSidekick";

type Wait = "6" | "10" | "always";
type Cap = "20000" | "50000" | "none";

/**
 * The open scope's id and title (harnesses with scopes; null when none is open or the harness has none). The title
 * follows renames; a change that arrives is newer than the first reply.
 */
function useOpenScope(client: HarnessClient, enabled: boolean): { id: string; label: string } | null {
  const [open, setOpen] = useState<{ id: string; label: string } | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    let seen = false;
    const show = (id: string | null, list: ScopeView[]) => setOpen(id === null ? null : { id, label: list.find((s) => s.id === id)?.title ?? id });
    Promise.all([client.scopes.current(), client.scopes.list()]).then(
      ([id, list]) => {
        if (live && !seen) show(id, list);
      },
      () => undefined,
    );
    const off = client.scopes.onChange((v) => {
      seen = true;
      show(v.open, v.list);
    });
    return () => {
      live = false;
      off();
    };
  }, [client, enabled]);
  return enabled ? open : null;
}

/**
 * Settings › Sidekick(s) (spec §8, mockup board 6): on/off and the moments, the share used, the muted kinds, the
 * harness's presets (while any is not adopted, spec §2a.7), the sidekicks, the sidekicks in the open scope (harnesses
 * with scopes, Decision 8), and what they learned. Each change saves at once.
 *
 * Radix stage 2d: one page in the same order; the main switch in the section head, three stat cards, the moments in a
 * card of rows, and the lists below as loose groups or cards.
 */
/** The section's and the tab's title (spec §8): "Sidekicks" once there are two or more, else "Sidekick". */
export function sidekickTitleKey(sidekicks: readonly unknown[] | undefined): "sidekick.list.title" | "sidekick.tab" {
  return (sidekicks?.length ?? 1) > 1 ? "sidekick.list.title" : "sidekick.tab";
}

export function SidekickTab({
  client,
  onModels,
  scopes,
}: {
  client: HarnessClient;
  onModels: () => void;
  /** The harness's scopes (manifest `scopes`): its `label` names a scope. Absent: no scope section (D0). */
  scopes?: { label: string };
}) {
  const { t, i18n } = useTranslation();
  const state = useSidekick(client, true);
  const openScope = useOpenScope(client, Boolean(scopes));
  const [failed, setFailed] = useState<string | null>(null);
  /** "Not now" hides the presets until Settings opens again (it stays here while one is not adopted). */
  const [presetsHidden, setPresetsHidden] = useState(false);
  const onHint = useId();
  const preSendHint = useId();
  const afterHint = useId();
  const headsUpHint = useId();
  if (!state) return null;
  const s = state.settings;
  // One row per muted kind; with several sidekicks the same kind can show twice (part 1 has only one).
  const muted = Object.entries(s.muted).flatMap(([sidekick, kinds]) => kinds.map((kind) => [sidekick, kind] as const));
  // A kind's label where one exists (else the kind itself); a row names its sidekick (several may mute the same kind).
  const kindLabel = (kind: string) => t(`sidekick.kinds.${kind}`, { defaultValue: kind });
  const nameOf = (id: string) => state.sidekicks?.find((k) => k.id === id)?.name ?? (id === state.info.id ? state.info.name : id);
  const save = (patch: SidekickSettingsPatch) => {
    setFailed(null);
    client.sidekick.set(patch).then(
      (r) => {
        if (!r.ok) setFailed(r.message);
      },
      (err: unknown) => setFailed(err instanceof Error ? err.message : String(err)),
    );
  };
  const waits: { value: Wait; label: string }[] = [
    { value: "6", label: t("sidekick.settings.wait6") },
    { value: "10", label: t("sidekick.settings.wait10") },
    { value: "always", label: t("sidekick.settings.waitAlways") },
  ];
  const caps: { value: Cap; label: string }[] = [
    { value: "20000", label: t("sidekick.settings.cap20") },
    { value: "50000", label: t("sidekick.settings.cap50") },
    { value: "none", label: t("sidekick.settings.capNone") },
  ];
  const tokens = state.week.toLocaleString(shownLanguage(i18n));
  const parseWait = (v: string): SidekickSettings["wait"] => (v === "always" ? "always" : v === "10" ? 10 : 6);
  const parseCap = (v: string): SidekickSettings["cap"] => (v === "none" ? "none" : v === "50000" ? 50_000 : 20_000);
  // Off: the rest stays visible but can't be changed (spec §8).
  const off = !s.on;
  // A moment's row: its switch, labelled by the row and described by the hint.
  const moment = (key: "preSend" | "afterReply" | "headsUps", id: string) => (
    <Rx.Switch id={`${id}-on`} checked={s[key]} disabled={off} aria-describedby={id} onCheckedChange={(on) => save({ [key]: on })} />
  );
  return (
    <div>
      <SectionHead
        line={t("settings.line.sidekick")}
        lineId={onHint}
        aside={
          <div data-setting="sidekick.on">
            <Rx.Switch checked={s.on} aria-label={t("sidekick.settings.on")} aria-describedby={onHint} onCheckedChange={(on) => save({ on })} />
          </div>
        }
      />
      {/* A save error is a red notice above what it affects (DESIGN.md "Settings"). */}
      {failed !== null && (
        <Rx.Callout.Root color="red" role="alert" mb="3">
          <Rx.Callout.Text>{t("sidekick.settings.failed", { message: failed })}</Rx.Callout.Text>
        </Rx.Callout.Root>
      )}
      {/* Stats: a card each, a 12 label and a 20 value (DESIGN.md "Settings"). */}
      <Rx.Grid columns="3" gap="3" mb="5">
        <Stat label={t("sidekick.settings.statWeek")} value={t("sidekick.settings.statTokens", { tokens })} said={t("sidekick.settings.week", { tokens })} />
        <Stat
          label={t("sidekick.settings.statUsed")}
          value={state.used.of > 0 ? t("sidekick.settings.statUsedValue", state.used) : t("sidekick.settings.statUsedNone")}
          {...(state.used.of > 0 ? { said: t("sidekick.settings.usedShare", state.used) } : {})}
        />
        {/* A value chosen elsewhere: the value plus a Change… button (DESIGN.md "Control per kind of setting"). */}
        <Stat label={t("sidekick.settings.tier")} value={t(`sidekick.tiers.${state.tier}`, { defaultValue: state.tier })} data-setting="sidekick.tier">
          <Rx.Button variant="ghost" color="gray" size="1" onClick={onModels}>
            {t("sidekick.settings.changeTier")}
          </Rx.Button>
        </Stat>
      </Rx.Grid>
      <Group>
        <Row data-setting="sidekick.preSend" label={t("sidekick.settings.preSend")} htmlFor={`${preSendHint}-on`} hint={t("sidekick.settings.preSendHint")} hintId={preSendHint}>
          {moment("preSend", preSendHint)}
        </Row>
        <Row data-setting="sidekick.afterReply" label={t("sidekick.settings.afterReply")} htmlFor={`${afterHint}-on`} hint={t("sidekick.settings.afterReplyHint")} hintId={afterHint}>
          {moment("afterReply", afterHint)}
        </Row>
        <Row data-setting="sidekick.headsUps" label={t("sidekick.settings.headsUps")} htmlFor={`${headsUpHint}-on`} hint={t("sidekick.settings.headsUpsHint")} hintId={headsUpHint}>
          {moment("headsUps", headsUpHint)}
        </Row>
        <Row data-setting="sidekick.wait" label={t("sidekick.settings.wait")}>
          <Rx.SegmentedControl.Root value={String(s.wait)} onValueChange={(v) => save({ wait: parseWait(v) })} aria-label={t("sidekick.settings.wait")} {...disabled(off)}>
            {waits.map((w) => (
              <Rx.SegmentedControl.Item key={w.value} value={w.value}>
                {w.label}
              </Rx.SegmentedControl.Item>
            ))}
          </Rx.SegmentedControl.Root>
        </Row>
        <Row data-setting="sidekick.cap" label={t("sidekick.settings.cap")}>
          <Rx.SegmentedControl.Root value={String(s.cap)} onValueChange={(v) => save({ cap: parseCap(v) })} aria-label={t("sidekick.settings.cap")} {...disabled(off)}>
            {caps.map((c) => (
              <Rx.SegmentedControl.Item key={c.value} value={c.value}>
                {c.label}
              </Rx.SegmentedControl.Item>
            ))}
          </Rx.SegmentedControl.Root>
        </Row>
      </Group>
      {muted.length > 0 && (
        <Group loose title={t("sidekick.settings.muted")}>
          {muted.map(([sidekick, kind]) => {
            const text = t("sidekick.mutedRow", { name: nameOf(sidekick), kind: kindLabel(kind) });
            return (
              <Row key={`${sidekick}/${kind}`} as="li" aria-label={text} label={text}>
                <Rx.Button
                  variant="ghost"
                  color="gray"
                  size="1"
                  onClick={() => void client.sidekick.unmute(sidekick, kind).catch((err: unknown) => setFailed(err instanceof Error ? err.message : String(err)))}
                >
                  {t("sidekick.settings.unmute", { kind: kindLabel(kind) })}
                </Rx.Button>
              </Row>
            );
          })}
        </Group>
      )}
      {/* Always offered here while one is not adopted; `presetsOffered` only gates the panel's one-time offer. */}
      {!presetsHidden && <PresetOffer client={client} onDone={() => setPresetsHidden(true)} />}
      <SidekickList client={client} places={state.places} />
      {scopes && openScope && <ScopeSidekicks key={openScope.id} client={client} scope={openScope} scopeNoun={scopes.label} />}
      <LearnedList client={client} />
    </div>
  );
}

/**
 * SegmentedControl.Root takes `disabled` (Radix passes it to its toggle group) though its type, built on a div's
 * props, does not list it.
 */
const disabled = (off: boolean) => ({ disabled: off }) as Record<string, unknown>;

/**
 * One stat (DESIGN.md "Settings"): a card with a 12 grey label and a 20 value. `said` is the whole sentence a screen
 * reader gets instead of the two parts; `children` is an action at the card's end.
 */
function Stat({ label, value, said, children, "data-setting": setting }: { label: string; value: string; said?: string; children?: ReactNode; "data-setting"?: string }) {
  return (
    <Rx.Card size="2" data-setting={setting}>
      <Rx.Flex direction="column" gap="1" align="start" height="100%">
        {said && <Hidden>{said}</Hidden>}
        <Rx.Text size="1" color="gray" aria-hidden={said ? "true" : undefined}>
          {label}
        </Rx.Text>
        <Rx.Text size="5" weight="bold" aria-hidden={said ? "true" : undefined}>
          {value}
        </Rx.Text>
        {children && <Rx.Box mt="auto" pt="2">{children}</Rx.Box>}
      </Rx.Flex>
    </Rx.Card>
  );
}
