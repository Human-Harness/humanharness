import { configure } from "@testing-library/react";

// `findBy…` and `waitFor` wait up to 1 s by default: under a full parallel run (Electron builds, workers converting
// files) a render can take longer, and a correct test fails now and then. One shared, roomier limit for every UI test;
// a test that passes never waits for it.
export const ASYNC_UTIL_TIMEOUT = 5_000;
configure({ asyncUtilTimeout: ASYNC_UTIL_TIMEOUT });

// Radix (Select, Dialog) asks the DOM for pointer capture, scrolling and resize observing, which jsdom lacks.
if (typeof Element !== "undefined") {
  const proto = Element.prototype as unknown as Record<string, unknown>;
  proto.hasPointerCapture ??= () => false;
  proto.setPointerCapture ??= () => {};
  proto.releasePointerCapture ??= () => {};
  proto.scrollIntoView ??= () => {};
}
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}
