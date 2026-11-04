import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import type { ButtonSize } from "./Button";
import { Icon, type IconName } from "./icons";

type Props = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "className" | "aria-label" | "title"> & {
  icon: IconName;
  /** The accessible name and the tooltip (§3 Icon: always with a tooltip). */
  label: string;
  size?: ButtonSize;
  className?: string;
  /** Something drawn over the icon, such as a count. */
  children?: ReactNode;
};

/** Style guide §3 Icon: square (40 or 30), no text, the icon at 18, quiet. Only the icons and places of §4. */
export const IconButton = forwardRef<HTMLButtonElement, Props>(function IconButton({ icon, label, size = "normal", className, children, ...rest }, ref) {
  return (
    <button ref={ref} type="button" {...rest} className={className ? `hh-icon-btn ${className}` : "hh-icon-btn"} data-size={size} aria-label={label} title={label}>
      <Icon name={icon} size={18} />
      {children}
    </button>
  );
});
