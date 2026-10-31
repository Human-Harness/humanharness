import { describe, expect, it } from "vitest";
import { DEFAULT_POLICY, DefaultModelPolicy, isContextPolicyId, isModelPolicyId, modelPolicy } from "../src";

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
});
