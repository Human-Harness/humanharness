# Hallazgos · teacher harness

The single findings ledger for the teacher design. One row per problem; when several testers hit
the same problem it stays one row and lists them all. Rows come from the reports in
`user-testing/reports/`. Content in Spanish (it quotes the testers); this header in English.

- **Tipo:** `diseño` (the canvas session changes it; `falta la entrada` = the screen exists but no
  control on the base screen opens it) · `maqueta` (a demo link or sample-data problem, fixed in
  `user-testing/demo/`).
- **Estado:** `abierto` → `en el canvas` → `re-probado` (passed a new run) · `descartado`.
- **Orden:** severity first, then how many testers hit it.

Round 1 · 2026-11-13 · Laura, Sofía, Diego, Matías, Graciela · canvas v30 · Sonnet 5.5.
Round 2 · 2026-11-13 · same personas, tasks and start boards · canvas v40 · Sonnet 5.5 · reports in `user-testing/reports/r2/`; T34 started on "Sin conexión". *R2:* notes in Quiénes say what round 2 saw.

## Problemas

| id | Problema | Quiénes | Gravedad | Tipo | Estado |
|---|---|---|---|---|---|
| H01 | Ninguna acción confirma lo que hizo: Copiar a 2026, Aprobar, Crear las 32 clases, guardar unidad / autor / colegio / pregunta, elegir MLA, Instalar, Descargar el original, Exportar. *Opción C (canvas v33–v34): si el resultado queda en la misma pantalla, cambia ahí (etiqueta verde, botón "Aprobada", Deshacer); si queda en otro lado, aviso abajo con botón para ir ("Ver las clases", "Mostrar en la carpeta", "Ver en 2026"). 15 estados nuevos en la sección "Confirmaciones (H01)". Falta: "Copiar a 2026" de una clase o examen suelto (el botón está dentro de la fila)* | Laura, Sofía, Diego, Matías, Graciela · *R2: Laura, Graciela, Sofía (quedan: Copiar a 2026, Juntar categorías, Agregar a la Biblioteca, Editar ficha, volver a APA 7)* | Bloqueante | diseño | parcial |
| H02 | No hay pantalla de corte de internet: qué quedó guardado y cómo seguir. *El canvas sí la tiene ("Sin conexión", "Error de la IA"), pero es un estado y ningún clic lleva ahí: re-probar empezando en esa pantalla* | Diego, Matías · *R2: Matías: pasó (Diego no encontró el tablero de inicio)* | Bloqueante | maqueta | re-probado |
| H03 | No hay forma de empezar un año nuevo eligiendo qué conservar. *La pantalla existe ("Empezar 2027 · qué traer"), pero Materia no tiene ningún botón que lleve a ella. Canvas v35: pestaña "+ 2027" en el selector de años de la materia (opción A)* | Graciela · *R2: Graciela: T06 completada con dudas* | Bloqueante | diseño: falta la entrada | re-probado |
| H04 | Materias que ya no doy: no se llega desde el tablero normal. *El link existe solo en "Después de mucho uso"; Canvas v35: fila punteada al final de la lista de materias, en todo tablero con materias (opción B)* | Laura · *R2: Laura: T07 completada* | Bloqueante | diseño: falta la entrada | re-probado |
| H05 | "Administrar categorías" no responde; no se pueden agrupar ni unir fuentes. *La ventana existe, pero en Biblioteca las categorías son etiquetas sin botón para abrirla. Canvas v35: botón "Editar categorías" en la cabecera, al lado de "Agregar fuente" (opción C, nombre de Marco)* | Graciela · *R2: Graciela: T20 completada con dudas; Juntar no confirma (H29)* | Bloqueante | diseño: falta la entrada | re-probado |
| H06 | El examen generado habla de clases y no de los dos textos elegidos. *"Revisar el examen" existe solo en la versión armada desde clases* | Graciela · *R2: Graciela: sigue ("sale de 6 clases y 11 fuentes")* | Bloqueante | diseño | v46: opción A, el examen desde material tiene su pantalla de trabajo y su revisión con "sale de 5 fuentes que elegiste" y citas de esas fuentes |
| H07 | No hay estilo de cita distinto por materia; no se entiende si manda el del colegio o el general. *La ventana "Estilo de la materia" existe, pero Materia no tiene botón que la abra. Canvas v36 (opción D): botón "Editar materia" en la cabecera; la ventana pasa a "Editar Biología 2º B" con nombre, curso y colegio arriba y "Estilo para exportar" abajo, con la etiqueta "Del colegio" en el formato de citas* | Graciela, Laura · *R2: Graciela: T30 completada* | Bloqueante | diseño: falta la entrada | re-probado |
| H08 | Los números no coinciden entre pantallas: "Exportar 3 PDF" con 4 tildadas, 10 vs 14 preguntas, 2 borradores vs 1, "aprobado" vs Borrador, Aprobada en el chat vs Borrador en la lista | Laura, Diego, Graciela, Matías, Sofía · *R2: Graciela, Matías: sigue (materias 2/3/4, exámenes 3 vs 6, 10 vs 14 preguntas, unidades 2027)* | Fricción | diseño | en el canvas: v42 pasa todas las pantallas a una sola ficha de datos (2 materias activas; Biología 32 clases, 26 aprobadas, 81 %; exámenes U1 y U2 / U3 tomados + U4 borrador de 14 preguntas desde 6 clases y 11 fuentes; Historia Revolución de Mayo 10 preguntas; tabla de todos los exámenes 4 filas; unidades 2027 = 2026). v44 aplica cuatro decisiones: 28 Ciclo del carbono y 29 Humedales en todas las pantallas; exámenes "Aprobado", nunca "Listo"; Química solo entre las materias que ya no da (6 materias, 181 clases); 4 unidades, sin U5. v45–v46 cierran los 9 puntos: Ajustes queda en el escenario básico 1+1; exámenes en 2027 ya estaban bien; Taller de ciencias se queda (es una tarjeta del escenario completo); H06 resuelto con la opción A; el chat sigue a la lista de la materia (Clase 29 · Humedales del Delta); la ficha de Rodríguez se usa en Biología 2º B · U2 · Clase 13 · La fotosíntesis; Historia 4º A 24 de 28 (86%) en ambos escenarios, próxima U4 · Clase 25 · La Ley Sáenz Peña; Kandus queda como Libro; Editar abre la pregunta 1 |
| H09 | El menú de Agregar fuente queda abierto encima de otra ventana, y reaparece al cancelar | Laura, Sofía, Diego, Graciela · *R2: Laura, Graciela, Sofía: sigue* | Fricción | diseño | en el canvas · v49: la Biblioteca ya no dibuja el menú abierto; solo el estado "menú Agregar fuente" lo muestra, y Nueva fuente, Editar categorías y el Asistente quedan sin menú detrás |
| H10 | Íconos de la barra sin nombre; Ajustes se llega por un ícono de sol | Laura, Diego, Graciela · *R2: Laura, Graciela, Matías: sigue* | Fricción | diseño | en el canvas · v49: opción B (Marco): el riel sigue solo con íconos y cada ícono muestra su nombre al pasar el mouse; Ajustes pasa al engranaje. Probar en la ronda 3 si alcanza |
| H11 | "Grilla de corrección" viene sin tildar al exportar el examen con versiones y clave | Graciela, Matías · *R2: Graciela, Matías: sigue* | Fricción | diseño | en el canvas · v50: con la clave, la grilla de corrección viene marcada: "Exportar 4 PDF" y el aviso nombra la grilla |
| H12 | "Para revisar" sin fecha, y desde "1 desactualizada" no hay camino directo | Laura, Diego | Fricción | diseño | en el canvas · v50: opción A (Marco): cada fila de "Para revisar" dice para cuándo es, ordenadas por fecha; lo de mañana va en ámbar. "1 desactualizada" en la tarjeta de la materia es un link a la revisión |
| H13 | Buscar una clase: ⌘K y la lupa no hacen nada. *No hay ninguna pantalla de búsqueda en el canvas. Canvas v38 (opción A): ventana encima de la pantalla actual (tablero "Buscar"), con resultados agrupados en Clases, Unidades, Exámenes y Biblioteca; todas las lupas llevan a ella* | Matías · *R2: Matías: T02 completada; dos "Clase 27" casi iguales, la lupa no muestra ⌘K* | Fricción (abandonó T02) | diseño: falta la pantalla | re-probado |
| H14 | Crear una clase abre un formulario largo; pedirla en una frase queda detrás de "Asistente" | Matías · *R2: Matías: sigue, ahora en Nuevo examen* | Fricción | diseño | en el canvas · v51: respuesta de Marco: el botón de crear abre siempre el formulario, y todo se puede pedir por el chat. Nueva clase y Nuevo examen tienen una línea "También podés pedirla en una frase: Escribile al Asistente" |
| H15 | No hay entrada visible a "Nuevo examen" desde el tablero. *Está detrás del ícono Exámenes, que no tiene nombre (ver H10)* | Matías | Fricción | diseño | en el canvas · v49: opción C (Marco): sin cambio en el tablero; se llega por Exámenes, que tiene "Nuevo examen" como acción principal. Depende de que el nombre al pasar el mouse (H10) alcance |
| H16 | "Pedirle a la IA que busque" abre un formulario de archivo, no una búsqueda. *Error del link; ahora abre "Fuentes en el chat" (canvas v31)* | Sofía · *R2: Sofía: ya no abre un formulario; ver H31* | Fricción | maqueta | re-probado |
| H17 | Fotocopia: nada dice que es un escaneo ni cuánto tarda la lectura | Diego · *R2: Diego: sigue* | Fricción | diseño | en el canvas · v50: opción A (Marco): la fila de la Biblioteca dice "Leyendo el texto · 62%" y "Falta 1 min"; al abrirla, la ficha avisa que es un escaneo de 18 páginas, cuánto tarda, que se puede cerrar, y ofrece "Ver lo leído hasta ahora" (estado nuevo "escaneo en lectura"). El mod pasa a llamarse "Leer escaneos" en todas partes |
| H18 | Al tocar el texto de la clase no hay señal de edición; "guardado hace un momento" no confirma mi cambio | Diego · *R2: Diego: peor, T10 abandonada (clic y doble clic no editan)* | Fricción | diseño | en el canvas · v49: opción A (Marco): el texto muestra un borde punteado al pasar el mouse y se abre con borde ámbar y cursor al hacer clic; al lado del título aparece "Guardado · tu cambio en la diapositiva 3" con Deshacer (estado nuevo "editando el texto") |
| H19 | Tras "acortala a 40 minutos" no se ve el cambio de duración | Matías · *R2: Matías: sigue (+10 min y arriba dice 80 min)* | Fricción | diseño | en el canvas · v50: opción A (Marco): al acortar la clase, el dato cambia donde está: etiqueta "40 min" junto al título y "antes 80" en la línea de datos; el chat responde con "Ver antes y después · Deshacer". Debajo del chat hay una sugerencia que reproduce el pedido (estado nuevo "acortada a 40 minutos") |
| H20 | Texto secundario chico y gris: a 150% sigue costando; opciones marcadas sin relleno | Graciela | Fricción | diseño | en el canvas · v51: opción A (Marco): el texto secundario pasa de 12 a 14 px, muted más oscuro (#505359 claro, contraste 7,7; #b8bcc1 oscuro) y la opción marcada se rellena en ámbar. Falta llevarlo al DESIGN.md del core (hh-muted y "Secondary text 12") en un PR aparte |
| H21 | Verbos parecidos: Editar / Regenerar / Pedir cambio; Descartar / Quitar / Usar / Deshacer | Matías, Sofía · *R2: Matías: sigue (Editar / Regenerar)* | Ruido | diseño | en el canvas · v51: opción A (Marco): en el examen, "Editar" (a mano) y "Pedir a la IA…" (con "Otra versión" como sugerencia y "Pedir"); en las fuentes de una clase solo "Usar" / "No usar" |
| H22 | La IA inquieta: "la IA ve esta materia"; no dice de dónde sacó un dato | Sofía, Graciela · *R2: Graciela, Sofía: sigue (de dónde salen fuentes y unidades)* | Ruido | diseño | en el canvas · v51: opción A (Marco): el chat dice qué usa ("la IA usa esta materia y sus 18 fuentes", "esta clase y sus 3 fuentes"); en Planificar "15 más" se abre (estado nuevo "las 18 fuentes que usa") |
| H23 | Tres caminos al empezar (materia, primera clase, Biblioteca) | Sofía | Ruido | diseño | en el canvas · v51: opción B (Marco): la primera vez, "¿Por dónde empezás?" con tres tarjetas: Una clase (para la semana que viene), La materia (para planificar el año), Tus materiales (si ya tenés PDFs) |
| H24 | "Seguir en segundo plano" no dice dónde voy a ver la clase después | Sofía · *R2: Matías: sigue* | Ruido | diseño | en el canvas · v51: junto a "Seguir en segundo plano": "cuando esté lista, te avisamos y queda en Para revisar" |
| H25 | "Aprobar" no dice si avisa a alguien | Sofía · *R2: Sofía: sigue (aprueba sin mostrar qué se revisó)* | Ruido | diseño | en el canvas · v51: opción A (Marco): Aprobar abre un panel con lo que tiene la clase o el examen y "Queda marcada como lista. No se manda a nadie.", con Seguir revisando / Aprobar (2 estados nuevos "antes de aprobar") |
| H26 | Exportar: no dice que la bibliografía va dentro de cada PDF; ventana alta para pantalla angosta. *Canvas v38 (opción A): la bibliografía deja de ser una cuarta parte tildada y pasa a una pregunta (al final de cada archivo / como archivo aparte / no incluir); el pie dice "3 PDF, cada uno con su bibliografía al final"* | Diego · *R2: Laura, Diego: Bien* | Ruido | diseño | re-probado |
| H27 | "Nueva clase" ya trae una materia y unidad que no creé. *Es a propósito ("Nueva clase precargada por la IA"); revisar si se entiende de dónde sale* | Sofía · *R2: Sofía: sigue ("Dónde va: U4, clase 27")* | Ruido | diseño | en el canvas · v51: opción A (Marco): en Nueva clase, cada dato que puso la IA lleva una línea "Sale de: …" (p. ej. "la clase 26 es la última de U4 que armaste") |
| H28 | Cabecera de Biblioteca con demasiados conteos | Sofía | Ruido | diseño | en el canvas · v51: opción A (Marco): la cabecera dice "146 fuentes"; el desglose está en el filtro de tipo (Todas 146 · Archivos 98 · Web 41 · Escaneadas 7) |
| H29 | Juntar categorías, Copiar a 2026, Agregar a la Biblioteca y Editar ficha no confirman nada (resto de H01) | R2: Graciela, Laura, Sofía | Fricción | diseño | en el canvas · v50: "Copiar a 2026" en una clase, "Juntar" categorías y "Agregar a la Biblioteca" en el Asistente confirman en el lugar con Deshacer (3 estados nuevos). Editar ficha ya confirmaba |
| H30 | En el editor, la X del Asistente no cierra el panel y el botón "Asistente" lleva a otra pantalla | R2: Diego, Matías | Fricción | maqueta | en el canvas · v48: la X cierra el Asistente y el botón "Asistente" lo abre y cierra en el mismo editor (estado nuevo "sin el Asistente") |
| H31 | "Buscar más" en Nueva clase lleva a la Biblioteca con un menú abierto que tapa el chat | R2: Sofía | Fricción | diseño | resuelto en v49 con H09 (el menú de Agregar fuente ya no queda abierto) |
| H32 | Unidad nueva dice "la IA las está armando" sin haber tildado la IA | R2: Graciela | Fricción | diseño | en el canvas · v50: crear una unidad muestra "U5 · Evolución creada" con Deshacer y la unidad vacía con "Crear una clase"; ya no aparece "la IA las está armando" |
| H33 | Editar materia: el ejemplo renombra la materia sin que la docente lo pida | R2: Graciela | Fricción | maqueta | en el canvas · v48: el ejemplo mantiene el nombre "Biología"; el aviso dice "Materia guardada: estilo propio" |
| H34 | Colegio nuevo: el aviso dice "Colegio San Martín guardado" y el nuevo no aparece en la lista | R2: Graciela | Fricción | maqueta | en el canvas · v48: el colegio nuevo es "Escuela Normal 4"; el aviso dice "Escuela Normal 4 guardada" y aparece en la lista |
| H35 | Estilo de cita: el ejemplo no cambia al elegir MLA 9 | R2: Laura | Fricción | diseño | en el canvas · v50: el ejemplo de cita cambia con el estilo elegido (APA o MLA) |
| H36 | Planificar no explica de dónde salen las 4 unidades; "15 más" no se abre | R2: Sofía | Fricción | diseño | en el canvas · v51: opción A (Marco): cada unidad propuesta dice "Sale de: Diseño curricular 2º año, bloque N · ver el párrafo" |
| H37 | Se exporta un examen en borrador sin avisar que no está aprobado | R2: Graciela | Ruido | diseño | en el canvas · v51: al exportar un examen en borrador, aviso "Este examen todavía no está aprobado. Podés exportarlo igual." con "Revisar primero" |
| H38 | Muchos "Copiar" repetidos en el año pasado; querría "Traer todo" | R2: Laura | Ruido | diseño | en el canvas · v51: opción A (Marco): "Copiar todo a 2026" en el aviso de 2025, con un resumen antes ("4 unidades, 29 clases y 2 exámenes, como borrador") y aviso al terminar (2 estados nuevos). Los botones por unidad quedan; los de cada clase solo al pasar el mouse |
| H39 | La cita de la ficha no coincide con los datos de la ventana anterior; columna derecha cortada | R2: Laura, Graciela | Ruido | maqueta | en el canvas · v48: los autores ya coincidían; Editar ficha ahora muestra la fuente abierta (Rodríguez, 2021, web) y la columna derecha ya no se corta |
| H40 | Sin conexión: la barra naranja se corta; "Reintentar ahora" no dice qué pasó | R2: Matías | Ruido | diseño | en el canvas · v51: la barra de sin conexión puede pasar a dos líneas; junto a "Reintentar ahora", "Último intento hace 20 s: sin internet" |

## Palabras

| id | Dice la app | Dirían ellos | Quiénes |
|---|---|---|---|
| P01 | Mods | complementos, extras | Laura, Sofía, Matías, Graciela |
| P02 | OCR, Procesando OCR | leer fotocopias escaneadas, leyendo el texto de la foto | Laura, Diego, Graciela |
| P03 | Aprobar, Aprobada | lista, lista para dar | Laura, Sofía, Diego |
| P04 | Motor, Esfuerzo | qué tan a fondo piensa (no las tocarían) | Laura, Sofía, Graciela |
| P05 | ⌘J | sobra, no se entiende | Laura, Diego, Graciela |
| P06 | Desactualizada | para revisar de nuevo, quedó vieja | Laura, Diego, Matías |
| P07 | Pendiente vs Borrador | sin armar todavía; no ven la diferencia | Sofía, Diego |
| P08 | Biblioteca, fuentes, categorías | mis textos, apuntes, temas, carpetas | Sofía, Diego, Graciela |
| P09 | HTML para proyectar | para proyectar en el aula | Laura |
| P10 | Armándose | generando | Matías |
| P11 | Versión A / B | tema A / B | Matías |
| P12 | Colegio nuevo, Plantilla para exportar | formato de documentos del colegio | Graciela |

## Lo que funciona (mantener)

- Ver el año pasado al lado con "Copiar a 2026" (Laura).
- "Para revisar" con el motivo en palabras comunes y botón Abrir (Laura, Diego).
- Las fuentes marcan qué completó la IA y qué falta; datos corregibles a mano (Laura, Graciela).
- Cada fuente sugerida con autor, año y razón; las descartadas con motivo (Sofía).
- Exportar: bibliografía como opción propia, vista previa, "Mostrar en la carpeta" (Laura, Diego).
- Examen: versiones y clave en la misma pantalla, "Solo lo ves vos", la versión B se arma sola (Graciela, Matías).
- "Ver antes y después · Deshacer" en cada cambio de la IA (Matías).
- "Armando tu clase": pasos, tiempo, "Seguir en segundo plano", "Guardar como pendiente" (Diego, Matías).
- Primera vez: tarjeta con 3 pasos; plan anual armado y editable, "guía, no fechas" (Sofía).
- Asistente: respuesta con botón a la pantalla correcta; cerrar y reabrir conserva el historial (Laura, Sofía, Matías).
- Colegio nuevo: logo, colores, tipografía, citas y plantilla en un solo lugar (Graciela).

## Arreglos de la maqueta (para la próxima ronda)

- Light/dark crossing (Matías): not reproduced. Every dark board passes `dark` down and `check.js`
  passes on all components; Matías also took screenshots from other testers' tabs.
- "Editar" colegio opens "Colegio nuevo": the only school form in the canvas (canvas session, needs
  an edit variant). "Editar" question 1 opens question 4: sample data, ignore.
- T34 (offline): no click reaches "Sin conexión"; start the tester there or tell them the connection drops.
- Graciela did not find "Tablero de materias": the board is "B · Tablero de materias (claro/oscuro)";
  give testers the exact title.
- Done in canvas v31: "Pedirle a la IA que busque" → "Fuentes en el chat" (H16).
- Play needed "Fill" again on every screen, and Escape in Biblioteca left Play.
- Testers shared one Chrome and closed each other's tab group twice; run at most 2 at a time.

## Ronda 1 vs ronda 2

| | Completada | Con dudas | Abandonada |
|---|---|---|---|
| Ronda 1 (v30, 40 tareas) | 9 | 24 | 7 |
| Ronda 2 (v40, 40 tareas) | 15 | 21 | 4 |

- Dejaron de abandonarse: T02 buscar (Matías), T06 año nuevo, T20 categorías, T30 estilo por materia (Graciela), T07 materias que ya no doy (Laura), T34 sin conexión (Matías).
- Abandonos nuevos: T09 y T11 (Matías: la caja del chat no escribe, maqueta), T10 (Diego: el texto no entra en edición, H18), T34 (Diego no encontró el tablero de inicio, falla de la prueba).
- Diego reconstruyó cuatro tareas desde un resumen: su informe pesa menos.
