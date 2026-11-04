import { type ButtonHTMLAttributes, type ReactNode, useId } from "react";

export interface ToggleProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "role" | "type" | "onChange" | "children"> {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Visible text before the switch, which sits at the end of the row (answer C4). It names the switch, and clicking it flips the switch. Leave it out when a `label` element, `aria-label` or a settings row names the switch. */
  children?: ReactNode;
}

/**
 * The one toggle (style guide §5 Toggle, 20 × 34): turn on or off something that acts at once.
 * A `button` with `role="switch"`. Several from a list are Toggles too, one per row.
 */
export function Toggle({ checked, onChange, children, className, onClick, ...rest }: ToggleProps) {
  const textId = useId();
  const labelled = children != null;
  const button = (
    <button
      type="button"
      aria-labelledby={labelled ? textId : undefined}
      {...rest}
      role="switch"
      aria-checked={checked}
      className={className ? `hh-toggle ${className}` : "hh-toggle"}
      onClick={(e) => {
        onClick?.(e);
        if (!e.defaultPrevented) onChange(!checked);
      }}
    />
  );
  if (!labelled) return button;
  return (
    <label className="hh-toggle-row">
      <span id={textId}>{children}</span>
      {button}
    </label>
  );
}
