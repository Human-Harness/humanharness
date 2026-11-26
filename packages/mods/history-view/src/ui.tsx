import { defineMod } from "@humanharness/mod-sdk";
import { HistoryPage } from "./HistoryPage";

/** The History page of the task view, as the core drew it before (minimal-core step 2): same icon, label and title. */
export default defineMod({
  id: "history-view",
  ui: (ctx) => {
    ctx.taskPage?.({
      name: "history",
      rail: { icon: "history", label: "History" },
      title: "history.title",
      page: HistoryPage,
    });
  },
});
