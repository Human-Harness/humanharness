import { type ComponentType, type FormEvent, useEffect, useLayoutEffect, useReducer, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityList } from "./ActivityList";
import type { AppState, HarnessClient } from "./client";
import { ErrorCard } from "./ErrorCard";
import { HistoryPanel } from "./HistoryPanel";
import { type BlockProps, Blocks, Message } from "./Message";
import { initialChat, reduceChat } from "./state";

/** How close to the bottom (px) the user must be for new content to keep the chat pinned. */
const STICK_THRESHOLD = 80;

export function ChatView({
  client,
  state,
  components,
  stateBlocks,
  renderSide,
}: {
  client: HarnessClient;
  state: AppState;
  components: Record<string, ComponentType<BlockProps>>;
  stateBlocks: string[];
  renderSide?: (blockState: Record<string, unknown>) => React.ReactNode;
}) {
  const { t } = useTranslation();
  const [chat, dispatch] = useReducer(reduceChat, undefined, () => initialChat([], stateBlocks));
  const [draft, setDraft] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const chatRef = useRef<HTMLElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const stick = useRef(true);
  // Set synchronously on send so two quick clicks can't both pass before the live turn renders.
  const busy = useRef(false);
  const wasLive = useRef(false);
  const engine = state.engines.find((e) => e.id === state.config.engineId)?.name ?? state.config.engineId ?? "";

  useEffect(() => {
    void client.loadChat().then(({ entries }) => dispatch({ type: "loaded", entries }));
    return client.onEvent((e) => dispatch(e));
  }, [client]);

  useEffect(() => {
    if (!chat.live) busy.current = false;
  }, [chat.live]);

  useLayoutEffect(() => {
    const el = chatRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [chat.entries, chat.live]);

  useEffect(() => {
    if (chat.live && !wasLive.current) setAnnouncement(t("chat.working"));
    if (!chat.live && wasLive.current) {
      setAnnouncement(chat.entries.findLast((e) => e.role === "assistant")?.text ?? "");
      inputRef.current?.focus();
    }
    wasLive.current = Boolean(chat.live);
  }, [chat.live, chat.entries, t]);

  /** Returns true only if the message was actually sent. */
  const send = (text: string): boolean => {
    const message = text.trim();
    if (!message || chat.live || busy.current) return false;
    busy.current = true;
    stick.current = true;
    dispatch({ type: "user", text: message, at: new Date().toISOString() });
    client.send(message).catch((err: unknown) => {
      dispatch({ type: "done", ok: false, error: { code: "agent-crashed", detail: err instanceof Error ? err.message : String(err) } });
    });
    inputRef.current?.focus();
    return true;
  };
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

  return (
    <div className="hh-app">
      <header className="hh-header">
        <h1>{state.harness.name[state.config.language ?? "en"]}</h1>
        <button onClick={() => setShowHistory(true)}>{t("history.title")}</button>
      </header>
      <div className="hh-body">
        <section className="hh-chat" ref={chatRef} onScroll={onScroll}>
          {chat.entries.map((entry) => (
            <div key={entry.id}>
              <Message entry={entry} components={components} respond={send} />
              {entry.error && entry === last && (
                <ErrorCard error={entry.error} engine={engine} onRetry={lastUser ? () => send(lastUser.text) : undefined} />
              )}
            </div>
          ))}
          {chat.live && (
            <article className="hh-message assistant live">
              <ActivityList items={chat.live.activities} />
              {chat.live.text ? chat.live.text.split("\n\n").map((p, i) => <p key={i}>{p}</p>) : <p className="hh-working">{t("chat.working")}</p>}
              <Blocks blocks={chat.live.blocks} components={components} respond={send} />
            </article>
          )}
        </section>
        {renderSide && <aside className="hh-side">{renderSide(chat.blockState)}</aside>}
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
