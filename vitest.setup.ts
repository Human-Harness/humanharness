import { answerPace } from "./packages/ui/src/pace";

// Tests see an answer as soon as it arrives; the pacing has its own tests, with fake timers.
answerPace.wordMs = 0;
