import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import type { BlockProps } from "./Message";
import { ModeList } from "./ModeList";
import { readRecommendation } from "./modes";
import { Button } from "./guide/Button";
import { Option, OptionGroup } from "./guide/Option";

/**
 * The core `recommend_mode` block (task-modes spec §4): the agent's recommendation first, with its reasons, then the
 * alternatives, then every mode of the action. A pick goes to the app, which switches the task's mode.
 */
export function RecommendModeBlock({ data, chooseMode, modes, active }: BlockProps) {
  const { t } = useTranslation();
  const id = useId();
  const allId = useId();
  const allListId = useId();
  const [picked, setPicked] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  if (!modes) return null;
  // Only the action's modes the window knows: an id the app state doesn't describe is never drawn.
  const views = modes.views;
  const allowed = modes.allowed.filter((m) => Object.hasOwn(views, m));
  const r = readRecommendation(data, allowed);
  if (!r) return null;
  const usable = active && chooseMode !== undefined && picked === null;
  const pick = (m: string) => {
    // Marked only once sent: a switch waiting for the tier answer (or refused) leaves every mode usable.
    if (chooseMode?.(m)) setPicked(m);
  };
  return (
    <section className="hh-choices">
      <h3 id={id}>{t("modes.recommendTitle")}</h3>
      <OptionGroup labelledBy={id}>
        <Option
          recommended
          checked={picked === r.recommended}
          disabled={!usable}
          title={views[r.recommended].label}
          tag={<span className="hh-badge">{t("modes.recommended")}</span>}
          description={r.reasons.map((reason, i) => (
            <span key={i}>{reason}</span>
          ))}
          onClick={() => pick(r.recommended)}
        />
        {r.alternatives.map((a) => (
          <Option key={a.mode} checked={picked === a.mode} disabled={!usable} title={views[a.mode].label} description={<span>{a.why}</span>} onClick={() => pick(a.mode)} />
        ))}
      </OptionGroup>
      <Button
        type="button"
        id={allId}
        kind="quiet" size="compact"
        aria-expanded={all}
        aria-controls={all ? allListId : undefined}
        onClick={() => setAll((x) => !x)}
      >
        {t("modes.seeAll")}
      </Button>
      {all && (
        <ModeList
          id={allListId}
          modes={allowed.map((m) => ({ id: m, ...views[m] }))}
          current={picked ?? modes.current}
          disabled={!usable}
          labelledBy={allId}
          onPick={pick}
        />
      )}
    </section>
  );
}
