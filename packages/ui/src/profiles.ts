// The window never imports the SDK at runtime: these copy two of its names, and profiles.test.tsx keeps them in step.

/** The collection that says who a profile is (`PROFILE_COLLECTION` in the SDK). */
export const PROFILE_COLLECTION = "profile";
/** The colours an avatar can take (`PROFILE_COLORS` in the SDK); each has a `--hh-profile-<colour>` token. */
export const AVATAR_COLORS = ["coral", "amber", "green", "teal", "blue", "violet", "pink", "gray"] as const;
