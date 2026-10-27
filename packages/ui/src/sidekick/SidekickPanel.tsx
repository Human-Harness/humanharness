import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Segmented } from "../chrome";
import type { SidekickCard, SidekickState } from "../client";
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
  /** Opens Settings › Sidekick from the foot's tier; without it the tier is plain text. */
  onTier?: () => void;
}

/** The expanded Sidekick panel, 330 px (spec §7, mockup boards 1–3). Never takes focus. */
export function SidekickPanel(p: SidekickPanelProps) {
  const { t, i18n } = useTranslation();
  const n = (v: number) => v.toLocaleString(shownLanguage(i18n));
  const s = p.state;
  const showHarness = p.harnessSide !== undefined && p.view === "harness";
  const tierText = t("sidekick.tier", { tier: t(`sidekick.tiers.${s.tier}`, { defaultValue: s.tier }) });
  return (
    <aside className="hh-sk-panel" aria-label={s.info.name}>
      <header className="hh-sk-head">
        <SidekickMark off={!s.settings.on} />
        <h2 className="hh-sk-name">{s.info.name}</h2>
        <span className="hh-sk-status">{t(`sidekick.status.${s.status}`)}</span>
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
              {s.card && <Card key={s.card.id} card={s.card} {...p} />}
              {/* Main keeps them oldest first: the newest reads first. */}
              {[...s.cards].reverse().map((card) => (
                <AfterCard key={card.id} card={card} onPutInComposer={p.onPutInComposer} onDismiss={p.onDismiss} />
              ))}
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

function Card({ card, onSendSuggested, onEdit, onSendAnyway, onMute }: { card: SidekickCard } & SidekickPanelProps) {
  const { t } = useTranslation();
  return (
    <section className="hh-sk-card" aria-label={t("sidekick.card.title")}>
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
      {card.why && <p className="hh-caption">{t("sidekick.why", { used: card.why.used, of: card.why.of, kind: card.kind })}</p>}
      <button type="button" className="hh-link" onClick={() => onMute(card.id)}>
        {t("sidekick.mute", { kind: card.kind })}
      </button>
    </section>
  );
}

/** After the reply (spec §4.2): the gap it saw and the next prompt, which goes to the composer, never sent by itself. */
function AfterCard({ card, onPutInComposer, onDismiss }: { card: SidekickCard } & Pick<SidekickPanelProps, "onPutInComposer" | "onDismiss">) {
  const { t } = useTranslation();
  const a = card.after ?? {};
  const next = a.next;
  return (
    <section className="hh-sk-card" aria-label={t("sidekick.after.title")}>
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
