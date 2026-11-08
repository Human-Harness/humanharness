import { z } from "zod";

/** A mod's id: what the manifest's `mods` keys, config.json and `.harness/mods/<id>/` use. */
export const MOD_ID = /^[a-z][a-z0-9-]{0,39}$/;
/** The mod API this core speaks (spec §4.1 `apiVersion`). A mod for another version is refused. */
export const MOD_API_VERSION = 1;
/** A relative path inside the mod's folder: no `..` segment, not absolute. */
const inside = z.string().min(1).max(200).refine((p) => !p.startsWith("/") && !p.split(/[\\/]/).includes(".."), "main must be inside the mod's folder");

/** `mod.json`: the only part of a mod read without running its code (spec §4.1). */
export const modJsonSchema = z
  .strictObject({
    id: z.string().regex(MOD_ID, "A mod id is lowercase letters, digits and -, at most 40"),
    name: z.string().min(1).max(60),
    version: z.string().regex(/^\d+\.\d+\.\d+$/, "version is x.y.z"),
    apiVersion: z.literal(MOD_API_VERSION),
    requires: z.array(z.string().regex(MOD_ID)).max(10).default([]),
    /** The mod's `.harness/mods/<id>/` folder is in the work folder's history. Absent: excluded. */
    history: z.boolean().default(false),
    /** The built main part, relative to the folder. 0b adds bundling `main.ts`. */
    main: inside.default("main.js"),
  })
  .refine((m) => !m.requires.includes(m.id), { message: "A mod can't require itself", path: ["requires"] });

export type ModJson = z.output<typeof modJsonSchema>;
