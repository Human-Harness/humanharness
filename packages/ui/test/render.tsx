import type { ReactElement } from "react";
import { render } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { createI18n } from "@humanharness/i18n";

/** Renders `ui` with the core strings in `language`, like HarnessApp does. */
export async function renderIn(language: string, ui: ReactElement) {
  const i18n = await createI18n(language);
  return { i18n, ...render(<I18nextProvider i18n={i18n}>{ui}</I18nextProvider>) };
}
