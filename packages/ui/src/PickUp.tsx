import { useTranslation } from "react-i18next";
import { Tag, type TagTone } from "./chrome";

export interface PickUpItem {
  id: string;
  title: string;
  tone: TagTone;
  status: string;
  where: string;
}
interface OpenTask {
  id: string;
  title: string;
  state: "waiting" | "working" | "queued";
  updatedAt: number;
}
interface PastTask {
  id: string;
  title: string;
  outcome: "noteSaved" | "inProgress";
  endedAt: number;
}

const RANK = { waiting: 0, working: 1, queued: 2 } as const;

/** Up to three tasks to resume (UI refresh spec §5.2): open ones first (waiting, working, queued), then the latest from history. */
export function pickUpItems({ open, history }: { open: OpenTask[]; history: PastTask[] }): PickUpItem[] {
  const fromOpen = [...open]
    .sort((a, b) => RANK[a.state] - RANK[b.state] || b.updatedAt - a.updatedAt)
    .map((o) => ({ id: o.id, title: o.title, tone: (o.state === "waiting" ? "orange" : o.state === "working" ? "blue" : "gray") as TagTone, status: o.state, where: "" }));
  const seen = new Set(fromOpen.map((i) => i.id));
  const fromHistory = [...history]
    .sort((a, b) => b.endedAt - a.endedAt)
    .filter((h) => !seen.has(h.id))
    .map((h) => ({ id: h.id, title: h.title, tone: (h.outcome === "noteSaved" ? "green" : "blue") as TagTone, status: h.outcome, where: "" }));
  return [...fromOpen, ...fromHistory].slice(0, 3);
}

export function PickUp({ items, onOpen }: { items: PickUpItem[]; onOpen: (id: string) => void }) {
  const { t } = useTranslation();
  if (items.length === 0) return null;
  return (
    <section className="hh-pickup" aria-labelledby="hh-pickup-h">
      <div className="hh-pickup-head">
        <h2 id="hh-pickup-h">{t("home.pickUp")}</h2>
        <span className="hh-tag hh-tag-gray">{items.length}</span>
      </div>
      <div className="hh-pickup-grid">
        {items.map((i) => (
          <button key={i.id} className="hh-pickup-card" onClick={() => onOpen(i.id)}>
            <Tag tone={i.tone}>{i.status}</Tag>
            <span className="hh-pickup-title">{i.title}</span>
            <span className="hh-caption">{i.where}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
