import { ErrorBar, Table, usePlugin, useQuery } from "@humanharness/plugin-ui";

type Item = { id: string; title: string };

// The panel: reads the plugin's own collection and asks for a prepared task; the person starts it, or not.
export default function Main() {
  const { requestAction } = usePlugin();
  const { rows, error, reload } = useQuery<Item>("items");
  if (error) return <ErrorBar message={error} onRetry={reload} />;
  return (
    <Table
      columns={[{ key: "title", label: "Item" }]}
      rows={rows ?? []}
      empty="No items yet."
      action={{ label: "Summarize", onClick: (item) => requestAction("summarize", { id: item.id }).catch(() => {}) }}
    />
  );
}
