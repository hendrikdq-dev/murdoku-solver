# Cambios

## 0.2.0 (10-10-2026)

Versión de consolidación tras la auditoría (`docs/AUDITORIA.md`). Mismos resultados y mismos textos de explicación que la 0.1.0; cambian los mensajes de error, aparecen avisos y se retiran tres variantes de pista insatisfacibles.

### Corrección

- La propagación ya no convierte cualquier excepción de una regla en una contradicción lógica: un error de programación sale a la superficie en lugar de producir un "0 soluciones" o una "solución única" falsos.

### Validación y avisos

- El CLI valida opciones (`--limit`, `--crop`, `--hyp`, valores ausentes, opciones desconocidas), ficheros (JSON mal formado con el nombre del fichero, ficheros que no son un puzle), el slug y el idioma de `fetch`.
- El formato propio rechaza con mensaje concreto filas de `areas` de longitud distinta, claves de casilla y puertas fuera del tablero, códigos desconocidos en `subareas`, personajes duplicados o sin nombre y valores de `sex`, `role` y `objective` fuera de su vocabulario. Los errores de una pista indican el personaje y el tipo.
- Avisos por `stderr` (`P.meta.warnings`): objetos desconocidos en puzles propios, códigos de objeto desconocidos, víctima deducida del texto de la pista, sexo no reconocido, JSON oficial sin `total_chars`, códigos de `areaNames` sin usar.
- Mensajes de error en español en todo el proyecto.

### Pistas

- Retiradas `beside` con `who`, `same_row` y `same_col`: dos personajes nunca comparten fila ni columna, así que esas pistas eran insatisfacibles.
- La biblioteca de pistas vive en `src/clues/` (un módulo por familia) con el contrato de restricción documentado en `src/clues/index.js`. Un test comprueba que la tabla de `puzzles/FORMAT.md` y los constructores coinciden.
- El comando `clues` muestra la lectura en español de cada pista codificada.

### CLI

- `main(argv, io)` importable; `--cache dir` o `MURDOKU_CACHE` para la caché de JSON oficiales; `fetch` usa el `fetch` global con 20 s de tiempo límite.
- Texto de confinamiento sin género: "X tiene que estar en la fila N".

### Tests y herramientas

- Tests de oráculo para todos los tipos de pista, puzle de ejemplo `faro-tesoro` (7×7, tesoro, subzonas, puertas, grupos), fixture sintética en formato oficial, tests del CLI y de la salida textual. Cobertura en copia limpia: del 63 % al 98 % de líneas.
- CI en GitHub Actions (Node 20 y 22 en Ubuntu, Node 22 en Windows) con lint, formato y umbral de cobertura.
- Prettier, ESLint y `.editorconfig` como herramientas de desarrollo; `package.json` marcado como privado.

## 0.1.0 (10-10-2026)

Primera versión: solucionador exhaustivo, motor de deducción explicada, cargadores del formato propio y del JSON de murdoku.com/play, renderizador SVG y CLI.
