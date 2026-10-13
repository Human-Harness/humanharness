/**
 * What a harness's screen imports (`HarnessApp`, `BlockProps`, `useTranslation`…): a harness repo depends on
 * @humanharness/cli only. The shell's renderer build dedupes React and i18n, so there is one copy of each.
 */
export * from "@humanharness/ui";
export { useTranslation } from "react-i18next";
