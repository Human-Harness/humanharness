# Human Harness — core y primer harness

- Fecha: 2026-10-10
- Estado: diseño aprobado por secciones, pendiente revisión del spec escrito
- Alcance: core + contrato de harness + Socrates como harness de referencia. La web/catálogo y Ariadna van en specs aparte.

## 1. Qué es

Human Harness es un framework open source para construir **harnesses**: apps de escritorio instalables que ponen una interfaz y un flujo de trabajo definido sobre un agente de IA. El motor no es una API key del desarrollador: cada usuario usa **su propia suscripción** a través del CLI oficial del proveedor, que la app instala y configura.

El público final es **no técnico**: nada de terminales, puertos, Node ni git a la vista.

Hoy ese patrón existe repetido en ariadna-web y socrates-app (Next.js local que hace `spawn("claude", ["-p", ...])`). Human Harness extrae lo común para que cada harness nuevo sea solo configuración, contenido y UI propia.

## 2. Principios

1. **Un harness = configuración + flujo agéntico + UI propia.** Motor, onboarding, archivos, historial, idiomas, updates y empaquetado viven en el core.
2. **Agnóstico del motor.** Ningún harness habla con un CLI concreto; habla con el motor del core, que elige el transporte de cada CLI.
3. **Un motor entra solo si sus términos lo permiten.** Que funcione técnicamente no alcanza.
4. **Los datos son del usuario.** Viven en una carpeta visible que él eligió. Nada sale de su máquina salvo hacia el proveedor de IA que él eligió. Sin telemetría.
5. **API chica y estable.** El core es público y lo consumen terceros: romper `harness-sdk` es caro.

## 3. Decisiones

| Tema | Decisión |
|---|---|
| Distribución | Una app instalable por harness |
| Código | Open source (core MIT). Cada dev responde por lo que construye o extiende |
| Repos | Monorepo público `humanharness` (core + Socrates de referencia). Paquetes publicados en npm como `@humanharness/*`. Otros harnesses (incluidos los de Marco, como Ariadna) en repos propios |
| Shell | Electron. Su Node embebido (`ELECTRON_RUN_AS_NODE`) corre adapters npm y servidores MCP sin que el usuario instale Node |
| Protocolo con el motor | Híbrido, por exigencia de términos: transporte nativo `claude -p` (binario oficial sin modificar) para Claude; ACP para el resto. Los harnesses no ven la diferencia |
| Herramientas propias del harness | Servidores MCP en Node, empaquetados en la app |
| UI | Kit React compartido + UI fina por harness |
| Bloques UI | Herramientas MCP (`mostrar_<bloque>`) expuestas por un servidor MCP `ui` del core |
| Datos | Carpeta visible, ubicación sugerida, elegida una vez al inicio, fija por app, con advertencia |
| Historial | Git local oculto (isomorphic-git), con el gitdir fuera de la carpeta visible. Sin remoto |
| Idiomas | es y en desde la v1, elegidos en el onboarding, cambiables en Ajustes |
| Plataformas | macOS primero, después Windows, después Linux. Código multiplataforma desde el día 1 |
| Monetización | Gratis. Botón de donación al dev de cada harness (`donar` en el manifest). Sin licencias |
| Firma | Marco firma y distribuye solo sus harnesses (oficiales). Los de la comunidad los compila y firma cada dev |
| Responsabilidad | La app es una interfaz; el contenido lo genera la IA del usuario con su cuenta. Se aclara en el onboarding y en la licencia/términos |

## 4. Estructura del monorepo

```
humanharness/
├─ packages/
│  ├─ engines/       definición de cada motor como datos (detección, instalación, login, transporte, estado legal)
│  ├─ motor/         interfaz Transporte (claude-cli | acp): sesiones, turnos, eventos normalizados, cancelar, errores tipados
│  ├─ workspace/     carpeta del usuario, generación de AGENTS.md y equivalentes, historial
│  ├─ blocks/        definición de bloques (schema zod + metadatos) y servidor MCP `ui`
│  ├─ mcp-kit/       helpers para escribir herramientas MCP de un harness
│  ├─ i18n/          i18next, traducciones del core (es, en), carga de locales del harness
│  ├─ shell/         proceso main de Electron: ventanas, puente IPC, updater, ~/.humanharness/
│  ├─ ui/            kit React: Onboarding, Chat, Actividad, Bloques, Historial, Ajustes, tema
│  ├─ harness-sdk/   defineHarness() y tipos públicos
│  └─ fake-agent/    agentes falsos con guiones (ACP y stream-json de Claude), para tests (publicado)
├─ harnesses/
│  └─ socrates/      harness de referencia
├─ tooling/
│  ├─ build/         config de electron-builder generada desde el manifest, firma, notarización
│  ├─ check/         `npx humanharness check`
│  └─ create-harness/  `npm create humanharness`
└─ docs/
```

Stack: pnpm workspaces, TypeScript, Vite (renderer), electron-builder, changesets, GitHub Actions.

Dependencias entre paquetes (sin ciclos):

```
harness-sdk ← blocks, i18n
engines ← motor ← shell
workspace ← shell
blocks, mcp-kit ← shell
ui ← (renderer del harness)
```

`shell` es el único paquete que conoce Electron. `motor`, `workspace`, `engines` y `blocks` son Node puro y se testean sin Electron.

## 5. Motores (`packages/engines`)

Cada motor es una entrada de datos, no código:

```ts
{
  id: "claude",
  nombre: "Claude",
  estado: "permitido",          // permitido | pendiente | excluido
  fuenteEstado: "https://code.claude.com/docs/en/legal-and-compliance (2026-10-10)",
  requiere: { es: "Plan Claude Pro o Max", en: "Claude Pro or Max plan" },
  datos: { es: "Anthropic, EE. UU.", en: "Anthropic, USA" },
  detectar: { binario: "claude", argsVersion: ["--version"], versionMinima: "2.0.0" },
  instalar: { mac: { comando: "curl -fsSL https://claude.ai/install.sh | bash" } },
  login: { comando: ["claude"], nota: "…" },
  transporte: { tipo: "claude-cli" },   // o { tipo: "acp", comando: [...] }
  instrucciones: { archivo: "CLAUDE.md", contenido: "@AGENTS.md\n" },
}
```

### Estado de cada motor (investigación del 2026-10-10)

| Motor | Vía | Estado | Por qué |
|---|---|---|---|
| Claude | binario oficial `claude -p`, sin modificar, login del usuario | **permitido** | La doc de Claude Code permite que el usuario final use su suscripción en el binario sin modificar aunque lo ejecute un producto de terceros. Condiciones: aceptar los Commercial Terms (cuenta en Console), no modificar el binario, no intermediar el uso |
| Claude | adapter ACP (Agent SDK) | **excluido** | El Agent SDK exige aprobación previa para el login de claude.ai. Se reconsidera si Anthropic aprueba por escrito |
| Codex | `codex-acp` (o `codex exec --json`) con login de ChatGPT del usuario | **permitido** | OpenAI documenta el uso del plan de ChatGPT en apps open source y locales. Si la app cobra o agrega un servidor, hay que llenar el formulario |
| Gemini CLI | login de cuenta Google | **excluido** | Desde el 2026-06-18 no atiende cuentas gratuitas ni AI Pro/Ultra |
| Antigravity | `agy_acp_server` oficial | **pendiente** | Los términos prohíben el acceso desde software de terceros; no hay un permiso oficial |
| Qwen Code | OAuth de Qwen | **excluido** | El tier gratuito se cerró el 2026-04-15 y no hay OAuth pago |
| Qwen Code | key de Model Studio de pago por uso | **pendiente** | Está permitido, pero el usuario tiene que configurar su key en el CLI; se evalúa junto con el modo key |
| Kimi Code | `kimi acp`, login del usuario | **pendiente** | El plan está pensado para escenarios de programación; los flujos que no son de código son zona gris. Datos en China, y entrena por defecto |
| GLM Coding Plan | Claude Code con endpoint de Z.ai | **excluido** | Los términos excluyen integraciones de terceros |
| MiniMax / DeepSeek | Claude Code con endpoint compatible | **pendiente** | DeepSeek lo permite, pero el usuario configura el endpoint él mismo. MiniMax: términos vinculantes sin leer. Ambos tienen implicancias de datos fuertes |

**Motores de la v1:** Claude y Codex.

**Gate legal:** solo los motores `permitido` aparecen en el onboarding de un build distribuido. En modo desarrollo se pueden usar los `pendiente`. Cambiar un estado es cambiar una línea.

### Reglas de cumplimiento (no negociables en el código)

1. Nunca leer, copiar, reenviar ni refrescar tokens. Nunca leer `~/.claude`, `~/.codex` ni `~/.gemini`.
2. No inyectar `ANTHROPIC_BASE_URL`, keys ni configuración de credenciales. No alterar el User-Agent. No modificar ni parchear binarios. No ocultar métodos de autenticación.
3. Sin servidor intermedio. Una cuenta por usuario, uso interactivo (sin loops masivos ni tareas programadas).
4. El login siempre pasa por el flujo oficial del proveedor (navegador/CLI).
5. Ni el nombre ni el logo de una app usan "Claude", "Claude Code", "Codex", "Anthropic" ni "OpenAI". En el texto se puede decir "funciona con Claude Code".
6. Al elegir un motor, la app muestra: proveedor, dónde se procesan los datos, si entrena con ellos, link a sus términos y a su privacidad, y el aviso "usás tu propia cuenta bajo sus términos; esta app no es de {proveedor} ni está avalada por él". El usuario lo acepta con una casilla.

**Antes de distribuir builds a usuarios finales:** abrir una cuenta en Console de Anthropic (equivale a aceptar los Commercial Terms) y pedir confirmación escrita a Anthropic (contact sales), describiendo la arquitectura.

**Plan B** (si Claude o Codex cambian sus términos): modo API key, donde el usuario pega su propia key en el flujo oficial del CLI. No se construye si no hace falta.

## 6. Flujo de un turno

```
UI ──IPC──► shell ──► motor
  motor → Transporte del motor elegido:
    acp:        un proceso por ventana; initialize → session/new { cwd, mcpServers: [ui, …mcp del harness] }
                (o session/load); session/prompt por turno; session/update → Evento
    claude-cli: un proceso `claude -p … --output-format stream-json --mcp-config <ui + mcp>`
                por turno, con --session-id / --resume; stream-json → Evento
  Evento normalizado ──IPC──► UI
  ◄ tool_call a `ui.mostrar_<bloque>` → validado por schema → Evento bloque ──► componente del harness
  ◄ permisos → acp: respuesta automática a session/request_permission; claude-cli: --allowedTools/--permission-mode
               derivados de `permisos` del manifest
  ◄ fin (stopReason) → commit de historial → chat guardado en <carpeta>/.harness/chats/
```

- **ACP:** un proceso de agente por ventana, que se reusa entre turnos. **claude-cli:** un proceso por turno (como hoy en Socrates), con la sesión retomada por id.
- **Las respuestas a bloques** (por ejemplo, la opción elegida) vuelven como mensaje del usuario con texto legible.
- **Permisos:** el usuario nunca ve un diálogo técnico. La política sale del manifest: editar solo dentro de la carpeta, sin ejecución de comandos salvo que el harness la declare, y web según el manifest.

### Errores

Todos son tipados y siempre traen una acción para el usuario:

| Error | Mensaje | Acción |
|---|---|---|
| `motor-no-instalado` | "No encuentro {motor} en esta compu" | Instalar (onboarding) |
| `sesion-vencida` | "Tu sesión de {motor} se cerró" | Volver a entrar |
| `sin-cuota` | "Llegaste al límite de tu plan" (+ hora de renovación si el motor la informa) | Se guarda la conversación; reintentar más tarde |
| `agente-caido` | "Algo falló, no cambié nada" | Rollback al último commit + Reintentar |
| `cancelado` | — | `session/cancel`, con rollback opcional |
| `version-vieja` | "Hace falta actualizar {motor}" | Actualizar |

## 7. Carpeta, instrucciones e historial (`packages/workspace`)

- **Carpeta:** sugerida por el manifest (por ejemplo `Documentos/Socrates`), elegida en el onboarding y guardada en la config de la app. No se cambia después. La primera vez se copia `carpeta.semilla`.
- **Advertencia:** se le explica al usuario que mover o editar la carpeta a mano puede romper la app.
- **Instrucciones:** el harness escribe un solo `AGENTS.md`. En cada arranque el runtime genera:
  - una sección gestionada dentro de AGENTS.md con el idioma de respuesta, las reglas del entorno (sin preguntas interactivas propias del CLI, mensajes cortos) y la documentación de los bloques generada desde sus schemas, con ejemplos;
  - el archivo que espera cada motor (`CLAUDE.md` con `@AGENTS.md`, `contextFileName` para Gemini/Qwen; Codex y Kimi leen AGENTS.md directo).
- **Historial:** isomorphic-git con el gitdir en la carpeta de datos de la app y la carpeta del usuario como árbol de trabajo. Un commit al terminar cada turno. La UI ofrece "Volver a como estaba antes de este mensaje". El historial no viaja si el usuario cambia de computadora (aceptado para la v1).

## 8. Contrato del harness (`packages/harness-sdk`)

```ts
export default defineHarness({
  id: "socrates",
  nombre: { es: "Sócrates", en: "Socrates" },
  core: "^1.0.0",
  idiomas: ["es", "en"],
  motores: ["claude", "codex"],              // probados; el onboarding muestra la intersección con los permitidos
  carpeta: { sugerida: "Documentos/Socrates", semilla: "./agent/semilla" },
  instrucciones: "./agent/AGENTS.md",
  permisos: { editar: "carpeta", ejecutar: false, web: true },
  bloques: { ejercicio, opciones, estado },  // defineBloque({ schema, componente, visible })
  mcp: ["./mcp/index.ts"],
  ui: "./ui/App.tsx",
  locales: "./locales",                      // es.json, en.json
  autor: "…", repo: "…", donar: "https://…",
})
```

- `defineBloque` declara un schema zod, un componente React y si el bloque es visible o solo de estado (como `estado` en Socrates, que actualiza pasos y términos sin mostrarse como mensaje).
- `npx humanharness check` valida el manifest, los schemas, que existan los archivos referenciados, que estén todas las claves de los idiomas declarados y el rango de versión del core.

## 9. Onboarding

```
0. Idioma     es / en, preseleccionado con el idioma del sistema operativo
1. Bienvenida qué hace la app + descargo ("la IA es la tuya, con tu cuenta; la app
              no ve ni guarda nada fuera de tu compu") → Entendido
2. Carpeta    sugerida → Cambiar / Seguir; advertencia; queda fija
3. Motor      tarjetas: (motores del harness) ∩ (estado permitido)
              cada una muestra el plan que hace falta y adónde van los datos
              si ya hay uno configurado en ~/.humanharness → "Ya tenés X listo ✓" → paso 6
4. Instalar   instalador oficial en segundo plano, con progreso
5. Entrar     login oficial del CLI (abre el navegador): ACP `authenticate` si el motor lo soporta;
              si no (Claude) → terminal embebida que corre el login del propio CLI
6. Probar     prompt de prueba → "Listo ✓"
7. Harness    primera pantalla del harness
```

- **Config compartida** en `~/.humanharness/`: motores detectados y configurados. Nunca guarda credenciales; esas quedan en el CLI.
- **Cada arranque:** chequeo en segundo plano (binario, versión mínima, sesión). Si algo falla, se muestra la tarjeta de error correspondiente.
- **Updates:** la app con electron-updater desde GitHub Releases; los adapters npm viajan dentro de la app; los CLIs se actualizan solos y el core exige la versión mínima.

## 10. Socrates como harness de referencia

Se migra desde `socrates-app`:

- `ia/` → `agent/semilla/` (temas, plantillas, glosario) + `agent/AGENTS.md` (CLAUDE.md + METODO.md unificados).
- `PROMPT_WEB` desaparece: los bloques se documentan solos y las reglas del entorno salen de la sección gestionada.
- Los bloques `socrates-ejercicio`, `socrates-opciones` y `socrates-estado` pasan a ser `ejercicio`, `opciones` y `estado`, definidos con `defineBloque`.
- Las pantallas de materias y temas se reescriben sobre el kit `ui`.
- Motores probados en la v1: los que resulten permitidos entre Claude y Codex.

Sirve como ejemplo vivo y como suite E2E del core.

## 11. Testing y CI

| Nivel | Qué cubre | Dónde |
|---|---|---|
| Unit | schemas de bloques, definiciones de motores, generación de AGENTS.md (snapshots), historial en carpetas temporales, claves de i18n | CI, en cada PR |
| Contrato del motor | motor vs `fake-agent` con guiones: streaming, tool calls, permisos, cuota, sesión vencida, caída a mitad del turno | CI, en cada PR |
| E2E | Playwright + Electron + Socrates + `fake-agent`: onboarding → turno → bloque → deshacer | CI, en cada PR (macOS) |
| Handshake real | cada CLI se instala y arranca: ACP responde `initialize`; `claude --version` y `--help` siguen teniendo los flags que usamos (sin login) | CI nightly |
| Motores reales | turno completo con login real | Local, con las cuentas de Marco: `pnpm test:motores`, antes de cada release |

Nunca hay credenciales de suscripción en CI.

**Releases:**
- **Paquetes:** changesets → npm.
- **Harnesses oficiales:** tag → Action en macOS → build, firma, notarización, GitHub Release → electron-updater.
- **Harnesses de la comunidad:** `pnpm build` usa los certificados del dev si existen; si no, genera un build sin firmar, con instrucciones para abrirlo.

## 12. Fuera de alcance (specs aparte)

- Web de Human Harness y catálogo (oficiales vs comunidad, links de donación).
- Ariadna como harness (reemplazar `ari` en Python por MCP en Node).
- Windows y Linux (empaquetado, firma, prerrequisitos de cada CLI).
- Modo API key (solo si el gate legal lo exige).

## 13. Pendientes y qué bloquea cada uno

1. **Investigación legal por motor** (Anthropic, OpenAI, Google, Qwen, Kimi y coding plans): define el `estado` de cada uno. Incluye la revisión del descargo y las advertencias de privacidad para motores con datos fuera de la región del usuario.
   - **Bloquea solo la distribución** de builds firmados de harnesses oficiales a usuarios finales (y que un motor aparezca como `permitido` en el onboarding).
   - **No bloquea** el repo público, los paquetes npm, el harness de referencia ni el uso por parte de devs: el framework se publica igual, y cada dev decide bajo su responsabilidad con qué motor lo corre. En modo desarrollo (`pnpm dev`) se pueden usar motores en `pendiente`.
2. **Spike de transportes** con Claude (`claude -p` + `--mcp-config`) y Codex (`codex-acp` + mcpServers). Es la primera tarea del plan del motor.
