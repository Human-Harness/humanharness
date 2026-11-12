import { useTranslation } from "react-i18next";
import { Rx, type TagTone } from "@humanharness/ui";

/** A tag tone as a Radix badge color; the bridge maps each to its hh-t-* pair. */
const TONE = { green: "green", orange: "orange", blue: "blue", violet: "violet", red: "red", gray: "gray" } as const satisfies Record<TagTone, string>;

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
  // Inicio's section titles are 12 uppercase grey labels (DESIGN.md "Inicio").
  return (
    <section className="hh-pickup" aria-labelledby="hh-pickup-h">
      <Rx.Heading as="h2" size="1" color="gray" className="hh-home-label" id="hh-pickup-h">
        {t("home.pickUp")}
      </Rx.Heading>
      <ul className="hh-pickup-grid">
        {items.map((i) => (
          <li key={i.id}>
            <Rx.Card size="2" asChild>
              <button type="button" className="hh-pickup-card" onClick={() => onOpen(i.id)}>
                <Rx.Badge color={TONE[i.tone]}>{i.status}</Rx.Badge>
                <Rx.Text as="span" size="3" weight="bold">
                  {i.title}
                </Rx.Text>
                {i.where && (
                  <Rx.Text as="span" size="1" color="gray">
                    {i.where}
                  </Rx.Text>
                )}
              </button>
            </Rx.Card>
          </li>
        ))}
      </ul>
    </section>
  );
}
