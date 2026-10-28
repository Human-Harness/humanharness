# Spike: plugin panels in the app window, the build and `vm` (2026-10-28)

Checks the assumptions of the Plugins part 2 plan (`docs/superpowers/plans/2026-10-27-plugins-part2.md`, Task 1) with the repo's own Electron (44.7.0, `packages/shell`), esbuild (0.28.2, the copy tsx 4.23.15 brings), React 19.3.0 and Node 22.23.2. Nothing was installed. No network: the only server was the spike's own `http.createServer` on `127.0.0.1:0`, counting every request and WebSocket upgrade. **It saw 0 hits in every run.**

- Folder: written below as `/tmp/hh-pl2-spike/...`; it really ran in the session scratchpad (`.../scratchpad/hh-pl2-spike/`).
- Files: `main.cjs` (Electron main), `app-preload.cjs` + `app/index.html` + `app/app.js` (an app-like page), `plugin/backend.ts` + `plugin/panels/a.tsx` + `a.css` (a plugin folder with no `node_modules`), `build-*.mjs` (esbuild through tsx), `vm.mts` (P-S10).
- The app window copies the real one (`packages/shell/src/main/index.ts`, `createWindow`): `webPreferences: { preload, contextIsolation: true, sandbox: false }`, `nodeIntegrationInSubFrames` unset, loaded with `loadFile`. Its meta CSP is the real one (`packages/shell/src/renderer/index.html`) plus `frame-src hh-plugin:`. The page creates `<iframe sandbox="allow-scripts" src="hh-plugin://x/panel-a.html?…">` and logs every `message` with its origin and whether `event.source === iframe.contentWindow`.
- The scheme is registered exactly as part 1 does (`PLUGIN_SCHEME`: `standard`, `secure`). A part-1-style handler sits on the partition `hh-plugin-x` (with a hidden backend window loading from it); a second handler on `session.defaultSession` serves the panel files with the P2 CSP **header** (`default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; base-uri 'none'; form-action 'none'`), `nosniff` and `no-store`.
- The panel is a React tree bundled by esbuild. On load it reports each probe through `parent.postMessage(…, "*")`, then tries `window.open`, `top.location`, and last `location.href = <target>`.
- Modes: `csp` (panel CSP header; `webRequest` only logs; a `will-frame-navigate` guard), `filter` (no panel CSP, no guard; `webRequest` cancels anything from a panel frame that isn't its own panel file, and any subframe that isn't a panel page), `nometa` (the app meta **without** `frame-src hh-plugin:`). `META=wide` adds `http:` to the app's `frame-src`, only to watch the guard and the filter on their own.

## Summary

| # | Question | Verdict | Plan change |
|---|---|---|---|
| P-S1 | Preload only in the main frame; no `hh`/`require`/`process` in the panel; `parent.document` throws | **Yes** | — |
| P-S2 | Default-session handler coexists with part 1's; CSP header + `'self'` runs `<script type=module>` in the opaque frame; 0 hits | **Partly.** Coexists, `'self'` matches, 0 hits. But a **module** script does **not** load: CORS from origin `null` on a non-CORS scheme. A classic `<script src>` loads | Panels are **classic IIFE scripts**, not ESM (Decision 6, Task 15, Task 22's probe). Scheme privileges stay as part 1 set them |
| P-S3 | `webRequest` sees panel requests with `details.frame.url` = panel URL; app requests pass | **Yes**, with one gap: for a `subFrame` request `details.frame` is the frame being navigated (URL `""` on its first load), so a frame a panel nests is only seen through `details.frame.parent.url` | Task 7: the filter also looks at the parent (ancestors) for `subFrame` |
| P-S4 | `will-frame-navigate` fires for the panel's `location.href`, `isMainFrame` false, `e.frame.url` = panel; `preventDefault` keeps it | **Yes.** With the real app meta, an `http:` target is already refused by the app's `frame-src` before the event, and the frame ends on an error page (a second `load`) | Task 7: the first-load case must require the app page as parent. Task 11's reload on a second `load` is needed (confirmed) |
| P-S5 | `event.origin === "null"`, `event.source === iframe.contentWindow`; `contentWindow.postMessage(msg, "*")` reaches the panel | **Yes** | — |
| P-S6 | Meta with `frame-src hh-plugin:` loads the frame; without it, blocked | **Yes** (`ERR_BLOCKED_BY_CSP`) | — |
| P-S7 | Under `style-src 'self'`: React `style={{…}}` applies; `<style>` and `style="…"` markup are blocked | **Yes** | — (plugin-ui must never inject a `<style>`) |
| P-S8 | `createRequire(tsx/package.json).resolve("esbuild")` | **Yes**: esbuild 0.28.2 | — |
| P-S9 | Alias to absolute paths, no `node_modules` in the plugin, byte-identical builds | **Yes**, with three facts: `react-dom` doesn't resolve from `packages/cli`; `process.env.NODE_ENV` must be defined; bundles embed machine paths unless set up as below | Task 15 |
| P-S10 | `vm` runs `backend.js` and awaits a source; which form works without Node flags under `tsx` | `SourceTextModule` needs `--experimental-vm-modules`. **The IIFE form works without flags**, best made in memory by `esbuild.transform` from the very `dist/backend.js` | Task 17 |

## P-S1: the preload and the panel's globals

The preload sends `location.href` and whether it runs in the main frame. It ran **once**, in the app page (`file://…/app/index.html`, `isMain=true`), never in the panel. From the panel (identical in every mode):

```
P-S1 typeof window.hh        ok "undefined"
P-S1 typeof require          ok "undefined"
P-S1 typeof process          ok "undefined"
P-S1 window.parent.document  threw SecurityError: Blocked a frame with origin "null" from accessing a cross-origin frame.
P-S1 window.parent.hh        threw SecurityError: (same)
P-S1 top.document            threw SecurityError: (same)
localStorage                 threw SecurityError: The document is sandboxed and lacks the 'allow-same-origin' flag.
document.cookie              threw SecurityError: (same)
loaded                       hh-plugin://x/panel-a.html?… origin=null
```

**Holds.** `sandbox: false` on the app window doesn't reach the iframe: with `nodeIntegrationInSubFrames` unset, the preload runs only in the main frame.

## P-S2: the panel handler, its CSP header, and how the script loads

Coexistence: `isProtocolHandled("hh-plugin")` was true on both sessions. The backend window on the partition got the partition handler's page (`title: backend-ran`). The app window's iframe got the default-session handler's. Each session uses its own handler.

**Module scripts don't load.** With `<script type="module" src="./panel-a.js">`:

```
console(error) Access to script at 'hh-plugin://x/panel-a.js' from origin 'null' has been blocked by CORS policy:
  Cross origin requests are only supported for protocol schemes: chrome, chrome-extension, chrome-untrusted, data, http, https.
```

A module script is fetched in CORS mode. The sandboxed frame's origin is opaque (`null`), so its own file is cross-origin, and the scheme isn't CORS-enabled. An `Access-Control-Allow-Origin: *` header alone changes nothing. Registering the scheme with `corsEnabled: true` makes it load (with or without the header). That privilege is scheme-wide, though, so it would reach part 1's backend windows too. **A classic `<script src="./panel-a.js">` (an IIFE bundle) loads with no change at all.** That is the form taken. `<link rel="stylesheet">` loads either way (no-cors).

With the classic script, `script-src 'self'` and `style-src 'self'` match `hh-plugin://x` even though the frame's origin is `null`: `'self'` is the response URL's origin. Network probes in mode `csp` (`webRequest` only logging):

```
fetch                       threw TypeError: Failed to fetch      (CSP: connect-src via default-src 'none')
XHR                         error
WebSocket                   constructed, then error              (blocked by CSP)
EventSource                 constructed, then error
sendBeacon                  returned true, blocked by CSP
<img src=http>              error                                 (img-src)
<script src=http>           error                                 (script-src)
import("http://…/mod.js")   threw TypeError: Failed to fetch dynamically imported module
new Worker(http)            threw SecurityError (cannot be accessed from origin 'null')
new Worker(blob:)           constructed, then error              (worker-src via script-src 'self')
<link rel=prefetch>         error                                 (default-src)
fetch(own hh-plugin css)    threw TypeError (connect-src)
fetch(hh-plugin://y/…)      threw TypeError (connect-src)
<iframe src=http>           ERR_BLOCKED_BY_CSP (frame-src via default-src)
(0, eval)("1+1")            threw EvalError (no 'unsafe-eval')
window.open(http)           null ("sandboxed frame whose 'allow-popups' permission is not set")
top.location.href = http    threw SecurityError (no 'allow-top-navigation')
SERVER HITS []
```

One thing the CSP lets through: `<img src="hh-plugin://x/backend.js">` passes `img-src 'self'` and **reaches the default-session handler**. The image fails only because the spike's handler refused the name. So Task 7's handler rule (P7: never serve `backend.js`, `plugin.json` or `_hh/`) is load-bearing, not just defence in depth.

**Verdict: partly holds.** CSP, `'self'` and 0 hits hold. ESM panel bundles don't: panels ship as classic IIFE scripts.

## P-S3: what `webRequest` sees

Mode `filter` (no panel CSP; the filter cancels): server hits `[]`. The log, trimmed:

```
pass   mainFrame  file://…/app/index-wide.html        frame=""                         (the app itself)
pass   script     file://…/app/app.js                 frame=file://…/app/index-wide.html
pass   subFrame   hh-plugin://x/panel-a.html?…        frame=""  parent=file://…/app/…  (the panel's first load)
pass   stylesheet hh-plugin://x/panel-a.css           frame=hh-plugin://x/panel-a.html?…
pass   script     hh-plugin://x/panel-a.iife.js       frame=hh-plugin://x/panel-a.html?…
CANCEL xhr        http://127.0.0.1:<port>/fetch       frame=hh-plugin://x/panel-a.html?…
CANCEL xhr        …/xhr, …/es                          (same frame)
CANCEL webSocket  ws://127.0.0.1:<port>/ws
CANCEL ping       …/beacon
CANCEL image      …/img
CANCEL script     …/script.js, …/mod.js
CANCEL other      …/prefetch
CANCEL xhr        …/from-worker                        frame=hh-plugin://x/panel-a.html?…  (a fetch inside a blob: Worker)
CANCEL image      hh-plugin://x/backend.js             (the filter here allowed only panel files)
CANCEL image      hh-plugin://y/panel-a.css
CANCEL subFrame   http://127.0.0.1:<port>/iframe       frame=""  parent=hh-plugin://x/panel-a.html?…
CANCEL subFrame   http://127.0.0.1:<port>/nav          frame=hh-plugin://x/panel-a.html?…  parent=file://…
```

Facts for Task 7:
- `details.frame.url` is the panel's URL for everything it loads, a worker's requests included. The app's own requests carry the app page's URL and pass.
- `details.frame.url` **includes the query string** when the iframe's `src` has one. Compare host and path, never the whole string.
- For a **`subFrame`** request, `details.frame` is the frame **being navigated**. On a first load its URL is `""`, and only `details.frame.parent.url` says who embeds it. A frame that a panel nests (`<iframe src=http>`) shows `frame=""`, `parent=hh-plugin://x/…`. A filter that reads only `details.frame.url` would let it pass. The panel CSP's `frame-src` (via `default-src 'none'`) blocks it first, but the filter is meant to hold on its own (P2).
- `details.frame` may be null, and reading `.url` on a disposed frame can throw. Wrap it.
- `file:///etc/hosts` and requests the CSP refuses never reach `webRequest` (as in part 1).

**Holds**, with the subframe gap. Without the guard, the cancelled `location.href` left the iframe on an error page whose URL is the blocked target (`frames now [… "http://127.0.0.1:<port>/nav"]`, `iframe load #2`).

## P-S4: the frame-navigation guard

The guard: `preventDefault()` unless `isMainFrame`, or the target is `hh-plugin://x/panel-a.html` and the frame is on its first load (`frame.url` `""`/`about:blank`) or already on `hh-plugin://x/`. With `META=wide`, so the app's own CSP doesn't act first:

```
will-frame-navigate allow   isMainFrame=false url=hh-plugin://x/panel-a.html?…  frame.url=""  parent=file://…/app/…
will-frame-navigate PREVENT isMainFrame=false url=http://127.0.0.1:<port>/nav   frame.url="hh-plugin://x/panel-a.html?…"
P-S4 still here after location.href  hh-plugin://x/panel-a.html?…
SERVER HITS []
```

With the **real** meta (`frame-src hh-plugin:`):
- `hh-plugin://y/panel-a.html` → `will-frame-navigate PREVENT`, `frame.url` = the panel; the panel stays.
- `hh-plugin://x/backend.js` → the same.
- `http://127.0.0.1:<port>/nav` → **the event doesn't fire**. The app's own `frame-src` refuses it first ("Framing 'http://127.0.0.1:…/' violates … frame-src hh-plugin:"), the frame ends on an error page (`did-fail-provisional-load -30 ERR_BLOCKED_BY_CSP`), and the iframe fires `load` a **second time**. The panel is gone until the app reloads it. That is exactly the case Task 11's "reload on a second `load`" covers.

A frame a panel nests fires the event too, with `frame.url ""` and `parent` = the panel. So "first load" alone is not enough to allow an `hh-plugin:` target: a panel could frame another plugin's panel, if its own CSP didn't stop it.

**Holds.** `e.url`, `e.isMainFrame` and `e.frame.url` are as planned. `will-navigate` never fired for subframes.

## P-S5: messages both ways

```
APP msg origin="null" sourceIsIframe=true {"panel":"a","probe":"loaded",…}
APP msg origin="null" sourceIsIframe=true {"panel":"a","probe":"P-S5 got ping from parent","result":"origin=null sourceIsParent=true data={\"ping\":1}"}
```

Every message from the panel had `origin "null"` and `event.source === iframe.contentWindow`. The app's `iframe.contentWindow.postMessage({ ping: 1 }, "*")` reached the panel with `event.source === parent`. The panel saw the app's origin as `"null"` too, because the app page is `file:`; in development it would be the dev server's. The panel side must therefore check `event.source === window.parent`, not the origin, as Task 8 already does. **Holds.**

## P-S6: the app's CSP

Mode `nometa` (the real meta, unchanged):

```
console(error) Framing 'hh-plugin://x/' violates the following Content Security Policy directive: "default-src 'self'". … 'frame-src' was not explicitly set
did-fail-provisional-load -30 ERR_BLOCKED_BY_CSP hh-plugin://x/panel-a.html?… main=false
```

With `frame-src hh-plugin:` the panel loads (every other run). **Holds**: P8's one directive is needed and enough. As a side effect it also stops a panel's own navigation to any non-`hh-plugin:` URL (P-S4).

## P-S7: styles under `style-src 'self'`

```
P-S7 react style={{height:10}} computed       10px     (applied: CSSOM)
P-S7 el.style.width = "77px"                   77px     (applied: CSSOM)
P-S7 css file rule (.from-css width 33px)      33px     (panel-a.css, emitted by esbuild from `import "./a.css"`)
P-S7 <style> element (44px?)                   284px    (blocked: "Applying inline style violates … style-src 'self'")
P-S7 style="…" in markup via innerHTML (55px?) 284px    (blocked)
P-S7 setAttribute("style", …) (66px?)          284px    (blocked)
```

In mode `filter` (no CSP) all three blocked ones apply (44, 55, 66 px), so the CSP is what blocks them. **Holds**: no `'unsafe-inline'` for panels. Panel code and plugin-ui must never inject a `<style>` element or set a `style` attribute (CSS-in-JS libraries that do will not work). Styles come from the built `panel-<id>.css` or from React's `style` prop.

## P-S8: esbuild through tsx

From `packages/cli`: `createRequire(createRequire("packages/cli/package.json").resolve("tsx/package.json")).resolve("esbuild")` → `node_modules/.pnpm/esbuild@0.28.2/node_modules/esbuild/lib/main.js`, version `0.28.2`. **Holds.**

## P-S9: the bundle

`plugin/` has `backend.ts` (importing `@humanharness/harness-sdk/plugin-backend`), `panels/a.tsx` (React, `react-dom/client`, `import "./a.css"`) and **no `node_modules`** (and none in any parent folder). Options: `bundle`, `platform: "browser"`, `target: "chrome130"`, `legalComments: "none"`, `charset: "utf8"`, `jsx: "automatic"`, with `alias` to absolute paths: `react` → the CLI's `react` folder, `react-dom` → a `react-dom` folder, and `@humanharness/harness-sdk/plugin-backend` → `packages/harness-sdk/src/plugin-backend.ts`. An alias for a package name covers its sub-paths (`react/jsx-runtime`, `react-dom/client`). It also applies to imports inside `node_modules`.

```
same backend.js / backend.iife.js / panel-a.js / panel-a.css   (two builds, cmp: byte-identical)
backend.js 580 B; panel-a.js 683 KB (minify off) / 491 KB (minifyWhitespace)
```

**Holds**, with three facts for Task 15:
1. **`react-dom` does not resolve from `packages/cli`.** The CLI has only `react` (a devDependency). It resolves from `@humanharness/ui`, which depends on it. With no installs allowed, resolve it through `@humanharness/ui`'s `package.json`.
2. **`define: { "process.env.NODE_ENV": '"production"' }` is required.** Without it React's entry keeps a `process.env` branch, and `process` doesn't exist in a panel.
3. **Machine paths end up in the bundle.** With `absWorkingDir: <plugin dir>` and `minify: false`, every module gets a `// ../../../../Users/<name>/…/node_modules/.pnpm/react@19.3.0/…` comment. React's CommonJS modules are also wrapped as `__commonJS({ "../../../../Users/<name>/…": … })`, so the path stays even with `minifyWhitespace`. That leaks the author's home path and makes output depend on where the plugin sits. **Setting `absWorkingDir` to the workspace root the aliases point into, together with `minifyWhitespace: true`, gave 0 occurrences** of the home path or the plugin's (temp) path. Names stay readable; only whitespace and comments go. Determinism held. With the workspace root and `minify: false`, the library keys are clean (`node_modules/.pnpm/react@19.3.0/…`), but a comment naming the plugin's own files remains, a home path for a plugin outside the repo.
- A **direct `eval`** in plugin code makes esbuild wrap that module the same way, with its full relative path. It warns (`direct-eval`), and the panel CSP refuses `eval` anyway.

## P-S10: running `backend.js` in `vm`

`vm.mts` under `packages/cli`'s `tsx` (`execArgv` = tsx's `--require`/`--import` only), with a fake `ctx` recording calls:

```
typeof vm.SourceTextModule: undefined
FORM 1 (SourceTextModule) failed: not a constructor
FORM 2 (IIFE + runInContext) ok: fetch https://api.example.com/items | put items a | put items b | chip count 2 items
FORM 2 globals inside the context: typeof process/require/fetch/setTimeout = undefined,undefined,undefined,undefined
FORM 3 (dist backend.js → esbuild.transform iife in memory → runInContext) ok: (same calls)
--- NODE_OPTIONS=--experimental-vm-modules
typeof vm.SourceTextModule: function
FORM 1 (SourceTextModule) ok: (same calls)
```

- Form 1 needs `--experimental-vm-modules`.
- Form 2 needs a second bundle, built with `format: "iife", globalName`.
- **Form 3 needs neither.** It reads the **same bytes the app runs** (`dist/backend.js`, ESM), turns them into an IIFE in memory with `esbuild.transform(code, { format: "iife", globalName: "__hhBackend" })`, runs that with `vm.runInContext` in a fresh context, and awaits `__hhBackend.default.sources[id](ctx)`. No file is written.
- A new context is empty: no `setTimeout`, `URL`, `TextEncoder`… Whatever the backend window has must be passed in (Task 17 already lists them).

**Taken: Form 3.**

## What the plan changes

- **Decision 6 / Task 15:** `panel-<id>.html` loads a **classic** script, `<script src="./panel-<id>.js"></script>` (no `type="module"`; it sits after `#root`), and `panel-<id>.js` is built with `format: "iife"`. `backend.js` stays ESM (part 1's host imports it). Build options gain `define: { "process.env.NODE_ENV": '"production"' }`, `absWorkingDir` = the workspace root and `minifyWhitespace: true` (or another way to keep machine paths out, with a test that the bundle holds neither `os.homedir()` nor the plugin's absolute path). `react-dom` resolves through `@humanharness/ui`.
- **Task 7:** `allowPanelRequest` judges a `subFrame` request by its parent too, so frames nested by a panel are caught. `allowFrameNavigation`'s first-load case holds only when the parent is the app's main frame. Paths are compared without the query.
- **Task 8:** plugin-ui injects no `<style>` element and sets no `style` attribute.
- **Task 17:** Form 3.
- **Task 22:** the hand-written probe uses a classic script. Its `location.href = server + "/nav"` is refused by the app's own `frame-src` before `will-frame-navigate`, leaves an error page and fires a second `load`: the reload path is what the e2e sees.
- No change for P-S1, P-S5, P-S6, P-S7, P-S8. The scheme's privileges stay as part 1 set them (no `corsEnabled`).
