import { useTranslation } from "react-i18next";
import type { LiveActivity } from "./state";

export function ActivityList({ items }: { items: Pick<LiveActivity, "kind" | "detail" | "done">[] }) {
  const { t } = useTranslation();
  if (items.length === 0) return null;
  return (
    <ul className="hh-activity">
      {items.map((a, i) => (
        <li key={i} className={a.done ? "done" : "running"}>
          {t(`activity.${a.kind}`, { detail: a.detail })}
        </li>
      ))}
    </ul>
  );
}
