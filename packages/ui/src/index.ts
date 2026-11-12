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
