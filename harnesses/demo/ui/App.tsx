import { type HarnessClient, HarnessApp } from "@humanharness/ui";
import en from "../locales/en.json";
import { BackendPanel } from "./BackendPanel";
import { DiagramBlock } from "./DiagramBlock";
import { FilesBlock } from "./FilesBlock";
import "./demo.css";

const locales = { en };
const blocks = { diagram: DiagramBlock, files: FilesBlock };
const startView = { title: "startTitle", intro: "startIntro", faq: ["faq.ownHarness", "faq.conversation", "faq.newEngine"], hint: "hint" };

export default function App({ client }: { client: HarnessClient }) {
  // The side panel shows the demo's backend at work (hatches spec §4).
  return <HarnessApp client={client} blocks={blocks} locales={locales} startView={startView} renderSide={() => <BackendPanel client={client} />} />;
}
