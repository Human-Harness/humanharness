import { useState, type ReactNode, type Ref } from "react";
import { useTranslation } from "react-i18next";
import { Segmented } from "../chrome";
import type { SidekickCard, SidekickHeadsUp, SidekickInfo, SidekickState } from "../client";
import { shownLanguage } from "../language";
import { SidekickMark } from "./mark";
import { wordDiff } from "./word-diff";

export interface SidekickPanelProps {
  state: SidekickState;
  /** Which side shows when the harness also has one (spec §7). */
  view: "sidekick" | "harness";
  onView(view: "sidekick" | "harness"): void;
  /** The harness's own side panel (renderSide), when it has one. */
  harnessSide?: ReactNode;
  /** "⌘" on macOS, "Ctrl" elsewhere. */
  sendKey: string;
  onCollapse(): void;
  onTurnOn(): void;
  onNotNow(): void;
  onSendSuggested(card: SidekickCard): void;
  onEdit(card: SidekickCard): void;
  onSendAnyway(card: SidekickCard): void;
  onPutInComposer(text: string): void;
  /** "Don't flag …": mutes the card's kind for its sidekick (spec §6.3). */
  onMute(cardId: string): void;
  /** An after-reply card leaves: `used` by Put in composer, or `dismissed` (spec §4.2). */
  onDismiss(cardId: string, outcome: "used" | "dismissed"): void;
  /** Queued asks "For later", kept by the chat so they survive the card that found them; `key` tells equal texts apart. */
  queued?: { key: string; text: string }[];
  onDropQueued(key: string): void;
  /** A repeated-ask heads-up's "Save as decision" (spec §4.3); a refusal's message shows on the card, which stays. */
  onSaveDecision(cardId: string): Promise<{ ok: boolean; message?: string }>;
  /** A context or off-phase heads-up's "Finish task" (spec §4.3). */
  onFinishTask(cardId: string): void;
  /** Opens Settings › Sidekick from the foot's tier; without it the tier is plain text. */
  onTier?: () => void;
  /** The harness's presets, offered once on the panel's first open (spec §2a.7); the caller decides when. */
  offer?: ReactNode;
}

/** A card the panel shows: an after-reply card needs a gap, a next prompt or a lesson (a repeated ask alone is the heads-up's). */
export const shownCard = (c: SidekickCard) => Boolean(c.headsUp || c.guard || c.moment === "daily" || c.after?.gap || c.after?.next || c.after?.lesson);

/** The cards waiting for the person, the live pre-send one first; none while Sidekick is off. */
export function waitingCards(s: SidekickState): SidekickCard[] {
  if (!s.settings.on) return [];
  return [...(s.card ? [s.card] : []), ...s.cards.filter(shownCard)];
}

/** Who speaks, named on a card when the person has several sidekicks or another one speaks (spec §7); one: nothing (D0). */
const speakerOf = (s: SidekickState, card: SidekickCard): SidekickInfo | undefined =>
  (s.sidekicks?.length ?? 0) > 1 || card.speaker.id !== s.info.id ? card.speaker : undefined;

function Speaker({ who }: { who: SidekickInfo | undefined }) {
  if (!who) return null;
  return (
    <span className="hh-sk-speaker">
      <SidekickMark mark={who.mark} size={16} /> {who.name}
    </span>
  );
}

/**
 * The collapsed panel: a 52 px rail with the mark (spec §7). With cards waiting it lights up and shows up to three
 * distinct marks of who speaks; its label carries the count.
 */
export function SidekickRail({ state: s, onOpen, buttonRef }: { state: SidekickState; onOpen(): void; buttonRef?: Ref<HTMLButtonElement> }) {
  const { t } = useTranslation();
  const waiting = waitingCards(s);
  const marks = [...new Map(waiting.map((c) => [c.speaker.id, c.speaker.mark])).values()].slice(0, 3);
  return (
    <div className="hh-sk-rail">
      <button ref={buttonRef} type="button" aria-label={waiting.length > 0 ? t("sidekick.rail.waiting", { count: waiting.length }) : t("sidekick.open")} onClick={onOpen}>
        {marks.length > 0 ? marks.map((mark, i) => <SidekickMark key={i} mark={mark} />) : <SidekickMark off={!s.settings.on} />}
        {waiting.length > 0 && <span className="hh-sk-dot" aria-hidden="true" />}
      </button>
    </div>
  );
}

/** The expanded Sidekick panel, 330 px (spec §7, mockup boards 1–3). Never takes focus. */
export function SidekickPanel(p: SidekickPanelProps) {
  const { t, i18n } = useTranslation();
  const n = (v: number) => v.toLocaleString(shownLanguage(i18n));
  const s = p.state;
  const showHarness = p.harnessSide !== undefined && p.view === "harness";
  const headsUps = s.cards.filter((c) => c.headsUp).length;
  // The count stands in for "Watching" only: a review or a suggestion says more.
  const status = headsUps > 0 && s.status === "watching" && !s.card ? t("sidekick.headsUpCount", { count: headsUps }) : t(`sidekick.status.${s.status}`);
  const tierText = t("sidekick.tier", { tier: t(`sidekick.tiers.${s.tier}`, { defaultValue: s.tier }) });
  return (
    <aside className="hh-sk-panel" aria-label={s.info.name}>
      <header className="hh-sk-head">
        <SidekickMark off={!s.settings.on} mark={s.info.mark} />
        <h2 className="hh-sk-name">{s.info.name}</h2>
        <span className="hh-sk-status">{status}</span>
        <span className="hh-spacer" />
        <button type="button" className="hh-sk-collapse" aria-label={t("sidekick.collapse")} onClick={p.onCollapse}>
          ›
        </button>
      </header>
      {p.harnessSide !== undefined && (
        <Segmented
          label={t("sidekick.switch.label")}
          options={[
            { value: "sidekick", label: t("sidekick.switch.sidekick") },
            { value: "harness", label: t("sidekick.switch.harness") },
          ]}
          value={p.view}
          onChange={p.onView}
        />
      )}
      {showHarness ? (
        <div className="hh-sk-harness">{p.harnessSide}</div>
      ) : (
        <div className="hh-sk-body">
          {!s.settings.on ? (
            s.settings.introSeen ? (
              <div className="hh-sk-off">
                <p>{t("sidekick.off")}</p>
                <button type="button" onClick={p.onTurnOn}>{t("sidekick.intro.turnOn")}</button>
              </div>
            ) : (
              <div className="hh-sk-intro">
                <h3>{t("sidekick.intro.title")}</h3>
                <p>{s.cap === null ? t("sidekick.intro.bodyNoCap") : t("sidekick.intro.body", { cap: n(s.cap) })}</p>
                <div className="hh-sk-actions">
                  <button type="button" className="hh-primary" onClick={p.onTurnOn}>{t("sidekick.intro.turnOn")}</button>
                  <button type="button" onClick={p.onNotNow}>{t("sidekick.intro.notNow")}</button>
                </div>
              </div>
            )
          ) : (
            <>
              {s.notice && <p className="hh-caption hh-sk-notice">{t(`sidekick.notice.${s.notice}`)}</p>}
              {p.offer}
              {s.card && <Card key={s.card.id} card={s.card} speaker={speakerOf(s, s.card)} {...p} />}
              {/* Main keeps them oldest first: the newest reads first. */}
              {[...s.cards].reverse().filter(shownCard).map((card) =>
                card.headsUp ? (
                  <HeadsUpCard key={card.id} card={card} headsUp={card.headsUp} speaker={speakerOf(s, card)} {...p} />
                ) : card.guard ? (
                  <GuardCard key={card.id} card={card} guard={card.guard} speaker={speakerOf(s, card)} onDismiss={p.onDismiss} />
                ) : card.moment === "daily" ? (
                  <DailyCard key={card.id} card={card} speaker={speakerOf(s, card)} onDismiss={p.onDismiss} />
                ) : (
                  <AfterCard key={card.id} card={card} speaker={speakerOf(s, card)} onPutInComposer={p.onPutInComposer} onDismiss={p.onDismiss} />
                ),
              )}
              {p.queued && p.queued.length > 0 && (
                <div className="hh-sk-queued">
                  <h4>{t("sidekick.card.queued")}</h4>
                  <ul>
                    {p.queued.map((q) => (
                      <li key={q.key}>
                        <p>{q.text}</p>
                        <button type="button" onClick={() => p.onPutInComposer(q.text)}>{t("sidekick.card.putInComposer")}</button>
                        <button type="button" onClick={() => p.onDropQueued(q.key)}>{t("sidekick.card.drop")}</button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {s.past.length > 0 && (
                <ul className="hh-sk-past">
                  {s.past.map((past) => (
                    <li key={past.id} className="hh-caption">
                      {t("sidekick.earlier", { outcome: t(`sidekick.outcomes.${past.outcome}`) })}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      )}
      {s.settings.on && (
        <footer className="hh-sk-foot">
          <p>{s.cap === null ? t("sidekick.footNoCap", { spent: n(s.spent) }) : t("sidekick.foot", { spent: n(s.spent), cap: n(s.cap) })}</p>
          {s.cap !== null && <progress max={s.cap} value={Math.min(s.spent, s.cap)} aria-label={t("sidekick.toggle")} />}
          <p className="hh-caption">
            {p.onTier ? (
              <button type="button" className="hh-link" onClick={p.onTier}>
                {tierText}
              </button>
            ) : (
              <span>{tierText}</span>
            )}{" "}
            · <span>{t("sidekick.sendNow", { key: p.sendKey })}</span>
          </p>
        </footer>
      )}
    </aside>
  );
}

function Card({ card, speaker, onSendSuggested, onEdit, onSendAnyway, onMute }: { card: SidekickCard; speaker: SidekickInfo | undefined } & SidekickPanelProps) {
  const { t } = useTranslation();
  // The kind as the person reads it (Settings' labels); an unknown kind as it is.
  const kind = t(`sidekick.kinds.${card.kind}`, { defaultValue: card.kind });
  return (
    <section className="hh-sk-card" aria-label={t("sidekick.card.title")}>
      <Speaker who={speaker} />
      <h3>{t("sidekick.card.title")}</h3>
      <ul className="hh-sk-issues">
        {card.issues.length > 0
          ? card.issues.map((issue, i) => <li key={i}>{issue.text}</li>)
          : card.flags.map((f, i) => <li key={i}>{t(`sidekick.flag.${f.kind}`, { match: f.match })}</li>)}
      </ul>
      {card.rewrite && (
        <div className="hh-sk-rewrite">
          <h4>{t("sidekick.card.rewrite")}</h4>
          <p>
            {wordDiff(card.prompt, card.rewrite).map((part, i) => (part.added ? <ins key={i}>{part.text}</ins> : <span key={i}>{part.text}</span>))}
          </p>
        </div>
      )}
      <div className="hh-sk-actions">
        {card.rewrite && (
          <>
            <button type="button" className="hh-primary" onClick={() => onSendSuggested(card)}>{t("sidekick.card.sendSuggested")}</button>
            <button type="button" onClick={() => onEdit(card)}>{t("sidekick.card.edit")}</button>
          </>
        )}
        <button type="button" onClick={() => onSendAnyway(card)}>{t("sidekick.card.sendAnyway")}</button>
      </div>
      {card.why && <p className="hh-caption">{t("sidekick.why", { used: card.why.used, of: card.why.of, kind })}</p>}
      <button type="button" className="hh-link" onClick={() => onMute(card.id)}>
        {t("sidekick.mute", { kind })}
      </button>
    </section>
  );
}

/**
 * After the reply (spec §4.2): the gap it saw and the next prompt, which goes to the composer, never sent by itself;
 * a mentor's lesson under "Worth knowing" (spec §2a.2).
 */
function AfterCard({ card, speaker, onPutInComposer, onDismiss }: { card: SidekickCard; speaker: SidekickInfo | undefined } & Pick<SidekickPanelProps, "onPutInComposer" | "onDismiss">) {
  const { t } = useTranslation();
  const a = card.after ?? {};
  const next = a.next;
  return (
    <section className="hh-sk-card" aria-label={t("sidekick.after.title")}>
      <Speaker who={speaker} />
      <h3>{t("sidekick.after.title")}</h3>
      {a.gap && (
        <>
          <h4>{a.gap.title}</h4>
          <p>{a.gap.text}</p>
        </>
      )}
      {next && (
        <>
          <h4>{t("sidekick.after.next")}</h4>
          <p>{next}</p>
        </>
      )}
      {a.lesson && (
        <>
          <h4>{t("sidekick.after.lesson")}</h4>
          <p>{a.lesson}</p>
        </>
      )}
      <div className="hh-sk-actions">
        {next && (
          <button
            type="button"
            className="hh-primary"
            onClick={() => {
              onPutInComposer(next);
              onDismiss(card.id, "used");
            }}
          >
            {t("sidekick.card.putInComposer")}
          </button>
        )}
        <button type="button" onClick={() => onDismiss(card.id, "dismissed")}>{t("sidekick.after.dismiss")}</button>
      </div>
    </section>
  );
}

/** A heads-up (spec §4.3): one line, its button and Dismiss. Never blocks and never takes focus. */
function HeadsUpCard({ card, headsUp, speaker, onSaveDecision, onFinishTask, onDismiss }: { card: SidekickCard; headsUp: SidekickHeadsUp; speaker: SidekickInfo | undefined } & SidekickPanelProps) {
  const { t } = useTranslation();
  const [failed, setFailed] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const save = () => {
    setFailed(null);
    setSaving(true);
    onSaveDecision(card.id).then(
      (r) => {
        setSaving(false);
        if (!r.ok) setFailed(r.message ?? "");
      },
      (err: unknown) => {
        setSaving(false);
        setFailed(err instanceof Error ? err.message : String(err));
      },
    );
  };
  return (
    <section className="hh-sk-card hh-sk-headsup">
      <Speaker who={speaker} />
      {headsUp.kind === "context" && <p>{t("sidekick.headsUp.context", { percent: Math.round(headsUp.share * 100) })}</p>}
      {headsUp.kind === "repeated" && (
        <>
          <p>{t("sidekick.headsUp.repeated", { topic: headsUp.topic })}</p>
          <p className="hh-caption">{headsUp.decision}</p>
        </>
      )}
      {headsUp.kind === "off-phase" && <p>{headsUp.phase ? t("sidekick.headsUp.offPhaseNamed", { phase: headsUp.phase }) : t("sidekick.headsUp.offPhase")}</p>}
      <div className="hh-sk-actions">
        {headsUp.kind === "repeated" ? (
          <button type="button" className="hh-primary" disabled={saving} onClick={save}>
            {t("sidekick.headsUp.saveDecision")}
          </button>
        ) : (
          <button type="button" className="hh-primary" onClick={() => onFinishTask(card.id)}>
            {t("sidekick.headsUp.finishTask")}
          </button>
        )}
        <button type="button" onClick={() => onDismiss(card.id, "dismissed")}>{t("sidekick.after.dismiss")}</button>
      </div>
      {/* No message back: the plain line, never "…decision: " with nothing after it. */}
      {failed !== null && <p role="alert">{failed ? t("sidekick.headsUp.saveFailed", { message: failed }) : t("sidekick.headsUp.saveFailedPlain")}</p>}
    </section>
  );
}

/** A process-guard's card (spec §2a.2): what the phase left (or the document) is missing, before moving on or approving. */
function GuardCard({ card, guard, speaker, onDismiss }: { card: SidekickCard; guard: { missing: string[] }; speaker: SidekickInfo | undefined } & Pick<SidekickPanelProps, "onDismiss">) {
  const { t } = useTranslation();
  const title = t(card.moment === "before-approve" ? "sidekick.guard.approveTitle" : "sidekick.guard.title");
  return (
    <section className="hh-sk-card" aria-label={title}>
      <Speaker who={speaker} />
      <h3>{title}</h3>
      <ul className="hh-sk-issues">
        {guard.missing.map((m, i) => (
          <li key={i}>{m}</li>
        ))}
      </ul>
      <div className="hh-sk-actions">
        <button type="button" onClick={() => onDismiss(card.id, "dismissed")}>{t("sidekick.after.dismiss")}</button>
      </div>
    </section>
  );
}

/** The daily card (spec §2a.2 daily-summary): yesterday in a few plain sentences. */
function DailyCard({ card, speaker, onDismiss }: { card: SidekickCard; speaker: SidekickInfo | undefined } & Pick<SidekickPanelProps, "onDismiss">) {
  const { t } = useTranslation();
  return (
    <section className="hh-sk-card" aria-label={t("sidekick.daily.title")}>
      <Speaker who={speaker} />
      <h3>{t("sidekick.daily.title")}</h3>
      <p className="hh-sk-daily">{card.text}</p>
      <div className="hh-sk-actions">
        <button type="button" onClick={() => onDismiss(card.id, "dismissed")}>{t("sidekick.after.dismiss")}</button>
      </div>
    </section>
  );
}
