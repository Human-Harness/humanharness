import { type KeyboardEvent, type ReactNode, useRef } from "react";

export interface TabItem {
  id: string;
  label: ReactNode;
  /** Accessible name when the visible label is not enough (a waiting tab says so). */
  ariaLabel?: string;
  title?: string;
  /** Orange dot: this one waits for you (§3). */
  waiting?: boolean;
}

/**
 * Open things of the same kind (style guide §3, 40 high): parallel tasks, the panels of one plugin.
 * Roving focus: the selected tab is the only tab stop; arrows, Home and End select and focus the next one.
 * With `id`, each tab gets `${id}-tab-${i}` and the selected one `aria-controls="${id}-panel"`.
 */
export function Tabs({
  label,
  items,
  value,
  onChange,
  id,
}: {
  label: string;
  items: readonly TabItem[];
  value: string;
  onChange: (id: string) => void;
  id?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const index = Math.max(
    0,
    items.findIndex((i) => i.id === value),
  );
  const onKeyDown = (e: KeyboardEvent) => {
    const last = items.length - 1;
    const next =
      e.key === "ArrowRight" || e.key === "ArrowDown"
        ? (index + 1) % items.length
        : e.key === "ArrowLeft" || e.key === "ArrowUp"
          ? (index + last) % items.length
          : e.key === "Home"
            ? 0
            : e.key === "End"
              ? last
              : -1;
    if (next < 0) return;
    e.preventDefault();
    onChange(items[next].id);
    ref.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
  };
  return (
    <div ref={ref} className="hh-tabs" role="tablist" aria-label={label} onKeyDown={onKeyDown}>
      {items.map((it, i) => {
        const selected = i === index;
        return (
          <button
            key={it.id}
            id={id ? `${id}-tab-${i}` : undefined}
            type="button"
            role="tab"
            className="hh-tab-item"
            aria-selected={selected}
            aria-controls={id && selected ? `${id}-panel` : undefined}
            aria-label={it.ariaLabel}
            tabIndex={selected ? 0 : -1}
            title={it.title}
            onClick={() => onChange(it.id)}
          >
            {it.waiting && <span className="hh-tab-dot" data-tone="waiting" aria-hidden="true" />}
            <span className="hh-tab-label" dir="auto">
              {it.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
