/** The parts of Electron's `before-input-event` input that a text-size shortcut depends on. */
export interface KeyInput {
  type: string;
  key: string;
  meta: boolean;
  control: boolean;
  alt: boolean;
}

/**
 * Which way ⌘+, ⌘− and ⌘0 (Ctrl outside macOS) change the text size, or null for any other key.
 * ⌘= counts as ⌘+ (the same key without Shift), as in every browser.
 */
export function textSizeShortcut(input: KeyInput, platform: NodeJS.Platform): "in" | "out" | "reset" | null {
  if (input.type !== "keyDown" || input.alt) return null;
  const mod = platform === "darwin" ? input.meta && !input.control : input.control && !input.meta;
  if (!mod) return null;
  if (input.key === "+" || input.key === "=") return "in";
  if (input.key === "-" || input.key === "_") return "out";
  if (input.key === "0") return "reset";
  return null;
}

/** The 52 px top bar grows with the zoom: the traffic lights move down to stay centred in it (18 px at normal size). */
export function trafficLightY(factor: number): number {
  return Math.round(18 + 26 * (factor - 1));
}
