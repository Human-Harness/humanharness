import { defineMod } from "@humanharness/mod-sdk";
import type { ComponentProps } from "react";
import { HistoryPage } from "./HistoryPage";

/** The History page of the task view, as the core drew it before (minimal-core step 2): same icon, label and title. */
export default defineMod({
  id: "history-view",
  ui: (ctx) => {
    // The go-backs are the mod's own main's (`restore`, `restoreTask`); the page calls them through the mod's `ctx.call`.
    const call = (name: "restore" | "restoreTask", payload: unknown) => (ctx.call ? ctx.call(name, payload) : Promise.reject(new Error("The History view has no main part")));
    const Page = (props: Omit<ComponentProps<typeof HistoryPage>, "call">) => <HistoryPage {...props} call={call} />;
    ctx.taskPage?.({
      name: "history",
      rail: { icon: "history", label: "History" },
      title: "history.title",
      page: Page,
    });
  },
});
