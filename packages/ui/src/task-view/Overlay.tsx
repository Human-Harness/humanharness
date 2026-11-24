import { type ReactNode, useEffect, useRef } from "react";
import { IconButton } from "../guide/IconButton";

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * A 280 panel over the task's content (task view one column): the path on the left, a mod's on the right. Named, with
 * a close button and Escape. `bare`: the child is already the named region with its own close (a mod's own panel).
 */
export function Overlay({
  side,
  name,
  closeLabel,
  onClose,
  autoFocus,
  bare,
  id,
  children,
}: {
  side: "left" | "right";
  name: string;
  closeLabel: string;
  onClose: () => void;
  /** Moves focus into the panel when it opens (opened by its button; not when a card opened it). */
  autoFocus: boolean;
  bare?: boolean;
  id?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!autoFocus || !ref.current) return;
    (ref.current.querySelector<HTMLElement>(FOCUSABLE) ?? ref.current).focus();
    // Only on open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "Escape" || e.defaultPrevented) return;
    e.preventDefault();
    onClose();
  };
  const className = `hh-overlay hh-overlay-${side}`;
  if (bare) {
    return (
      <div ref={ref as React.RefObject<HTMLDivElement>} className={className} id={id} onKeyDown={onKeyDown}>
        {children}
      </div>
    );
  }
  return (
    <aside ref={ref} className={className} id={id} aria-label={name} tabIndex={-1} onKeyDown={onKeyDown}>
      <header className="hh-overlay-head">
        <h2 className="hh-overlay-title">{name}</h2>
        <IconButton icon="close" label={closeLabel} size="compact" onClick={onClose} />
      </header>
      {children}
    </aside>
  );
}
