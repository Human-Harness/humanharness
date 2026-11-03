/**
 * The classes of the guide's pieces, templates and zones (style guide §1). A class enters only in the
 * PR that adds its piece (§15). Parts 3-14 of the plan fill it.
 *
 * It starts empty on purpose: every `hh-*` class in use today is an offender until its piece lands.
 */
export const GUIDE_CLASSES: ReadonlySet<string> = new Set<string>([
  // Icon (§4)
  "hh-icon",
  "hh-icon-loading",
  "hh-icon-chevron",
]);
