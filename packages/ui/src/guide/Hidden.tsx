import type { ReactNode } from "react";

/**
 * Text only screen readers get: a table's caption, or the detail a hover title shows (Radix + Impeccable spec,
 * stage 2c). `as="caption"` goes first inside a table.
 */
export function Hidden({ as = "span", children }: { as?: "span" | "caption"; children: ReactNode }) {
  const Tag = as;
  return <Tag className="hh-sr-only">{children}</Tag>;
}
