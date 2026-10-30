import { type ReactNode, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ToolCallView } from "../client";

/**
 * An entry's leading pre-step calls (tools spec §8.2, Decision 8): one folded line "Prepared N items · S s · 0 tokens"
 * that unfolds to each call's line (`children`), notes included. N counts the distinct tools of the calls that aren't
 * notes (a forEach step's calls count once); S is the sum of their times. It starts unfolded when a call failed.
 */
export function PreparedGroup({ calls, children }: { calls: ToolCallView[]; children: ReactNode }) {
  const { t } = useTranslation();
  const steps = calls.filter((c) => c.note === undefined);
  // Open while a call failed, even one that arrives after the group was drawn (live calls come one by one), until the
  // person folds or unfolds it.
  const failed = steps.some((c) => !c.ok);
  const [toggled, setToggled] = useState<boolean | null>(null);
  const open = toggled ?? failed;
  const details = useId();
  // Only notes (no call to count): they are drawn as they are, never as "Prepared 0 items".
  if (steps.length === 0) return <>{children}</>;
  const count = new Set(steps.map((c) => c.tool)).size;
  const seconds = (steps.reduce((n, c) => n + Math.max(0, c.ms), 0) / 1000).toFixed(1);
  return (
    <div className="hh-tool-group">
      <button type="button" className="hh-tool-line" aria-expanded={open} aria-controls={details} onClick={() => setToggled(!open)}>
        {t("tools.prepared", { count, seconds })}
      </button>
      {/* Always in the page, so aria-controls names it even when folded. */}
      <div id={details} className="hh-tool-group-list" hidden={!open}>
        {children}
      </div>
    </div>
  );
}
