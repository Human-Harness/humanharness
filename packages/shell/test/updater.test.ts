import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startUpdater } from "../src/main/updater";

const HOUR = 3600_000;

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("startUpdater", () => {
  it("does nothing when the app is not packaged", () => {
    const updater = { checkForUpdatesAndNotify: vi.fn(async () => null) };
    const stop = startUpdater({ packaged: false, updater, log: vi.fn() });
    vi.advanceTimersByTime(24 * HOUR);
    expect(updater.checkForUpdatesAndNotify).not.toHaveBeenCalled();
    expect(() => stop()).not.toThrow();
  });

  it("checks at start and every 6 hours", () => {
    const updater = { checkForUpdatesAndNotify: vi.fn(async () => null) };
    startUpdater({ packaged: true, updater, log: vi.fn() });
    expect(updater.checkForUpdatesAndNotify).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(6 * HOUR);
    expect(updater.checkForUpdatesAndNotify).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(6 * HOUR);
    expect(updater.checkForUpdatesAndNotify).toHaveBeenCalledTimes(3);
  });

  it("logs a rejected check and still runs the next tick", async () => {
    const check = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(null);
    const log = vi.fn();
    startUpdater({ packaged: true, updater: { checkForUpdatesAndNotify: check }, log });
    await vi.advanceTimersByTimeAsync(0);
    expect(log).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(6 * HOUR);
    expect(check).toHaveBeenCalledTimes(2);
  });

  it("logs a check that throws synchronously", () => {
    const log = vi.fn();
    const updater = { checkForUpdatesAndNotify: vi.fn(() => { throw new Error("boom"); }) };
    expect(() => startUpdater({ packaged: true, updater, log })).not.toThrow();
    expect(log).toHaveBeenCalledTimes(1);
  });

  it("stops checking once stopped", () => {
    const updater = { checkForUpdatesAndNotify: vi.fn(async () => null) };
    const stop = startUpdater({ packaged: true, updater, log: vi.fn() });
    stop();
    vi.advanceTimersByTime(12 * HOUR);
    expect(updater.checkForUpdatesAndNotify).toHaveBeenCalledTimes(1);
  });

  it("never sets the channel and honours a custom interval", () => {
    const updater: { checkForUpdatesAndNotify: () => Promise<unknown>; channel?: string } = { checkForUpdatesAndNotify: vi.fn(async () => null) };
    startUpdater({ packaged: true, updater, log: vi.fn(), intervalMs: 1000 });
    vi.advanceTimersByTime(1000);
    expect(updater.checkForUpdatesAndNotify).toHaveBeenCalledTimes(2);
    expect(updater.channel).toBeUndefined();
  });
});
