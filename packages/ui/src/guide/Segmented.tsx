export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  /** Accessible name when the visible label is short (a weekday's initials). */
  ariaLabel?: string;
}

/** Style guide §3: 2 to 4 short options; the one exception is the seven weekdays (a multiple Segmented). */
export const SEGMENTED_MIN = 2;
export const SEGMENTED_MAX = 4;
export const SEGMENTED_WEEKDAYS = 7;
export function segmentedFits(count: number, multiple = false): boolean {
  return (count >= SEGMENTED_MIN && count <= SEGMENTED_MAX) || (multiple && count === SEGMENTED_WEEKDAYS);
}

/**
 * One choice among a few (style guide §3, 30 high, radius 8; the chosen segment is `--hh-active`).
 * Several at once: pass the chosen values as an array; `onChange` still reports the segment that was clicked, to toggle.
 */
export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
  describedBy,
}: {
  label: string;
  options: SegmentOption<T>[];
  value: T | readonly T[];
  onChange: (value: T) => void;
  /** Ids of the texts that describe the group (help, an error). */
  describedBy?: string;
}) {
  const on = (v: T) => (typeof value === "string" ? value === v : value.includes(v));
  return (
    <div className="hh-segmented" role="group" aria-label={label} aria-describedby={describedBy}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-label={o.ariaLabel} aria-pressed={on(o.value)} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
