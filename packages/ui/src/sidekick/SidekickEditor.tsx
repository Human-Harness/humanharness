import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { HarnessClient, SidekickDraftDef, SidekickPurposeView, SidekickView } from "../client";
import { ICON_NAMES, Icon, Row, Rx } from "../guide";
import { markIcon } from "./mark";

/** The core's purposes (spec §2a.2), in the order the editor lists them; `custom` comes after. */
const CORE = ["prompt-coach", "focus", "process-guard", "mentor", "daily-summary"] as const;
/** The moments a custom purpose can speak at (spec §2a.2), before the harness's places. */
const MOMENTS = ["pre-send", "after-reply", "heads-up", "before-approve", "phase-change", "daily"] as const;
/** The record's bounds (SDK `sidekickRecordSchema`). */
const NAME_MAX = 40;
const PERSONALITY_MAX = 1500;
const CUSTOM_MAX = 600;
const PURPOSES_MAX = 6;
const MOMENTS_MAX = 7;

type Tier = "default" | NonNullable<SidekickDraftDef["tier"]>;

/**
 * Create or edit a sidekick (spec §8): name, mark, personality, purposes and, for a custom purpose, its text and
 * moments (the harness's places too), and its model tier. Save sends the full definition: the store replaces every
 * field, so what the editor doesn't show (source, preset, defaultOn, a second custom purpose) goes back as it was.
 *
 * Radix stage 2d: one card of rows (DESIGN.md "an editor goes inside a card"); the mark is a grid of icon buttons, the
 * chosen one soft; purposes and moments are switches in columns; Save is the primary and Cancel the secondary, at the end.
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
  const [mark, setMark] = useState<string>(markIcon(initial?.mark));
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
      mark: markIcon(mark),
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
  // A new sidekick's editor stands below the list in its own card; an edit opens inside its row, which the list
  // already frames, so it gets no second card.
  const Frame = initial ? Rx.Box : Rx.Card;
  const momentChoices = [...MOMENTS.map((m) => ({ id: m as string, label: t(`sidekick.moments.${m}`) })), ...places.map((p) => ({ id: `place:${p.id}`, label: p.label }))];

  return (
    <section aria-label={initial ? t("sidekick.list.edit", { name: initial.name }) : t("sidekick.list.new")}>
      <Frame {...(initial ? { mt: "2" } : { size: "2" })}>
        <Row label={t("sidekick.editor.name")} htmlFor={`${ids}-name`}>
          <Rx.TextField.Root ref={nameRef} id={`${ids}-name`} value={name} maxLength={NAME_MAX} onChange={(e) => setName(e.target.value)} />
        </Row>
        <Rx.Separator size="4" />
        <Row
          label={<span id={`${ids}-mark`}>{t("sidekick.editor.mark")}</span>}
          below={
            <Rx.Flex wrap="wrap" gap="1" role="group" aria-labelledby={`${ids}-mark`}>
              {ICON_NAMES.map((n) => (
                <Rx.IconButton key={n} type="button" size="2" variant={mark === n ? "soft" : "ghost"} color={mark === n ? undefined : "gray"} aria-label={n} aria-pressed={mark === n} onClick={() => setMark(n)}>
                  <Icon name={n} size={18} />
                </Rx.IconButton>
              ))}
            </Rx.Flex>
          }
        />
        <Rx.Separator size="4" />
        <Row
          label={t("sidekick.editor.personality")}
          htmlFor={`${ids}-personality`}
          hint={`${t("sidekick.editor.personalityHint")} ${t("sidekick.editor.count", { count: personality.length, max: PERSONALITY_MAX })}`}
          hintId={`${ids}-personality-hint`}
          below={
            <Rx.TextArea
              id={`${ids}-personality`}
              value={personality}
              maxLength={PERSONALITY_MAX}
              rows={4}
              aria-describedby={`${ids}-personality-hint`}
              onChange={(e) => setPersonality(e.target.value)}
            />
          }
        />
        <Rx.Separator size="4" />
        <Row
          label={<span id={`${ids}-purposes`}>{t("sidekick.editor.purposes")}</span>}
          {...(tooMany ? { hint: t("sidekick.editor.tooMany", { max: PURPOSES_MAX }), hintId: `${ids}-too-many` } : {})}
          below={
            <Rx.Box role="group" aria-labelledby={`${ids}-purposes`}>
              <Switches>
                {CORE.map((id) => (
                  <SwitchLine key={id} checked={core.includes(id)} onChange={(on) => setCore(toggle(core, id, on))}>
                    {t(`sidekick.purposes.${id}`)}
                  </SwitchLine>
                ))}
                <SwitchLine checked={custom} onChange={setCustom}>
                  {t("sidekick.purposes.custom")}
                </SwitchLine>
              </Switches>
              {custom && (
                <Rx.Flex direction="column" gap="2" mt="3">
                  <Rx.Text as="label" size="2" htmlFor={`${ids}-custom`}>
                    {t("sidekick.editor.customText")}
                  </Rx.Text>
                  <Rx.TextArea id={`${ids}-custom`} value={customText} maxLength={CUSTOM_MAX} rows={3} onChange={(e) => setCustomText(e.target.value)} />
                  <Rx.Text as="p" size="1" color="gray" weight="bold" mt="2" id={`${ids}-moments`}>
                    {t("sidekick.editor.moments")}
                  </Rx.Text>
                  {tooManyMoments && (
                    <Rx.Text as="p" size="1" color="gray" id={`${ids}-too-many-moments`}>
                      {t("sidekick.editor.tooManyMoments", { max: MOMENTS_MAX })}
                    </Rx.Text>
                  )}
                  <Rx.Box role="group" aria-labelledby={`${ids}-moments`}>
                    <Switches>
                      {momentChoices.map((m) => (
                        <SwitchLine key={m.id} checked={moments.includes(m.id)} onChange={(on) => setMoments(toggle(moments, m.id, on))}>
                          {m.label}
                        </SwitchLine>
                      ))}
                    </Switches>
                  </Rx.Box>
                </Rx.Flex>
              )}
            </Rx.Box>
          }
        />
        <Rx.Separator size="4" />
        <Row label={t("sidekick.editor.tier")}>
          <Rx.SegmentedControl.Root value={tier} onValueChange={(v) => setTier(v as Tier)} aria-label={t("sidekick.editor.tier")}>
            {tiers.map((o) => (
              <Rx.SegmentedControl.Item key={o.value} value={o.value}>
                {o.label}
              </Rx.SegmentedControl.Item>
            ))}
          </Rx.SegmentedControl.Root>
        </Row>
        {failed !== null && (
          <Rx.Callout.Root color="red" role="alert" size="1" mt="3">
            <Rx.Callout.Text>{t("sidekick.settings.failed", { message: failed })}</Rx.Callout.Text>
          </Rx.Callout.Root>
        )}
        <Rx.Flex justify="end" gap="2" mt="3">
          <Rx.Button type="button" variant="outline" color="gray" onClick={() => onDone(false)}>
            {t("sidekick.editor.cancel")}
          </Rx.Button>
          {/* disabled until the sidekick is complete; aria-disabled while it saves, so the button keeps focus. */}
          <Rx.Button
            type="button"
            variant="solid"
            disabled={!ready}
            aria-disabled={busy}
            {...(tooMany || tooManyMoments ? { "aria-describedby": tooMany ? `${ids}-too-many` : `${ids}-too-many-moments` } : {})}
            onClick={() => void save()}
          >
            {t("sidekick.editor.save")}
          </Rx.Button>
        </Rx.Flex>
      </Frame>
    </section>
  );
}

/** Switches in two columns (one on a narrow card). */
function Switches({ children }: { children: ReactNode }) {
  return (
    <Rx.Grid columns={{ initial: "1", sm: "2" }} gapX="4" gapY="2">
      {children}
    </Rx.Grid>
  );
}

/** One on/off choice: a small switch named by the text next to it. */
function SwitchLine({ checked, onChange, children }: { checked: boolean; onChange: (on: boolean) => void; children: ReactNode }) {
  return (
    <Rx.Text as="label" size="2">
      <Rx.Flex gap="2" align="center">
        <Rx.Switch size="1" checked={checked} onCheckedChange={onChange} />
        {children}
      </Rx.Flex>
    </Rx.Text>
  );
}
