import { type ComponentType, type FormEvent, type ReactNode, useEffect, useLayoutEffect, useReducer, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityList } from "./ActivityList";
import { GearIcon, TopBar } from "./chrome";
import type { AppState, EngineProblem, HarnessClient, SendOptions } from "./client";
import { ErrorCard, problemError } from "./ErrorCard";
import { uiLanguage } from "./FolderStep";
import { HistoryPanel } from "./HistoryPanel";
import { type BlockProps, Blocks, Message } from "./Message";
import { initialChat, reduceChat } from "./state";
import { UsageMeter } from "./UsageMeter";
import { type Preflight, lastTurnTokens, percent, preflight } from "./usage";

/** How close to the bottom (px) the user must be for new content to keep the chat pinned. */
const STICK_THRESHOLD = 80;

export type SendFn = (text: string, options?: SendOptions) => boolean;

export function ChatView({
  client,
  state,
  components,
  stateBlocks,
  renderSide,
  engineProblem,
  onHome,
  onSettings,
  onFixEngine,
}: {
  client: HarnessClient;
  state: AppState;
  components: Record<string, ComponentType<BlockProps>>;
  stateBlocks: string[];
  renderSide?: (blockState: Record<string, unknown>, send: SendFn) => ReactNode;
  /** What the background check found wrong with the engine, if anything. */
  engineProblem?: EngineProblem | null;
  onHome?: () => void;
  onSettings?: () => void;
  onFixEngine?: () => void;
}) {
  const { t, i18n } = useTranslation();
  const [chat, dispatch] = useReducer(reduceChat, undefined, () => initialChat([], stateBlocks));
  const [draft, setDraft] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const [estimates, setEstimates] = useState<Record<string, number>>({});
  const [pending, setPending] = useState<{ text: string; options: SendOptions; check: Preflight } | null>(null);
  const preflightRef = useRef<HTMLDivElement>(null);
  const notNowRef = useRef<HTMLButtonElement>(null);
  /** What had focus when the pre-flight question opened (the action's button): it gets focus back on "Not now". */
  const preflightOpener = useRef<HTMLElement | null>(null);
  const chatRef = useRef<HTMLElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const stick = useRef(true);
  // Set synchronously on send so two quick clicks can't both pass before the live turn renders.
  const busy = useRef(false);
  const wasLive = useRef(false);
  const lang = uiLanguage(state, i18n.language);
  const engineOption = state.engines.find((e) => e.id === state.config.engineId);
  const engine = engineOption?.name ?? state.config.engineId ?? "";

  useEffect(() => {
    void client.loadChat().then(({ entries, switchedFrom }) => {
      dispatch({ type: "loaded", entries });
      if (switchedFrom) dispatch({ type: "notice", text: t("chat.switched", { engine }), at: new Date().toISOString() });
    });
    client.getUsage().then(
      (u) => {
        setEstimates(u.estimates);
        if (u.limits) dispatch({ type: "limits", status: "allowed", windows: u.limits });
      },
      () => {},
    );
    return client.onEvent((e) => dispatch(e));
  }, [client]);

  useEffect(() => {
    if (!chat.live) busy.current = false;
  }, [chat.live]);

  // The pre-flight question gets focus on its safe answer ("Not now") and comes into view.
  const asking = pending !== null;
  useEffect(() => {
    if (!asking) return;
    preflightRef.current?.scrollIntoView?.({ block: "nearest" });
    notNowRef.current?.focus();
  }, [asking]);

  useLayoutEffect(() => {
    const el = chatRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [chat.entries, chat.live]);

  useEffect(() => {
    if (chat.live && !wasLive.current) setAnnouncement(t("chat.working"));
    if (!chat.live && wasLive.current) {
      setAnnouncement(chat.entries.findLast((e) => e.role === "assistant")?.text ?? "");
      inputRef.current?.focus();
      client.getUsage().then((u) => setEstimates(u.estimates), () => {});
    }
    wasLive.current = Boolean(chat.live);
  }, [chat.live, chat.entries, t, client]);

  /** True when the message was sent, or is waiting for the user to confirm a heavy action. */
  const send = (text: string, options: SendOptions = {}, confirmed = false): boolean => {
    const message = text.trim();
    if (!message || chat.live || busy.current || (pending && !confirmed)) return false;
    if (!confirmed && options.action) {
      const check = preflight(state.actions[options.action]?.cost, chat.limits, estimates[options.action]);
      if (check) {
        preflightOpener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        setPending({ text: message, options, check });
        return true;
      }
    }
    busy.current = true;
    stick.current = true;
    dispatch({ type: "user", text: message, at: new Date().toISOString(), ...(options.action ? { action: options.action } : {}) });
    client.send(message, options).catch((err: unknown) => {
      dispatch({ type: "done", ok: false, error: { code: "agent-crashed", detail: err instanceof Error ? err.message : String(err) } });
    });
    inputRef.current?.focus();
    return true;
  };
  /** "Not now" (or Escape): nothing is sent, and focus goes back to whatever asked. */
  const closePreflight = () => {
    setPending(null);
    const opener = preflightOpener.current;
    preflightOpener.current = null;
    if (opener?.isConnected) opener.focus();
    else inputRef.current?.focus();
  };
  /** What harness UI gets: it can't skip the pre-flight check. */
  const sendFromHarness: SendFn = (text, options) => send(text, options);
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (send(draft)) setDraft("");
  };
  const onScroll = () => {
    const el = chatRef.current;
    if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight <= STICK_THRESHOLD;
  };
  const last = chat.entries.at(-1);
  const lastUser = chat.entries.findLast((e) => e.role === "user");

  let preflightText = "";
  if (pending) {
    const action = pending.options.action ?? "";
    const label = state.actions[action]?.label[lang] ?? action;
    const left = percent(pending.check.left);
    preflightText =
      pending.check.estimate !== null
        ? t("preflight.estimate", { action: label, estimate: Math.max(1, percent(pending.check.estimate)), left })
        : t("preflight.hint", { action: label, left });
  }

  return (
    <div className="hh-app">
      <TopBar title={state.harness.name[lang]}>
        <UsageMeter engine={engineOption} limits={chat.limits} lastTokens={lastTurnTokens(chat.entries)} />
        {onHome && <button onClick={onHome}>{t("chat.home")}</button>}
        <button onClick={() => setShowHistory(true)}>{t("history.title")}</button>
        {onSettings && (
          <button className="hh-icon-button" aria-label={t("home.settings")} onClick={onSettings}>
            <GearIcon />
          </button>
        )}
      </TopBar>
      <div className="hh-body">
        <section className="hh-chat" ref={chatRef} onScroll={onScroll}>
          {engineProblem && <ErrorCard error={problemError(engineProblem)} engine={engine} onFix={onFixEngine} />}
          {chat.entries.map((entry) => (
            <div key={entry.id}>
              <Message entry={entry} components={components} respond={sendFromHarness} />
              {entry.error && entry === last && (
                <ErrorCard
                  error={entry.error}
                  engine={engine}
                  limits={chat.limits}
                  onFix={onFixEngine}
                  onRetry={lastUser ? () => send(lastUser.text, lastUser.action ? { action: lastUser.action } : {}) : undefined}
                />
              )}
            </div>
          ))}
          {chat.live && (
            <article className="hh-message assistant live">
              <ActivityList items={chat.live.activities} />
              {chat.live.text ? chat.live.text.split("\n\n").map((p, i) => <p key={i}>{p}</p>) : <p className="hh-working">{t("chat.working")}</p>}
              <Blocks blocks={chat.live.blocks} components={components} respond={sendFromHarness} />
            </article>
          )}
          {pending && (
            <div
              ref={preflightRef}
              className="hh-confirm"
              role="alertdialog"
              aria-labelledby="hh-preflight-title"
              aria-describedby="hh-preflight-text"
              onKeyDown={(e) => {
                if (e.key !== "Escape") return;
                e.preventDefault();
                closePreflight();
              }}
            >
              <p id="hh-preflight-title">
                <strong className="hh-warn">{t("preflight.title")}</strong>
              </p>
              <p id="hh-preflight-text">{preflightText}</p>
              <button
                className="hh-primary"
                onClick={() => {
                  const p = pending;
                  setPending(null);
                  send(p.text, p.options, true);
                }}
              >
                {t("preflight.continue")}
              </button>
              <button ref={notNowRef} onClick={closePreflight}>
                {t("preflight.notNow")}
              </button>
            </div>
          )}
        </section>
        {renderSide && <aside className="hh-side">{renderSide(chat.blockState, sendFromHarness)}</aside>}
      </div>
      <div className="hh-sr-only" aria-live="polite">
        {announcement}
      </div>
      <form className="hh-composer" onSubmit={onSubmit}>
        <textarea
          ref={inputRef}
          aria-label={t("chat.placeholder")}
          placeholder={t("chat.placeholder")}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter" || e.shiftKey) return;
            if (e.nativeEvent.isComposing || e.keyCode === 229) return;
            e.preventDefault();
            if (send(draft)) setDraft("");
          }}
        />
        {chat.live ? (
          <button type="button" onClick={() => void client.cancel()}>
            {t("chat.stop")}
          </button>
        ) : (
          <button type="submit">{t("chat.send")}</button>
        )}
      </form>
      {showHistory && (
        <HistoryPanel
          client={client}
          disabled={Boolean(chat.live)}
          onClose={() => setShowHistory(false)}
          onRestored={() => dispatch({ type: "notice", text: t("history.restored"), at: new Date().toISOString() })}
        />
      )}
    </div>
  );
}
