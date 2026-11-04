import { type ButtonHTMLAttributes, type KeyboardEvent, type ReactNode, useId, useLayoutEffect, useRef } from "react";

/**
 * A radio group of Options (style guide §3 Option, §5 Radio: the radio exists only inside an Option).
 * One tab stop for the group (the chosen option, else the first usable one); the arrow keys move the focus.
 * `followFocus`: moving the focus also chooses (a setting: engine, language, backup place). Without it the arrows only
 * move the focus and Enter / Space chooses, so a group whose pick acts at once (chat choices, modes) never fires by moving.
 */
export function OptionGroup({
  label,
  labelledBy,
  describedBy,
  followFocus = false,
  id,
  className,
  children,
  ...data
}: {
  label?: string;
  /** The id of the text that names the group. */
  labelledBy?: string;
  /** Ids of the texts that describe the group (the reason some options are off). */
  describedBy?: string;
  followFocus?: boolean;
  id?: string;
  className?: string;
  children: ReactNode;
} & { [K in `data-${string}`]?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  // The roving tab stop is set on the DOM after each render: the options stay plain buttons with no group state.
  useLayoutEffect(() => {
    const radios = [...(ref.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]') ?? [])];
    const stop = radios.find((r) => r.getAttribute("aria-checked") === "true" && !r.disabled) ?? radios.find((r) => !r.disabled);
    for (const r of radios) r.tabIndex = r === stop ? 0 : -1;
  });
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const by = e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : e.key === "ArrowUp" || e.key === "ArrowLeft" ? -1 : 0;
    if (by === 0) return;
    const radios = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]')].filter((r) => !r.disabled);
    const from = radios.indexOf((e.target as HTMLElement).closest<HTMLButtonElement>('[role="radio"]')!);
    if (from < 0) return;
    e.preventDefault();
    const to = radios[(from + by + radios.length) % radios.length];
    to.focus();
    if (followFocus) to.click();
  };
  return (
    <div
      ref={ref}
      id={id}
      className={className ? `hh-option-group ${className}` : "hh-option-group"}
      role="radiogroup"
      aria-label={label}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      onKeyDown={onKeyDown}
      {...data}
    >
      {children}
    </div>
  );
}

export interface OptionProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "title" | "role" | "children"> {
  /** The chosen one: the radio is filled. */
  checked: boolean;
  /** Amber border (`--hh-cta`): the one the guide recommends (§3). */
  recommended?: boolean;
  title: ReactNode;
  /** Under the title. */
  description?: ReactNode;
  /** After the title: the type tag of a chat option, or a "Recommended" badge. */
  tag?: ReactNode;
  /** Between the radio and the text: an engine logo. */
  lead?: ReactNode;
  /** At the end: a short state ("Ready"). */
  trail?: ReactNode;
  /** The accessible name is the title only and the description describes it (two places with the same title, told apart by their account). */
  nameOnly?: boolean;
  /** More lines under the description. */
  children?: ReactNode;
}

/**
 * One among options that have a description (style guide §3, 52 high, radius 12): an 18 radio, a title, a description.
 * A `button` with `role="radio"`; put it inside an `OptionGroup`.
 */
export function Option({ checked, recommended, title, description, tag, lead, trail, nameOnly, children, className, ...rest }: OptionProps) {
  const id = useId();
  const hasDescription = description != null;
  return (
    <button
      type="button"
      aria-labelledby={nameOnly ? `${id}-title` : undefined}
      aria-describedby={nameOnly && hasDescription ? `${id}-desc` : undefined}
      {...rest}
      role="radio"
      aria-checked={checked}
      className={className ? `hh-option-item ${className}` : "hh-option-item"}
      data-recommended={recommended || undefined}
    >
      <span className="hh-option-mark" aria-hidden="true" />
      {lead != null && <span className="hh-option-lead">{lead}</span>}
      <span className="hh-option-text">
        <span className="hh-option-head">
          <strong className="hh-option-title" id={`${id}-title`}>
            {title}
          </strong>
          {tag}
        </span>
        {hasDescription && (
          <span className="hh-option-desc" id={`${id}-desc`}>
            {description}
          </span>
        )}
        {children}
      </span>
      {trail != null && <span className="hh-option-trail">{trail}</span>}
    </button>
  );
}
