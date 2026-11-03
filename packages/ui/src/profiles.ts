// The window never imports the SDK at runtime: these copy two of its names, and profiles.test.tsx keeps them in step.

/** The collection that says who a profile is (`PROFILE_COLLECTION` in the SDK). */
export const PROFILE_COLLECTION = "profile";
/** The colours an avatar can take (`PROFILE_COLORS` in the SDK): the guide's tag colors plus grey (style guide §2). */
export const AVATAR_COLORS = ["green", "orange", "blue", "violet", "red", "gray"] as const;

/**
 * Colours profiles stored before the six, and the one of the six each draws as.
 * PENDING MARCO: these pairs are option A (the old rules' nearest tag color), not a decision.
 */
export const RETIRED_AVATAR_COLORS: Readonly<Record<string, (typeof AVATAR_COLORS)[number]>> = {
  coral: "red",
  amber: "orange",
  teal: "green",
  pink: "red",
};
