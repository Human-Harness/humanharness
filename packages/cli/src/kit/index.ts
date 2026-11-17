// The kit's data functions: what the CLI prints and the MCP server answers. Each takes the app's home folder, or in
// harness mode a harness project and its core (`KitRoot`), and returns data, or throws a CliError with the message the
// CLI prints.
export { type AppStatus, appShot, appStatus } from "./app";
export { type ModCheck, checkMod } from "./check";
export { type ClonedLayout, type ClonedMod, assertLayoutName, assertModId, cloneLayout, cloneMod } from "./clone";
export { type Catalog, type CatalogLayout, type CatalogMod, type CatalogType, catalog } from "./catalog";
export { type HarnessCatalog, type HarnessMod, type HarnessRoot, type KitRoot, coreOf, harnessCatalog, isHarnessProject } from "./harness-project";
export { type NewMod, newMod } from "./new-mod";
