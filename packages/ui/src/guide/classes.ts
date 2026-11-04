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
  // HhTheme: the Radix Themes root (Radix + Impeccable spec §3)
  "hh-theme",
  // SettingsNav: Settings' left column (Radix + Impeccable spec §7, stage 2)
  "hh-settings-nav",
  "hh-gd-nav-item",
  // Group's loose list and a file path in a Row's hint (guide/settings.tsx)
  "hh-gd-list",
  "hh-gd-path",
  // SidekickMark (§4)
  "hh-sk-mark",
  "hh-sk-mark-off",
  "hh-sk-mark-grid",
  "hh-sk-mark-pick",
  // Button and IconButton (§3)
  "hh-btn",
  "hh-icon-btn",
  // The row buttons of a task keep their own margin (answer B9)
  "hh-tk-cancel",
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
  // Option (§3); the radio is its mark, never a class of its own (§5)
  "hh-option-group",
  "hh-option-item",
  "hh-option-mark",
  "hh-option-lead",
  "hh-option-text",
  "hh-option-head",
  "hh-option-title",
  "hh-option-desc",
  "hh-option-trail",
  // Tile (§3)
  "hh-tile-grid",
  "hh-tile",
  "hh-tile-check",
  "hh-tile-logo",
  "hh-tile-head",
  "hh-tile-lead",
  "hh-tile-title",
  "hh-tile-tags",
  "hh-tile-text",
  // Toggle and Checkbox (§5)
  "hh-toggle",
  "hh-toggle-row",
  "hh-checkbox",
  "hh-checkbox-box",
  // Empty state line (§4: a 14 icon before the text)
  "hh-history-empty-line",
]);
