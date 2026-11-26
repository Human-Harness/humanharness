import { defineMod } from "@humanharness/mod-sdk";
import type { ComponentProps } from "react";
import { HistoryPage } from "./HistoryPage";

/** The History page of the task view, as the core drew it before (minimal-core step 2): same icon, label and title. */
export default defineMod({
  id: "history-view",
  ui: (ctx) => {
    // The go-backs are the mod's own main's (`restore`, `restoreTask`): the page calls them through the app's mod call.
    const Page = (props: Omit<ComponentProps<typeof HistoryPage>, "call">) => (
      <HistoryPage {...props} call={(name, payload) => props.client.mods.call("history-view", name, payload)} />
    );
    ctx.taskPage?.({
      name: "history",
      rail: { icon: "history", label: "History" },
      title: "history.title",
      page: Page,
    });
  },
});
