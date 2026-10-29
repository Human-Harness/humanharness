import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { AppState, CurrentTaskView, HarnessClient } from "../client";
import { ScopeSettings } from "./ScopeSettings";

/**
 * Under the task header (hatches spec §5.3): the task runs without its scope's engine config, because it isn't
 * approved (or changed since), or because it holds something the app refuses. "Review" opens that scope's settings
 * at the Engine config section. Main sends `engineNotice` only for a harness with `enginePresets` (D0: nothing here).
 */
export function EngineNotice({
  client,
  state,
  scope,
  notice,
}: {
  client: HarnessClient;
  state: AppState;
  scope: string;
  notice: NonNullable<CurrentTaskView["engineNotice"]>;
}) {
  const { t } = useTranslation();
  /** The scope's title while its settings show. */
  const [open, setOpen] = useState<string | null>(null);
  const review = async () => {
    const list = await client.scopes.list().catch(() => []);
    setOpen(list.find((s) => s.id === scope)?.title ?? scope);
  };
  return (
    <p className="hh-engine-notice" role="status">
      <span>{t(notice === "refused" ? "hatches.engineNotUsed" : "hatches.engineNotApproved")}</span>
      {" · "}
      <button type="button" className="hh-link" onClick={() => void review()}>
        {t("hatches.engineReview")}
      </button>
      {open !== null && <ScopeSettings client={client} state={state} scope={scope} title={open} focusEngine onClose={() => setOpen(null)} />}
    </p>
  );
}
