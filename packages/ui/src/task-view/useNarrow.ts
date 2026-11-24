import { useEffect, useState } from "react";

/** The width under which the task view has no right overlay: no mod overlay, no review. */
const NARROW = "(max-width: 720px)";

function matches(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(NARROW).matches;
}

/** True while the window is too narrow for a right overlay, live. */
export function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(matches);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia(NARROW);
    const onChange = () => setNarrow(query.matches);
    onChange();
    query.addEventListener?.("change", onChange);
    return () => query.removeEventListener?.("change", onChange);
  }, []);
  return narrow;
}
