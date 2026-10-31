// What the window can ask the core (replaceable parts §5): the preload implements these over IPC.
import type {
  ChoiceOption,
  DataKey,
  DataRecord,
  Language,
  RespondResult,
} from "@humanharness/harness-sdk";
import type { Event, ToolCallView } from "@humanharness/engines";
import type { DataQuery, DataQueryResult } from "@humanharness/workspace";
import type { AnswerPick, ReviewSummary } from "@humanharness/harness-sdk/review";
import type { GeneratedStrings } from "@humanharness/i18n";
import type { AppConfig, AppState, ApproveOptions, ApprovedText, AttentionTarget, AttentionView, BackendState, ChatLoad, CommentInput, ConnectionResult, ConnectionsView, ContextGetResult, ContextPick, ContextResult, DataChangeView, DataDiffView, DataOptions, DocumentRead, EngineApproveResult, EngineConfigView, EngineStatus, FileDiffResult, FileRestoreResult, FileTimelineResult, FocusState, FolderPick, GoBackResult, HistoryTaskView, JobSummary, LanguageChoose, LanguageStart, LanguageState, LinkRefusalView, LinkedHistoryView, LinkedView, MaterialAddResult, MaterialChoice, MaterialResult, MaterialView, ModeChoice, ModeResult, ModeSwitch, MoveResult, PanelAnswer, PanelCall, PhaseResult, PluginDataChange, PluginDetail, PluginPick, PluginResult, PluginSurfaceView, PluginTestResult, PluginWorkHours, PluginsView, ProfileResult, ProfilesState, ReviewResult, ReviewSendResult, ReviewView, RunningSetup, ScopeView, ScopesView, SearchAnswer, SearchFilters, SearchHitView, SearchStatus, SendOptions, SettingsResult, SettingsState, SetupOutput, SetupResult, SetupStep, SetupStepResult, SetupStepsState, SidekickApproveCheck, SidekickDraftDef, SidekickImportInput, SidekickImportResult, SidekickInScope, SidekickInfo, SidekickLearned, SidekickOriginal, SidekickOutcome, SidekickPick, SidekickPlaceAnswer, SidekickPreset, SidekickReview, SidekickSetResult, SidekickSettingsPatch, SidekickState, SidekickView, TaskContext, TaskTurnNotice, TaskView, TasksState, TestResult, TextSize, ToolCallResult, ToolsInfo, UndoRefusal, UsageSummary } from "./views";

/** `client.jobs`: a harness's background jobs (spec §9.1). Only with `state.jobs`: otherwise main refuses every call (D0). */
export interface JobsClient {
  list(): Promise<JobSummary[]>;
  /** "Run now": a declared manual job, in an existing scope (J4). False when it can't start (already queued, off). */
  run(id: string, scope?: string): Promise<boolean>;
  onChange(listener: (jobs: JobSummary[]) => void): () => void;
}

/** `client.context` (§5.2). Every answer is data. */
export interface ContextClient {
  get(taskId: string): Promise<ContextGetResult>;
  onChange(taskId: string, listener: (context: TaskContext) => void): () => void;
  /** §4.1: the open task reads `path` now. */
  add(taskId: string, path: string): Promise<ContextResult>;
  /** The system file dialog at the folder; the path comes back checked like a pin's. */
  pick(): Promise<ContextPick>;
  pin(scope: string, path: string): Promise<ContextResult>;
  unpin(scope: string, path: string): Promise<ContextResult>;
  exclude(scope: string, notePath: string): Promise<ContextResult>;
  include(scope: string, notePath: string): Promise<ContextResult>;
}

/** `client.search` (search spec §9). Every answer is data; nothing here ever reaches the engine (§8.3). */
export interface SearchClient {
  /** The results for `query`; an empty query answers the recents. The first call builds the index (D8). */
  query(query: string, filters?: SearchFilters): Promise<SearchAnswer>;
  /** The person opened `hit`: main remembers it among the recents, and shows a reference folder's file in Finder. */
  opened(hit: SearchHitView): Promise<{ ok: boolean }>;
  /** The index's progress while it builds ("Indexing… N of M"). */
  onStatus(listener: (status: SearchStatus) => void): () => void;
  /** Opens the palette, with `query` typed in (the top bar's button, a harness view). */
  open(query?: string): void;
  /** Every `open`, whoever called it: the window's palette listens. */
  onOpen(listener: (query?: string) => void): () => void;
}

/** A scope's engine config (hatches spec §5.3). Only with `state.hatches.enginePresets`; without, every call rejects (D0). */
export interface EngineConfigClient {
  /** Null: the scope has no engine config. */
  get(scope: string): Promise<EngineConfigView | null>;
  /** `hash` is the view's: what the person saw. */
  approve(scope: string, hash: string): Promise<EngineApproveResult>;
  /**
   * Revokes the scope's approval: new tasks start without its config, running ones drop it from their next turn, and
   * an old approval pasted back no longer counts. Resolves to the view afterwards (`approved: false`); null when the
   * scope has no engine config.
   */
  revoke(scope: string): Promise<EngineConfigView | null>;
  /** A scope's engine config (or its approval) changed; null: any scope may have. Returns the unsubscribe. */
  onChanged(listener: (scope: string | null) => void): () => void;
}

/** The harness's own backend (hatches spec §4). Harnesses without `backend`: every call rejects. */
export interface BackendClient {
  /** Rejects with the backend's error message, "The backend didn't answer in time" or "The backend isn't running". */
  call(method: string, params?: unknown): Promise<unknown>;
  /** Listens to one event the backend sends; returns the unsubscribe. */
  on(event: string, listener: (data: unknown) => void): () => void;
  /** Decision 1: a method, since values cross the bridge by copy. */
  state(): Promise<BackendState>;
  onState(listener: (s: BackendState) => void): () => void;
  /** From `failed`: starts it again. */
  restart(): Promise<void>;
}

/** `client.language` (language spec). Every answer is data; `harness` is the harness's English map (`locales.en`). */
export interface LanguageClient {
  state(harness: Record<string, unknown>): Promise<LanguageState | null>;
  /** English, or a language with a complete translation: saved and switched at once. */
  choose(tag: Language, harness: Record<string, unknown>): Promise<LanguageChoose>;
  /** Starts the run (after the notice); its progress comes through `onChange`. */
  translate(tag: Language, harness: Record<string, unknown>): Promise<LanguageStart>;
  cancel(): Promise<{ ok: boolean }>;
  strings(tag: Language, harness: Record<string, unknown>): Promise<GeneratedStrings>;
  onChange(listener: (state: LanguageState) => void): () => void;
}

export interface MaterialClient {
  /** Null without material. */
  list(scope: string): Promise<MaterialView | null>;
  /** Opens the main process's file dialog, then takes in each file picked. */
  add(scope: string): Promise<MaterialAddResult>;
  addLink(scope: string, url: string): Promise<MaterialAddResult>;
  confirm(scope: string, id: string, choice: { pageRange?: [number, number]; sheets?: string[] | "summary" }): Promise<MaterialResult>;
  setGrounding(scope: string, mode: "strict" | "mixed"): Promise<MaterialResult>;
  /** Try again: a source whose AI stage failed goes back to that stage. */
  retry(scope: string, id: string): Promise<MaterialResult>;
  /**
   * The person's answer to a question (`fragment` null: about the whole source). `use` on a source waiting for a full
   * review goes on without it.
   */
  decide(scope: string, id: string, fragment: string | null, choice: MaterialChoice): Promise<MaterialResult>;
  /** Removes a source: its original goes to the system Trash, its fragments go (also Cancel on a waiting one). */
  remove(scope: string, id: string): Promise<MaterialResult>;
  /** Opens the original of a source or a fragment's source. */
  open(scope: string, id: string): Promise<MaterialResult>;
  /** A citation's label, "<source>, <location>"; null: no such fragment in the scope (the text stays as it is). */
  cite(scope: string, id: string): Promise<{ label: string } | null>;
  onChange(listener: (view: MaterialView) => void): () => void;
}

/** Everything the renderer can ask the main process. Implemented by the preload as `window.hh`. */
export interface HarnessClient {
  getState(): Promise<AppState>;
  /** Null when the user cancelled the dialog. */
  pickFolder(defaultPath: string): Promise<FolderPick | null>;
  saveConfig(patch: AppConfig): Promise<AppState>;
  loadChat(): Promise<ChatLoad>;
  send(message: string, options?: SendOptions): Promise<void>;
  cancel(): Promise<void>;
  onEvent(listener: (event: Event) => void): () => void;
  /**
   * Makes the whole folder look as it did at `sha`, after main's native confirmation; recorded outside any task.
   * `cancelled`: the person said no, nothing changed.
   */
  restore(sha: string): Promise<GoBackResult>;
  /** The history grouped by task, newest first; the group of commits outside any task last. */
  historyTasks(): Promise<HistoryTaskView[]>;
  /**
   * Makes the folder look as it did before the task started (later tasks are undone too), after main's native
   * confirmation; recorded outside any task. `cancelled`: the person said no, nothing changed. Board mode (parallel
   * spec §5.3) takes back only the task's own files, and says why when it can't (`refused`).
   */
  restoreTask(taskId: string): Promise<GoBackResult | { refused: UndoRefusal }>;
  engineStatus(engineId: string): Promise<EngineStatus>;
  acceptNotice(engineId: string): Promise<void>;
  /** Runs the official install, update, login or logout; resolves when it exits. */
  runSetup(engineId: string, step: SetupStep): Promise<SetupResult>;
  /** Types one line into the running login (e.g. a code the sign-in page shows). */
  setupInput(text: string): Promise<void>;
  cancelSetup(): Promise<void>;
  onSetupOutput(listener: (output: SetupOutput) => void): () => void;
  /** The setup step running now, if any. */
  getSetup(): Promise<RunningSetup | null>;
  /** Sends a tiny prompt to check the engine works; marks it verified when it does. */
  testEngine(engineId: string): Promise<TestResult>;
  /** Copies the engine's official install command, for the user to paste in Terminal. */
  copyInstallCommand(engineId: string): Promise<void>;
  /** Copies the command for a step the person runs in Terminal (`terminalSteps`). */
  copySetupCommand(engineId: string, step: "login" | "logout"): Promise<void>;
  /** Opens the Terminal app (it runs nothing). */
  openTerminal(): Promise<void>;
  /** Shows ~/.humanharness/engines.json in Finder. */
  revealSharedConfig(): Promise<void>;
  /** Starts ~/.humanharness/engines.json over, keeping a dated copy of the old one. */
  resetSharedConfig(): Promise<void>;
  getUsage(): Promise<UsageSummary>;
  /** Shows the configured folder in Finder. */
  revealFolder(): Promise<void>;
  /** Moves the folder and its history to `to` (an absolute path that doesn't exist yet). Refused while a turn or a restore runs. */
  moveFolder(to: string): Promise<MoveResult>;
  /** The current task, how each action ended, and the notes. */
  getTasks(): Promise<TaskView>;
  onTasks(listener: (view: TaskView) => void): () => void;
  /**
   * The person picked an option of a `choices` block: a follow-up, another topic, or the next one on the path.
   * `task` is the task the block was shown for; a block of an earlier task is refused.
   */
  choose(option: ChoiceOption, task: string): Promise<void>;
  /**
   * The person's answer to input block `blockId` (input-blocks spec §4). Resolves with the refusal and its field
   * errors, or with the chat's line once the answer is taken; the agent's turn then arrives as events.
   */
  respond(blockId: string, value: Record<string, unknown>): Promise<RespondResult>;
  /**
   * The person picks a mode for the open task (task-modes spec §5): resolves with a refusal (with the tiers when the
   * mode asks for more) or with how the switch goes on; the switch's turn then arrives as events. `choice` answers the
   * tier question.
   */
  chooseMode(mode: string, choice?: ModeChoice): Promise<ModeResult>;
  /**
   * Every switch `chooseMode` started, whoever called it (the window's mode bar and blocks, or the harness's own UI),
   * told when its result arrives and before the switch's turn: the chat draws the "Switched to" line and that turn.
   */
  onModeSwitch(listener: (s: ModeSwitch) => void): () => void;
  /**
   * The person moves the open task `taskId` to phase `phaseId` (task-phases spec §4.2): resolves with a refusal or with
   * how the change goes on. A change turn then arrives as an `onTaskTurn` notice and its events.
   */
  setPhase(taskId: string, phaseId: string): Promise<PhaseResult>;
  /** Closes the open task now with the core closing turn (the stepper's Finish). False when it was stopped first. */
  finishTask(): Promise<boolean>;
  /** The time box's clock (spec §5): pause and resume; false when there was nothing to do. */
  pauseTask(): Promise<boolean>;
  resumeTask(): Promise<boolean>;
  /** "+5 min". */
  extendTimeBox(): Promise<boolean>;
  /** A turn the app starts on its own (a phase change, the wrap-up) is about to run: draw its line first. */
  onTaskTurn(listener: (n: TaskTurnNotice) => void): () => void;
  /** Opens a file inside the reference folders or the user's folder in its default app. False when refused or missing. */
  openPath(path: string): Promise<boolean>;
  /** Shows a file inside the reference folders or the user's folder in Finder (any kind of file). False when refused or missing. */
  revealPath(path: string): Promise<boolean>;
  /** A Markdown document inside the folder or a reference folder (document-reader spec §5.3). Never writes. */
  readDocument(path: string): Promise<DocumentRead>;
  /** A local image (png, jpeg, gif, webp) inside the folder or a reference folder, as a data: URL; null when refused. */
  readImage(path: string): Promise<string | null>;
  /** Whether each path is still there (a card of a moved or deleted file is struck through). */
  documentsExist(paths: string[]): Promise<boolean[]>;
  /** Calls `listener` after each change to the document; returns the unsubscribe. */
  watchDocument(path: string, listener: () => void): () => void;
  /** Opens a document in the reader panel, at the heading `anchor` when given (the harness's own UI may call it). */
  openDocument(path: string, anchor?: string): void;
  /** Every `openDocument`, whoever called it: the chat opens the panel. */
  onOpenDocument(listener: (path: string, anchor?: string) => void): () => void;
  /** Document reviews (review spec §5.6). Calls answer with data; only useful when `AppState.review` is set. */
  documents: {
    /** The record, its summary and the blob of the version read, for the reader. */
    view(path: string): Promise<ReviewView>;
    /** A harness view's summary of one document; null without a record or when it can't be read. */
    review(path: string): Promise<ReviewSummary | null>;
    summaries(paths: string[]): Promise<(ReviewSummary | null)[]>;
    answer(path: string, id: string, pick: AnswerPick): Promise<ReviewResult>;
    comment(path: string, input: CommentInput): Promise<ReviewResult>;
    /** Edits a draft, or deletes it with null. */
    editDraft(path: string, id: string, text: string | null): Promise<ReviewResult>;
    reopen(path: string, id: string): Promise<ReviewResult>;
    send(path: string): Promise<ReviewSendResult>;
    /** Approves the version shown: `blob` is the view's (a document changed since is refused with "changed"). */
    approve(path: string, blob: string, opts?: ApproveOptions): Promise<ReviewResult>;
    approvedText(path: string): Promise<ApprovedText>;
    /** Any review record or approval changed (`path`: its document). Returns the unsubscribe. */
    onChange(listener: (path: string) => void): () => void;
    /** Opens the document in the reader in focus mode (§6.2). */
    focus(path: string): void;
    /** Every `focus(path)`, whoever called it: the chat listens. */
    onFocus(listener: (path: string) => void): () => void;
  };
  /** Focus mode (§6.2): the chat sets it; a harness view listens to pause its own interruptions. */
  focus: {
    current(): FocusState;
    onChange(listener: (state: FocusState) => void): () => void;
    /** The core's chat only. */
    set(state: FocusState): void;
  };
  /** File timelines (file-timeline spec §6.3). Every call answers with data; main always confirms a go-back natively. */
  files: {
    /** The file's entries, newest first. */
    timeline(path: string): Promise<FileTimelineResult>;
    /** What changed between two commits, or from a commit to the file now ("current"); `from` null: nothing before. */
    diff(path: string, from: string | null, to: string | "current"): Promise<FileDiffResult>;
    /** Brings the file back to `commit` (an entry's `to`) after main's native confirmation; nothing else changes. */
    restore(path: string, commit: string): Promise<FileRestoreResult>;
    /** A commit touched `path`: its timeline has a new entry. Returns the unsubscribe. */
    onChange(path: string, listener: () => void): () => void;
  };
  /** Harnesses with scopes (spec §3.4). There is no delete: archive instead. */
  scopes: {
    list(): Promise<ScopeView[]>;
    create(title: string): Promise<ScopeView>;
    rename(id: string, title: string): Promise<ScopeView>;
    /** Archiving the open scope closes it first. */
    archive(id: string): Promise<void>;
    unarchive(id: string): Promise<void>;
    /** Opens a scope (null: none), closing the open task first; false when that close was stopped. */
    open(id: string | null): Promise<boolean>;
    current(): Promise<string | null>;
    onChange(listener: (view: ScopesView) => void): () => void;
    /** Harnesses with `linkedFolders` only; the others reject. The scope's links the app signed, and Decision 15's flag. */
    linked(scope: string): Promise<{ folders: LinkedView[]; unsupported: boolean }>;
    /** Opens the system picker; nothing is linked without the person choosing it. Null: cancelled. */
    linkFolder(scope: string, key: string): Promise<{ linked: LinkedView } | { refused: LinkRefusalView } | null>;
    /** Never touches the folder itself. */
    unlinkFolder(scope: string, key: string, path: string): Promise<void>;
    /** After a folder gained or lost git (Decision 13): keep it tracked or leave it to its git. */
    confirmGit(scope: string, key: string, path: string, tracked: boolean): Promise<void>;
    /** Harnesses with `linkedFolders` only: the open scope's linked folders as the History panel shows them. */
    linkedHistory(): Promise<LinkedHistoryView>;
  };
  /** The harness's data (spec §4.5), as the person: the same checks as the agent's tools. `settings` is read-only here: use `settings`. */
  data: {
    get(collection: string, key?: DataKey, options?: DataOptions): Promise<DataRecord | null>;
    query(collection: string, query?: DataQuery, options?: DataOptions): Promise<DataQueryResult>;
    put(collection: string, record: DataRecord, options?: DataOptions): Promise<DataRecord>;
    patch(collection: string, key: DataKey | undefined, patch: DataRecord, options?: DataOptions): Promise<DataRecord>;
    delete(collection: string, key?: DataKey, options?: DataOptions): Promise<boolean>;
    /** Every write to `collection` (in `scope`; null: any scope), from any writer. App-wide collections ignore the scope. */
    subscribe(collection: string, scope: string | null, listener: (change: DataChangeView) => void): () => void;
  };
  /** What a task changed in the harness's data ("what changed in this session", spec §4.5). */
  dataDiff(taskId: string): Promise<DataDiffView[]>;
  /** The harness's settings (harness-settings spec §4). A harness with none answers no values and refuses changes. */
  settings: {
    /** Every field's value (the default when unchanged) and the fields waiting for the next task. */
    get(): Promise<SettingsState>;
    /** Saves one field now, as the person. Refusals come back as data. */
    set(field: string, value: unknown): Promise<SettingsResult>;
    /** Every field back to its default. */
    reset(): Promise<SettingsResult>;
    onChange(listener: (state: SettingsState) => void): () => void;
  };
  /** Sidekick (sidekick spec): its state, settings and the pre-send review. */
  sidekick: {
    get(): Promise<SidekickState | null>;
    set(patch: SidekickSettingsPatch): Promise<SidekickSetResult>;
    /**
     * Reviews the prompt before it goes out; the composer sends as typed unless a card comes back or it was cancelled.
     * `attached`: the send carries attachments or material (mutes the missing-context flag). `block`: the text is a
     * block answer's free text, its card marked `block`.
     */
    review(req: { text: string; force?: boolean; attached?: boolean; block?: boolean }): Promise<SidekickReview>;
    /** Stops a running review (⌘⏎ sends at once). */
    cancelReview(): Promise<void>;
    /** What the person did with a card; it leaves the panel. */
    resolve(cardId: string, outcome: SidekickOutcome): Promise<void>;
    /** "Don't flag …": mutes the card's kind for its sidekick at once, and remembers it as the person's (spec §6.3). */
    mute(cardId: string): Promise<void>;
    /** Undoes a mute (Settings). */
    unmute(sidekick: string, kind: string): Promise<void>;
    /** "Save as decision" on a repeated-ask heads-up: a note written as the person; the card goes. */
    saveDecision(cardId: string): Promise<{ ok: boolean; message?: string }>;
    /** What Sidekick learned (spec §6.4), both levels. */
    learned(): Promise<SidekickLearned[]>;
    /** "Forget this": deletes one learned item, as the person. */
    forget(id: string): Promise<void>;
    /** "Forget everything": deletes every learned item of both levels, the person's too. */
    forgetAll(): Promise<void>;
    /** Edits from the person: their items become `source: "person"` (learning never changes them again). */
    editLearned(changes: { id: string; text: string }[]): Promise<void>;
    /**
     * For the document-review flow: call before approving; on a card, show it next to Approve (approve anyway stays
     * possible). Never waits longer than the person's wait setting; any failure answers `approve`.
     */
    beforeApprove(doc: { title: string; text: string }): Promise<SidekickApproveCheck>;
    /** The approval was answered or withdrawn: a running before-approve check stops (its answer is `approve`). */
    cancelApprove(): Promise<void>;
    /**
     * For a harness UI with places (spec §2a.5): asks the sidekick on for `place` (a manifest place id) about `content`
     * (at most 4,000 characters). A short plain-text answer and who gave it, never a card; `{ ok: false }` when Sidekick
     * is off, no sidekick answers there, or anything fails. The harness shows the answer in its place.
     */
    ask(place: string, content: string): Promise<SidekickPlaceAnswer>;
    /** "Suggested by the harness" (spec §2a.7): the manifest's presets, each with whether the person adopted it. */
    presets(): Promise<SidekickPreset[]>;
    /** "Add <name>": the preset becomes one of the person's sidekicks, and the presets count as offered. */
    adoptPreset(name: string): Promise<void>;
    /**
     * "Choose files" for an import: the system picker's choice as a token and the files' names (null when cancelled).
     * The paths stay in the app; nothing is read yet. Pass the token to importDraft, once, soon (a newer pick replaces it).
     */
    pickFiles(): Promise<SidekickPick | null>;
    /**
     * An import (spec §2a.6): pasted text (at most 64 KB), a pick's files (its token) or a stored sidekick's own
     * files again ("Bring the changes": `original`), at most 4 plain-text files of 64 KB, never inside an engine's
     * settings folder, turned into a draft sidekick and what it knows. Nothing is saved: the preview's Save does that.
     * Works with Sidekick off once the engine notice was accepted.
     */
    importDraft(input: SidekickImportInput): Promise<SidekickImportResult>;
    /** Whether an imported sidekick's files changed since ("The original changed"); `none` when it wasn't imported from files. */
    checkOriginal(sidekickId: string): Promise<SidekickOriginal>;
    /**
     * Saves a sidekick as the person: new without `def.id`, else every field of that one is replaced (send the full
     * def, `source` too). `learned`: the import's items, written as the person's. A files `source` must come from an
     * import (or be the one it already has). Rejects when it can't be written.
     */
    saveSidekick(def: SidekickDraftDef & { id?: string }, learned?: { text: string; level: "you" | "harness" }[]): Promise<SidekickInfo>;
    /** The person's sidekicks by order (Settings › Sidekicks); the implicit default alone when none was written. */
    list(): Promise<SidekickView[]>;
    /** Removes a sidekick, as the person; the last one stays (`ok: false` with why). */
    remove(id: string): Promise<{ ok: boolean; message?: string }>;
    /** Orders the sidekicks as `ids` (the higher one speaks when two could). */
    reorder(ids: string[]): Promise<void>;
    /** "Sidekicks in this <scope>" (spec §2a.4): every sidekick by order, on or off in `scope`, and its purpose text there. */
    scope(scope: string): Promise<SidekickInScope[]>;
    /**
     * A sidekick in a scope, as the person: on or off and its purpose text there (at most 600 characters; none when
     * absent). Send the `places` it had, or they are dropped. `ok: false` with why (e.g. the sidekick was removed).
     */
    setScope(scope: string, sidekick: string, v: { on: boolean; purposeText?: string; places?: string[] }): Promise<{ ok: boolean; message?: string }>;
    onChange(listener: (state: SidekickState) => void): () => void;
  };
  /**
   * Plugins (plugins spec §7). Only with `state.plugins`: a main without them registers none of these channels (D0).
   * Refusals come back as data.
   */
  plugins: {
    get(): Promise<PluginsView | null>;
    rescan(): Promise<PluginsView | null>;
    setOn(id: string, on: boolean): Promise<PluginResult>;
    /** Main shows the folder dialog itself; the renderer never sends a path. Pass the token to `add`, once, soon. */
    pick(): Promise<PluginPick>;
    add(token: string): Promise<PluginResult>;
    /** Approves what the review showed: send its `distHash` back (a plugin that changed since is refused). */
    approve(id: string, distHash: string): Promise<PluginResult>;
    remove(id: string): Promise<PluginResult>;
    detail(id: string): Promise<PluginDetail | null>;
    setSetting(id: string, field: string, value: unknown): Promise<PluginResult>;
    resetSettings(id: string): Promise<PluginResult>;
    setWorkHours(id: string, wh: PluginWorkHours): Promise<PluginResult>;
    /** Stores a key (at most 8,192 characters); its value never comes back, only whether it is stored (B6). */
    setSecret(id: string, secret: string, value: string): Promise<PluginResult>;
    deleteSecret(id: string, secret: string): Promise<PluginResult>;
    setNotify(id: string, on: boolean): Promise<PluginResult>;
    test(id: string): Promise<PluginTestResult[]>;
    /** Runs a source now; one at a time per source and a few per minute. */
    refresh(id: string, source: string): Promise<PluginResult>;
    onChange(listener: (view: PluginsView) => void): () => void;
    /** What the window draws for the running plugins: panels, chips, the prepared task (plugins part 2). */
    surface(): Promise<PluginSurfaceView>;
    /**
     * A panel's call (Decision 7), sent by the PanelFrame that made the frame: `plugin` and `panel` are the frame's,
     * never the message's. Main checks both again. A prepared task comes only from `requestAction` here.
     */
    panel(plugin: string, panel: string, call: PanelCall, args?: unknown): Promise<PanelAnswer>;
    /** The person's Start on the prepared card: only its token goes; main starts what the card showed. */
    startPrepared(token: string): Promise<PluginResult>;
    cancelPrepared(token: string): Promise<void>;
    onSurface(listener: (view: PluginSurfaceView) => void): () => void;
    /** A run wrote these collections: a signal only, panels query again (Decision 8). */
    onPluginData(listener: (change: PluginDataChange) => void): () => void;
  };
  /** The Attention inbox (plugins spec §6). Only with `state.plugins` (D0). */
  attention: {
    get(): Promise<AttentionView | null>;
    dismiss(plugin: string, key: string): Promise<void>;
    /** No arguments: every item; a plugin: its items; both: that one. */
    read(plugin?: string, key?: string): Promise<void>;
    /** A click on an item in the core's inbox: marks it read and answers what to open (Decision 12). */
    open(plugin: string, key: string): Promise<AttentionTarget>;
    onChange(listener: (view: AttentionView) => void): () => void;
  };
  /** The harness's secrets, Settings › Connections (tools spec §9). Only with `state.connections` (D0). */
  connections: ConnectionsClient;
  /** The harness's tools (tools spec §5). Only with `state.tools`; without, every call rejects (D0). */
  tools: ToolsClient;
  /** The harness's setup steps (setup-steps spec). A harness with none answers no steps and refuses every change. */
  setupSteps: {
    get(): Promise<SetupStepsState>;
    /** A form step's current values: the record's fields it asks for, or the settings' values. */
    values(id: string): Promise<Record<string, unknown>>;
    /** A form step's Next: saved through the same checks as any write. Refusals come back as data. */
    submit(id: string, value: Record<string, unknown>): Promise<SetupStepResult>;
    /** An interview's end (its task closed, its record valid) or a component's `done()`. */
    complete(id: string): Promise<SetupStepResult>;
    skip(id: string): Promise<SetupStepResult>;
    /** The setup screen reached "All set". */
    finish(): Promise<SetupStepsState>;
    /** Settings showed the list: steps a harness update added count from now on. */
    acknowledge(): Promise<SetupStepsState>;
    onChange(listener: (state: SetupStepsState) => void): () => void;
  };
  /** The harness's profiles (profiles spec §5). A harness with none answers none and refuses every change. */
  profiles: {
    get(): Promise<ProfilesState>;
    /** A new profile from the form's fields; it becomes the active one (the open task closes first). */
    create(values: Record<string, unknown>): Promise<ProfileResult>;
    /** Switches to a profile (the open task closes first). */
    open(id: string): Promise<ProfileResult>;
    /**
     * Saves the edit form's fields to the active profile's record, as the person. A field sent with no value is cleared;
     * refusals come back by field (`errors`).
     */
    edit(values: Record<string, unknown>): Promise<ProfileResult>;
    archive(id: string): Promise<ProfileResult>;
    unarchive(id: string): Promise<ProfileResult>;
    /** Puts a profile's folder and history in the system Trash. Never the active one. */
    delete(id: string): Promise<ProfileResult>;
    onChange(listener: (state: ProfilesState) => void): () => void;
  };
  /** The person's material (material spec §10). A harness without material answers null and "not-ready". */
  material: MaterialClient;
  /** What the agent takes into account (context-panel spec §5.2). */
  context: ContextClient;
  /** Language on demand (plan 5b). Absent in a client that predates it: the Language row stays read-only (D0). */
  language?: LanguageClient;
  /** The text size changed from the keyboard (⌘+, ⌘−, ⌘0), already saved. */
  onTextSize(listener: (size: TextSize) => void): () => void;
  /** Open tasks (parallel spec §9.1). Only with `state.parallel`: in plain mode main refuses every call and sends no change (D0). */
  tasks: TasksClient;
  /** Background jobs (parallel spec §9.1). Only with `state.jobs` (D0). */
  jobs: JobsClient;
  /** The harness's backend (hatches spec §4). Only with `state.hatches.backend`; without, every call rejects (D0). */
  backend: BackendClient;
  /** A scope's engine config (hatches spec §5.3). Only with `state.hatches.enginePresets` (D0). */
  engineConfig: EngineConfigClient;
}

/** `client.tasks`: the open tasks of a harness that declares `parallel` (spec §9.1). */
export interface TasksClient {
  list(): Promise<TasksState>;
  onChange(listener: (state: TasksState) => void): () => void;
  /** null: the start view. */
  focus(id: string | null): Promise<void>;
  /** Takes a queued message out; its text, for the box (Decision 7). Null when it already started. */
  cancelQueued(id: string): Promise<string | null>;
  /** Resumes the queues paused by an out-of-quota end (spec §7). */
  resumeQueues(): Promise<void>;
}

/** Settings › Connections (tools spec §9). Only with `state.connections`: a main without secrets registers none (D0). */
export interface ConnectionsClient {
  get(): Promise<ConnectionsView | null>;
  /** Stores a key (at most 8,192 characters once trimmed); its value never comes back. */
  set(id: string, value: string): Promise<ConnectionResult>;
  delete(id: string): Promise<ConnectionResult>;
  /** Runs the key's test tool once (only for a key whose view says `test`); ok, or the error to show. */
  test(id: string): Promise<ConnectionResult>;
  onChange(listener: (view: ConnectionsView) => void): () => void;
}
/** The harness's tools (tools spec §5). Only with `state.tools`; without, every call rejects (D0). */
export interface ToolsClient {
  /** Runs tool `id` as the UI (caller "ui"), in the open scope (or none), with no task. Refusals come back as data. */
  call(id: string, args?: unknown): Promise<ToolCallResult>;
  /** A task's or a job run's calls, oldest first. */
  trace(id: string): Promise<ToolCallView[]>;
  /** Main's tools info changed (the host started, or went off after repeated crashes). */
  onChange(listener: (info: ToolsInfo) => void): () => void;
}
