import { forwardRef, type AnchorHTMLAttributes, type ButtonHTMLAttributes, type MouseEventHandler, type ReactNode } from "react";
import { Icon, type IconName } from "./icons";

/** The button types of style guide §3 (Icon is the IconButton piece). */
export type ButtonKind = "primary" | "secondary" | "quiet" | "danger" | "link" | "large";
export type ButtonSize = "normal" | "compact";

type Own = {
  /** Icon left of the text (18). Only the icon + text pairs of §4. */
  icon?: IconName;
  /** Waiting: aria-busy, the loading icon, `busyText` instead of the children, and disabled. */
  busy?: boolean;
  busyText?: ReactNode;
  className?: string;
  children?: ReactNode;
};
type ButtonAttrs = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "className" | "onClick">;
type AnchorAttrs = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "children" | "className">;

export type ButtonProps = Own &
  (
    | (ButtonAttrs & { href?: undefined; kind?: "primary" | "secondary" | "quiet"; size?: ButtonSize; onClick?: MouseEventHandler<HTMLButtonElement> })
    /** Danger always asks for confirmation (§3): it takes `onConfirm`, never `onClick`. */
    | (ButtonAttrs & { href?: undefined; kind: "danger"; size?: ButtonSize; onConfirm: () => void; onClick?: never })
    /** Large has one size (52); `arrow` draws "next" after the text. */
    | (ButtonAttrs & { href?: undefined; kind: "large"; size?: never; arrow?: boolean; onClick?: MouseEventHandler<HTMLButtonElement> })
    /** Link: only inside running text, never as a standalone action. */
    | (ButtonAttrs & { href?: undefined; kind: "link"; size?: never; onClick?: MouseEventHandler<HTMLButtonElement> })
    /** An `a` that opens outside the app: a secondary (or any non-danger) button with `href`. */
    | (AnchorAttrs & { href: string; kind?: "primary" | "secondary" | "quiet"; size?: ButtonSize })
  );

type Loose = Own & {
  kind?: ButtonKind;
  size?: ButtonSize;
  arrow?: boolean;
  onConfirm?: () => void;
  href?: string;
  [attr: string]: unknown;
};

/** Style guide §3: 8 types, 2 sizes (normal 40, compact 30), states normal, hover, focus, disabled and busy. */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(props, ref) {
  const { kind = "secondary", size, icon, busy, busyText, arrow, onConfirm, href, className, children, ...rest } = props as Loose;
  // Task 31 wires the confirmation (InlineConfirm or Dialog) and calls `onConfirm` only after it. Until then the first click never does.
  void onConfirm;
  const content = (
    <>
      {busy ? <Icon name="loading" size={18} /> : icon && <Icon name={icon} size={18} />}
      {busy && busyText !== undefined ? busyText : children}
      {kind === "large" && arrow && !busy && <Icon name="next" size={18} />}
    </>
  );
  const common = {
    className: className ? `hh-btn ${className}` : "hh-btn",
    "data-kind": kind,
    "data-size": kind === "large" || kind === "link" ? "normal" : (size ?? "normal"),
  };
  if (href !== undefined) {
    return (
      <a {...(rest as AnchorHTMLAttributes<HTMLAnchorElement>)} {...common} href={href}>
        {content}
      </a>
    );
  }
  const attrs = rest as ButtonHTMLAttributes<HTMLButtonElement>;
  return (
    <button
      ref={ref}
      {...attrs}
      {...common}
      {...(busy ? { "aria-busy": true } : {})}
      disabled={Boolean(attrs.disabled) || Boolean(busy)}
      {...(kind === "danger" ? { onClick: undefined } : {})}
    >
      {content}
    </button>
  );
});
