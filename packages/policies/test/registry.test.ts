import { describe, expect, it } from "vitest";
import {
  DEFAULT_POLICY,
  DefaultContextPolicy,
  DefaultModelPolicy,
  contextPolicy,
  isContextPolicyId,
  isModelPolicyId,
  modelPolicy,
  registerContextPolicy,
  registerModelPolicy,
} from "../src";

describe("policy registry", () => {
  it("knows the default ids", () => {
    expect(DEFAULT_POLICY).toBe("default");
    expect(isModelPolicyId("default")).toBe(true);
    expect(isContextPolicyId("default")).toBe(true);
    expect(isModelPolicyId("eco")).toBe(false);
  });
  it("an absent or unknown id runs the default", () => {
    expect(modelPolicy(undefined)).toBe(DefaultModelPolicy);
    expect(modelPolicy("nope")).toBe(DefaultModelPolicy);
  });
  it("an absent or unknown context policy id runs the default", () => {
    expect(contextPolicy(undefined)).toBe(DefaultContextPolicy);
    expect(contextPolicy("nope")).toBe(DefaultContextPolicy);
  });
  it("a registered context policy is known and selectable until it is unregistered", () => {
    const half = { ...DefaultContextPolicy, id: "half" };
    const unregister = registerContextPolicy(half);
    expect(isContextPolicyId("half")).toBe(true);
    expect(contextPolicy("half")).toBe(half);
    unregister();
    expect(isContextPolicyId("half")).toBe(false);
    expect(contextPolicy("half")).toBe(DefaultContextPolicy);
  });
  it("a registered model policy is known and selectable until it is unregistered", () => {
    const eco = { ...DefaultModelPolicy, id: "eco" };
    const unregister = registerModelPolicy(eco);
    expect(isModelPolicyId("eco")).toBe(true);
    expect(modelPolicy("eco")).toBe(eco);
    unregister();
    expect(isModelPolicyId("eco")).toBe(false);
    expect(modelPolicy("eco")).toBe(DefaultModelPolicy);
  });
  it("registering an id that already exists throws", () => {
    expect(() => registerContextPolicy({ ...DefaultContextPolicy })).toThrow();
    expect(() => registerModelPolicy({ ...DefaultModelPolicy })).toThrow();
    const unregister = registerModelPolicy({ ...DefaultModelPolicy, id: "eco" });
    try {
      expect(() => registerModelPolicy({ ...DefaultModelPolicy, id: "eco" })).toThrow();
    } finally {
      unregister();
    }
  });
});
