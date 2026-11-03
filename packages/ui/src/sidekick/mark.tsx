import { ICON_NAMES, type IconName, Icon } from "../guide/icons";

/** A stored or received mark as an icon name: anything that is not one (an old emoji, `"spark"`) reads as `coach`. */
export const markIcon = (mark: string | undefined): IconName => ((ICON_NAMES as readonly string[]).includes(mark ?? "") ? (mark as IconName) : "coach");

/**
 * A sidekick's mark (style guide §4, row 44): a 24 circle holding a 14 icon of the set, grey when the sidekick is off.
 * It takes only an icon name; `markIcon` turns a stored or received string into one.
 */
export function SidekickMark({ off, icon = "coach" }: { off?: boolean; icon?: IconName }) {
  return (
    <span className={`hh-sk-mark${off ? " hh-sk-mark-off" : ""}`} aria-hidden="true">
      <Icon name={icon} size={14} />
    </span>
  );
}
