# Plan 3f — Setup flow, Home states and mock engine

Date: 2026-10-14. Status: approved design (mockups: https://claude.ai/artifact/XEv9Xr1a9dRJqPpTQ3m4Vy).

## Why

Usability testing in mock mode showed four problems:

- "Iniciar Demo" opened Settings on first launch instead of the demo. Nothing said what had to be done.
- Settings mixed setup with settings. Before setup, General and Motor both showed the same welcome text and folder picker.
- In mock mode, the engine and model screens showed Claude and Claude's models, though no AI runs.
- The settings gear looked off: a filled, angular gear in a bordered box.

## 1. Home

Home has one big button. Its label and target depend on whether the app is ready:

- **Ready.** The app is ready when it is configured (language, folder and engine saved) and the engine check found no problem. The button reads "Iniciar {{name}}" and opens the work screen.
- **Not ready.** The button reads "Configurar {{name}}" and opens the setup flow at the first step still missing. A card above it says what is missing:
  - first launch: "Antes de empezar, dos pasos", with "Elegir dónde se guarda tu trabajo" and "Conectar el motor de IA" (a done step shows a check);
  - configured, but the engine has a problem: "Falta un paso: <step>", where the step follows the engine problem: accept the notice, install, update, sign in again, or test it. A check that failed counts as "revisar <engine>".
- **Checking.** While the engine check runs, the button reads "Iniciar {{name}}" and is disabled; the engine pill says "Revisando…".

The engine pill stays as it is (it opens Settings › Motor).

## 2. The setup flow

The setup flow is a screen of its own, not the Settings sheet. It has the top bar with the title "Configurar {{name}}" (and the mock badge), a stepper ("1 Tu carpeta — 2 Motor de IA", with a check on a done step), the step, and a footer with Cancelar/Atrás on the left and Siguiente on the right.

1. **Tu carpeta.** It shows the folder step that Settings showed before: synced places first, then "Solo en esta compu", the path, "Elegir otra carpeta…" and the warnings. Siguiente saves the folder and the language, as "Usar esta carpeta" did. The step is skipped when a folder is already saved; the folder can't be changed here after that (it moves from Settings › General).
2. **Motor de IA.** The engine tiles and each engine's onboarding (notice, install, update, sign in, test), as in Settings › Motor today. Siguiente is enabled once the selected engine is ready. It saves the engine when it differs from the saved one, then shows the last step. The "Usar <engine>" button of Settings is not shown here; Siguiente does that.
3. **Todo listo.** A check, "Todo listo", the folder and the engine (with its model in mock mode), "Podés cambiar todo esto cuando quieras desde Ajustes", and the button "Iniciar {{name}}", which opens the work screen. It has no stepper and no footer.

Cancelar (first step) and Atrás go back: Cancelar returns to Home, Atrás to the folder step only when that step was shown. What was saved stays saved.

## 3. Settings

- **General** shows language, appearance, folder (reveal, move), backup and About. Before a folder is chosen it shows only language, appearance and About: no welcome text and no folder picker.
- **Motor, Modelos and Uso** before the app is configured show one empty state: "Todavía no elegiste un motor", "Primero elegí dónde se guarda tu trabajo y después conectá la IA. Son dos pasos.", and a "Configurar {{name}}" button that closes Settings and opens the setup flow.
- After setup, Motor is as it is today.

## 4. Mock mode engine

In mock mode (`humanharness dev --mock`), the faked engine is shown as a test engine. Its id stays the same (`claude`), so config, models and the runtime don't change.

- **Name and details.** The main process sends it with:
  - name: "Motor de prueba" or "Test engine", in the app's language (saved, else the system's);
  - provider: Human Harness;
  - requirements: none;
  - data location: "Tus datos no salen de esta compu";
  - training: no;
  - no logo and no install command;
  - `reportsLimits: false`;
  - `mock: true`.

  Without a logo, the UI draws a generic screen icon on the tile and the pill.
- **Motor tab and setup step.** For a mock engine, the details read:
  - Modelo: Modelo de prueba;
  - Respuestas: grabadas en `mock/` del harness;
  - Tus datos: no salen de esta compu;
  - Tu plan: no gasta nada.

  There is no "Cerrar sesión", plan, version or legal line. In the setup step, a caption under the tiles says: "En modo prueba hay un solo motor: responde con conversaciones grabadas, sin IA y sin gastar tu plan."
- **Notice.** A faked engine reports the notice as accepted in mock mode. There is no provider to disclose, and nothing leaves the computer. This changes spec 3e §1 "the legal notice stays real" for mock mode only. Plain e2e runs with fake engines keep the real notice.
- **Models.** For the faked engine, `ModelsView` offers one model, `{ id: "mock", name: "Modelo de prueba" | "Test model" }`. Every tier's default model is `mock`, and its effort and cap are left as they are. Modelos then shows "Modelo de prueba" everywhere. fake-claude ignores `--model`.

## 5. Settings icon

The gear becomes a line icon (24-unit stroke gear, as macOS's "gearshape"). It has no box and gets a hover background, and the label "Ajustes" stays as its aria-label. It is used on Home and on the work screen.

## Tests

- **UI unit:**
  - Home's three states and both missing-step cards;
  - the setup flow's steps, skipping the folder step, and Siguiente gated on a ready engine;
  - the Settings empty states;
  - General without a folder;
  - a mock engine's details.
- **Shell unit:** the mock engine view and the mock models view.
- **E2E:** the existing tests keep passing (they start configured). The mock walk-through starts from a fresh app: Configurar → folder → Motor de prueba → Todo listo → Iniciar.

## Changes during implementation

- **Atrás.** It returns to the folder step with the saved folder chosen, and Siguiente there saves again. So within the same flow the folder can still be changed until the engine step is passed; once the flow is left, a saved folder skips the step as specified.
- **Folder step's Siguiente.** It sits in the footer like the engine step's: `FolderStep` renders a form, and with a `formId` it has no button of its own; the footer button submits it (`form={formId}`).
- **Mock caption.** "En modo prueba hay un solo motor…" is shown above the tiles, under the step's intro, not under the tiles.
- **E2E.** Mock launches pass `--lang=es`, so a fresh app with no saved language is in Spanish like the configured ones. Every launch sets `HH_TEST_SUGGESTED_FOLDER` to the sandbox's folder, and the walk-through picks "Solo en esta compu" when synced places exist, so it never writes outside the sandbox.

## Out

- Setup for engines other than the harness's own; changing the folder in the flow after it is saved.
- Any change to the work screen.
