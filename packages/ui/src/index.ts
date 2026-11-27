import { Group, Row, SecondaryPage, SectionHead } from "./guide";
export * from "./client";
export * from "./state";
export * from "./usage";
// The app's one Radix Themes root; the shell wraps the harness App in it (Radix + Impeccable spec §3).
export { HhTheme } from "./guide/Theme";
export { ScopePicker } from "./ScopePicker";
export { ScopeSettings } from "./hatches/ScopeSettings";
export { type UseBackend, useBackend } from "./hatches/useBackend";
export { PhaseStepper } from "./PhaseStepper";
export { HarnessApp, type HarnessAppProps } from "./HarnessApp";
// Mods' blocks the layout places (minimal-core spec §5.2); `app` is typed for core mods only until step 0b2.
export { type BlockComponent, type BlockProps as ModBlockProps, type BlockRegistry, ModBlocksProvider, blockFor, createBlockRegistry, registerBlock } from "./layout/registry";
export { LanguagePicker } from "./LanguagePicker";
export { TranslateNotice } from "./TranslateNotice";
export { LanguageChooser } from "./LanguageChooser";
export { type LanguageControl, useLanguage } from "./language-control";
// A harness's own legal blocks (keys under `legal.`, Decision 13) use these: lang="en" and the "shown in English" line.
export { LegalInEnglish, useLegalLang } from "./EngineOnboarding";
export { MaterialPanel, type MaterialPanelProps, useMaterial } from "./MaterialPanel";
export { PluginSlot } from "./plugins/PluginSlot";
export { FileTimeline, type FileTimelineProps } from "./FileTimeline";
export { FileDiff, type FileDiffProps, type DiffLayout } from "./FileDiff";
export type { BlockActions, BlockProps, InputContext, InputProps } from "./Message";
export { AnswerView, InputForm, type InputFormProps } from "./InputForm";
export type { StartViewCopy } from "./StartView";
export type { SendFn } from "./ChatView";
export { Markdown, type MarkdownProps } from "./markdown";
export { DocumentContext, type DocumentHost } from "./documents-context";
// What the core mods' blocks build with (minimal-core step 0b1): the app they get, and the core's pieces Home uses.
export { type AppValue, useApp } from "./layout/app";
// The window runs the ui part of each on, non-core mod (minimal-core 0b2).
export { type ModLoader, type ModLoaderOptions, type UiCtx as CoreUiCtx, startModLoader } from "./layout/mod-loader";
// A core mod's task-view pieces (minimal-core step 1b): the open task view they act on, and what a reviewer may add.
export { type TaskViewValue, useTaskView } from "./task-view/context";
export type { TaskReviewer } from "./task-view/review";
export type { ModelsRowProps, OverlayButtonProps, OverlayPanelProps, RowProps, SettingsAppProps, SettingsTabProps, TaskBarProps, UsageRowProps } from "./layout/registry";
export type { AnswerHold } from "./InputForm";
export { BackupNotice, type FolderMove } from "./BackupNotice";
export { AppFooter, HHLogo, SettingsGear, Tag, type TagTone, TopBar } from "./chrome";
export { Hidden, Icon, IconButton, Rx } from "./guide";
// The History entry labels and day grouping the file timeline also uses; the History panel (a core mod) builds with them.
export { byDay, entryLabel, sameDay } from "./history-labels";
// Core-only guide pieces for the core mods (not in hh.d.ts).
export { Button, ICON_NAMES, type IconName, Segmented } from "./task-view/pieces";
// The History panel's page shell: imported, then exported, so it stays out of hh.d.ts like Settings' pieces below.
export { SecondaryPage };
// A core mod's Settings tab builds with Settings' own pieces: imported, then exported, so hh-dts (which publishes only
// `export … from "./guide…"`) keeps them core-only.
export { Group, Row, SectionHead };
export { ownName, shownLanguage, systemLanguage } from "./language";
export { ProfileSwitcher } from "./ProfileSwitcher";
export { useCurrentWindows } from "./UsageMeter";
// Settings › Usage (a core mod) builds with the Models tab's rows, the profile helpers and the slot boundary.
export { QUESTIONS, taskRows } from "./ModelsTab";
export { shownTitle, useProfiles } from "./ProfileSwitcher";
export { SlotBoundary } from "./layout/BlockBoundary";
export { useBlocks } from "./layout/registry";
export { useTasks } from "./parallel/useTasks";
export type { SearchIntent } from "./search/intent";
