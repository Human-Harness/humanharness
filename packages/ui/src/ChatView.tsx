import { type ComponentType, type FormEvent, useEffect, useReducer, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityList } from "./ActivityList";
import type { AppState, HarnessClient } from "./client";
import { ErrorCard } from "./ErrorCard";
import { HistoryPanel } from "./HistoryPanel";
import { type BlockProps, Blocks, Message } from "./Message";
import { initialChat, reduceChat } from "./state";

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
  const lastUserText = useRef("");
  const engine = state.engines.find((e) => e.id === state.config.engineId)?.name ?? "";

  useEffect(() => {
    void client.loadChat().then((entries) => dispatch({ type: "loaded", entries }));
    return client.onEvent((e) => dispatch(e));
  }, [client]);

  const send = (text: string) => {
    const message = text.trim();
    if (!message || chat.live) return;
    lastUserText.current = message;
    dispatch({ type: "user", text: message, at: new Date().toISOString() });
    void client.send(message);
  };
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    send(draft);
    setDraft("");
  };
  const last = chat.entries.at(-1);

  return (
    <div className="hh-app">
      <header className="hh-header">
        <h1>{state.harness.name[state.config.language ?? "en"]}</h1>
        <button onClick={() => setShowHistory(true)}>{t("history.title")}</button>
      </header>
      <div className="hh-body">
        <section className="hh-chat">
          {chat.entries.map((entry) => (
            <div key={entry.id}>
              <Message entry={entry} components={components} respond={send} />
              {entry.error && entry === last && (
                <ErrorCard error={entry.error} engine={engine} onRetry={() => send(lastUserText.current)} />
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
      <form className="hh-composer" onSubmit={onSubmit}>
        <textarea
          placeholder={t("chat.placeholder")}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) onSubmit(e);
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
      {showHistory && <HistoryPanel client={client} onClose={() => setShowHistory(false)} />}
    </div>
  );
}
