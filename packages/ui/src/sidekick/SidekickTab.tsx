import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Segmented } from "../chrome";
import type { HarnessClient, SidekickSettings, SidekickSettingsPatch } from "../client";
import { shownLanguage } from "../language";
import { LearnedList } from "./LearnedList";
import { useSidekick } from "./useSidekick";

type Wait = "6" | "10" | "always";
type Cap = "20000" | "50000" | "none";

/** Settings › Sidekick (spec §8, mockup board 6), the share used, the muted kinds and what Sidekick learned. Each change saves at once. */
export function SidekickTab({ client, onModels }: { client: HarnessClient; onModels: () => void }) {
  const { t, i18n } = useTranslation();
  const state = useSidekick(client, true);
  const [failed, setFailed] = useState<string | null>(null);
  const onHint = useId();
  const preSendHint = useId();
  const afterHint = useId();
  const headsUpHint = useId();
  const mutedHead = useId();
  if (!state) return null;
  const s = state.settings;
  // One row per muted kind; with several sidekicks the same kind can show twice (part 1 has only one).
  const muted = Object.entries(s.muted).flatMap(([sidekick, kinds]) => kinds.map((kind) => [sidekick, kind] as const));
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
  const parseWait = (v: Wait): SidekickSettings["wait"] => (v === "always" ? "always" : v === "10" ? 10 : 6);
  const parseCap = (v: Cap): SidekickSettings["cap"] => (v === "none" ? "none" : v === "50000" ? 50_000 : 20_000);
  return (
    <div className="hh-tab">
      <div className="hh-rows">
        <div className="hh-row hh-row-wrap">
          <label className="hh-row-label" htmlFor={`${onHint}-on`}>
            {t("sidekick.settings.on")}
          </label>
          <input id={`${onHint}-on`} type="checkbox" checked={s.on} aria-describedby={onHint} onChange={(e) => save({ on: e.target.checked })} />
          <p className="hh-caption hh-row-note" id={onHint}>
            {t("sidekick.settings.onHint")}
          </p>
        </div>
      </div>
      {/* Off: the rest stays visible but can't be changed (spec §8). */}
      <fieldset className="hh-sk-fieldset" disabled={!s.on}>
        <div className="hh-rows">
          <div className="hh-row hh-row-wrap">
            <label className="hh-row-label" htmlFor={`${preSendHint}-on`}>
              {t("sidekick.settings.preSend")}
            </label>
            <input
              id={`${preSendHint}-on`}
              type="checkbox"
              checked={s.preSend}
              aria-describedby={preSendHint}
              onChange={(e) => save({ preSend: e.target.checked })}
            />
            <p className="hh-caption hh-row-note" id={preSendHint}>
              {t("sidekick.settings.preSendHint")}
            </p>
          </div>
          <div className="hh-row hh-row-wrap">
            <label className="hh-row-label" htmlFor={`${afterHint}-on`}>
              {t("sidekick.settings.afterReply")}
            </label>
            <input
              id={`${afterHint}-on`}
              type="checkbox"
              checked={s.afterReply}
              aria-describedby={afterHint}
              onChange={(e) => save({ afterReply: e.target.checked })}
            />
            <p className="hh-caption hh-row-note" id={afterHint}>
              {t("sidekick.settings.afterReplyHint")}
            </p>
          </div>
          <div className="hh-row hh-row-wrap">
            <label className="hh-row-label" htmlFor={`${headsUpHint}-on`}>
              {t("sidekick.settings.headsUps")}
            </label>
            <input
              id={`${headsUpHint}-on`}
              type="checkbox"
              checked={s.headsUps}
              aria-describedby={headsUpHint}
              onChange={(e) => save({ headsUps: e.target.checked })}
            />
            <p className="hh-caption hh-row-note" id={headsUpHint}>
              {t("sidekick.settings.headsUpsHint")}
            </p>
          </div>
          <div className="hh-row">
            <span className="hh-row-label">{t("sidekick.settings.wait")}</span>
            <Segmented label={t("sidekick.settings.wait")} options={waits} value={String(s.wait) as Wait} onChange={(v) => save({ wait: parseWait(v) })} />
          </div>
          <div className="hh-row">
            <span className="hh-row-label">{t("sidekick.settings.tier")}</span>
            <span>{t(`sidekick.tiers.${state.tier}`, { defaultValue: state.tier })}</span>
            <button type="button" className="hh-link" onClick={onModels}>
              {t("sidekick.settings.changeTier")}
            </button>
          </div>
          <div className="hh-row">
            <span className="hh-row-label">{t("sidekick.settings.cap")}</span>
            <Segmented label={t("sidekick.settings.cap")} options={caps} value={String(s.cap) as Cap} onChange={(v) => save({ cap: parseCap(v) })} />
          </div>
        </div>
      </fieldset>
      <p className="hh-caption">{t("sidekick.settings.week", { tokens: state.week.toLocaleString(shownLanguage(i18n)) })}</p>
      {state.used.of > 0 && <p className="hh-caption">{t("sidekick.settings.usedShare", state.used)}</p>}
      {muted.length > 0 && (
        <section aria-labelledby={mutedHead}>
          <h3 id={mutedHead}>{t("sidekick.settings.muted")}</h3>
          <ul className="hh-rows hh-sk-muted">
            {muted.map(([sidekick, kind]) => (
              <li key={`${sidekick}/${kind}`} className="hh-row">
                <span className="hh-row-label">{kind}</span>
                <button
                  type="button"
                  className="hh-link"
                  onClick={() => void client.sidekick.unmute(sidekick, kind).catch((err: unknown) => setFailed(err instanceof Error ? err.message : String(err)))}
                >
                  {t("sidekick.settings.unmute", { kind })}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {failed !== null && <p role="alert">{t("sidekick.settings.failed", { message: failed })}</p>}
      <LearnedList client={client} />
    </div>
  );
}
