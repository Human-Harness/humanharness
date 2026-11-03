import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Icon } from "./icons";

export interface TileProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "title" | "children"> {
  /** Chosen: 2 px dark border and a check (14), and `aria-pressed`. Leave it out for a tile that only acts (a topic that starts a task). */
  selected?: boolean;
  /** The one that comes next on the path: amber border. */
  recommended?: boolean;
  /** Dimmed title: already done. */
  done?: boolean;
  /** A logo above the head. */
  logo?: ReactNode;
  /** Before the title: a number. */
  lead?: ReactNode;
  title: ReactNode;
  /** After the title, pushed to the end: tags. */
  tags?: ReactNode;
  description?: ReactNode;
}

/**
 * A large option with a logo or a description (style guide §3 Tile, 104 high, radius 14): the topics at task start.
 * Put it in a `TileGrid`.
 */
export function Tile({ selected, recommended, done, logo, lead, title, tags, description, className, ...rest }: TileProps) {
  return (
    <button
      type="button"
      {...rest}
      className={className ? `hh-tile ${className}` : "hh-tile"}
      aria-pressed={selected}
      data-recommended={recommended || undefined}
      data-done={done || undefined}
    >
      {selected && (
        <span className="hh-tile-check" aria-hidden="true">
          <Icon name="check" size={14} />
        </span>
      )}
      {logo != null && <span className="hh-tile-logo">{logo}</span>}
      <span className="hh-tile-head">
        {lead != null && <span className="hh-tile-lead">{lead}</span>}
        <span className="hh-tile-title">{title}</span>{" "}
        {tags != null && <span className="hh-tile-tags">{tags}</span>}
      </span>
      {description != null && <span className="hh-tile-text">{description}</span>}
    </button>
  );
}

/** The topics as an ordered list of tiles: cards, or rows (the Cards / List choice). Each child is an `li` holding one tile. */
export function TileGrid({ label, layout = "cards", children }: { label: string; layout?: "cards" | "list"; children: ReactNode }) {
  return (
    <ol className="hh-tile-grid" aria-label={label} data-layout={layout}>
      {children}
    </ol>
  );
}
