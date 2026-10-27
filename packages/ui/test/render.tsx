import type { ReactElement } from "react";
import { configure, render } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { createI18n } from "@humanharness/i18n";

// findBy*/waitFor give up after asyncUtilTimeout of wall-clock time (1 s by default) and don't check once more when it
// fires. Under the full suite's load a worker can stall past that while the screen is already right (role queries in
// happy-dom are slow), so a long flow failed now and then. A wider window changes no assertion: what a test waits for
// still has to appear, and a real failure only takes longer to report (well within the 30 s test timeout).
configure({ asyncUtilTimeout: 10_000 });

/** Renders `ui` with the core strings in `language`, like HarnessApp does. */
export async function renderIn(language: string, ui: ReactElement) {
  const i18n = await createI18n(language);
  return { i18n, ...render(<I18nextProvider i18n={i18n}>{ui}</I18nextProvider>) };
}
