import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Segmented } from "../chrome";
import type { HarnessClient, SidekickDraftDef, SidekickPurposeView, SidekickView } from "../client";

/** The core's purposes (spec §2a.2), in the order the editor lists them; `custom` comes after. */
const CORE = ["prompt-coach", "focus", "process-guard", "mentor", "daily-summary"] as const;
/** The moments a custom purpose can speak at (spec §2a.2), before the harness's places. */
const MOMENTS = ["pre-send", "after-reply", "heads-up", "before-approve", "phase-change", "daily"] as const;
/** The record's bounds (SDK `sidekickRecordSchema`). */
const NAME_MAX = 40;
const MARK_MAX = 16;
const PERSONALITY_MAX = 1500;
const CUSTOM_MAX = 600;
const PURPOSES_MAX = 6;
const MOMENTS_MAX = 7;

type Tier = "default" | NonNullable<SidekickDraftDef["tier"]>;

/**
 * Create or edit a sidekick (spec §8): name, mark, personality, purposes and, for a custom purpose, its text and
 * moments (the harness's places too), and its model tier. Save sends the full definition: the store replaces every
 * field, so what the editor doesn't show (source, preset, defaultOn, a second custom purpose) goes back as it was.
 */
export function SidekickEditor({
  client,
  initial,
  places = [],
  onDone,
}: {
  client: HarnessClient;
  /** The sidekick to edit; absent for a new one. */
  initial?: SidekickView;
  places?: { id: string; label: string }[];
  /** Saved (true) or cancelled (false). */
  onDone: (saved: boolean) => void;
}) {
  const { t } = useTranslation();
  const ids = useId();
  const customs = initial?.purposes.filter((p) => p.id === "custom") ?? [];
  const [name, setName] = useState(initial?.name ?? "");
  const [mark, setMark] = useState(initial?.mark ?? "spark");
  const [personality, setPersonality] = useState(initial?.personality ?? "");
  const [core, setCore] = useState<string[]>(initial?.purposes.filter((p) => p.id !== "custom").map((p) => p.id) ?? []);
  const [custom, setCustom] = useState(customs.length > 0);
  const [customText, setCustomText] = useState(customs[0]?.text ?? "");
  const [moments, setMoments] = useState<string[]>(customs[0]?.moments ?? []);
  const [tier, setTier] = useState<Tier>(initial?.tier ?? "default");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  /** A save running: a second press (a double click) before the first answer does nothing. */
  const saving = useRef(false);
  const nameRef = useRef<HTMLInputElement>(null);

  // The editor opens with focus in its first field.
  useEffect(() => nameRef.current?.focus(), []);

  const toggle = (list: string[], v: string, on: boolean) => (on ? [...list.filter((x) => x !== v), v] : list.filter((x) => x !== v));
  const purposes: SidekickPurposeView[] = [
    ...CORE.filter((id) => core.includes(id)).map((id) => ({ id })),
    ...(custom ? [{ id: "custom", text: customText.trim(), moments: [...MOMENTS, ...places.map((p) => `place:${p.id}`)].filter((m) => moments.includes(m)) }] : []),
    // A second custom purpose (an import's) has no fields here: it goes back unchanged.
    ...customs.slice(1),
  ];
  // From what Save sends: a moment of a place the harness no longer has doesn't count.
  const customOk = (p: SidekickPurposeView) => p.id !== "custom" || ((p.text ?? "").trim().length > 0 && (p.moments?.length ?? 0) >= 1 && (p.moments?.length ?? 0) <= MOMENTS_MAX);
  const tooMany = purposes.length > PURPOSES_MAX;
  const tooManyMoments = custom && (purposes.find((p) => p.id === "custom")?.moments?.length ?? 0) > MOMENTS_MAX;
  const ready = name.trim().length > 0 && purposes.length > 0 && !tooMany && purposes.every(customOk);

  const save = async () => {
    if (!ready || saving.current) return;
    saving.current = true;
    setBusy(true);
    setFailed(null);
    const def: SidekickDraftDef & { id?: string } = {
      ...(initial ? { id: initial.id } : {}),
      // Kept as they were: the editor has no field for them.
      ...(initial?.source ? { source: initial.source } : {}),
      ...(initial?.preset !== undefined ? { preset: initial.preset } : {}),
      ...(initial?.defaultOn !== undefined ? { defaultOn: initial.defaultOn } : {}),
      name: name.trim(),
      mark: mark.trim() || "spark",
      personality: personality.trim(),
      purposes,
      ...(tier !== "default" ? { tier } : {}),
    };
    try {
      await client.sidekick.saveSidekick(def);
    } catch (err) {
      saving.current = false;
      setFailed(err instanceof Error ? err.message : String(err));
      setBusy(false);
      return;
    }
    saving.current = false;
    setBusy(false);
    onDone(true);
  };

  const tiers: { value: Tier; label: string }[] = [
    { value: "default", label: t("sidekick.editor.tierDefault") },
    { value: "light", label: t("sidekick.tiers.light") },
    { value: "standard", label: t("sidekick.tiers.standard") },
    { value: "deep", label: t("sidekick.tiers.deep") },
  ];
  const momentChoices = [...MOMENTS.map((m) => ({ id: m as string, label: t(`sidekick.moments.${m}`) })), ...places.map((p) => ({ id: `place:${p.id}`, label: p.label }))];

  return (
    <section aria-label={initial ? t("sidekick.list.edit", { name: initial.name }) : t("sidekick.list.new")} className="hh-sk-editor">
      <div className="hh-rows">
        <div className="hh-row">
          <label className="hh-row-label" htmlFor={`${ids}-name`}>
            {t("sidekick.editor.name")}
          </label>
          <input ref={nameRef} id={`${ids}-name`} type="text" value={name} maxLength={NAME_MAX} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="hh-row">
          <label className="hh-row-label" htmlFor={`${ids}-mark`}>
            {t("sidekick.editor.mark")}
          </label>
          <input id={`${ids}-mark`} type="text" value={mark} maxLength={MARK_MAX} onChange={(e) => setMark(e.target.value)} />
        </div>
        <div className="hh-row hh-row-wrap">
          <label className="hh-row-label" htmlFor={`${ids}-personality`}>
            {t("sidekick.editor.personality")}
          </label>
          <textarea
            id={`${ids}-personality`}
            value={personality}
            maxLength={PERSONALITY_MAX}
            rows={4}
            aria-describedby={`${ids}-personality-hint`}
            onChange={(e) => setPersonality(e.target.value)}
          />
          <p className="hh-caption hh-row-note" id={`${ids}-personality-hint`}>
            {t("sidekick.editor.personalityHint")} {t("sidekick.editor.count", { count: personality.length, max: PERSONALITY_MAX })}
          </p>
        </div>
      </div>
      <fieldset className="hh-sk-fieldset">
        <legend>{t("sidekick.editor.purposes")}</legend>
        {tooMany && (
          <p className="hh-caption" id={`${ids}-too-many`}>
            {t("sidekick.editor.tooMany", { max: PURPOSES_MAX })}
          </p>
        )}
        {CORE.map((id) => (
          <label key={id} className="hh-sk-check">
            <input type="checkbox" checked={core.includes(id)} onChange={(e) => setCore(toggle(core, id, e.target.checked))} /> {t(`sidekick.purposes.${id}`)}
          </label>
        ))}
        <label className="hh-sk-check">
          <input type="checkbox" checked={custom} onChange={(e) => setCustom(e.target.checked)} /> {t("sidekick.purposes.custom")}
        </label>
        {custom && (
          <div className="hh-sk-custom">
            <label htmlFor={`${ids}-custom`}>{t("sidekick.editor.customText")}</label>
            <textarea id={`${ids}-custom`} value={customText} maxLength={CUSTOM_MAX} rows={3} onChange={(e) => setCustomText(e.target.value)} />
            <fieldset className="hh-sk-fieldset">
              <legend>{t("sidekick.editor.moments")}</legend>
              {tooManyMoments && (
                <p className="hh-caption" id={`${ids}-too-many-moments`}>
                  {t("sidekick.editor.tooManyMoments", { max: MOMENTS_MAX })}
                </p>
              )}
              {momentChoices.map((m) => (
                <label key={m.id} className="hh-sk-check">
                  <input type="checkbox" checked={moments.includes(m.id)} onChange={(e) => setMoments(toggle(moments, m.id, e.target.checked))} /> {m.label}
                </label>
              ))}
            </fieldset>
          </div>
        )}
      </fieldset>
      <div className="hh-row">
        <span className="hh-row-label">{t("sidekick.editor.tier")}</span>
        <Segmented label={t("sidekick.editor.tier")} options={tiers} value={tier} onChange={setTier} />
      </div>
      {failed !== null && <p role="alert">{t("sidekick.settings.failed", { message: failed })}</p>}
      <div className="hh-sk-actions">
        {/* disabled until the sidekick is complete; aria-disabled while it saves, so the button keeps focus. */}
        <button
          type="button"
          className="hh-primary"
          disabled={!ready}
          aria-disabled={busy}
          {...(tooMany || tooManyMoments ? { "aria-describedby": tooMany ? `${ids}-too-many` : `${ids}-too-many-moments` } : {})}
          onClick={() => void save()}
        >
          {t("sidekick.editor.save")}
        </button>
        <button type="button" onClick={() => onDone(false)}>
          {t("sidekick.editor.cancel")}
        </button>
      </div>
    </section>
  );
}
