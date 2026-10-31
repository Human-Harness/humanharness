// The IPC channels between the window's preload and main (replaceable parts §5.3, D6): a renamed or mistyped
// channel fails at compile time. `Invoke`: what the preload asks with ipcRenderer.invoke — the wire arguments and
// what main answers. `Push`: what main sends with webContents.send — the payload. Channel names never change here.
// The plugin and tool realms (hh-plugin:rpc, hh-tools:rpc) have their own preloads and are not in this table.
import type { DataRecord, Language } from "@humanharness/harness-sdk";
import type { Event } from "@humanharness/engines";
import type { DataQueryResult, DataRequest } from "@humanharness/workspace";
import type { BackendClient, ConnectionsClient, ContextClient, EngineConfigClient, HarnessClient, JobsClient, MaterialClient, SearchClient, TasksClient, ToolsClient } from "./client";
import type {
  ApproveOptions,
  AttentionView,
  ConnectionsView,
  DataChangeView,
  DataOptions,
  FileRestoreAnswer,
  JobSummary,
  MaterialView,
  ModeChoice,
  ModeResult,
  PluginDataChange,
  PluginSurfaceView,
  PluginsView,
  ProfileResult,
  ProfilesState,
  ReviewResult,
  ScopesView,
  SearchAnswer,
  SearchFilters,
  SearchStatus,
  SendOptions,
  SettingsState,
  SetupOutput,
  SetupStepsState,
  SidekickState,
  TaskTurnNotice,
  TaskView,
  TasksState,
  TextSize,
  ToolsInfo,
} from "./views";

type H = HarnessClient;
type Documents = H["documents"];
type Files = H["files"];
type Scopes = H["scopes"];
type Settings = H["settings"];
type Sidekick = H["sidekick"];
type Plugins = H["plugins"];
type Attention = H["attention"];
type SetupSteps = H["setupSteps"];
type Profiles = H["profiles"];

export interface Invoke {
  "hh:getState": H["getState"];
  "hh:pickFolder": H["pickFolder"];
  "hh:saveConfig": H["saveConfig"];
  "hh:loadChat": H["loadChat"];
  /** `options` always goes (`{}` when the window gave none). */
  "hh:send": (message: string, options: SendOptions) => void;
  "hh:cancel": H["cancel"];
  "hh:restore": H["restore"];
  "hh:historyTasks": H["historyTasks"];
  "hh:restoreTask": H["restoreTask"];
  "hh:engineStatus": H["engineStatus"];
  "hh:acceptNotice": H["acceptNotice"];
  "hh:runSetup": H["runSetup"];
  "hh:setupInput": H["setupInput"];
  "hh:cancelSetup": H["cancelSetup"];
  "hh:getSetup": H["getSetup"];
  "hh:testEngine": H["testEngine"];
  "hh:revealSharedConfig": H["revealSharedConfig"];
  "hh:copyInstallCommand": H["copyInstallCommand"];
  "hh:copySetupCommand": H["copySetupCommand"];
  "hh:openTerminal": H["openTerminal"];
  "hh:resetSharedConfig": H["resetSharedConfig"];
  "hh:getUsage": H["getUsage"];
  "hh:revealFolder": H["revealFolder"];
  "hh:moveFolder": H["moveFolder"];
  "hh:getTasks": H["getTasks"];
  "hh:choose": H["choose"];
  "hh:respond": H["respond"];
  /** `choice` always goes (`{}` when the window gave none). */
  "hh:chooseMode": (mode: string, choice: ModeChoice) => ModeResult;
  "hh:setPhase": H["setPhase"];
  "hh:finishTask": H["finishTask"];
  "hh:pauseTask": H["pauseTask"];
  "hh:resumeTask": H["resumeTask"];
  "hh:extendTimeBox": H["extendTimeBox"];
  "hh:openPath": H["openPath"];
  "hh:revealPath": H["revealPath"];
  "hh:readDocument": H["readDocument"];
  "hh:readImage": H["readImage"];
  "hh:documentsExist": H["documentsExist"];
  /** The reader's watches (`watchDocument`): main's watch id, null when it made none. */
  "hh:watchDocument": (path: string) => number | null;
  "hh:unwatchDocument": (id: number) => void;
  "hh:reviewView": Documents["view"];
  /** Also `documents.review(path)`, as a list of one. */
  "hh:reviewSummaries": Documents["summaries"];
  "hh:reviewAnswer": Documents["answer"];
  "hh:reviewComment": Documents["comment"];
  "hh:reviewEditDraft": Documents["editDraft"];
  "hh:reviewReopen": Documents["reopen"];
  "hh:reviewSend": Documents["send"];
  /** `opts` always goes, with only the fields the window set. */
  "hh:reviewApprove": (path: string, blob: string, opts: ApproveOptions) => ReviewResult;
  "hh:reviewApprovedText": Documents["approvedText"];
  "hh:fileTimeline": Files["timeline"];
  "hh:fileDiff": Files["diff"];
  /** `files.restore` turns main's answer into "restored", "cancelled" or a refusal. */
  "hh:fileRestore": (path: string, commit: string) => FileRestoreAnswer;
  "hh:scopes": Scopes["list"];
  "hh:scopeCreate": Scopes["create"];
  "hh:scopeRename": Scopes["rename"];
  /** `scopes.archive` and `scopes.unarchive`. */
  "hh:scopeArchive": (id: string, archived: boolean) => void;
  "hh:scopeOpen": Scopes["open"];
  "hh:scopeCurrent": Scopes["current"];
  "hh:scopeLinked": Scopes["linked"];
  "hh:scopeLinkFolder": Scopes["linkFolder"];
  "hh:scopeUnlinkFolder": Scopes["unlinkFolder"];
  "hh:scopeConfirmGit": Scopes["confirmGit"];
  "hh:linkedHistory": Scopes["linkedHistory"];
  /** Every `data` call, as one request; the answer is the op's (a record or null, a query's result, a delete's boolean). */
  "hh:data": (request: DataRequest, options?: DataOptions) => DataRecord | DataQueryResult | boolean | null;
  "hh:dataDiff": H["dataDiff"];
  "hh:settingsGet": Settings["get"];
  "hh:settingsSet": Settings["set"];
  "hh:settingsReset": Settings["reset"];
  "hh:sidekickGet": Sidekick["get"];
  "hh:sidekickSet": Sidekick["set"];
  "hh:sidekickReview": Sidekick["review"];
  "hh:sidekickCancel": Sidekick["cancelReview"];
  "hh:sidekickResolve": Sidekick["resolve"];
  "hh:sidekickMute": Sidekick["mute"];
  "hh:sidekickUnmute": Sidekick["unmute"];
  "hh:sidekickSaveDecision": Sidekick["saveDecision"];
  "hh:sidekickLearned": Sidekick["learned"];
  "hh:sidekickForget": Sidekick["forget"];
  "hh:sidekickForgetAll": Sidekick["forgetAll"];
  "hh:sidekickEditLearned": Sidekick["editLearned"];
  "hh:sidekickBeforeApprove": Sidekick["beforeApprove"];
  "hh:sidekickApproveCancel": Sidekick["cancelApprove"];
  "hh:sidekickAsk": Sidekick["ask"];
  "hh:sidekickPresets": Sidekick["presets"];
  "hh:sidekickAdoptPreset": Sidekick["adoptPreset"];
  "hh:sidekickPickFiles": Sidekick["pickFiles"];
  "hh:sidekickImportDraft": Sidekick["importDraft"];
  "hh:sidekickCheckOriginal": Sidekick["checkOriginal"];
  "hh:sidekickSave": Sidekick["saveSidekick"];
  "hh:sidekickList": Sidekick["list"];
  "hh:sidekickRemove": Sidekick["remove"];
  "hh:sidekickReorder": Sidekick["reorder"];
  "hh:sidekickScope": Sidekick["scope"];
  "hh:sidekickSetScope": Sidekick["setScope"];
  "hh:pluginsGet": Plugins["get"];
  "hh:pluginsRescan": Plugins["rescan"];
  "hh:pluginsSetOn": Plugins["setOn"];
  "hh:pluginsPick": Plugins["pick"];
  "hh:pluginsAdd": Plugins["add"];
  "hh:pluginsApprove": Plugins["approve"];
  "hh:pluginsRemove": Plugins["remove"];
  "hh:pluginsDetail": Plugins["detail"];
  "hh:pluginsSetSetting": Plugins["setSetting"];
  "hh:pluginsResetSettings": Plugins["resetSettings"];
  "hh:pluginsSetWorkHours": Plugins["setWorkHours"];
  "hh:pluginsSetSecret": Plugins["setSecret"];
  "hh:pluginsDeleteSecret": Plugins["deleteSecret"];
  "hh:pluginsSetNotify": Plugins["setNotify"];
  "hh:pluginsTest": Plugins["test"];
  "hh:pluginsRefresh": Plugins["refresh"];
  "hh:pluginsSurface": Plugins["surface"];
  "hh:pluginsPanel": Plugins["panel"];
  "hh:pluginsStartPrepared": Plugins["startPrepared"];
  "hh:pluginsCancelPrepared": Plugins["cancelPrepared"];
  "hh:attentionGet": Attention["get"];
  "hh:attentionDismiss": Attention["dismiss"];
  "hh:attentionRead": Attention["read"];
  "hh:attentionOpen": Attention["open"];
  "hh:connectionsGet": ConnectionsClient["get"];
  "hh:connectionsSet": ConnectionsClient["set"];
  "hh:connectionsDelete": ConnectionsClient["delete"];
  "hh:connectionsTest": ConnectionsClient["test"];
  "hh:toolsCall": ToolsClient["call"];
  "hh:toolsTrace": ToolsClient["trace"];
  "hh:tasksList": TasksClient["list"];
  "hh:tasksFocus": TasksClient["focus"];
  "hh:tasksCancelQueued": TasksClient["cancelQueued"];
  "hh:tasksResume": TasksClient["resumeQueues"];
  "hh:jobsList": JobsClient["list"];
  "hh:jobsRun": JobsClient["run"];
  "hh:setupStepsGet": SetupSteps["get"];
  "hh:setupStepValues": SetupSteps["values"];
  "hh:setupStepSubmit": SetupSteps["submit"];
  "hh:setupStepComplete": SetupSteps["complete"];
  "hh:setupStepSkip": SetupSteps["skip"];
  "hh:setupStepsFinish": SetupSteps["finish"];
  "hh:setupStepsAcknowledge": SetupSteps["acknowledge"];
  "hh:profilesGet": Profiles["get"];
  "hh:profileCreate": Profiles["create"];
  "hh:profileOpen": Profiles["open"];
  /** `profiles.archive` and `profiles.unarchive`. */
  "hh:profileArchive": (id: string, archived: boolean) => ProfileResult;
  "hh:profileEdit": Profiles["edit"];
  "hh:profileDelete": Profiles["delete"];
  "hh:materialList": MaterialClient["list"];
  "hh:materialAdd": MaterialClient["add"];
  "hh:materialAddLink": MaterialClient["addLink"];
  "hh:materialConfirm": MaterialClient["confirm"];
  "hh:materialGrounding": MaterialClient["setGrounding"];
  "hh:materialRetry": MaterialClient["retry"];
  "hh:materialDecide": MaterialClient["decide"];
  "hh:materialRemove": MaterialClient["remove"];
  "hh:materialOpen": MaterialClient["open"];
  "hh:materialCite": MaterialClient["cite"];
  "hh:contextGet": ContextClient["get"];
  "hh:contextAdd": ContextClient["add"];
  "hh:contextPick": ContextClient["pick"];
  "hh:contextPin": ContextClient["pin"];
  "hh:contextUnpin": ContextClient["unpin"];
  "hh:contextExclude": ContextClient["exclude"];
  "hh:contextInclude": ContextClient["include"];
  /** `filters` always goes (`{}` when the window gave none). */
  "hh:search": (query: string, filters: SearchFilters) => SearchAnswer;
  "hh:searchOpen": SearchClient["opened"];
  // `client.language` checks every answer's shape before use.
  "hh:languageState": (harness: Record<string, unknown>) => unknown;
  "hh:languageChoose": (tag: Language, harness: Record<string, unknown>) => unknown;
  "hh:languageTranslate": (tag: Language, harness: Record<string, unknown>) => unknown;
  "hh:languageCancel": () => unknown;
  "hh:languageStrings": (tag: Language, harness: Record<string, unknown>) => unknown;
  "hh:backendCall": BackendClient["call"];
  "hh:backendState": BackendClient["state"];
  "hh:backendRestart": () => void;
  "hh:engineConfig": EngineConfigClient["get"];
  "hh:engineApprove": EngineConfigClient["approve"];
  "hh:engineRevoke": EngineConfigClient["revoke"];
}

export interface Push {
  "hh:event": Event;
  "hh:setupOutput": SetupOutput;
  "hh:tasks": TaskView;
  "hh:taskTurn": TaskTurnNotice;
  "hh:reviewChanged": string;
  /** The paths a commit touched; null: too many to list. The preload checks it. */
  "hh:fileCommits": unknown;
  "hh:documentChanged": number;
  "hh:documentWatchEnded": number;
  "hh:scopes": ScopesView;
  "hh:dataChange": DataChangeView;
  "hh:settings": SettingsState;
  "hh:sidekick": SidekickState;
  "hh:plugins": PluginsView;
  "hh:pluginSurface": PluginSurfaceView;
  "hh:pluginData": PluginDataChange;
  "hh:attention": AttentionView;
  "hh:connectionsChange": ConnectionsView;
  "hh:toolsChange": ToolsInfo;
  "hh:tasksChange": TasksState;
  "hh:jobsChange": JobSummary[];
  "hh:setupSteps": SetupStepsState;
  "hh:profiles": ProfilesState;
  "hh:materialStatus": MaterialView;
  /** `{ task, context }`; the preload checks it. */
  "hh:context": unknown;
  "hh:searchStatus": SearchStatus;
  "hh:textSize": TextSize;
  /** A `LanguageState`; the preload checks it. */
  "hh:language": unknown;
  /** `{ event, data }`; the preload checks it. */
  "hh:backendEvent": unknown;
  /** A `BackendState`; the preload checks it. */
  "hh:backendStateChange": unknown;
  "hh:engineConfigChanged": string | null;
}

export type InvokeChannel = keyof Invoke;
export type PushChannel = keyof Push;
export type InvokeArgs<C extends InvokeChannel> = Parameters<Invoke[C]>;
/** What main answers, unwrapped: `invoke` always returns a promise. */
export type InvokeResult<C extends InvokeChannel> = Awaited<ReturnType<Invoke[C]>>;
