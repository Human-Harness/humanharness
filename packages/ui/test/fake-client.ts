import type { AppConfig, AppState, ChatEntry, Event, HarnessClient, HistoryItem } from "../src/client";

export class FakeClient implements HarnessClient {
  state: AppState;
  sent: string[] = [];
  restored: string[] = [];
  cancelled = 0;
  chat: ChatEntry[] = [];
  items: HistoryItem[] = [{ sha: "abc", message: "Turn: hi", date: "2026-10-10T12:00:00.000Z" }];
  private listeners = new Set<(e: Event) => void>();

  constructor(config: AppConfig = {}) {
    this.state = {
      harness: { id: "demo", name: { es: "Demo", en: "Demo" }, languages: ["es", "en"] },
      config,
      suggestedFolder: "/Users/me/Documents/Demo",
      engines: [
        { id: "claude", name: "Claude", status: "allowed", requires: { es: "Plan Pro", en: "Pro plan" }, dataLocation: { es: "EE. UU.", en: "USA" } },
      ],
    };
  }

  emit(e: Event) {
    for (const l of this.listeners) l(e);
  }

  async getState() {
    return this.state;
  }
  async pickFolder() {
    return "/Users/me/Elsewhere";
  }
  async saveConfig(patch: AppConfig) {
    this.state = { ...this.state, config: { ...this.state.config, ...patch } };
    return this.state;
  }
  async loadChat() {
    return this.chat;
  }
  async send(message: string) {
    this.sent.push(message);
  }
  async cancel() {
    this.cancelled++;
  }
  onEvent(listener: (e: Event) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  async history() {
    return this.items;
  }
  async restore(sha: string) {
    this.restored.push(sha);
  }
}
