import { configure } from "@testing-library/react";

// `findBy…` and `waitFor` wait up to 1 s by default: under a full parallel run (Electron builds, workers converting
// files) a render can take longer, and a correct test fails now and then. One shared, roomier limit for every UI test;
// a test that passes never waits for it.
export const ASYNC_UTIL_TIMEOUT = 5_000;
configure({ asyncUtilTimeout: ASYNC_UTIL_TIMEOUT });
