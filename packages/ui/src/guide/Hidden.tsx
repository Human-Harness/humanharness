import type { ReactNode } from "react";

/**
 * Text only screen readers get: a table's caption, or the detail a hover title shows (Radix + Impeccable spec,
 * stage 2c). `as="caption"` goes first inside a table.
 */
export function Hidden({ as = "span", id, children }: { as?: "span" | "caption"; /** For aria-describedby. */ id?: string; children: ReactNode }) {
  const Tag = as;
  return (
    <Tag className="hh-sr-only" id={id}>
      {children}
    </Tag>
  );
}
