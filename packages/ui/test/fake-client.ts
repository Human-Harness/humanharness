import type {
  AppConfig,
  AppState,
  ChatEntry,
  EngineError,
  EngineStatus,
  Event,
  FolderPick,
  HarnessClient,
  HistoryItem,
  SendOptions,
  SetupOutput,
  SetupStep,
  UsageSummary,
} from "../src/client";

export class FakeClient implements HarnessClient {
  state: AppState;
  sent: string[] = [];
  sentOptions: SendOptions[] = [];
  restored: string[] = [];
  cancelled = 0;
  chat: ChatEntry[] = [];
  switchedFrom: string | undefined;
  items: HistoryItem[] = [{ sha: "abc", message: "Turn: hi", date: "2026-10-10T12:00:00.000Z" }];
  sendError: Error | null = null;
  saveError: Error | null = null;
  restoreError: Error | null = null;
  pickResult: FolderPick | null = { folder: "/Users/me/Elsewhere", problem: null };
  stateError: Error | null = null;
  getStateCalls = 0;
  loadChatGate: Promise<void> | null = null;
  /** Engine status returned by engineStatus (any engine id); setup steps update it. */
  status: EngineStatus = {
    engineId: "claude",
    installed: true,
    version: "2.1.296",
    minVersion: "2.1.296",
    outdated: false,
    loggedIn: true,
    noticeAccepted: true,
    verified: true,
  };
  accepted: string[] = [];
  setupRuns: { engineId: string; step: SetupStep }[] = [];
  setupResult = { ok: true };
  /** When set, runSetup waits for it (a login in progress). */
  setupGate: Promise<void> | null = null;
  setupInputs: string[] = [];
  setupCancelled = 0;
  tested: string[] = [];
  testResult: { ok: boolean; error?: EngineError } = { ok: true };
  usage: UsageSummary = { limits: null, estimates: {} };
  revealed = 0;
  private listeners = new Set<(e: Event) => void>();
  private setupListeners = new Set<(o: SetupOutput) => void>();

  constructor(config: AppConfig = {}) {
    this.state = {
      harness: {
        id: "demo",
        name: { es: "Demo", en: "Demo" },
        languages: ["es", "en"],
        tagline: { es: "Notas de prueba", en: "Test notes" },
        author: "Marco Zanger",
        donate: "https://example.com/donate",
        version: "0.1.0",
      },
      config,
      suggestedFolder: "/Users/me/Documents/Demo",
      engines: [
        {
          id: "claude",
          name: "Claude",
          status: "allowed",
          provider: "Anthropic",
          requires: { es: "Plan Pro", en: "Pro plan" },
          dataLocation: { es: "EE. UU.", en: "USA" },
          trainsOnData: { es: "Según tu configuración", en: "Depends on your settings" },
          termsUrl: "https://example.com/terms",
          privacyUrl: "https://example.com/privacy",
          reportsLimits: true,
          installCommand: "curl -fsSL https://claude.ai/install.sh | bash",
          installDocsUrl: "https://code.claude.com/docs/en/setup",
          logo: "data:image/svg+xml;base64,PHN2Zy8+",
        },
      ],
      actions: {},
    };
  }

  emit(e: Event) {
    for (const l of this.listeners) l(e);
  }
  emitSetup(o: SetupOutput) {
    for (const l of this.setupListeners) l(o);
  }

  async getState() {
    this.getStateCalls++;
    if (this.stateError) throw this.stateError;
    return this.state;
  }
  async pickFolder() {
    return this.pickResult;
  }
  async saveConfig(patch: AppConfig) {
    if (this.saveError) throw this.saveError;
    this.state = { ...this.state, config: { ...this.state.config, ...patch } };
    return this.state;
  }
  async loadChat() {
    if (this.loadChatGate) await this.loadChatGate;
    return { entries: this.chat, ...(this.switchedFrom ? { switchedFrom: this.switchedFrom } : {}) };
  }
  async send(message: string, options: SendOptions = {}) {
    this.sent.push(message);
    this.sentOptions.push(options);
    if (this.sendError) throw this.sendError;
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
    if (this.restoreError) throw this.restoreError;
    this.restored.push(sha);
  }
  async engineStatus(engineId: string) {
    return { ...this.status, engineId };
  }
  async acceptNotice(engineId: string) {
    this.accepted.push(engineId);
    this.status = { ...this.status, noticeAccepted: true };
  }
  async runSetup(engineId: string, step: SetupStep) {
    this.setupRuns.push({ engineId, step });
    if (this.setupGate) await this.setupGate;
    if (this.setupResult.ok) {
      if (step === "install") this.status = { ...this.status, installed: true };
      if (step === "update") this.status = { ...this.status, outdated: false };
      if (step === "login") this.status = { ...this.status, loggedIn: true };
      if (step === "logout") this.status = { ...this.status, loggedIn: false };
    }
    return this.setupResult;
  }
  async setupInput(text: string) {
    this.setupInputs.push(text);
  }
  async cancelSetup() {
    this.setupCancelled++;
  }
  onSetupOutput(listener: (o: SetupOutput) => void) {
    this.setupListeners.add(listener);
    return () => this.setupListeners.delete(listener);
  }
  async testEngine(engineId: string) {
    this.tested.push(engineId);
    if (this.testResult.ok) this.status = { ...this.status, verified: true };
    return this.testResult;
  }
  async getUsage() {
    return this.usage;
  }
  async revealFolder() {
    this.revealed++;
  }
}
