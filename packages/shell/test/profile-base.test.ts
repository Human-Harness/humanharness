import path from "node:path";
import { describe, expect, it } from "vitest";
import { baseFor, isInsideFolder, profileOfBase } from "../src/main/profile-base";

describe("baseFor (profiles spec D2, D4)", () => {
  it("D0: without profiles the base is the folder, whatever profile says", () => {
    expect(baseFor({ folder: "/w" }, false)).toBe("/w");
    expect(baseFor({ folder: "/w", profile: "sofi" }, false)).toBe("/w");
  });

  it("with profiles it is the active profile's folder, and null while none is active", () => {
    expect(baseFor({ folder: "/w", profile: "sofi" }, true)).toBe(path.join("/w", "sofi"));
    expect(baseFor({ folder: "/w" }, true)).toBeNull();
    expect(baseFor({ folder: "/w", profile: "../x" }, true)).toBeNull();
  });
});

describe("profileOfBase", () => {
  it("names the profile of a folder right inside the root", () => {
    expect(profileOfBase("/w", path.join("/w", "sofi"))).toBe("sofi");
    expect(profileOfBase("/w", "/w")).toBeNull();
    expect(profileOfBase("/w", path.join("/w", "sofi", "x"))).toBeNull();
    expect(profileOfBase("/w", path.join("/other", "sofi"))).toBeNull();
  });

  it("compares normalized paths: a trailing separator or a `..` step does not hide the profile", () => {
    expect(profileOfBase("/w/", "/w/sofi/")).toBe("sofi");
    expect(profileOfBase("/w", "/w/x/../sofi")).toBe("sofi");
    expect(profileOfBase("/w", "/w/sofi/..")).toBeNull();
  });
});

describe("isInsideFolder", () => {
  it("is the folder itself or anything under it", () => {
    expect(isInsideFolder("/w", "/w")).toBe(true);
    expect(isInsideFolder(path.join("/w", "sofi"), "/w")).toBe(true);
    expect(isInsideFolder("/w2", "/w")).toBe(false);
  });

  it("compares normalized paths", () => {
    expect(isInsideFolder("/w/", "/w")).toBe(true);
    expect(isInsideFolder("/w/sofi", "/w/")).toBe(true);
    expect(isInsideFolder("/w/sofi/../../etc", "/w")).toBe(false);
    expect(isInsideFolder("/w/x/../sofi", "/w/sofi")).toBe(true);
  });
});
