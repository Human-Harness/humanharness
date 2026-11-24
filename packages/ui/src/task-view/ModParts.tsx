import { useRef } from "react";
import { SlotBoundary } from "../layout/BlockBoundary";
import { type ComposerReviewer, type Slots, useBlocks } from "../layout/registry";
import { Overlay } from "./Overlay";
import { answerReview, reviewMarks, reviewWait, runReview } from "./review";
import type { OverlayName, useOverlay } from "./useOverlay";

type Client = { mods: { set(id: string, on: boolean): Promise<unknown> } };
type Overlays = ReturnType<typeof useOverlay>;

/** A mod's overlay as the task view names it (one open at a time with the path's and Sidekick's). */
const nameOf = (o: Slots["taskOverlay"]): OverlayName => `mod:${o.mod}/${o.name}`;
/** Its element id (the button's `aria-controls`). */
const idOf = (o: Slots["taskOverlay"]) => `hh-overlay-mod-${o.mod}-${o.name.replace(/[^A-Za-z0-9_-]/g, "_")}`;

/**
 * Mods' parts in the task view (`ctx.taskBar`, `ctx.taskOverlay`, `ctx.composer`): never in slim mode; overlays and the
 * reviewer not in a narrow window either (no review the person can't see), like Sidekick's. The reviewer is the first
 * one registered, and only when Sidekick doesn't review. `review`/`answer`: the composer's and the answer form's mod
 * review in flight, aborted by Send now.
 */
export function useModParts(o: { slim: boolean; narrow: boolean; sidekickReviews: boolean }) {
  const blocks = useBlocks();
  const review = useRef<AbortController | null>(null);
  const answer = useRef<AbortController | null>(null);
  const reviewer: ComposerReviewer | undefined = o.sidekickReviews || o.slim || o.narrow ? undefined : blocks.slot("composer")[0]?.reviewer;
  return {
    bar: o.slim ? [] : blocks.slot("taskBar"),
    overlays: o.slim || o.narrow ? [] : blocks.slot("taskOverlay"),
    reviewer,
    review,
    answer,
    /** The composer's marks for `draft` (none without a reviewer: no backdrop). */
    marks: (draft: string) => (reviewer ? reviewMarks(reviewer, draft) : undefined),
    /** The answer form's review props; `busy`: a composer review runs. */
    form: (busy: () => boolean) => (reviewer ? answerReview(reviewer, busy, answer) : {}),
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
export async function modReviewSend(parts: ModParts & { reviewer: ComposerReviewer }, text: string, force: boolean, start: (until: number | null) => void, stale: () => boolean) {
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
        <Overlay key={nameOf(o)} side="right" id={idOf(o)} name={o.name} closeLabel={closeLabel} onClose={overlay.close} autoFocus={overlay.focusIn}>
          <SlotBoundary mod={o.mod} client={client}>
            <o.Panel close={overlay.close} />
          </SlotBoundary>
        </Overlay>
      ),
  );
}
