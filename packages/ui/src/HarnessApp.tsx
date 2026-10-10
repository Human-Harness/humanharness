import { type ComponentType, type ReactNode, useEffect, useState } from "react";
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

  useEffect(() => {
    void client.getState().then(async (s) => {
      const preferred = s.config.language ?? (navigator.language.startsWith("es") ? "es" : "en");
      const language = s.harness.languages.includes(preferred) ? preferred : s.harness.languages[0];
      setI18n(await createI18n(language, locales));
      setState(s);
    });
  }, [client, locales]);

  if (!state || !i18n) return null;
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
