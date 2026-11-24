import { useRef } from "react";
import { SlotBoundary } from "../layout/BlockBoundary";
import { type Slots, useBlocks } from "../layout/registry";
import { Overlay } from "./Overlay";
import { type TaskReviewer, answerReview, reviewMarks, reviewWait, runReview } from "./review";
import type { OverlayName, useOverlay } from "./useOverlay";

type Client = { mods: { set(id: string, on: boolean): Promise<unknown> } };
type Overlays = ReturnType<typeof useOverlay>;

/** A mod's overlay entry; `bare`: its panel is already the named region with its own close (a core mod's). */
type OverlayEntry = Slots["taskOverlay"] & { bare?: boolean };
/** A mod's overlay as the task view names it (one open at a time with the path's). */
export const overlayName = (mod: string, name: string): OverlayName => `mod:${mod}/${name}`;
const nameOf = (o: Slots["taskOverlay"]): OverlayName => overlayName(o.mod, o.name);
/** Its element id (the button's `aria-controls`): `hh-overlay-<mod>` for the overlay named after its mod. */
const idOf = (o: Slots["taskOverlay"]) => (o.name === o.mod ? `hh-overlay-${o.mod}` : `hh-overlay-mod-${o.mod}-${o.name.replace(/[^A-Za-z0-9_-]/g, "_")}`);

/**
 * Mods' parts in the task view (`ctx.taskBar`, `ctx.taskOverlay`, `ctx.composer`): never in slim mode; overlays and
 * reviews not in a narrow window either (no review the person can't see), though the reviewer's marks stay. The
 * reviewer is the first one registered; `reviews`: it reviews before sending now. `review`/`answer`: the composer's and
 * the answer form's mod review in flight, aborted by Send now.
 */
export function useModParts(o: { slim: boolean; narrow: boolean }) {
  const blocks = useBlocks();
  const review = useRef<AbortController | null>(null);
  const answer = useRef<AbortController | null>(null);
  const reviewer: TaskReviewer | undefined = o.slim ? undefined : blocks.slot("composer")[0]?.reviewer;
  const reviews = reviewer !== undefined && !o.narrow && reviewer.reviews !== false;
  return {
    bar: o.slim ? [] : blocks.slot("taskBar"),
    overlays: (o.slim || o.narrow ? [] : blocks.slot("taskOverlay")) as readonly OverlayEntry[],
    reviewer,
    reviews,
    review,
    answer,
    /** The composer's marks for `draft` (none without a reviewer: no backdrop). */
    marks: (draft: string) => (reviewer ? reviewMarks(reviewer, draft) : undefined),
    /** The answer form's review props; `busy`: a composer review runs. */
    form: (busy: () => boolean) => (reviewer && reviews ? answerReview(reviewer, busy, answer) : {}),
    /** Send now: aborts the mod review in flight; false when none ran. */
    abort: () => {
      if (!review.current) return false;
      review.current.abort();
      review.current = null;
      return true;
    },
  };
}

export type ModParts = ReturnType<typeof useModParts>;

/**
 * A send through the mod's reviewer: `start` the countdown with its wait, run the review (Send now aborts it), and
 * resolve whether the text should go (`false`: a hold; `null`: `stale()`, another send took over).
 */
export async function modReviewSend(parts: ModParts & { reviewer: TaskReviewer }, text: string, force: boolean, start: (until: number | null) => void, stale: () => boolean) {
  const { reviewer } = parts;
  const wait = reviewWait(reviewer);
  start(wait === "always" ? null : Date.now() + wait * 1000);
  const ctl = new AbortController();
  parts.review.current = ctl;
  const v = await runReview(reviewer, text, ctl.signal, { force, answer: false });
  if (stale()) return null;
  parts.review.current = null;
  return v === "send";
}

/** Mods' pieces in the task bar, then the buttons of their overlays, each behind the block boundary. */
export function ModBarParts({ parts, overlay, client, task }: { parts: ModParts; overlay: Overlays; client: Client; task: string | null }) {
  if (parts.bar.length === 0 && parts.overlays.length === 0) return null;
  return (
    <>
      {parts.bar.map(({ mod, Component }, i) => (
        <SlotBoundary key={`bar-${mod}-${i}`} mod={mod} client={client}>
          <Component task={task} />
        </SlotBoundary>
      ))}
      {parts.overlays.map((o) => {
        const name = nameOf(o);
        return (
          <SlotBoundary key={name} mod={o.mod} client={client}>
            <o.Button expanded={overlay.open === name} controls={idOf(o)} onOpen={() => overlay.toggle(name)} buttonRef={overlay.trigger(name)} />
          </SlotBoundary>
        );
      })}
    </>
  );
}

/** The open mod overlay, on the right, its panel behind the block boundary. */
export function ModOverlays({ parts, overlay, client, closeLabel }: { parts: ModParts; overlay: Overlays; client: Client; closeLabel: string }) {
  return parts.overlays.map(
    (o) =>
      overlay.open === nameOf(o) && (
        <Overlay key={nameOf(o)} side="right" id={idOf(o)} name={o.name} closeLabel={closeLabel} onClose={overlay.close} autoFocus={overlay.focusIn} {...(o.bare ? { bare: true } : {})}>
          <SlotBoundary mod={o.mod} client={client}>
            <o.Panel close={overlay.close} />
          </SlotBoundary>
        </Overlay>
      ),
  );
}
