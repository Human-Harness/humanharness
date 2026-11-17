import { type HarnessClient, HarnessApp } from "@humanharness/cli/ui";
import en from "../locales/en.json";
import "./harness.css";

const locales = { en };
// Keys of locales/en.json for the work screen's start view.
const startView = { title: "startTitle", intro: "startIntro", hint: "hint" };

// The harness's own UI lives in mods/ (blocks) and layouts/ (where they go); this file only starts the app.
export default function App({ client }: { client: HarnessClient }) {
  return <HarnessApp client={client} locales={locales} startView={startView} />;
}
