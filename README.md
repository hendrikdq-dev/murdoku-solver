# murdoku-solver

[![CI](https://github.com/hendrikdq-dev/murdoku-solver/actions/workflows/ci.yml/badge.svg)](https://github.com/hendrikdq-dev/murdoku-solver/actions/workflows/ci.yml)

Herramientas para resolver y, sobre todo, **explicar** puzles [Murdoku](https://murdoku.com) (el juego de Manuel Garand que mezcla sudoku y misterio de asesinato): un solucionador exhaustivo, un motor de deducción que genera la cadena lógica paso a paso en español (útil para dar pistas progresivas sin desvelar la solución), un cargador de los puzles públicos de murdoku.com/play y un renderizador SVG del tablero.

Sin dependencias: solo Node.js 20 o superior.

## Uso rápido

```bash
# descargar un puzle oficial de murdoku.com/play (el slug es el de la URL del JSON); la caché es cache/official/
# en el repositorio, o la que indiques con --cache dir o la variable MURDOKU_CACHE
node src/cli.js fetch preppers-medium
node src/cli.js fetch preppers-medium --lang es     # textos en español

# resumen del tablero, pistas y estado de su codificación
node src/cli.js info preppers-medium
node src/cli.js clues preppers-medium

# búsqueda exhaustiva (demuestra que la solución es única) y comprobación con el asesino oficial
node src/cli.js solve preppers-medium

# cadena de deducciones explicada (sin búsqueda), hitos para pistas progresivas
node src/cli.js explain preppers-medium --out out/preppers.txt
node src/cli.js hints preppers-medium

# ¿y si...? fija hipótesis y comprueba si queda alguna solución
node src/cli.js solve preppers-medium --hyp Angelo=1,9 --hyp Blake=5,*

# tablero en SVG (con la solución marcada)
node src/cli.js render preppers-medium --solution --legend
```

Los puzles propios (PDF, libros, concursos) se describen en un JSON sencillo; ver [puzzles/FORMAT.md](puzzles/FORMAT.md) y [puzzles/examples/toy-murder.json](puzzles/examples/toy-murder.json):

```bash
node src/cli.js solve puzzles/examples/toy-murder.json
node src/cli.js explain puzzles/examples/faro-tesoro.json   # 7×7 con tesoro, subzonas, puertas y grupos
```

## Cómo funciona

1. **Modelo** (`src/model.js`): rejilla, zonas (con subzonas), objetos y su ocupabilidad, puertas, personajes con atributos (sexo, sombrero, parche...).
2. **Biblioteca de pistas** (`src/clues/`, un módulo por familia: unarias, binarias, existenciales y globales; el contrato de restricción está documentado en `src/clues/index.js`): cada pista se codifica como una restricción (`beside`, `in_area`, `direction`, `alone_with`, `someone_in_area`...). Las pistas de los puzles oficiales llegan como texto; su codificación se escribe a mano una vez en `puzzles/annotations/<slug>.clues.json`. La semántica sigue el glosario oficial: "junto a" = adyacente en horizontal o vertical **y en la misma zona**; "al norte de" = cualquier casilla más arriba, en cualquier zona; "frente a una puerta" = las dos casillas conectadas a la puerta.
3. **Propagación** (`src/propagate.js`): una persona por fila y columna, singles ocultos, confinamiento a una línea, subconjuntos desnudos (parejas y tríos de filas o columnas) y reglas específicas de cada tipo de pista.
4. **Solucionador** (`src/solver.js`): búsqueda en profundidad con propagación en cada nodo. Sirve para demostrar unicidad y para refutar hipótesis.
5. **Motor de deducción** (`src/logic.js`): propagación más hipótesis de un nivel ("supongamos X en R3C4 ⇒ ... ⇒ contradicción"), eligiendo siempre la refutación más corta. El resultado es una lista de pasos legible que se puede convertir en pistas.
6. **Cargadores**: formato propio (`src/load-puzzle.js`) y JSON oficial de murdoku.com/play (`src/load-official.js`, verificado con el cargador de la propia web: tabla de objetos oficial en `src/objects.js`, orientación `room_code_<columna>_<fila>`, subzonas, textos de pistas, pistas oficiales y asesino).
7. **Renderizador** (`src/render-svg.js`): tablero con zonas, muros, objetos y superposiciones (letras, círculos, aspas, bandas de fila/columna).

## Estado y límites

- Verificado con el puzle del primer concurso oficial (*The Treasure Hunt*, 24×24: solución única, explicada sin búsqueda con 21 hipótesis cortas) y con el puzle *Preppers* de /play (asesino coincidente con el oficial).
- Las pistas en lenguaje natural no se interpretan automáticamente: hay que codificarlas (ver la tabla de tipos en `puzzles/FORMAT.md`). Cuando un puzle usa una construcción nueva, se añade un constructor en el módulo correspondiente de `src/clues/` y una fila en la tabla de `puzzles/FORMAT.md` (un test comprueba que ambas listas coinciden).
- Puertas y ventanas de los JSON oficiales: el formato guarda los bordes (`room_windows_h/v`) pero su orientación no está verificada todavía; de momento se declaran a mano en la anotación (`"doors"`).
- El sitio de /play está en fase alfa y su formato puede cambiar.
- El CLI valida opciones y ficheros (los errores indican el fichero, la pista y el personaje implicados) y avisa por `stderr` de las decisiones dudosas: objetos desconocidos en puzles propios, víctima deducida del texto de la pista, sexo no reconocido o JSON oficial sin personajes.

## Tests

```bash
npm test
```

Los tests con puzles reales se saltan si faltan sus ficheros: `cache/official/preppers-medium.json` (descárgalo con `fetch`), `private/puzzles/treasure-hunt.json` y `treasure-hunt.expected.json` (el puzle del concurso y su solución no se distribuyen con el repositorio).

`test/clues.test.js` comprueba cada tipo de pista contra un oráculo independiente: enumera todas las soluciones de un tablero de 5×5 sin la pista, las filtra con una reformulación directa de su significado y exige que el solucionador devuelva exactamente ese conjunto; además verifica que el motor de deducción nunca elimina una casilla que pertenece a una solución.

## Carpetas

- `src/` código; `test/` tests; `puzzles/` formato, ejemplos y anotaciones de puzles oficiales; `tools/` utilidades auxiliares (superposición de marcas sobre una imagen del tablero en PowerShell, lista de puzles de /play).
- `cache/`, `out/` y `private/` no se versionan (JSON oficiales descargados, salidas, material privado o con derechos de terceros).

## Créditos

Murdoku es obra de Manuel Garand; los puzles, su arte y sus textos pertenecen a sus autores. Este proyecto solo contiene herramientas y codificaciones lógicas de las pistas. Licencia del código: MIT.
