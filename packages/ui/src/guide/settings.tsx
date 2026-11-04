import { Badge, Box, Button, Card, Flex, Heading, Separator, Text } from "@radix-ui/themes";
import { Children, Fragment, type KeyboardEvent, type ReactNode, useId } from "react";

/*
 * Settings' own wrappers (DESIGN.md "Card and settings rows", "Inicio, Assistant and Settings"): built only from Radix
 * pieces, closed by their props. Spacing (Marco, 2026-11-04): 12 above and below a row, 24 between groups.
 */

/**
 * A section's head: no title (the nav item names the section), one 12 grey sentence and, when needed, a control on the
 * right. `lineId` lets that control be described by the sentence.
 */
export function SectionHead({ line, aside, lineId }: { line: ReactNode; aside?: ReactNode; lineId?: string }) {
  return (
    <Flex align="center" justify="between" gap="4" mb="5">
      <Text as="p" size="1" color="gray" id={lineId}>
        {line}
      </Text>
      {aside}
    </Flex>
  );
}

/**
 * Settings rows that belong together. By default a card: an optional 16 title with only a tag on its right, then the
 * rows with a hairline between them. `loose` is a list (profiles, plugins, usage): a 12 grey title over bordered rows,
 * no card, whose children are `Row as="li"`; its 24 side padding matches the cards' so the text lines up. Never inside another group.
 */
export function Group({
  title,
  tag,
  loose,
  children,
  "data-setting": setting,
}: {
  title?: ReactNode;
  tag?: ReactNode;
  loose?: boolean;
  children: ReactNode;
  "data-setting"?: string;
}) {
  const id = useId();
  const kids = Children.toArray(children).filter(Boolean);
  if (loose) {
    return (
      <Box asChild mb="5">
        <section aria-labelledby={title ? id : undefined} data-setting={setting}>
          {title && (
            <Text as="p" size="1" color="gray" weight="bold" mb="2" id={id}>
              {title}
            </Text>
          )}
          {/* A list: each child is a `Row as="li"` with its own name; the hairline between items comes from the CSS. */}
          <Box asChild px="5" className="hh-gd-list">
            <ul aria-labelledby={title ? id : undefined}>{kids}</ul>
          </Box>
        </section>
      </Box>
    );
  }
  return (
    <Box asChild mb="5">
      <section aria-labelledby={title ? id : undefined} data-setting={setting}>
        <Card size="3">
          {(title || tag) && (
            <Flex align="center" justify="between" gap="3" mb="1">
              {title && (
                <Heading as="h3" size="3" id={id}>
                  {title}
                </Heading>
              )}
              {tag}
            </Flex>
          )}
          {kids.map((child, i) => (
            <Fragment key={i}>
              {i > 0 && <Separator size="4" />}
              {child}
            </Fragment>
          ))}
        </Card>
      </section>
    </Box>
  );
}

/**
 * One setting: its name (and hint) on the left, its control on the right, in one column. `htmlFor` makes the name a
 * label for that control; `hintId` lets the control be described by the hint. With no control it is read-only data:
 * pass the value as a gray tag. `below` is a full-width line under the row (a list that opens, a form, a note).
 */
export function Row({
  label,
  hint,
  htmlFor,
  hintId,
  children,
  below,
  as,
  "aria-label": name,
  "data-setting": setting,
}: {
  label: ReactNode;
  hint?: ReactNode;
  htmlFor?: string;
  hintId?: string;
  children?: ReactNode;
  below?: ReactNode;
  /** `li` inside a loose group, named by `aria-label`. */
  as?: "div" | "li";
  "aria-label"?: string;
  "data-setting"?: string;
}) {
  const inner = body(label, hint, htmlFor, hintId, children, below);
  if (as === "li") {
    return (
      <Box asChild py="3" data-setting={setting}>
        <li aria-label={name}>{inner}</li>
      </Box>
    );
  }
  return (
    <Box py="3" data-setting={setting}>
      {inner}
    </Box>
  );
}

function body(label: ReactNode, hint: ReactNode, htmlFor: string | undefined, hintId: string | undefined, children: ReactNode, below: ReactNode) {
  return (
    <>
      <Flex align="center" justify="between" gap="4" wrap="wrap">
        <Flex direction="column" gap="1" minWidth="0" flexGrow="1" flexBasis="200px">
          <Text as={htmlFor ? "label" : "span"} size="2" htmlFor={htmlFor}>
            {label}
          </Text>
          {hint && (
            <Text as="p" size="1" color="gray" id={hintId}>
              {hint}
            </Text>
          )}
        </Flex>
        {children && (
          <Flex align="center" justify="end" gap="2" flexShrink="0" wrap="wrap">
            {children}
          </Flex>
        )}
      </Flex>
      {below && <Box pt="3">{below}</Box>}
    </>
  );
}

export type SettingsNavItem<Id extends string> = { id: Id; label: string; count?: number };

/**
 * Settings' left column: its title and one nav item per section, as a vertical tab list. The chosen item is the chosen
 * amber; a section that needs the person carries an orange counter. Arrow keys, Home and End move between items.
 */
export function SettingsNav<Id extends string>({
  title,
  titleId,
  label,
  items,
  current,
  onPick,
  tabId,
  panelId,
}: {
  title: string;
  titleId: string;
  label: string;
  items: SettingsNavItem<Id>[];
  current: Id;
  onPick: (id: Id) => void;
  tabId: (id: Id) => string;
  panelId: string;
}) {
  const ids = items.map((i) => i.id);
  const onKey = (e: KeyboardEvent<HTMLButtonElement>, id: Id) => {
    const i = ids.indexOf(id);
    const forward = e.key === "ArrowRight" || e.key === "ArrowDown";
    const back = e.key === "ArrowLeft" || e.key === "ArrowUp";
    const next = forward ? ids[(i + 1) % ids.length] : back ? ids[(i - 1 + ids.length) % ids.length] : e.key === "Home" ? ids[0] : e.key === "End" ? ids[ids.length - 1] : undefined;
    if (next === undefined) return;
    e.preventDefault();
    onPick(next);
    document.getElementById(tabId(next))?.focus();
  };
  return (
    <nav className="hh-settings-nav" aria-label={label}>
      <Heading as="h1" size="5" id={titleId} mb="3" ml="3">
        {title}
      </Heading>
      <Flex direction="column" gap="1" role="tablist" aria-label={title} aria-orientation="vertical">
        {items.map((item) => {
          const chosen = item.id === current;
          return (
            <Button
              key={item.id}
              id={tabId(item.id)}
              role="tab"
              aria-selected={chosen}
              aria-current={chosen ? "page" : undefined}
              aria-controls={panelId}
              tabIndex={chosen ? 0 : -1}
              variant={chosen ? "soft" : "ghost"}
              color={chosen ? undefined : "gray"}
              highContrast={!chosen}
              size="2"
              className="hh-gd-nav-item"
              onClick={() => onPick(item.id)}
              onKeyDown={(e) => onKey(e, item.id)}
            >
              <Text truncate>{item.label}</Text>
              {item.count ? (
                <Badge color="orange" radius="full" ml="auto">
                  {item.count}
                </Badge>
              ) : null}
            </Button>
          );
        })}
      </Flex>
    </nav>
  );
}
