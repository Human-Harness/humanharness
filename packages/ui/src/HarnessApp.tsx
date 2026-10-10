import { type ComponentType, type ReactNode, useEffect, useRef, useState } from "react";
import { I18nextProvider } from "react-i18next";
import type { i18n } from "i18next";
import { type Locales, createI18n } from "@humanharness/i18n";
import { ChatView } from "./ChatView";
import { type AppState, type HarnessClient, isConfigured } from "./client";
import type { BlockProps } from "./Message";
import { SetupScreen } from "./SetupScreen";

export interface HarnessAppProps {
  client: HarnessClient;
  blocks?: Record<string, ComponentType<BlockProps>>;
  stateBlocks?: string[];
  renderSide?: (blockState: Record<string, unknown>) => ReactNode;
  locales?: Locales;
}

export function HarnessApp({ client, blocks = {}, stateBlocks = [], renderSide, locales }: HarnessAppProps) {
  const [state, setState] = useState<AppState | null>(null);
  const [i18n, setI18n] = useState<i18n | null>(null);
  const [failed, setFailed] = useState(false);
  // Read through a ref so inline `locales` objects don't re-run the load.
  const localesRef = useRef(locales);
  localesRef.current = locales;

  useEffect(() => {
    let cancelled = false;
    const systemLanguage = navigator.language.startsWith("es") ? "es" : "en";
    void (async () => {
      try {
        const s = await client.getState();
        const preferred = s.config.language ?? systemLanguage;
        const language = s.harness.languages.includes(preferred) ? preferred : s.harness.languages[0];
        const instance = await createI18n(language, localesRef.current);
        if (cancelled) return;
        setI18n(instance);
        setState(s);
      } catch {
        const instance = await createI18n(systemLanguage, localesRef.current);
        if (cancelled) return;
        setI18n(instance);
        setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client]);

  if (failed && i18n) {
    return (
      <p className="hh-load-error" role="alert">
        {i18n.t("app.loadError")}
      </p>
    );
  }
  if (!state || !i18n) return <div className="hh-loading" role="status" aria-busy="true" />;
  return (
    <I18nextProvider i18n={i18n}>
      {isConfigured(state.config) ? (
        <ChatView client={client} state={state} components={blocks} stateBlocks={stateBlocks} renderSide={renderSide} />
      ) : (
        <SetupScreen client={client} state={state} onDone={setState} />
      )}
    </I18nextProvider>
  );
}
