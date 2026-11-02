import { type ConvertRunner, MaterialRefused, convertFile, measureFile } from "@humanharness/material";

/**
 * A runner that converts in the calling thread. The real runner (`workerRunner`) starts a worker thread per file, and
 * a worker built from the TypeScript source boots tsx first (~1.3 s of the test's time, more under load): a test that
 * adds six files spent ~4.4 s of its 5 s budget just starting workers, and one that adds one file spent 1.4 s. Tests
 * about the service (what is kept, shown, queued, how many jobs run at once) do not need the isolation, which has its
 * own tests in packages/material (convert-worker.test.ts, pipeline.test.ts). Errors read as the worker's do: a refusal
 * stays itself, anything else is "unreadable".
 */
export function inProcessRunner(): ConvertRunner {
  const refuse = (err: unknown): never => {
    throw err instanceof MaterialRefused ? err : new MaterialRefused("unreadable");
  };
  return {
    convert: (type, data, opts) => convertFile(type, data, opts).catch(refuse),
    measure: (type, data, name, link) => measureFile(type, data, name, link).catch(refuse),
  };
}
