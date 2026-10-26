import { describe, expect, it } from "vitest";
import { devDockIcon } from "../src/main/dock-icon";

const image = (file: string) => ({ file, isEmpty: () => file.endsWith(".svg") || file.includes("missing") });

describe("devDockIcon", () => {
  it("takes the harness's logo when it is a picture", () => {
    expect(devDockIcon([() => "logo.png", () => "hh-logo.png"], image)?.file).toBe("logo.png");
  });

  it("falls back to Human Harness's logo without a harness logo, with an SVG one or a missing file", () => {
    expect(devDockIcon([() => undefined, () => "hh-logo.png"], image)?.file).toBe("hh-logo.png");
    expect(devDockIcon([() => "logo.svg", () => "hh-logo.png"], image)?.file).toBe("hh-logo.png");
    expect(devDockIcon([() => "missing.png", () => "hh-logo.png"], image)?.file).toBe("hh-logo.png");
  });

  it("skips a logo whose path can't be resolved", () => {
    const outside = () => {
      throw new Error("leaves the harness folder");
    };
    expect(devDockIcon([outside, () => "hh-logo.png"], image)?.file).toBe("hh-logo.png");
  });

  it("gives null when nothing loads", () => {
    expect(devDockIcon([() => "missing.png"], image)).toBeNull();
  });
});
