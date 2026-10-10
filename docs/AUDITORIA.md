# Auditoría de murdoku-solver

- **Fecha:** 10-10-2026 · **Versión:** 0.1.0 · **Commit:** 9e252cf · **Node local:** 24.13.1 (`engines` pide ≥ 20)
- **Alcance:** los 22 ficheros versionados (`src/`, `test/`, `tools/`, `puzzles/`, configuración). No se ha tocado nada: este documento es el único fichero nuevo y está sin versionar.
- **Método:** lectura completa del código; `node --test --experimental-test-coverage` en tres escenarios (máquina de desarrollo con `private/` y `cache/`, solo `cache/`, y copia limpia del repo en un directorio temporal); búsquedas con `git grep` para confirmar símbolos sin uso; reproducción de tres casos límite con el CLI y con `node -e`.
- **Tamaño:** 1 525 líneas de código (≈ 115 KB), sin dependencias externas, 4 tests.

---

## 1. Arquitectura real

Es una herramienta de línea de comandos en Node.js, CommonJS, sin dependencias. Las capas son limpias y no hay ciclos:

```
src/cli.js ──► src/load-puzzle.js ───► src/model.js ──► src/objects.js
           ──► src/load-official.js ──┘      ▲
           ──► src/solver.js ──► src/clues.js ┘ (solo normObj)
           ──► src/logic.js  ──► src/propagate.js
           ──► src/render-svg.js        (sin dependencias internas)
```

**Flujo de datos.** `fetch` descarga el JSON oficial a `cache/official/<slug>.json` (y `<slug>-es.json` para textos). Los cargadores construyen un `Puzzle` (`model.js`): rejilla indexada 0-based por celda, zonas con subzonas (`mainIds`), objetos por celda, conjunto de nombres ocupables, pares "frente a puerta", personajes con `sex`, `attrs` (Set), `role`, `clue` y `constraints` (las especificaciones JSON sin interpretar). El cargador oficial fusiona las pistas codificadas a mano de `puzzles/annotations/<slug>.clues.json`.

**Núcleo lógico.** `clues.js` convierte cada especificación en un objeto restricción con hasta cinco ganchos opcionales, que son el contrato implícito de todo el sistema:

| gancho | quién lo usa | para qué |
|---|---|---|
| `unary(celda)` | `initialCandidates` | filtrar las celdas iniciales del dueño |
| `check(pos)` | `solver.js` | consistencia de una asignación parcial (`pos[k]` = celda o -1) |
| `support(pos, candOf)` | `solver.js` | soporte existencial ("alguien debe poder cumplirlo todavía") |
| `revise(st, emit)` | `propagate.js` | reglas de deducción con texto explicativo en español |
| `owner` | `initialCandidates` | índice del personaje dueño (o `null` en las globales) |

El estado es `{ cand: celdas[] por personaje }`. `propagate.js` itera hasta punto fijo: entidades fijadas excluyen fila y columna, singles ocultas (solo si nº de personajes = ancho = alto, detección automática `exactCover`), confinamiento a una línea, subconjuntos desnudos de 2 y 3 líneas, y después los `revise` de las restricciones. Cada `emit` que elimina celdas escribe una línea de log.

**Dos motores sobre la misma propagación.** `solver.js` hace búsqueda en profundidad con heurística de mínimo dominio, clonando el estado por rama; prueba unicidad y refuta hipótesis. `logic.js` hace propagación más hipótesis de un nivel: prueba cada (personaje, celda) con ≤ 14 candidatas, elige la refutación más corta, elimina esa celda y vuelve a propagar; el resultado son pasos legibles.

**Puntos de diseño que condicionan el resto del informe:**

- El contrato de restricción no está documentado en ningún sitio único; se infiere de `clues.js:94-98` y de cómo lo leen `solver.js:23-32` y `propagate.js:81-84`.
- El log de texto se usa como estructura de datos: `logic.js:37` y `logic.js:68` extraen con `indexOf`/regex las celdas fijadas a partir de la cadena literal `: quedan 1 (` que genera `propagate.js:26`. Un cambio de redacción rompe `hints` y las líneas "SUPONGAMOS" sin que ningún test lo detecte.
- `cli.js` ejecuta `main()` al cargarse (línea 171) sin `require.main === module`, así que no puede importarse ni testearse sin lanzar un proceso.
- El renderizador SVG (`render-svg.js`) y `tools/overlay.ps1` implementan la misma especificación de superposiciones (celdas, bandas, círculos, aspas) en dos lenguajes.

## 2. Archivos demasiado grandes

Por tamaño de fichero nada es alarmante; el problema está en una función y en la densidad de las líneas.

| fichero | líneas | bytes | líneas > 160 car. | línea más larga |
|---|---:|---:|---:|---:|
| `src/clues.js` | 388 | 24 713 | 27 | 283 |
| `src/cli.js` | 171 | 10 194 | 8 | 302 |
| `src/objects.js` | 162 | 11 782 | 1 | 170 |
| `src/model.js` | 139 | 7 316 | 0 | 139 |
| `src/load-official.js` | 110 | 5 882 | 1 | 184 |
| `src/propagate.js` | 92 | 4 734 | 5 | 202 |
| `src/render-svg.js` | 87 | 6 349 | 8 | 277 |
| `src/solver.js` | 79 | 3 608 | 2 | 182 |
| `src/logic.js` | 73 | 3 656 | 3 | 215 |
| `tools/overlay.ps1` | 45 | 4 743 | 7 | 468 |

Funciones más largas:

| función | ubicación | líneas | observación |
|---|---|---:|---|
| `build()` | `clues.js:94-377` | 284 | un `switch` con 28 etiquetas `case`; cada caso construye closures con `check`/`revise` en una o dos líneas de hasta 283 caracteres |
| `loadOfficialJson()` | `load-official.js:28-102` | 75 | zonas, objetos, bordes, personajes, pistas y textos en un solo cuerpo |
| `main()` | `cli.js:103-169` | 67 | los seis comandos en línea |
| `renderSvg()` | `render-svg.js:20-85` | 66 | aceptable, es lineal |
| `pass()` | `propagate.js:33-86` | 54 | cinco reglas en un cuerpo; filas y columnas duplicadas |

`objects.js` es una tabla de datos (156 filas) y no es un problema de tamaño, pero arrastra el campo `file` (nombre del SVG oficial) que el código nunca lee.

## 3. Código duplicado

1. **Aplicación de hipótesis**: `solver.js:19-22` y `logic.js:19-22` son cuatro líneas idénticas.
2. **`isTreasure`**: definido como lambda en `propagate.js:15` y `logic.js:15` cuando `model.js:125` ya ofrece `isPerson` y `clues.js:27` `persons`.
3. **Cálculo del asesino**: `solver.js:56-60` (dentro de `describeSolution`) repite `murdererOf` (`solver.js:72-76`).
4. **Grupos → atributos**: `load-puzzle.js:49-53` y `load-official.js:86-90` son el mismo bucle, incluido el mensaje de error.
5. **Puertas → pares de celdas** y la aritmética `(r - 1) * width + (c - 1)`: `load-puzzle.js:36,40` y `load-official.js:66` repiten lo que `Puzzle.idx` (`model.js:36`) ya encapsula.
6. **Patrones de `check` en `clues.js`**: el binario `pos => (pos[me] < 0 || pos[w] < 0) ? true : pred(...)` aparece en las líneas 115, 166, 189 y 197; el par existencial `check` + `support` aparece en 240-241, 255-256, 267-268 y 279-280.
7. **Inferencia de "línea ocupada"**: `clues.js:68-72` (filas) y `73-77` (columnas) son espejo, y `clues.js:289-294` es una tercera copia específica de `someone_exact_rows_beside`.
8. **Filas vs columnas en `propagate.js`**: singles ocultas (42-46 vs 47-51) y confinamiento (57 vs 59) duplicados en lugar de iterar sobre la dimensión, como sí hace el bloque de subconjuntos (63-78).
9. **`cli.js`**: el bucle de fusión de traducciones está dos veces (66 y 72); `args.limit || 2` se evalúa dos veces (139-140); `./load-official` se importa en la línea 8 y se vuelve a requerir en la 76.
10. **Dos renderizadores de la misma especificación**: `render-svg.js` y `tools/overlay.ps1` ya han divergido (márgenes 34/26 frente a 44/30, radio del círculo `0.4·cs` frente a `cs − 8`).
11. **Patrón de URL de murdoku.com**: `cli.js:111`, comentario de `load-official.js:3` y `tools/play-puzzles-json.txt:2`.

## 4. Código muerto

Confirmado con `git grep` sobre `src/` y `test/`:

| elemento | ubicación | situación |
|---|---|---|
| `Puzzle.charsWith` | `model.js:116-124` | nunca se llama (`clues.js:30` tiene su propio `filterPersons`) |
| `Puzzle.rawAreaNameOf`, `Puzzle.cellsWithObject` | `model.js:46`, `model.js:67` | nunca se llaman |
| export `DIRS` | `model.js:139` | nadie lo importa; `clues.js:11` define otro `DIRS` con distinta forma |
| import `loadOfficial` | `cli.js:8` | no se usa; el CLI usa `loadOfficialJson` vía un `require` tardío en la línea 76 |
| export `Contra` | `logic.js:73` | sin importadores (el real vive en `propagate.js`) |
| export `persons` | `clues.js:388` | sin importadores externos |
| exports `parseCellKey`, `fromSpec` | `load-puzzle.js:65` | sin importadores externos (válidos como API, pero sin tests) |
| `makeEmit`, `exactCover` devueltos por `createPropagator` | `propagate.js:89` | ningún llamador los lee |
| campos `text`, `others`, `type`, `spec` de las restricciones | `clues.js:98,114,165,188,196,222` | nunca se leen; solo se consumen `owner`, `unary`, `check`, `support`, `revise`. Los textos en español de cada restricción parecen pensados para el comando `clues`, que imprime el JSON crudo (`cli.js:134`) |
| `meta.spec` (JSON completo del puzle), `meta.edges`, `meta.annotated`, `meta.source` | `load-puzzle.js:57`, `load-official.js:100` | nunca se leen |
| primer filtro de `withCheck` | `solver.js:23` | `c => !c.unary \|\| c.check !== undefined` es siempre verdadero porque `base` define `check` |
| guarda `if (!dr && !dc && dr !== 0)` | `clues.js:148` | inalcanzable: con una dirección inválida la línea 147 ya lanza `TypeError: undefined is not iterable` (reproducido) |
| prefijo `official:` | `cli.js:54` | no aparece en la ayuda ni en el README |
| campo `file` de la tabla de objetos | `objects.js` | nunca se lee |
| `*.png binary` | `.gitattributes` | no hay PNG versionados (inofensivo) |

## 5. Dependencias no usadas

- `package.json` no declara dependencias ni devDependencies; no hay lockfile ni `node_modules`. La afirmación del README ("sin dependencias") es exacta.
- Módulos nativos usados: `fs`, `path`, `https` (solo `cli.js`), `node:test` y `node:assert` (tests).
- `https` más la promesa manual de `cli.js:84-91` pueden sustituirse por el `fetch` global, disponible desde Node 18 y por tanto cubierto por `engines ≥ 20`.
- El único import sin uso es `loadOfficial` en `cli.js:8` (ver sección 4).
- `engines.node >= 20` lo justifica `node --test` (estable desde la 20); el código en sí solo necesita ES2020 (`??`, `flatMap`, `Object.fromEntries`).
- No hay herramientas de calidad instaladas (linter, formateador, CI); no es una dependencia sobrante sino una ausencia, relevante para las secciones 6 y 9.

## 6. Inconsistencias de estilo y nombres

- **Idiomas.** Comentarios e identificadores en inglés y textos para el usuario en español es una decisión coherente, pero los mensajes de error están mezclados: en inglés en `model.js:113` ("Unknown character"), `load-puzzle.js:12,18,22,35`, `load-official.js:31`, `clues.js:375`; en español en `cli.js:56,96,108,119,160,168` y en los `revise` (`clues.js:328,360`). Los nombres de zona por defecto son `Zona ${k}` en `load-official.js:36` y `area ${id}` en `model.js:44`.
- **`P` significa `Puzzle` en todo el proyecto salvo en `load-official.js:29`**, donde `P`, `G` y `C` son las secciones `PROPERTIES`, `GRID` y `CHARACTERS` del JSON oficial.
- **`ch`** es "personaje" en `load-puzzle.js:41` y `clues.js:19`, pero "changed" en `propagate.js:35` y en todos los `revise` (`clues.js:45,58,176,...`).
- **Celdas, filas y columnas.** `c` es una celda en `clues.js` y `propagate.js` (con `d` como segunda celda) y una columna en `model.js` y `render-svg.js`; conviven `col`, `c`, `cc`, `idx`, `i`; el cargador oficial trabaja en `x/y` 0-based y la API pública en `r/c` 1-based.
- **Valores por defecto.** Se mezclan `??` (`solver.js:14`, `logic.js:11`) y `||` (`cli.js:139`, `render-svg.js:21`, `model.js:10`). Con `||`, `--limit 0` pasa a ser 2 y `cell: 0` a 34.
- **Comillas.** Simples en todo `src/` salvo `objects.js` (dobles).
- **Densidad.** 64 líneas de `src/` superan los 160 caracteres (máximo 302 en `cli.js`); varios bucles `for` con cuerpo de una línea encadenan `ch = emit(...) || ch`. No hay `.editorconfig`, Prettier ni ESLint; los finales de línea sí están gobernados por `.gitattributes`.
- **JSDoc** solo en algunas funciones (`solve`, `renderSvg`, `areaMatcher`, `isAreaCorner`).
- **Cuatro nombres para un concepto:** `occupiable` (JSON), `occupiableExtra` (JSON), `occupiableNames` (Set del modelo) y `OCCUPIABLE_BY_NAME` (Map de la tabla).
- **Literales libres.** `'suspect' | 'victim' | 'treasure'` y `'murder' | 'treasure' | 'none'` se comparan como cadenas en nueve sitios sin constantes; un `role` mal escrito no falla (ver sección 7).
- **Sexo.** El formato propio admite `null` (`load-puzzle.js:43`); el cargador oficial nunca lo produce: todo lo que no sea `1` es `'m'` (`load-official.js:80`).
- **Tipografía en consola.** `—`, `⇒`, `·`, `✔`, `✘`, `×` en la salida del CLI; correctos en UTF-8, ilegibles en consolas Windows con página de códigos heredada.

## 7. Manejo de errores

**Lo que está bien.** Un único `catch` en `cli.js:171` imprime `Error: <mensaje>` y sale con código 1. La clase `Contra` separa contradicciones lógicas de fallos reales, y el solucionador solo traga `Contra` (`solver.js:37`). Los cargadores validan dimensiones de `areas` y rango de las celdas de `objects` (`load-puzzle.js:18,22,35`). `fetch` valida el JSON antes de guardarlo y comprueba el código HTTP (`cli.js:87,113`).

**Hallazgo principal: los errores de programación se convierten en contradicciones.** `propagate.js:83` captura cualquier excepción lanzada por un `revise` y la relanza como `Contra`. Un `TypeError` por un bug poda la rama en silencio, y el resultado es un "0 soluciones", una "solución única" o una "hipótesis refutada" falsos. Reproducido: una restricción cuyo `revise` lanza `TypeError` produce `soluciones: 0 · nodos: 1` sin ningún aviso. `clues.js:328` y `clues.js:360` dependen de esta conversión al lanzar `Error` en vez de `Contra`. Es el punto más grave de la auditoría porque la razón de ser de la herramienta es demostrar unicidad.

**Fallos silenciosos o mensajes crípticos** (los tres primeros, reproducidos):

- `--hyp Clara=99,1` imprime `soluciones encontradas: 0` en lugar de "fila fuera de rango" (`cli.js:93-100` no valida rango).
- `--limit abc` da `NaN`; la comparación `>= NaN` siempre es falsa, así que nunca se corta la búsqueda ni se imprime "límite alcanzado" (`cli.js:139-140`).
- Una `dir` inválida en `direction` lanza `TypeError: undefined is not iterable` (`clues.js:147`) en lugar del mensaje previsto en la línea 148.
- `JSON.parse` sin contexto en `cli.js:58,65,72,75,113,159`, `load-puzzle.js:62` y `load-official.js:105-106`: un fichero mal formado da "Unexpected token…" sin decir qué fichero.
- `--out` como último argumento vale `true` (`cli.js:43-44`) y acaba en `fs.writeFileSync(true, …)`; `--crop 1,2,3` produce `NaN` en la geometría y un SVG roto; los flags desconocidos (`--limt`) se ignoran.
- Un `role` con errata no es `'suspect'` y pasa a contar como pista "codificada" en `cli.js:121`; nombres de personaje duplicados: gana el último (`model.js:33`), y `--hyp` por nombre se vuelve ambiguo.
- `subareas` con códigos inexistentes: `indexOf` devuelve -1 y la zona principal pasa a ser `area -1` (`load-puzzle.js:31`); las celdas de `doors` no se comprueban (`load-puzzle.js:40`, `load-official.js:66`).
- Un objeto con nombre desconocido ("chiar") no está en la tabla oficial y se trata como no ocupable: bloquea la casilla sin aviso (`load-puzzle.js:36-38`, `model.js:51`).
- Si falta `total_chars`, el puzle oficial carga con 0 personajes y se "resuelve" trivialmente (`load-official.js:68`).
- `Unknown character` y `Unknown constraint type` no dicen qué restricción ni qué personaje los provocó (`model.js:113`, `clues.js:375`).
- `fetchUrl` no sigue redirecciones (un 301 se reporta como error HTTP), no tiene tiempo límite ni tope de tamaño (`cli.js:84-91`). Aceptable en un CLI local.
- `explain`/`hints` informan de `atascado` o `contradicción` solo en texto; el código de salida es 0 siempre, lo que impide usarlos en scripts.

## 8. Secretos o configuración hardcodeada

**Secretos: ninguno.** No hay tokens, claves, contraseñas ni correos en ficheros ni commits (la autoría usa la dirección `noreply` de GitHub). La autenticación de `gh` vive fuera del repo.

**Configuración incrustada en el código:**

- Plantillas de URL de murdoku.com en `cli.js:111`; lista de idiomas `(en|es|fr|pt|de|it|nl)` en `cli.js:61` frente a los cuatro idiomas de la regex de víctima en `load-official.js:78`.
- Rutas ancladas a la raíz del repo: `cache/official`, `puzzles/annotations` (`cli.js:13-15`) y `out/` (`cli.js:162`). Con el `bin` de `package.json` instalado globalmente, el CLI escribiría dentro del propio paquete. Solo `--annotations` y `--out` son configurables.
- Números mágicos sin nombre: `maxWhatIf` 14 (`logic.js:11`); umbrales de `pairRevise` 4000 y 2000 (`clues.js:169,203`); subconjuntos de hasta 3 líneas (`propagate.js:68`); 40 pistas y 40 líneas de solución (`load-official.js:92-93`); reglas personalizadas 1 a 3 (`load-official.js:94`); `limit` por defecto 2 en dos ficheros (`cli.js:139-140`, `solver.js:14`).
- Identificadores de objeto por número sin nombre: `EXTEND_RIGHT = {6, 119, 21, 22, 90}` y `BUS_IDS = {56}` (`load-official.js:11-12`).
- Paleta, márgenes y tamaño de celda del SVG (`render-svg.js:5-6,21-23`); márgenes, fuentes y fondo de `overlay.ps1`.
- `objects.js` es una copia de la tabla del bundle del sitio oficial (fecha 10-10-2026): es la única forma de interpretar los JSON, pero envejecerá con el sitio y arrastra el campo `file` sin uso.
- `tools/play-puzzles-json.txt` es una instantánea de URLs fechada; caducará.

## 9. Cobertura de tests

Medida con `node --test --experimental-test-coverage` en tres escenarios. El tercero es el que vería cualquier otra persona o una CI.

| escenario | tests ejecutados | líneas | ramas | funciones |
|---|---:|---:|---:|---:|
| Máquina de desarrollo (`private/` + `cache/`) | 4 de 4 | 85,8 % | 82,4 % | 81,1 % |
| Solo `cache/` (tras `fetch preppers-medium`) | 3 de 4 | 77,9 % | 77,0 % | 68,1 % |
| Copia limpia del repo | 2 de 4 | 62,8 % | 66,0 % | 48,0 % |

Por fichero (líneas), mejor caso → copia limpia:

| fichero | mejor caso | copia limpia | sin cubrir en el mejor caso |
|---|---:|---:|---|
| `clues.js` | 73,2 % | 33,5 % | 14 variantes de pista (abajo) |
| `load-official.js` | 96,4 % | 17,3 % | grupos; 55 % de ramas: traducciones, subzonas, `EXTEND_RIGHT`/`BUS` |
| `logic.js` | 65,8 % | 46,6 % | `formatSteps`, `milestones`, hipótesis en `explain`, rama de contradicción |
| `solver.js` | 79,7 % | 73,4 % | `describeSolution` |
| `model.js` | 88,5 % | 88,5 % | `areasMatching`, `cellsMatchingArea`, `charsWith` |
| `load-puzzle.js` | 92,3 % | 89,2 % | `groups`, error de clave de celda |
| `propagate.js` | 100 % | 85,9 % | en limpio no se ejercitan los subconjuntos desnudos |
| `render-svg.js` | 100 % | 100 % | 58 % de ramas (recortes, bandas, aspas) |
| `cli.js` | 0 % | 0 % | no se carga en ningún test (ejecuta `main()` al importarse) |

**Tipos de pista sin ninguna prueba, ni siquiera con el puzle privado:** `beside` con `who`, `col`, `area_col`, `corner`, `same_row`, `same_col`, `with`, `not_with`, `alone`, `alone_with`, `not_alone`, `only_on`, `area_count` y `empty_area`. La negación `not` solo se ejercita en `not_beside`. El camino negativo de `support` (`clues.js:90`) nunca se alcanza.

**Diseño de los tests.** Dos de los cuatro dependen de ficheros externos al repo (uno privado, otro descargado), así que una copia limpia solo valida el puzle de juguete 4×4. No hay tests negativos (entradas mal formadas, tipos desconocidos, nombres duplicados), ni del CLI (`parseArgs`, `resolvePuzzle`, `parseHyps`), ni de la salida textual de `explain`/`hints`. El renderizador solo se comprueba contando `<circle`. El test del concurso tarda 3,3 s y no tiene cota. No existe CI.

## 10. Riesgos

Ordenados por gravedad.

1. **Conclusiones falsas por errores tragados** (`propagate.js:83`). Un bug en cualquier `revise` se presenta como "contradicción" y produce certificados de unicidad o refutaciones incorrectos. Probabilidad media, impacto alto: afecta a la función principal.
2. **Semántica silenciosa.** Objetos desconocidos bloquean casillas sin aviso; la víctima se detecta por regex sobre el texto de la pista (`load-official.js:78`), así que un sospechoso que mencione "the victim" se convierte en víctima si no hay anotación; sexo no reconocido → hombre; `areaMatcher` casa por prefijo y sufijo (`model.js:94`), de modo que `Hall` incluye también `Great Hall`; las celdas sin código de zona se asignan a la zona 0 (`load-official.js:42`). Todo produce codificaciones incorrectas sin error.
3. **Acoplamiento al formato alfa de murdoku.com.** Claves como `room_code_<x>_<y>`, `title_<lang>_`, `total_chars` e identificadores numéricos de objeto; un cambio del sitio degrada en silencio (0 personajes, objetos `objN`) en lugar de fallar. El README lo reconoce.
4. **Log textual como estructura de datos** (`logic.js:37,68` ↔ `propagate.js:26`). Cualquier retoque de redacción rompe `hints` y los pasos "SUPONGAMOS" sin test que lo detecte.
5. **Sin red de seguridad.** Copia limpia: 63 % de líneas y 48 % de funciones, 14 variantes de pista sin test, CLI al 0 %, sin CI. Cualquier refactor, incluidos los propuestos abajo, se hace a ciegas.
6. **Material de terceros y del concurso.** `private/` y `cache/` solo están protegidos por `.gitignore`; un `git add -f` o una edición del fichero los expondría. El repo debe seguir privado hasta el cierre del concurso (00:00 del 12-10-2026, hora española). `objects.js` copia nombres e identificadores del bundle del sitio.
7. **Rutas y empaquetado.** Rutas ancladas al repo y `bin` global; `fetch <slug>` no sanea el slug, así que `../` escribiría fuera de `cache/` (solo afecta al propio usuario). `"private": false` permite un `npm publish` accidental.
8. **Rendimiento sin cotas.** `explain` prueba cada (personaje, celda) con propagación completa en cada paso; `pairRevise` es cuadrático con umbrales fijos; un `--limit` inválido desactiva el corte; no hay tiempo límite. En 24×24 ya son 3,3 s.
9. **Portabilidad.** `overlay.ps1` solo funciona en Windows (`System.Drawing`); la salida usa símbolos Unicode; se desarrolla con Node 24 y `engines` promete la 20 sin que nadie la pruebe.
10. **Deuda de legibilidad.** Una función de 284 líneas, 64 líneas de más de 160 caracteres y convenciones de nombres contradictorias (`P`, `ch`, `c`) elevan el coste de cada cambio y la probabilidad de introducir el riesgo 1.

## 11. Diez acciones priorizadas por beneficio/riesgo

| nº | acción | beneficio | riesgo | ¿cambia comportamiento? |
|---:|---|---|---|---|
| 1 | Tests de las 14 variantes de pista y fixture pública | alto | nulo | no |
| 2 | Dejar de convertir errores genéricos en `Contra` | alto | bajo | solo ante bugs |
| 3 | CI en GitHub Actions | alto | nulo | no |
| 4 | Borrar código muerto | medio | nulo | no |
| 5 | Validación de entradas con mensajes claros | medio-alto | bajo | solo con entradas inválidas |
| 6 | Deduplicar (hipótesis, asesino, grupos, `isTreasure`, `check`) | medio | bajo | no |
| 7 | Avisos en `stderr` ante semántica silenciosa | medio | bajo | sí (solo salida en `stderr`) |
| 8 | `.editorconfig` + Prettier + ESLint, renombrados, idioma de errores | medio | bajo | no (sí en los textos de error) |
| 9 | Partir `clues.js` y sustituir el parseo del log por eventos | medio | medio | no |
| 10 | Rutas configurables, `fetch` global, `cli.js` importable, `"private": true` | bajo-medio | bajo | sí (dónde se escribe) |

1. **Tests de las 14 variantes sin cobertura y una fixture pública.** Mini-puzles de 5×5 por familia (binarias, existenciales, globales), tests de `formatSteps`, `milestones` y `describeSolution`, y un puzle público reducido para que una copia limpia ejecute algo más que el 4×4. Es la acción que habilita todas las demás. *No cambia comportamiento.*
2. **No convertir errores genéricos en `Contra`.** En `propagate.js:83` relanzar todo lo que no sea `Contra`; en `clues.js:328` y `clues.js:360` lanzar `Contra` explícitamente. *Cambia comportamiento solo ante bugs:* donde hoy sale "0 soluciones" saldrá un error visible, que es lo correcto.
3. **CI en GitHub Actions** con `npm test` en Node 20 y 22 y `--experimental-test-coverage`. Funciona ya porque los tests se saltan sin ficheros privados; cobra sentido real con la acción 1. *No cambia comportamiento.*
4. **Borrar código muerto:** `charsWith`, `rawAreaNameOf`, `cellsWithObject` y el export `DIRS` en `model.js`; el import `loadOfficial` en `cli.js:8`; el export `Contra` en `logic.js`; el filtro no-op de `solver.js:23`; los campos `text`/`others`/`spec`/`type` de las restricciones (o bien usar `text` en el comando `clues`, lo que sí cambiaría su salida) y `meta.spec`/`edges`/`annotated`. Para la guarda inalcanzable de `clues.js:148`, validar `DIRS[spec.dir]` antes de desestructurar. *No cambia comportamiento*, salvo el mensaje ante una dirección inválida.
5. **Validación de entradas con mensajes claros.** Envolver cada `JSON.parse` con el nombre del fichero; comprobar rango de `--hyp`; exigir números en `--limit` y `--crop`; rechazar `--out` sin valor y flags desconocidos; detectar nombres duplicados, `role`/`sex`/`objective` fuera del vocabulario, `subareas` y `doors` fuera de rango; indicar el dueño en `Unknown character`/`Unknown constraint type`. *Cambia comportamiento solo con entradas inválidas*, que hoy fallan en silencio o con mensajes crípticos.
6. **Deduplicar.** `applyHypotheses` compartida por `solver.js` y `logic.js`; `describeSolution` usando `murdererOf`; `applyGroups` y un `cellIndex(r, c, w)` para los dos cargadores; `P.isPerson` en lugar de las lambdas `isTreasure`; helpers `binaryCheck` y `existentialCheck` en `clues.js`; un solo bucle de fusión de traducciones en `cli.js`. *No cambia comportamiento.* Hacerlo después de la acción 1.
7. **Avisos en `stderr` ante semántica silenciosa:** objeto de puzle propio ausente de la tabla y de `occupiable`; víctima detectada por regex sin anotación; `sex` no reconocido; `total_chars` ausente; slug con caracteres fuera de `[a-z0-9-]`. *Cambia comportamiento* (aparecen avisos), los resultados no.
8. **Formato y nombres.** `.editorconfig`, Prettier con `printWidth` 120 y ESLint con `no-unused-vars`; reformatear las 64 líneas largas; renombrar `P`/`G`/`C` en `load-official.js` y `ch` (changed) → `changed`; sustituir `||` por `??` en valores por defecto numéricos; unificar los mensajes de error en español. Formatear y renombrar *no cambia comportamiento*; `??` corrige `--limit 0` y traducir errores *cambia textos*.
9. **Partir `clues.js` y dejar de parsear el log.** Convertir el `switch` de `build()` en un mapa `tipo → constructor` repartido en módulos por familia, con el contrato `unary`/`check`/`support`/`revise` documentado en un solo sitio; hacer que `emit` publique eventos estructurados (`{ who, cell, reason }`) y que `logic.js` deje de buscar `: quedan 1 (`. Refactor *sin cambio de comportamiento* si se apoya en la acción 1; riesgo medio por el tamaño.
10. **Portabilidad y empaquetado.** `cache/` y `out/` relativos al directorio de trabajo o configurables por flag o variable de entorno; sanear el slug; `fetch` global en lugar de `https`; `if (require.main === module) main()` para poder testear `cli.js`; `"private": true` si no se va a publicar en npm. Mover las rutas *cambia comportamiento* (dónde se escriben los ficheros); el resto no.
