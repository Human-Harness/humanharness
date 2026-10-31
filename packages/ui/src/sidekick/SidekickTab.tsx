import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Segmented } from "../chrome";
import type { HarnessClient, ScopeView, SidekickSettings, SidekickSettingsPatch } from "../client";
import { shownLanguage } from "../language";
import { LearnedList } from "./LearnedList";
import { PresetOffer } from "./PresetOffer";
import { ScopeSidekicks } from "./ScopeSidekicks";
import { SidekickList } from "./SidekickList";
import { useSidekick } from "./useSidekick";
import { SectionHead, SettingRow, SettingsCard } from "../settings-parts";

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
 */
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
  const mutedHead = useId();
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
  const parseWait = (v: Wait): SidekickSettings["wait"] => (v === "always" ? "always" : v === "10" ? 10 : 6);
  const parseCap = (v: Cap): SidekickSettings["cap"] => (v === "none" ? "none" : v === "50000" ? 50_000 : 20_000);
  return (
    <div className="hh-tab">
      {/* "Sidekicks" once there are two or more, as the tab says it (spec §8). */}
      <SectionHead
        title={(state.sidekicks?.length ?? 1) > 1 ? t("sidekick.list.title") : t("sidekick.tab")}
        line={t("settings.line.sidekick")}
        lineId={onHint}
        aside={
          <div className="hh-sk-main" data-setting="sidekick.on">
            <input
              className="hh-switch"
              type="checkbox"
              checked={s.on}
              aria-label={t("sidekick.settings.on")}
              aria-describedby={onHint}
              onChange={(e) => save({ on: e.target.checked })}
            />
          </div>
        }
      />
      <div className="hh-stats">
        <div className="hh-card hh-stat">
          <span className="hh-sr-only">{t("sidekick.settings.week", { tokens })}</span>
          <span className="hh-stat-label" aria-hidden="true">
            {t("sidekick.settings.statWeek")}
          </span>
          <span className="hh-stat-value" aria-hidden="true">
            {t("sidekick.settings.statTokens", { tokens })}
          </span>
        </div>
        <div className="hh-card hh-stat">
          {state.used.of > 0 && <span className="hh-sr-only">{t("sidekick.settings.usedShare", state.used)}</span>}
          <span className="hh-stat-label" aria-hidden={state.used.of > 0 ? "true" : undefined}>
            {t("sidekick.settings.statUsed")}
          </span>
          <span className="hh-stat-value" aria-hidden={state.used.of > 0 ? "true" : undefined}>
            {state.used.of > 0 ? t("sidekick.settings.statUsedValue", state.used) : t("sidekick.settings.statUsedNone")}
          </span>
        </div>
        <div className="hh-card hh-stat" data-setting="sidekick.tier">
          <span className="hh-stat-label">{t("sidekick.settings.tier")}</span>
          <span className="hh-stat-value">{t(`sidekick.tiers.${state.tier}`, { defaultValue: state.tier })}</span>
          {/* Off: it can't be changed, as the rows below (spec §8). */}
          <fieldset className="hh-sk-fieldset hh-stat-action" disabled={!s.on}>
            <button type="button" className="hh-link" onClick={onModels}>
              {t("sidekick.settings.changeTier")}
            </button>
          </fieldset>
        </div>
      </div>
      {/* Off: the rest stays visible but can't be changed (spec §8). */}
      <fieldset className="hh-sk-fieldset" disabled={!s.on}>
        <SettingsCard>
          <SettingRow
            data-setting="sidekick.preSend"
            label={t("sidekick.settings.preSend")}
            labelFor={`${preSendHint}-on`}
            hint={t("sidekick.settings.preSendHint")}
            hintId={preSendHint}
          >
            <input
              id={`${preSendHint}-on`}
              className="hh-switch"
              type="checkbox"
              checked={s.preSend}
              aria-describedby={preSendHint}
              onChange={(e) => save({ preSend: e.target.checked })}
            />
          </SettingRow>
          <SettingRow
            data-setting="sidekick.afterReply"
            label={t("sidekick.settings.afterReply")}
            labelFor={`${afterHint}-on`}
            hint={t("sidekick.settings.afterReplyHint")}
            hintId={afterHint}
          >
            <input
              id={`${afterHint}-on`}
              className="hh-switch"
              type="checkbox"
              checked={s.afterReply}
              aria-describedby={afterHint}
              onChange={(e) => save({ afterReply: e.target.checked })}
            />
          </SettingRow>
          <SettingRow
            data-setting="sidekick.headsUps"
            label={t("sidekick.settings.headsUps")}
            labelFor={`${headsUpHint}-on`}
            hint={t("sidekick.settings.headsUpsHint")}
            hintId={headsUpHint}
          >
            <input
              id={`${headsUpHint}-on`}
              className="hh-switch"
              type="checkbox"
              checked={s.headsUps}
              aria-describedby={headsUpHint}
              onChange={(e) => save({ headsUps: e.target.checked })}
            />
          </SettingRow>
          <SettingRow data-setting="sidekick.wait" label={t("sidekick.settings.wait")}>
            <Segmented label={t("sidekick.settings.wait")} options={waits} value={String(s.wait) as Wait} onChange={(v) => save({ wait: parseWait(v) })} />
          </SettingRow>
          <SettingRow data-setting="sidekick.cap" label={t("sidekick.settings.cap")}>
            <Segmented label={t("sidekick.settings.cap")} options={caps} value={String(s.cap) as Cap} onChange={(v) => save({ cap: parseCap(v) })} />
          </SettingRow>
        </SettingsCard>
      </fieldset>
      {muted.length > 0 && (
        <section aria-labelledby={mutedHead}>
          <h3 id={mutedHead}>{t("sidekick.settings.muted")}</h3>
          <ul className="hh-rows hh-sk-muted">
            {muted.map(([sidekick, kind]) => (
              <li key={`${sidekick}/${kind}`} className="hh-row">
                <span className="hh-row-label">{t("sidekick.mutedRow", { name: nameOf(sidekick), kind: kindLabel(kind) })}</span>
                <button
                  type="button"
                  className="hh-link"
                  onClick={() => void client.sidekick.unmute(sidekick, kind).catch((err: unknown) => setFailed(err instanceof Error ? err.message : String(err)))}
                >
                  {t("sidekick.settings.unmute", { kind: kindLabel(kind) })}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {failed !== null && <p role="alert">{t("sidekick.settings.failed", { message: failed })}</p>}
      {/* Always offered here while one is not adopted; `presetsOffered` only gates the panel's one-time offer. */}
      {!presetsHidden && <PresetOffer client={client} onDone={() => setPresetsHidden(true)} />}
      <SidekickList client={client} places={state.places} />
      {scopes && openScope && <ScopeSidekicks key={openScope.id} client={client} scope={openScope} scopeNoun={scopes.label} />}
      <LearnedList client={client} />
    </div>
  );
}
