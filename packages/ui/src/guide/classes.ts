/**
 * The classes of the guide's pieces, templates and zones (style guide §1). A class enters only in the
 * PR that adds its piece (§15). Parts 3-14 of the plan fill it.
 *
 * Each piece adds its classes in its own task; until then every `hh-*` class not listed here is an offender.
 */
export const GUIDE_CLASSES: ReadonlySet<string> = new Set<string>([
  // Icon (§4)
  "hh-icon",
  "hh-icon-loading",
  "hh-icon-chevron",
  // SidekickMark (§4)
  "hh-sk-mark",
  "hh-sk-mark-off",
  "hh-sk-mark-grid",
  "hh-sk-mark-pick",
  // Button and IconButton (§3)
  "hh-btn",
  "hh-icon-btn",
  // Segmented (§3)
  "hh-segmented",
  // Tabs (§3)
  "hh-tabs",
  "hh-tab-item",
  "hh-tab-label",
  "hh-tab-dot",
  // NavItem (§3)
  "hh-nav-item",
  "hh-nav-lead",
  "hh-nav-label",
  "hh-nav-trail",
  // Empty state line (§4: a 14 icon before the text)
  "hh-history-empty-line",
]);
