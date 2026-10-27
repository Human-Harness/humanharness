import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { type HarnessInput, PROFILE_COLLECTION, PROFILE_COLORS, defineHarness, hasProfiles, loadHarness, profileFormSpec, z } from "../src";

const fixture = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../fake-agent/fixtures/profiles-harness/harness.config.ts");

const profile = {
  scoped: false,
  single: true,
  schema: z.object({
    name: z.string().min(1).max(40),
    color: z.enum(PROFILE_COLORS).optional(),
    ageBand: z.enum(["6-9", "10-12", "13-17", "adult"]).optional(),
    notes: z.record(z.string(), z.string()).optional(),
  }),
  agent: "read" as const,
};
const base: HarnessInput = {
  id: "family",
  name: "Family Tutor",
  core: "^0.1.0",
  engines: ["claude"],
  folder: { suggested: "Documents/Family Tutor" },
  instructions: "./AGENTS.md",
  permissions: { edit: "none", exec: false, web: false },
  blocks: {},
  actions: { practice: { label: "Practice", prompt: "tasks/practice.md", cost: "light" } },
  data: { profile },
  author: "t",
};
const withProfiles: HarnessInput = { ...base, profiles: { label: "student", fields: ["name", "color", "ageBand"] } };

/** Every issue of a manifest, as `path: message`; [] when it parses. */
function issues(input: HarnessInput): string[] {
  try {
    defineHarness(input);
    return [];
  } catch (e) {
    return (e as { issues: { path: PropertyKey[]; message: string }[] }).issues.map((i) => `${i.path.map(String).join(".")}: ${i.message}`);
  }
}

describe("profiles in the manifest (profiles spec §3)", () => {
  it("D0: a manifest without profiles has none", () => {
    const h = defineHarness(base);
    expect(h).not.toHaveProperty("profiles");
    expect(hasProfiles(h)).toBe(false);
    expect(profileFormSpec(h)).toEqual({ fields: [] });
  });

  it("parses a label and the form's fields", () => {
    const h = defineHarness(withProfiles);
    expect(h.profiles).toEqual({ label: "student", fields: ["name", "color", "ageBand"] });
    expect(hasProfiles(h)).toBe(true);
    expect(PROFILE_COLLECTION).toBe("profile");
  });

  it("the form draws the listed fields in order, from the profile collection's schema", () => {
    const spec = profileFormSpec(defineHarness(withProfiles));
    expect(spec.fields.map((f) => [f.name, f.kind, f.optional])).toEqual([
      ["name", "text", false],
      ["color", "choice", true],
      ["ageBand", "choice", true],
    ]);
    expect(spec.fields[1].options).toEqual([...PROFILE_COLORS]);
  });

  it("needs a one-record, app-wide profile collection with a name string", () => {
    const { profile: _gone, ...noProfile } = withProfiles.data!;
    expect(issues({ ...withProfiles, data: noProfile })).toContain('profiles: Profiles keep who each person is in a "profile" collection: declare it in data');
    expect(issues({ ...withProfiles, data: { profile: { ...profile, scoped: true } } })).toContain(
      'data.profile: A profile keeps one app-wide record: "profile" needs single: true and scoped: false',
    );
    expect(issues({ ...withProfiles, data: { profile: { ...profile, single: false, key: "name" } } })).toContain(
      'data.profile: A profile keeps one app-wide record: "profile" needs single: true and scoped: false',
    );
    const noName = { ...profile, schema: z.object({ title: z.string() }) };
    expect(issues({ ...withProfiles, profiles: { label: "student", fields: ["title"] }, data: { profile: noName } })).toContain(
      'data.profile: The profile collection needs a "name" field that is a string',
    );
    const optionalName = { ...profile, schema: z.object({ name: z.string().optional() }) };
    expect(issues({ ...withProfiles, profiles: { label: "student", fields: ["name"] }, data: { profile: optionalName } })).toContain(
      'data.profile: The profile collection needs a "name" field that is a string',
    );
  });

  it("the fields start with name, are fields of the schema, are listed once and can be drawn", () => {
    expect(issues({ ...withProfiles, profiles: { label: "student", fields: ["color", "name"] } })).toContain('profiles.fields: The first field is "name"');
    expect(issues({ ...withProfiles, profiles: { label: "student", fields: ["name", "age"] } })).toContain('profiles.fields: "age" is not a field of "profile"');
    expect(issues({ ...withProfiles, profiles: { label: "student", fields: ["name", "color", "color"] } })).toContain('profiles.fields: "color" is listed twice');
    expect(issues({ ...withProfiles, profiles: { label: "student", fields: ["name", "notes"] } })).toContain('profiles.fields: The profile form can\'t draw "notes"');
  });

  it("refuses an empty label and too many fields", () => {
    expect(issues({ ...withProfiles, profiles: { label: "", fields: ["name"] } }).some((i) => i.startsWith("profiles.label"))).toBe(true);
    expect(issues({ ...withProfiles, profiles: { label: "student", fields: ["name", "a", "b", "c", "d", "e", "f"] } }).some((i) => i.startsWith("profiles.fields"))).toBe(true);
  });

  it("the fixture loads", async () => {
    const h = await loadHarness(fixture);
    expect(h.id).toBe("family");
    expect(h.profiles?.label).toBe("student");
  });
});
