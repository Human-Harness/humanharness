import { useTranslation } from "react-i18next";
import { Button } from "../guide/Button";
import { Icon } from "../guide/icons";
import type { LiveActivity } from "../state";

/** What the turn is doing now, in words: the newest step still running, else the newest one. */
export function stepOf(activities: readonly Pick<LiveActivity, "kind" | "detail" | "done">[], t: (key: string, o?: Record<string, unknown>) => string): string | null {
  const a = activities.findLast((x) => !x.done) ?? activities.at(-1);
  return a ? t(`activity.${a.kind}`, { detail: a.detail }) : null;
}

/**
 * The one working line of a turn (task view one column): "Working · <step>" and Stop, 44 high, pinned to the bottom
 * of the conversation card in the chat and of the page content elsewhere. Only the words are the live region: Stop
 * is not read out with every step.
 */
export function WorkingLine({ step, onStop }: { step: string | null; onStop: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="hh-working-line">
      <Icon name="loading" size={14} />
      <span role="status" className="hh-working-text">
        {step ? t("chat.workingStep", { step, defaultValue: "Working · {{step}}" }) : t("home.status.working")}
      </span>
      <Button kind="secondary" size="compact" onClick={onStop}>
        {t("chat.stop")}
      </Button>
    </div>
  );
}
