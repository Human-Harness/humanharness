import type { ButtonHTMLAttributes, ReactNode } from "react";

export interface NavItemProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  /** The chosen item: `--hh-active` fill (style guide §2). */
  selected?: boolean;
  /** What `aria-current` says when selected: "page" in Settings, "step" in the Assistant and the walkthrough. */
  current?: "page" | "step";
  /** Before the name: a step mark. */
  lead?: ReactNode;
  /** After the name, pushed to the end: a counter, a tag, a 12 px value. */
  trail?: ReactNode;
  /** `muted`: a step not reached yet (Assistant). */
  tone?: "muted";
  /**
   * `white`: the Assistant's current step as it is today (white fill with shadow). Leaves with Task 61,
   * which gives the Assistant its look (spec §12).
   */
  look?: "white";
  children?: ReactNode;
}

/**
 * Vertical navigation (style guide §3, 40 high): Settings, the Assistant's steps, the walkthrough.
 * A `button` when it does something (`onClick`); without one (the Assistant's steps only show where you are)
 * it is a plain block, so no dead button enters the tab order.
 */
export function NavItem({ selected = false, current, lead, trail, tone, look, className, children, ...rest }: NavItemProps) {
  const cls = className ? `hh-nav-item ${className}` : "hh-nav-item";
  const inner = (
    <>
      {lead != null && <span className="hh-nav-lead">{lead}</span>}
      <span className="hh-nav-label">{children}</span>
      {trail != null && <span className="hh-nav-trail">{trail}</span>}
    </>
  );
  const ariaCurrent = selected ? current : undefined;
  if (rest.onClick === undefined) {
    return (
      <div className={cls} aria-current={ariaCurrent} data-selected={selected} data-tone={tone} data-look={look}>
        {inner}
      </div>
    );
  }
  return (
    <button type="button" {...rest} className={cls} aria-current={ariaCurrent} data-selected={selected} data-tone={tone} data-look={look}>
      {inner}
    </button>
  );
}
