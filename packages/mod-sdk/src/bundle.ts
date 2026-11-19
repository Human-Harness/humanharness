// Node only (`@humanharness/mod-sdk/bundle`): builds a mod written by hand into the one file the app loads.
import * as zod from "zod";
import * as modSdk from "./index";

export { type BundleOptions, type BundleResult, bundleMod, SHARED_IMPORTS } from "./build";

/**
 * The app's own copies a mod's main part may import: what main hands to the shims a built main part imports
 * (`react` and `@humanharness/ui` belong to the ui part, in the window).
 */
export const MAIN_SHARED_MODULES: Readonly<Record<string, Record<string, unknown>>> = { "@humanharness/mod-sdk": modSdk, zod };
