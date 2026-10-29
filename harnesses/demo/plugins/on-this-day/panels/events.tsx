import { Empty, ErrorBar, usePlugin, useQuery } from "@humanharness/plugin-ui";
import { useEffect, useRef, useState } from "react";
import "./events.css";

type Event = { id: string; year: number; text: string; page?: string };

// The panel: today's events, newest first, one "Explain" per row. Explain only proposes a question; the person starts
// it, or not. A link is shown as text: a panel can't open URLs.
export default function Events() {
  const { requestAction, focus } = usePlugin();
  const { rows, error, reload } = useQuery<Event>("events");
  const [asked, setAsked] = useState<string | null>(null);
  const focused = useRef<HTMLTableRowElement | null>(null);

  useEffect(() => {
    focused.current?.scrollIntoView({ block: "nearest" });
  }, [focus, rows]);

  if (error) return <ErrorBar message={error} onRetry={reload} />;
  const events = [...(rows ?? [])].sort((a, b) => b.year - a.year);
  if (events.length === 0) return <Empty>No events yet. They arrive with the next sync.</Empty>;

  const explain = (e: Event) => {
    setAsked(null);
    requestAction("explain", { year: e.year, text: e.text.slice(0, 200) }).catch((err: unknown) =>
      setAsked(err instanceof Error ? err.message : "The question couldn't be prepared."),
    );
  };

  return (
    <>
      {asked && <ErrorBar message={asked} onRetry={() => setAsked(null)} retryLabel="Dismiss" />}
      <table className="hhp-table">
        <thead>
          <tr>
            <th scope="col">Year</th>
            <th scope="col">Event</th>
            <th aria-hidden="true" />
          </tr>
        </thead>
        <tbody>
          {events.map((e) => {
            const here = e.id === focus;
            return (
              <tr key={e.id} ref={here ? focused : undefined} className={here ? "otd-focus" : undefined} aria-current={here ? "true" : undefined}>
                <td className="otd-year">{e.year}</td>
                <td>
                  {e.text}
                  {e.page && <span className="otd-page">{e.page}</span>}
                </td>
                <td className="hhp-table-action">
                  <button type="button" className="hhp-button" aria-label={`Explain the event from ${e.year}`} onClick={() => explain(e)}>
                    Explain
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}
