import { type HarnessClient, HarnessApp } from "@humanharness/cli/ui";
import en from "../locales/en.json";
import { ExampleCard } from "./ExampleCard";
import "./harness.css";

const locales = { en };
// One component per visible custom block, by block name.
const blocks = { example_card: ExampleCard };
// Keys of locales/en.json for the work screen's start view.
const startView = { title: "startTitle", intro: "startIntro", hint: "hint" };

export default function App({ client }: { client: HarnessClient }) {
  return <HarnessApp client={client} blocks={blocks} locales={locales} startView={startView} />;
}
