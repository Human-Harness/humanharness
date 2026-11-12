import { type BlockComponent, registerBlock } from "@humanharness/ui";
import mod from "../src/ui";

// The tests here render HarnessApp, which draws Home from the layout's `home/home` block: register it as the shell's
// renderer entry does (minimal-core step 0b1), in the app's own block registry.
mod.ui?.({ id: "home", block: (name, component) => registerBlock("home", name, component as BlockComponent) });
