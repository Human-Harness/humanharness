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
2. **Agnóstico del motor.** Ningún harness habla con un CLI concreto; habla con el motor del core, que habla ACP.
3. **Un motor entra solo si sus términos lo permiten.** Que funcione técnicamente no alcanza.
4. **Los datos son del usuario.** Viven en una carpeta visible que él eligió. Nada sale de su máquina salvo hacia el proveedor de IA que él eligió. Sin telemetría.
5. **API chica y estable.** El core es público y lo consumen terceros: romper `harness-sdk` es caro.

## 3. Decisiones

| Tema | Decisión |
|---|---|
| Distribución | Una app instalable por harness |
| Código | Open source (core Apache-2.0). Cada dev responde por lo que construye o extiende |
| Repos | Monorepo público `humanharness` (core + Socrates de referencia). Paquetes publicados en npm como `@humanharness/*`. Otros harnesses (incluidos los de Marco, como Ariadna) en repos propios |
| Shell | Electron. Su Node embebido (`ELECTRON_RUN_AS_NODE`) corre adapters npm y servidores MCP sin que el usuario instale Node |
| Protocolo con el motor | ACP (Agent Client Protocol) para todos los motores |
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
│  ├─ engines/       definición de cada motor como datos (detección, instalación, login, ACP, estado legal)
│  ├─ motor/         cliente ACP: sesiones, turnos, eventos normalizados, cancelar, errores tipados
│  ├─ workspace/     carpeta del usuario, generación de AGENTS.md y equivalentes, historial
│  ├─ blocks/        definición de bloques (schema zod + metadatos) y servidor MCP `ui`
│  ├─ mcp-kit/       helpers para escribir herramientas MCP de un harness
│  ├─ i18n/          i18next, traducciones del core (es, en), carga de locales del harness
│  ├─ shell/         proceso main de Electron: ventanas, puente IPC, updater, ~/.humanharness/
│  ├─ ui/            kit React: Onboarding, Chat, Actividad, Bloques, Historial, Ajustes, tema
│  ├─ harness-sdk/   defineHarness() y tipos públicos
│  └─ fake-agent/    agente ACP falso con guiones, para tests (publicado)
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
  estado: "pendiente",          // permitido | pendiente | excluido
  fuenteEstado: "…url + fecha…",
  requiere: "Plan Claude Pro o Max",
  datos: "Anthropic, EE. UU.",  // se muestra al elegir el motor
  detectar: { binario: "claude", versionMinima: "…" },
  instalar: { mac: "…instalador oficial…", win: "…", linux: "…" },
  acp: { tipo: "adapter-npm", paquete: "@zed-industries/claude-code-acp" },  // o { tipo: "nativo", args: [...] }
  instrucciones: { archivo: "CLAUDE.md", contenido: "@AGENTS.md" },
}
```

Candidatos para la v1: Claude Code, Codex CLI, Gemini CLI, Qwen Code, Kimi CLI. Los "coding plans" con endpoint compatible con Anthropic (GLM, MiniMax, DeepSeek) son una variante de configuración del motor Claude (`ANTHROPIC_BASE_URL` + key del plan), y solo entran si la investigación legal lo permite.

**Gate legal:** todos los motores arrancan en `pendiente`. Solo los `permitido` aparecen en el onboarding. Un motor que pasa a `excluido` desaparece cambiando una línea.

**Plan B** (solo si ningún motor resulta permitido): modo API key, donde el usuario pega su propia key de API. No se construye si no hace falta.

**Spike previo al plan:** verificar con cada candidato que ACP funcione de punta a punta (initialize, authenticate, session/new con MCP, prompt, streaming, permisos, cancel, load).

## 6. Flujo de un turno

```
UI ──IPC──► shell ──► motor
  motor: si no hay agente ACP para esta ventana →
         lanza el motor (adapter npm vía ELECTRON_RUN_AS_NODE, o binario nativo)
         initialize → session/new { cwd: carpeta, mcpServers: [ui, …mcp del harness] }
                   o session/load para retomar
  session/prompt(mensaje)
  ◄ session/update (texto, tool_call, plan) → Evento normalizado ──IPC──► UI
  ◄ tool_call a `ui.mostrar_<bloque>` → validado por schema → Evento bloque ──► componente del harness
  ◄ session/request_permission → respuesta automática según `permisos` del manifest
  ◄ fin (stopReason) → commit de historial → chat guardado en <carpeta>/.harness/chats/
```

- **Un proceso de agente por ventana**, que se reusa entre turnos.
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
5. Entrar     ACP `authenticate` (abre el navegador); si no está soportado → terminal embebida con el login
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
| Handshake real | cada CLI se instala, arranca en modo ACP y responde `initialize` (sin login) | CI nightly |
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

## 13. Pendientes que bloquean la implementación

1. **Investigación legal por motor** (Anthropic, OpenAI, Google, Qwen, Kimi y coding plans): define el `estado` de cada uno. Incluye la revisión del descargo y las advertencias de privacidad para motores con datos fuera de la región del usuario.
2. **Spike de ACP** con cada motor candidato (sección 5).
