import type { ReactNode } from "react";

/** The closed icon set (style guide §4). Drawings: guide artifact v29 plus Marco's picks of 2026-11-03 (clock, remove, daily-summary). */
const info = (
  <>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 11v5M12 8v.5" />
  </>
);
const attention = (
  <>
    <path d="M12 4 21 20H3z" />
    <path d="M12 10v4M12 17v.5" />
  </>
);

const GLYPHS = {
  home: (
    <>
      <path d="M4 11 12 4l8 7" />
      <path d="M6 10v9h12v-9" />
    </>
  ),
  tasks: <path d="M5 5h14v10H9l-4 4z" />,
  inbox: (
    <>
      <path d="M4 13 6 5h12l2 8v6H4z" />
      <path d="M4 13h5l1 2h4l1-2h5" />
    </>
  ),
  jobs: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 8v4l3 2" />
    </>
  ),
  files: <path d="M4 7a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" />,
  note: (
    <>
      <path d="M6 4h9l3 3v13H6z" />
      <path d="M9 11h6M9 15h6" />
    </>
  ),
  plugins: (
    <>
      <path d="M9 4v4M15 4v4" />
      <path d="M6 8h12v4a6 6 0 0 1-12 0z" />
      <path d="M12 18v2" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8" />
    </>
  ),
  bell: (
    <>
      <path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z" />
      <path d="M10 20h4" />
    </>
  ),
  close: <path d="M6 6l12 12M18 6 6 18" />,
  search: (
    <>
      <circle cx="11" cy="11" r="6" />
      <path d="m16 16 4 4" />
    </>
  ),
  check: <path d="m5 12 4 4 10-10" />,
  add: <path d="M12 5v14M5 12h14" />,
  back: <path d="M15 5 8 12l7 7" />,
  next: <path d="M5 12h14M13 6l6 6-6 6" />,
  chevron: <path d="m9 6 6 6-6 6" />,
  more: (
    <>
      <circle cx="6" cy="12" r="1" />
      <circle cx="12" cy="12" r="1" />
      <circle cx="18" cy="12" r="1" />
    </>
  ),
  attention,
  history: (
    <>
      <path d="M4 12a8 8 0 1 0 2.4-5.7" />
      <path d="M4 4v4h4" />
      <path d="M12 8v4l3 2" />
    </>
  ),
  undo: (
    <>
      <path d="M9 7 4 12l5 5" />
      <path d="M4 12h10a6 6 0 0 1 0 12" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </>
  ),
  fullscreen: <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />,
  text: (
    <>
      <path d="M4 18 9 6l5 12M6 14h6" />
      <path d="M15 18v-5a2.5 2.5 0 0 1 5 0v5M15 15h5" />
    </>
  ),
  engine: (
    <>
      <rect x="5" y="5" width="14" height="14" rx="3" />
      <path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3" />
    </>
  ),
  info,
  loading: <path d="M12 4a8 8 0 1 1-8 8" />,
  "callout-note": info,
  "callout-tip": (
    <>
      <path d="M9 18h6M10 21h4" />
      <path d="M12 3a6 6 0 0 0-3.5 10.9V16h7v-2.1A6 6 0 0 0 12 3z" />
    </>
  ),
  "callout-warning": attention,
  "callout-summary": <path d="M5 6h14M5 12h14M5 18h9" />,
  "callout-decision": (
    <>
      <path d="M6 21V4" />
      <path d="M6 4h11l-2 4 2 4H6" />
    </>
  ),
  "callout-question": (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.5v.4M12 16.5v.5" />
    </>
  ),
  coach: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="m15 9-2 4-4 2 2-4z" />
    </>
  ),
  focus: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="4.5" />
      <path d="M12 12v.01" />
    </>
  ),
  guardian: <path d="M12 3.5 19 6v5.5c0 4.2-3 7.4-7 9-4-1.6-7-4.8-7-9V6z" />,
  mentor: (
    <>
      <path d="M3 9.5 12 5l9 4.5-9 4.5z" />
      <path d="M7 11.5V16c1.4 1.3 3 2 5 2s3.6-.7 5-2v-4.5" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="13" r="7" />
      <path d="M12 10v3l2 1.5" />
      <path d="M4.5 6.5 7 4M19.5 6.5 17 4" />
    </>
  ),
  remove: (
    <>
      <path d="M5 7h14M10 7V5h4v2" />
      <path d="M7 7l1 13h8l1-13" />
    </>
  ),
  "daily-summary": (
    <>
      <path d="M3 18h18" />
      <path d="M7 18a5 5 0 0 1 10 0" />
      <path d="M12 6v3M5.6 11.6 7 13M18.4 11.6 17 13" />
    </>
  ),
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof GLYPHS;
export const ICON_NAMES = Object.keys(GLYPHS) as readonly IconName[];

export function Icon({ name, size }: { name: IconName; size: 14 | 18 | 32 }) {
  return (
    <svg
      className={`hh-icon hh-icon-${name}`}
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {GLYPHS[name]}
    </svg>
  );
}
