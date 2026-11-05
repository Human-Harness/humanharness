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
  // Inicio: the column's notices and cards, the missing-steps list, its 12 uppercase grey labels (spec §7, stage 3a)
  "hh-home-box",
  "hh-home-steps",
  "hh-home-label",
  // Assistant: the steps list, the step's column, its action bar, the end's column (spec §7, stage 3b)
  "hh-setup-steps",
  "hh-setup-step",
  "hh-setup-actions",
  "hh-setup-end",
  // Group's loose list and a file path in a Row's hint (guide/settings.tsx)
  "hh-gd-list",
  "hh-gd-path",
  // SidekickMark (§4)
  "hh-sk-mark",
  "hh-sk-mark-off",
  // Button and IconButton (§3)
  "hh-btn",
  "hh-icon-btn",
  // SecondaryPage (template 3) and the Inbox page's row buttons, section heads and the rail's count (spec §7, stage 4a)
  "hh-page",
  "hh-page-col",
  "hh-inbox-row",
  "hh-inbox-head",
  "hh-rail-count",
  // History as a page: its task rows, a row's body, a changed file, a point's time; the chat hidden under it (stage 4b1)
  "hh-history-row",
  "hh-history-body",
  "hh-history-file",
  "hh-history-time",
  "hh-app-paged",
  // Files › Notes as a page: a note's row button, the detail's key points (stage 4b2)
  "hh-notes-row",
  "hh-notes-points",
  // The file timeline's split view (template 2), an entry's row button and its diff (stage 4b1)
  "hh-split",
  "hh-split-head",
  "hh-split-body",
  "hh-timeline-pick",
  "hh-entrydiff",
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
  // Hidden: text only screen readers get (Radix + Impeccable spec, stage 2c)
  "hh-sr-only",
]);
