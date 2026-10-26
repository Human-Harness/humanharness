# App look and feel (v2, "native app")

Status: approved direction (2026-10-11). Mockups: https://claude.ai/artifact/2cwBLd5xqYXiec38Qc74zX (page "v2 · App"). The v1 "web page" look on the same canvas was rejected: it read as a website, not an app.

## Principles

- Looks like a native macOS app, not a web page: fixed window, no page scroll on the home, compact controls, system font for UI text.
- Monochrome, taken from the Human Harness logo (beveled charcoal H on paper). One extra color only for warnings (usage limits) and one for "connected".
- The core owns this look for every harness. A harness supplies its name, tagline, logo (optional, defaults to the Human Harness H) and its own work screen inside the kit.

## Window

- `BrowserWindow`: `titleBarStyle: "hiddenInset"`, `trafficLightPosition` aligned with the top bar, `backgroundColor` = paper token (no white flash). Default size 1100×720, minimum ~900×600.
- Top bar 52 px: `-webkit-app-region: drag`; its buttons `no-drag`; ~80 px left inset for the traffic lights.

## Screens

1. **Home** (first screen every launch): large logo centered, harness name (display font), tagline, primary button "Iniciar <name>" / "Start <name>", engine pill below (engine logo, name, connection state, short usage e.g. "5 h · 42%"). Gear icon button top-right opens Settings. Footer: "Human Harness" wordmark and the folder path.
   - First launch (not configured): the primary button opens Settings on the Motor tab (and the folder step) instead of starting.
2. **Settings sheet** (gear): a sheet attached under the top bar, dimmed backdrop, segmented tabs **General · Motor · Uso**, "Listo"/"Done" button.
   - **General:** language (segmented), appearance automatic/light/dark (segmented), text size Normal/Grande/Más grande/Máximo (100/115/130/150 % zoom of the whole window, so the chrome and the harness's blocks grow together; also ⌘+, ⌘− and ⌘0; saved per app like appearance), folder row (fixed after first use; "Show in Finder"), About card (harness name + version, "made by <developer> with Human Harness", **Support** donation button from the manifest).
   - **Motor:** engines as large tiles with each provider's official logo, name and state (connected / not connected), plus a dashed "More engines · coming soon" tile. Below: account plan, where data goes, installed version, sign out. Disclaimer line. Onboarding (install, login, test, legal acceptance) runs from here.
   - **Uso:** the usage meter details (plan windows, reset times, cost of each action).
3. **Work screen** (after Start): not designed yet; keep the current chat/blocks layout restyled with the same tokens until it is.
   - **An answer arriving:** a sent question moves to the top of the chat and stays there; the answer grows into the room below it and nothing scrolls by itself. Text runs and blocks show in the order they arrived (saved so in the entry's `parts`, so the finished answer looks the same). The window paces the answer at about one word every 110 ms (faster when far behind the engine), each word and block fading in; reduced motion turns the fades off. The agent's instructions ask it to write the sentence that introduces a block before calling it.

### Changed by plan 3f (2026-10-14)

Spec `2026-10-14-setup-flow-design.md` changes the screens above:

- **Setup is its own flow.** A screen of its own, not the Settings sheet: top bar "Configurar <name>", a stepper (Tu carpeta, Motor de IA), the step, and a footer with Cancelar/Atrás on the left and Siguiente on the right; then "Todo listo" with "Iniciar <name>".
- **Home: Iniciar or Configurar.** "Iniciar <name>" only when the app is configured and the engine check passed (disabled while it runs). Otherwise "Configurar <name>" opens the setup flow at the first missing step, under a card that says what is missing. The first-launch rule above (the button opens Settings) no longer applies.
- **Settings no longer holds setup.** General has no welcome text or folder picker before a folder is chosen. Motor, Modelos and Uso show one empty state that leads to the setup flow until the app is configured. Settings also has a Modelos tab (plan 3c).
- **Line gear.** The settings button is a line gear icon (stroke, as macOS's "gearshape") with no box and a hover background, on Home and the work screen.

## Tokens

| Token | Value | Use |
|---|---|---|
| paper | `#F4F4F1` | window background |
| sheet | `#FBFBFA` | sheets |
| surface | `#FFFFFF` | cards, tiles, grouped rows |
| ink | `#191E24` | text, primary button, selection |
| slate | `#3F4852` | secondary text |
| muted | `#5B636C` | captions (≥4.5:1 on paper) |
| line | `#CFCFCB` / `#E1E1DD` | window border / row borders |
| segment | `#E7E7E3` | segmented control track |
| ok | `#2E6B4F` (dot `#2E8A5C`) | connected |
| warn | `#9A4A12` | usage warnings, heavy actions |
| backdrop | `rgba(25,30,36,.18)` | behind sheets |

- Fonts: UI text in the system font (`-apple-system, BlinkMacSystemFont, system-ui`), 13 px base. Display (harness name, wordmark) in Lexend 500/600, bundled with the app (no network fonts).
- Primary button: ink fill, white 15 px semibold text, 46 px tall, corners chamfered 9 px (top-left and bottom-right) as a nod to the logo's bevel. Secondary buttons: 28–30 px, white, 1 px line, 6–7 px radius (macOS style).
- Tiles and grouped rows: 10–12 px radius, 1 px line; selected tile 2 px ink border plus a check badge.

## Engine logos

Provider logos (Claude, OpenAI/Codex) are trademarks: use the official assets under each provider's brand guidelines, shipped as files in the engines package (one per engine). Check those guidelines before distribution (part of the legal gate).
