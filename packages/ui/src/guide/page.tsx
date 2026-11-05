import { Flex, Heading, Text } from "@radix-ui/themes";
import { type KeyboardEvent, type ReactNode, useEffect, useId, useRef } from "react";

/*
 * Template 3, a secondary page (DESIGN.md "Screen templates", "Secondary pages"): a rail button opens it in place of
 * the work screen; Volver sits in the top bar, outside this piece. Built only from Radix pieces (stage 4a).
 */

/** Escape on a page goes back, unless a field or a list that handles its own Escape has the focus. */
const OWN_ESCAPE = "input, textarea, select, [contenteditable]:not([contenteditable='false']), [role='combobox'], [role='listbox'], [role='menu']";

/**
 * A secondary page: one column at the reading width (680), centered, with 24 above and 32 at the sides and below.
 * Its head is the 20 title and an optional 12 grey line on the left, and the page's one primary action on the right.
 * Each new `focusKey` (a rail pick) puts the focus on the title; Escape calls `onBack`.
 */
export function SecondaryPage({
  title,
  line,
  action,
  focusKey,
  onBack,
  children,
}: {
  title: ReactNode;
  /** A 12 grey line under the title: what the page holds now. */
  line?: ReactNode;
  /** The page's primary action, last on the right of its head. */
  action?: ReactNode;
  focusKey?: number;
  onBack?: () => void;
  children: ReactNode;
}) {
  const id = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, [focusKey]);
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== "Escape" || e.defaultPrevented || !onBack) return;
    if ((e.target as HTMLElement).closest(OWN_ESCAPE)) return;
    // Handled here: the hidden chat's panels skip it.
    e.preventDefault();
    onBack();
  };
  return (
    <section className="hh-page" aria-labelledby={id} onKeyDown={onKeyDown}>
      <div className="hh-page-col">
        <Flex align="end" justify="between" gap="4" wrap="wrap" mb="5">
          <Flex direction="column" gap="1" minWidth="0">
            <Heading as="h1" size="5" id={id} ref={heading} tabIndex={-1}>
              {title}
            </Heading>
            {line && (
              <Text as="p" size="1" color="gray">
                {line}
              </Text>
            )}
          </Flex>
          {action}
        </Flex>
        {children}
      </div>
    </section>
  );
}
