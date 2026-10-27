import { answerPace } from "./packages/ui/src/pace";

// Tests see an answer as soon as it arrives; the pacing has its own tests, with fake timers.
answerPace.wordMs = 0;

// DOM tests (happy-dom) share Testing Library's settings; node tests never load it.
if (typeof document !== "undefined") await import("./packages/ui/test/dom-setup");
