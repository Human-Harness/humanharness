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
export { ContextPanel, type ContextPanelProps } from "./ContextPanel";
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
export { type ModLoader, type ModLoaderOptions, startModLoader } from "./layout/mod-loader";
export { BackupNotice, type FolderMove } from "./BackupNotice";
export { AppFooter, HHLogo, SettingsGear, type TagTone, TopBar } from "./chrome";
export { Hidden, Icon, Rx } from "./guide";
export { ownName, shownLanguage, systemLanguage } from "./language";
export { ProfileSwitcher } from "./ProfileSwitcher";
export { useCurrentWindows } from "./UsageMeter";
export { useTasks } from "./parallel/useTasks";
export type { SearchIntent } from "./search/intent";
