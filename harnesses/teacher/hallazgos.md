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
Round 3 · 2026-11-14 · same personas, tasks and start boards · canvas v51 · Sonnet 5.5 · reports in `user-testing/reports/r3/`. *R3:* notes say what round 3 saw; `abierto · R3: sigue` = fixed in the canvas but round 3 still hit it.

## Problemas

| id | Problema | Quiénes | Gravedad | Tipo | Estado |
|---|---|---|---|---|---|
| H01 | Ninguna acción confirma lo que hizo: Copiar a 2026, Aprobar, Crear las 32 clases, guardar unidad / autor / colegio / pregunta, elegir MLA, Instalar, Descargar el original, Exportar. *Opción C (canvas v33–v34): si el resultado queda en la misma pantalla, cambia ahí (etiqueta verde, botón "Aprobada", Deshacer); si queda en otro lado, aviso abajo con botón para ir ("Ver las clases", "Mostrar en la carpeta", "Ver en 2026"). 15 estados nuevos en la sección "Confirmaciones (H01)". Falta: "Copiar a 2026" de una clase o examen suelto (el botón está dentro de la fila)* | Laura, Sofía, Diego, Matías, Graciela · *R2: Laura, Graciela, Sofía (quedan: Copiar a 2026, Juntar categorías, Agregar a la Biblioteca, Editar ficha, volver a APA 7)* · *R3: Laura: "Guardar fuente" no avisa que se guardó (el resto confirma)* | Bloqueante | diseño | abierto · R3: sigue · parcial |
| H02 | No hay pantalla de corte de internet: qué quedó guardado y cómo seguir. *El canvas sí la tiene ("Sin conexión", "Error de la IA"), pero es un estado y ningún clic lleva ahí: re-probar empezando en esa pantalla* | Diego, Matías · *R2: Matías: pasó (Diego no encontró el tablero de inicio)* · *R3: Matías: pasó; Diego no encontró el tablero de inicio otra vez (falla de la prueba)* | Bloqueante | maqueta | re-probado |
| H03 | No hay forma de empezar un año nuevo eligiendo qué conservar. *La pantalla existe ("Empezar 2027 · qué traer"), pero Materia no tiene ningún botón que lleve a ella. Canvas v35: pestaña "+ 2027" en el selector de años de la materia (opción A)* | Graciela · *R2: Graciela: T06 completada con dudas* · *R3: Graciela: T06 con dudas (la fila Exámenes no tiene casilla, ver H51)* | Bloqueante | diseño: falta la entrada | re-probado |
| H04 | Materias que ya no doy: no se llega desde el tablero normal. *El link existe solo en "Después de mucho uso"; Canvas v35: fila punteada al final de la lista de materias, en todo tablero con materias (opción B)* | Laura · *R2: Laura: T07 completada* · *R3: Laura: T07 completada; la fila punteada es discreta* | Bloqueante | diseño: falta la entrada | re-probado |
| H05 | "Administrar categorías" no responde; no se pueden agrupar ni unir fuentes. *La ventana existe, pero en Biblioteca las categorías son etiquetas sin botón para abrirla. Canvas v35: botón "Editar categorías" en la cabecera, al lado de "Agregar fuente" (opción C, nombre de Marco)* | Graciela · *R2: Graciela: T20 completada con dudas; Juntar no confirma (H29)* · *R3: Graciela: T20 con dudas (ver H50); Juntar ya confirma* | Bloqueante | diseño: falta la entrada | re-probado |
| H06 | El examen generado habla de clases y no de los dos textos elegidos. *"Revisar el examen" existe solo en la versión armada desde clases* | Graciela · *R2: Graciela: sigue ("sale de 6 clases y 11 fuentes")* · *R3: Graciela: Bien (cada pregunta cita su fuente); arranca con 5 fuentes tildadas (H44)* | Bloqueante | diseño | re-probado |
| H07 | No hay estilo de cita distinto por materia; no se entiende si manda el del colegio o el general. *La ventana "Estilo de la materia" existe, pero Materia no tiene botón que la abra. Canvas v36 (opción D): botón "Editar materia" en la cabecera; la ventana pasa a "Editar Biología 2º B" con nombre, curso y colegio arriba y "Estilo para exportar" abajo, con la etiqueta "Del colegio" en el formato de citas* | Graciela, Laura · *R2: Graciela: T30 completada* · *R3: Graciela: T30 completada; desde Ajustes no lo encuentra (H48)* | Bloqueante | diseño: falta la entrada | re-probado |
| H08 | Los números no coinciden entre pantallas: "Exportar 3 PDF" con 4 tildadas, 10 vs 14 preguntas, 2 borradores vs 1, "aprobado" vs Borrador, Aprobada en el chat vs Borrador en la lista | Laura, Diego, Graciela, Matías, Sofía · *R2: Graciela, Matías: sigue (materias 2/3/4, exámenes 3 vs 6, 10 vs 14 preguntas, unidades 2027)* · *R3: sigue con otros números, ver H41* | Fricción | diseño | en el canvas: v42 pasa todas las pantallas a una sola ficha de datos (2 materias activas; Biología 32 clases, 26 aprobadas, 81 %; exámenes U1 y U2 / U3 tomados + U4 borrador de 14 preguntas desde 6 clases y 11 fuentes; Historia Revolución de Mayo 10 preguntas; tabla de todos los exámenes 4 filas; unidades 2027 = 2026). v44 aplica cuatro decisiones: 28 Ciclo del carbono y 29 Humedales en todas las pantallas; exámenes "Aprobado", nunca "Listo"; Química solo entre las materias que ya no da (6 materias, 181 clases); 4 unidades, sin U5. v45–v46 cierran los 9 puntos: Ajustes queda en el escenario básico 1+1; exámenes en 2027 ya estaban bien; Taller de ciencias se queda (es una tarjeta del escenario completo); H06 resuelto con la opción A; el chat sigue a la lista de la materia (Clase 29 · Humedales del Delta); la ficha de Rodríguez se usa en Biología 2º B · U2 · Clase 13 · La fotosíntesis; Historia 4º A 24 de 28 (86%) en ambos escenarios, próxima U4 · Clase 25 · La Ley Sáenz Peña; Kandus queda como Libro; Editar abre la pregunta 1 |
| H09 | El menú de Agregar fuente queda abierto encima de otra ventana, y reaparece al cancelar | Laura, Sofía, Diego, Graciela · *R2: Laura, Graciela, Sofía: sigue* · *R3: nadie volvió a ver el menú abierto* | Fricción | diseño | re-probado |
| H10 | Íconos de la barra sin nombre; Ajustes se llega por un ícono de sol | Laura, Diego, Graciela · *R2: Laura, Graciela, Matías: sigue* · *R3: Laura: el ícono de Biblioteca no tiene palabra; Diego: primer intento en el calendario. Nombre al pasar el mouse no alcanzó* | Fricción | diseño | abierto · R3: sigue · en el canvas · v49: opción B (Marco): el riel sigue solo con íconos y cada ícono muestra su nombre al pasar el mouse; Ajustes pasa al engranaje. Probar en la ronda 3 si alcanza |
| H11 | "Grilla de corrección" viene sin tildar al exportar el examen con versiones y clave | Graciela, Matías · *R2: Graciela, Matías: sigue* · *R3: Matías: Bien (A, B, clave y grilla juntas); "3 PDF" en el título y "4 PDF" en el aviso (H41)* | Fricción | diseño | re-probado |
| H12 | "Para revisar" sin fecha, y desde "1 desactualizada" no hay camino directo | Laura, Diego · *R3: Laura, Diego: Bien ("Mañana, lun 16"); Laura: "Jue 26" no dice si es fecha del examen* | Fricción | diseño | re-probado |
| H13 | Buscar una clase: ⌘K y la lupa no hacen nada. *No hay ninguna pantalla de búsqueda en el canvas. Canvas v38 (opción A): ventana encima de la pantalla actual (tablero "Buscar"), con resultados agrupados en Clases, Unidades, Exámenes y Biblioteca; todas las lupas llevan a ella* | Matías · *R2: Matías: T02 completada; dos "Clase 27" casi iguales, la lupa no muestra ⌘K* · *R3: Matías: T02 con dudas; los resultados agrupados son Bien; ⌘K no anda en la maqueta* | Fricción (abandonó T02) | diseño: falta la pantalla | re-probado |
| H14 | Crear una clase abre un formulario largo; pedirla en una frase queda detrás de "Asistente" | Matías · *R2: Matías: sigue, ahora en Nuevo examen* · *R3: Matías: sigue (T09 con dudas: el formulario es lo primero, la línea del chat es chica); Sofía: el formulario precargado no deja claro si hay que corregirlo* | Fricción | diseño | abierto · R3: sigue · en el canvas · v51: respuesta de Marco: el botón de crear abre siempre el formulario, y todo se puede pedir por el chat. Nueva clase y Nuevo examen tienen una línea "También podés pedirla en una frase: Escribile al Asistente" |
| H15 | No hay entrada visible a "Nuevo examen" desde el tablero. *Está detrás del ícono Exámenes, que no tiene nombre (ver H10)* | Matías | Fricción | diseño | en el canvas · v49: opción C (Marco): sin cambio en el tablero; se llega por Exámenes, que tiene "Nuevo examen" como acción principal. Depende de que el nombre al pasar el mouse (H10) alcance |
| H16 | "Pedirle a la IA que busque" abre un formulario de archivo, no una búsqueda. *Error del link; ahora abre "Fuentes en el chat" (canvas v31)* | Sofía · *R2: Sofía: ya no abre un formulario; ver H31* | Fricción | maqueta | re-probado |
| H17 | Fotocopia: nada dice que es un escaneo ni cuánto tarda la lectura | Diego · *R2: Diego: sigue* · *R3: Diego: Bien ("Leyendo el texto · 62% · Falta 1 min")* | Fricción | diseño | re-probado |
| H18 | Al tocar el texto de la clase no hay señal de edición; "guardado hace un momento" no confirma mi cambio | Diego · *R2: Diego: peor, T10 abandonada (clic y doble clic no editan)* · *R3: Diego: T10 completada; Bien (se edita tocando el texto, "Guardado · Deshacer")* | Fricción | diseño | re-probado |
| H19 | Tras "acortala a 40 minutos" no se ve el cambio de duración | Matías · *R2: Matías: sigue (+10 min y arriba dice 80 min)* · *R3: Matías: T11 completada; el chat con antes/después es Bien, pero "Diapositivas · 12" y "Guion · 80 min" no cambian* | Fricción | diseño | abierto · R3: sigue · en el canvas · v50: opción A (Marco): al acortar la clase, el dato cambia donde está: etiqueta "40 min" junto al título y "antes 80" en la línea de datos; el chat responde con "Ver antes y después · Deshacer". Debajo del chat hay una sugerencia que reproduce el pedido (estado nuevo "acortada a 40 minutos") |
| H20 | Texto secundario chico y gris: a 150% sigue costando; opciones marcadas sin relleno | Graciela · *R3: Graciela: Ajustes sigue con texto chico y gris. Con 14 px se cortan "Generar examen", el aviso de Mods y la franja sin conexión (Matías)* | Fricción | diseño | abierto · R3: sigue · en el canvas · v51: opción A (Marco): el texto secundario pasa de 12 a 14 px, muted más oscuro (#505359 claro, contraste 7,7; #b8bcc1 oscuro) y la opción marcada se rellena en ámbar. Falta llevarlo al DESIGN.md del core (hh-muted y "Secondary text 12") en un PR aparte |
| H21 | Verbos parecidos: Editar / Regenerar / Pedir cambio; Descartar / Quitar / Usar / Deshacer | Matías, Sofía · *R2: Matías: sigue (Editar / Regenerar)* · *R3: Matías: "Pedir a la IA…" no se distingue de "Editar"; Sofía: "Elegida / No usar / Usar" en la misma fila* | Ruido | diseño | abierto · R3: sigue · en el canvas · v51: opción A (Marco): en el examen, "Editar" (a mano) y "Pedir a la IA…" (con "Otra versión" como sugerencia y "Pedir"); en las fuentes de una clase solo "Usar" / "No usar" |
| H22 | La IA inquieta: "la IA ve esta materia"; no dice de dónde sacó un dato | Sofía, Graciela · *R2: Graciela, Sofía: sigue (de dónde salen fuentes y unidades)* · *R3: Sofía: Bien (cada unidad cita su bloque)* | Ruido | diseño | re-probado |
| H23 | Tres caminos al empezar (materia, primera clase, Biblioteca) | Sofía · *R3: Sofía, Laura: Bien ("¿Por dónde empezás?")* | Ruido | diseño | re-probado |
| H24 | "Seguir en segundo plano" no dice dónde voy a ver la clase después | Sofía · *R2: Matías: sigue* · *R3: Diego: Bien ("queda en Para revisar")* | Ruido | diseño | re-probado |
| H25 | "Aprobar" no dice si avisa a alguien | Sofía · *R2: Sofía: sigue (aprueba sin mostrar qué se revisó)* · *R3: Sofía: "Aprobar" sigue sin explicar qué significa* | Ruido | diseño | abierto · R3: sigue · en el canvas · v51: opción A (Marco): Aprobar abre un panel con lo que tiene la clase o el examen y "Queda marcada como lista. No se manda a nadie.", con Seguir revisando / Aprobar (2 estados nuevos "antes de aprobar") |
| H26 | Exportar: no dice que la bibliografía va dentro de cada PDF; ventana alta para pantalla angosta. *Canvas v38 (opción A): la bibliografía deja de ser una cuarta parte tildada y pasa a una pregunta (al final de cada archivo / como archivo aparte / no incluir); el pie dice "3 PDF, cada uno con su bibliografía al final"* | Diego · *R2: Laura, Diego: Bien* · *R3: Laura, Diego: Bien (bibliografía incluida); Laura: demasiadas decisiones juntas para imprimir (H54)* | Ruido | diseño | re-probado |
| H27 | "Nueva clase" ya trae una materia y unidad que no creé. *Es a propósito ("Nueva clase precargada por la IA"); revisar si se entiende de dónde sale* | Sofía · *R2: Sofía: sigue ("Dónde va: U4, clase 27")* · *R3: Sofía: sigue (el formulario trae tema y materia ajenos)* | Ruido | diseño | abierto · R3: sigue · en el canvas · v51: opción A (Marco): en Nueva clase, cada dato que puso la IA lleva una línea "Sale de: …" (p. ej. "la clase 26 es la última de U4 que armaste") |
| H28 | Cabecera de Biblioteca con demasiados conteos | Sofía · *R3: Graciela: "146 fuentes" junto al filtro "Materia: Biología" no se entiende* | Ruido | diseño | abierto · R3: sigue · en el canvas · v51: opción A (Marco): la cabecera dice "146 fuentes"; el desglose está en el filtro de tipo (Todas 146 · Archivos 98 · Web 41 · Escaneadas 7) |
| H29 | Juntar categorías, Copiar a 2026, Agregar a la Biblioteca y Editar ficha no confirman nada (resto de H01) | R2: Graciela, Laura, Sofía · *R3: Graciela: Bien (Juntar cuenta bien y se deshace)* | Fricción | diseño | re-probado |
| H30 | En el editor, la X del Asistente no cierra el panel y el botón "Asistente" lleva a otra pantalla | R2: Diego, Matías · *R3: Diego: Bien (un clic cierra, un clic abre)* | Fricción | maqueta | re-probado |
| H31 | "Buscar más" en Nueva clase lleva a la Biblioteca con un menú abierto que tapa el chat | R2: Sofía · *R3: nadie lo volvió a ver* | Fricción | diseño | re-probado |
| H32 | Unidad nueva dice "la IA las está armando" sin haber tildado la IA | R2: Graciela · *R3: Graciela: Bien (aviso verde con Deshacer); el tablero sigue diciendo 4 unidades (H41)* | Fricción | diseño | re-probado |
| H33 | Editar materia: el ejemplo renombra la materia sin que la docente lo pida | R2: Graciela | Fricción | maqueta | en el canvas · v48: el ejemplo mantiene el nombre "Biología"; el aviso dice "Materia guardada: estilo propio" |
| H34 | Colegio nuevo: el aviso dice "Colegio San Martín guardado" y el nuevo no aparece en la lista | R2: Graciela | Fricción | maqueta | en el canvas · v48: el colegio nuevo es "Escuela Normal 4"; el aviso dice "Escuela Normal 4 guardada" y aparece en la lista |
| H35 | Estilo de cita: el ejemplo no cambia al elegir MLA 9 | R2: Laura · *R3: Laura: Bien (ejemplo de cita y "Guardado · Deshacer")* | Fricción | diseño | re-probado |
| H36 | Planificar no explica de dónde salen las 4 unidades; "15 más" no se abre | R2: Sofía · *R3: Sofía: Bien* | Fricción | diseño | re-probado |
| H37 | Se exporta un examen en borrador sin avisar que no está aprobado | R2: Graciela · *R3: Laura: exportar una clase en borrador tampoco avisa* | Ruido | diseño | abierto · R3: sigue · en el canvas · v51: al exportar un examen en borrador, aviso "Este examen todavía no está aprobado. Podés exportarlo igual." con "Revisar primero" |
| H38 | Muchos "Copiar" repetidos en el año pasado; querría "Traer todo" | R2: Laura | Ruido | diseño | en el canvas · v51: opción A (Marco): "Copiar todo a 2026" en el aviso de 2025, con un resumen antes ("4 unidades, 29 clases y 2 exámenes, como borrador") y aviso al terminar (2 estados nuevos). Los botones por unidad quedan; los de cada clase solo al pasar el mouse |
| H39 | La cita de la ficha no coincide con los datos de la ventana anterior; columna derecha cortada | R2: Laura, Graciela | Ruido | maqueta | en el canvas · v48: los autores ya coincidían; Editar ficha ahora muestra la fuente abierta (Rodríguez, 2021, web) y la columna derecha ya no se corta |
| H40 | Sin conexión: la barra naranja se corta; "Reintentar ahora" no dice qué pasó | R2: Matías · *R3: Matías: la franja sigue cortada* | Ruido | diseño | abierto · R3: sigue · en el canvas · v51: la barra de sin conexión puede pasar a dos líneas; junto a "Reintentar ahora", "Último intento hace 20 s: sin internet" |
| H41 | Los números vuelven a no coincidir: examen de "100 puntos" cuyos tipos suman 82; "4 unidades" después de crear la quinta; 26 de 32 aprobadas apenas creadas; "3 PDF" vs "4 PDF"; "2 cosas para revisar" vs las etiquetas de las tarjetas; "Revolución de Mayo" Aprobado en Exámenes y Desactualizada en el inicio | R3: Graciela, Sofía, Matías, Laura | Fricción | diseño | abierto |
| H42 | La misma cosa con nombres distintos: dadas / aprobadas / revisadas; Estilo de cita / Formato de citas; Autor / Autores; Libros de texto / Manuales; Versión B "distintas preguntas" / "otro orden"; "temas" para contenidos y para versiones | R3: Graciela, Matías | Fricción | diseño | abierto |
| H43 | Traer las clases del año pasado a una materia que sigo dando: no ve la pestaña del año anterior; "Volver a darla" solo está en "Materias que ya no das" y el Asistente no lo sugiere | R3: Laura | Fricción | diseño | abierto |
| H44 | Nuevo examen arranca con todo tildado (5 fuentes, todas las clases): "las últimas 3 clases" obliga a destildar a mano | R3: Graciela, Matías | Fricción | diseño | abierto |
| H45 | Instalar un mod: aparece en medio de agregar una fotocopia ("un mod de 140 MB") y se instala con un clic sin decir de dónde viene ni qué permisos tiene | R3: Diego, Matías | Fricción | diseño | abierto |
| H46 | Nada marca ni detecta una pregunta con dos respuestas válidas | R3: Matías | Fricción | diseño | abierto |
| H47 | Ficha de fuente: la cita muestra edición, volumen y páginas, pero Editar ficha no tiene esos campos; Nueva fuente no pregunta capítulo ni páginas | R3: Graciela, Laura | Fricción | diseño | abierto |
| H48 | Estilo de cita: "Guardado… en todas las materias" no dice si vale para todos los colegios; el estilo propio de una materia no se encuentra desde Ajustes | R3: Laura, Graciela | Fricción | diseño | abierto |
| H49 | Material para alumnos: no muestra las fuentes citadas y abre en la página 2 de 2 | R3: Sofía | Fricción | diseño | abierto |
| H50 | Editar categorías: "Juntar con" y renombrar quedan abiertos a la vez en la misma fila; 14 categorías y solo 8 en la barra | R3: Graciela | Fricción | diseño | abierto |
| H51 | Empezar 2027: la fila Exámenes no tiene casilla; en la materia 2027 las pestañas de año pasan a un desplegable | R3: Graciela | Fricción | diseño | abierto |
| H52 | Escaneo: pantalla extra "Revisá el texto antes de guardar" con 3 palabras dudosas, que Diego saltearía | R3: Diego | Fricción | diseño | abierto |
| H53 | El Asistente no dice que pregunta antes de cambiar ("Puedo cambiarlo yo si me decís qué querés"; Empezar 2027: "la IA te sugiere cambiarles las preguntas") | R3: Laura | Fricción | diseño | abierto |
| H54 | Exportar la clase: muchas decisiones juntas para quien solo quiere imprimir; "Listo" no dice qué archivo es para proyectar y cuál para imprimir | R3: Laura, Diego | Fricción | diseño | abierto |
| H55 | Editor de clase: miniaturas en blanco, hay que abrir cada diapositiva para encontrar la de la fecha | R3: Diego | Ruido | diseño | abierto |
| H56 | Planificar: "Cambiar el pedido" y "Pedir cambios en el Asistente" parecen lo mismo; "Descargar el original" y "Abrir" lado a lado | R3: Sofía, Laura | Ruido | diseño | abierto |

## Palabras

| id | Dice la app | Dirían ellos | Quiénes |
|---|---|---|---|
| P01 | Mods | complementos, extras | Laura, Sofía, Matías, Graciela · *R3: los cinco* |
| P02 | OCR, Procesando OCR | leer fotocopias escaneadas, leyendo el texto de la foto | Laura, Diego, Graciela |
| P03 | Aprobar, Aprobada | lista, lista para dar | Laura, Sofía, Diego |
| P04 | Motor, Esfuerzo | qué tan a fondo piensa (no las tocarían) | Laura, Sofía, Graciela |
| P05 | ⌘J | sobra, no se entiende; en Windows es Ctrl | Laura, Diego, Graciela · *R3: Laura, Diego, Graciela* |
| P06 | Desactualizada | para revisar de nuevo, quedó vieja | Laura, Diego, Matías |
| P07 | Pendiente vs Borrador | sin armar todavía; no ven la diferencia | Sofía, Diego |
| P08 | Biblioteca, fuentes, categorías | mis textos, apuntes, temas, carpetas | Sofía, Diego, Graciela |
| P09 | HTML para proyectar | para proyectar en el aula | Laura |
| P10 | Armándose | generando | Matías |
| P11 | Versión A / B | tema A / B | Matías |
| P12 | Colegio nuevo, Plantilla para exportar | formato de documentos del colegio | Graciela |
| P13 | temas (repartir las preguntas entre 4 temas) | contenidos, unidades; "temas" son las versiones | Matías |
| P14 | diseño curricular | el programa | Laura |
| P15 | dadas / aprobadas / revisadas | una sola palabra | Graciela |
| P16 | Clases sueltas | clases sin materia | Graciela |
| P17 | palabras dudosas | palabras que no pude leer bien | Diego |

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
| Ronda 3 (v51, 40 tareas) | 20 | 19 | 1 |

- Dejaron de abandonarse: T02 buscar (Matías), T06 año nuevo, T20 categorías, T30 estilo por materia (Graciela), T07 materias que ya no doy (Laura), T34 sin conexión (Matías).
- Abandonos nuevos: T09 y T11 (Matías: la caja del chat no escribe, maqueta), T10 (Diego: el texto no entra en edición, H18), T34 (Diego no encontró el tablero de inicio, falla de la prueba).
- Diego reconstruyó cuatro tareas desde un resumen: su informe pesa menos.

Ronda 3:
- La única abandonada es T34 de Diego: otra vez no encontró el tablero "Sin conexión" (falla de la prueba, no del diseño). Matías sí lo hizo y le pareció Bien.
- Pasaron limpias por primera vez: T10 (Diego, H18), T11 (Matías, H19), T12 y T26 (Sofía), T24 y T25 (Graciela), T27 (Laura, Diego).
- Quedan 11 arreglos de v49–v51 que no alcanzaron (`abierto · R3: sigue`) y 16 problemas nuevos (H41–H56), casi todos fricción menor: nombres y números que no coinciden.
- Matías citó de memoria en T21–T34; Diego recorrió todo el canvas buscando el tablero de T34.

Problemas de la maqueta, ronda 3:
- Los campos no escriben (el Asistente sobre todo): T32 y T09 se imaginaron.
- ⌘K no llega al canvas; Esc dentro de la búsqueda saca del Play.
- Varios links abren otra materia o clase (Volver a darla → Biología 2º B; Mendel → Fotosíntesis; Nueva clase siempre Biología U4).
- Sin cablear: "Crear una clase para la U4", "Pedir a la IA…", "Descartar" en el Asistente de la Biblioteca, Clase 27 en la materia 2027, destildar una clase en Nuevo examen.
- Ajustes: tocar APA 7 mostró MLA 9 elegido.
- "Ver antes y después" de acortar muestra el cambio de la diapositiva 3.
- Escaneo: se saltea elegir el archivo y la ficha muestra Kandus en vez de la fotocopia.
- Al terminar de exportar, vuelve al editor reiniciado.
- Para T34, dar el título exacto del tablero y verificar antes que existe con ese nombre.
