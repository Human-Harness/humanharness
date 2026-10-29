import type { When } from "@humanharness/harness-sdk";
import type { StepValues } from "../tools/pre-steps";

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
/** Not empty (tools spec §7.2): a list with items, an object with keys, a non-empty string, or any other non-null value. */
const notEmpty = (v: unknown): boolean =>
  Array.isArray(v) ? v.length > 0 : isObject(v) ? Object.keys(v).length > 0 : typeof v === "string" ? v.length > 0 : v !== null && v !== undefined;

/**
 * Whether a recipe's AI step runs (tools spec §7.2): `{ from }` holds when that earlier result is there and not empty;
 * `{ from, where }` when it is a list with an object item whose own top-level fields equal (===) every value. A missing
 * or failed result never holds.
 */
export function whenHolds(when: When | undefined, values: StepValues): boolean {
  if (!when) return true;
  const got = values.get(when.from);
  if (!got || !got.ok) return false;
  if (!when.where) return notEmpty(got.value);
  if (!Array.isArray(got.value)) return false;
  const where = Object.entries(when.where);
  return got.value.some((item) => isObject(item) && where.every(([k, want]) => Object.hasOwn(item, k) && item[k] === want));
}
