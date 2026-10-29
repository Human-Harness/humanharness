import { describe, expect, it } from "vitest";
import { commandLoadsOtherCode, importsOtherCode } from "../../src/main/engine-config/outside-code";

describe("code outside the approval (hatches spec §5.3)", () => {
  it("finds imports, sources and package runners in a script", () => {
    for (const text of [
      "import fs from 'node:fs';",
      "const x = await import('./x.js');",
      "import {\n  a,\n} from './a';",
      "const h = require('./helpers');",
      "import os\n",
      "from helpers import run\n",
      "source ./env.sh\n",
      ". ./env.sh\n",
      "require 'json'\n",
      "use strict;\nuse Foo::Bar;\n",
      "npx -y tool\n",
      "#!/usr/bin/env node\nconsole.log(1);\n",
    ]) {
      expect(importsOtherCode(text), text).toBe(true);
    }
    for (const text of ["console.log('lint')", "#!/bin/sh\necho done\n", "'use strict';\nconsole.log(1);", ""]) {
      expect(importsOtherCode(text), text).toBe(false);
    }
  });

  it("stays fast on large blank input (64 KB of newlines, spaces or tabs)", () => {
    for (const text of ["\n".repeat(256 * 1024), " ".repeat(256 * 1024), "\t".repeat(256 * 1024), " \n\t\r\n".repeat(64 * 1024), "from ".repeat(50_000)]) {
      const start = performance.now();
      expect(importsOtherCode(text)).toBe(false);
      expect(performance.now() - start).toBeLessThan(200);
    }
  });

  it("marks commands that run a package runner, python -m, node_modules/.bin or a URL", () => {
    expect(commandLoadsOtherCode("npx -y some-tool")).toBe(true);
    expect(commandLoadsOtherCode(["uvx", "mcp-fetch"])).toBe(true);
    expect(commandLoadsOtherCode(["pnpm", "dlx", "x"])).toBe(true);
    expect(commandLoadsOtherCode(["python3", "-m", "server"])).toBe(true);
    expect(commandLoadsOtherCode("sh -c 'npx tool'")).toBe(true);
    expect(commandLoadsOtherCode('node "$CLAUDE_PROJECT_DIR"/tools/stop.js')).toBe(false);
    expect(commandLoadsOtherCode(["node", "./tools/lint.js"])).toBe(false);
    // Words it can't read for sure: said rather than hidden.
    expect(commandLoadsOtherCode("node $HOME/x.js")).toBe(true);
  });
});
