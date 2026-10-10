# Formato propio de puzle (JSON)

Un puzle se describe en un fichero JSON con esta estructura (ejemplo reducido):

```json
{
  "name": "Mi caso",
  "objective": "murder",
  "areas": ["KKLL", "KKLL", "MMLL", "MMNN"],
  "areaNames": { "K": "Kitchen", "L": "Living Room", "M": "Bedroom", "N": "Yard" },
  "areaGroups": { "ship": ["Sloop A", "Galleon"] },
  "subareas": { "s": "L" },
  "objects": { "R1C1": "table", "2,2": "chair", "R3C1": "bed" },
  "occupiable": ["bed", "chair", "hammock"],
  "doors": [ [[2, 2], [2, 3]] ],
  "groups": { "zookeeper": ["Ivan", "Vlad"] },
  "characters": [
    { "name": "Alba", "sex": "f", "role": "victim", "clue": "The victim." },
    { "name": "Bruno", "sex": "m", "attrs": ["hat"], "clue": "He was on a bed.", "constraints": [{ "type": "on", "object": "bed" }] }
  ],
  "global": [ { "type": "area_count", "area": "Habitat", "group": "zookeeper", "min": 1 } ]
}
```

- `objective`: `murder` (la víctima estaba a solas con el asesino en su zona), `treasure` (el tesoro ocupa la última casilla libre) o `none`.
- `areas`: una cadena por fila, un carácter por casilla. `areaNames` da el nombre de cada código. `subareas` declara que un código es una subzona de otra zona principal (para "misma zona" cuenta la principal).
- `areaGroups`: nombres colectivos (p. ej. `ship`) utilizables en las pistas. Además, un nombre parcial vale como "clase": `Cabin` casa con `Cabin A`, `Habitat` con `Bear Habitat`.
- `objects`: objeto de cada casilla (claves `RrCc` o `r,c`, 1-based). Los nombres se normalizan a minúsculas. Si no se da `occupiable`, se usa la tabla oficial de murdoku.com (cama, silla, hamaca, alfombra, caballo, coche... se pueden ocupar; mesa, árbol, estantería... no).
- `doors`: pares de casillas que están "frente a" una puerta o ventana.
- `characters`: `sex` (`m`/`f`), `attrs` (etiquetas libres: `hat`, `eyepatch`, `glasses`...), `role` (`suspect` por defecto, `victim`, `treasure`), `clue` (texto) y `constraints` (codificación lógica, ver abajo). `groups` añade una etiqueta a varios personajes.
- `global`: restricciones que no pertenecen a un personaje.

## Tipos de restricción

Todas admiten `"not": true` para negarlas salvo que se indique lo contrario.

| tipo | parámetros | significado |
|---|---|---|
| `in_area` | `area` | está en esa zona (nombre, clase o grupo) |
| `beside` | `object` \| `area` \| `who` | junto a un objeto (adyacente ortogonal y misma zona), junto a una zona (adyacente a alguna casilla de esa zona) o junto a una persona |
| `not_beside` | `object` \| `who` | abreviatura de `beside` negado |
| `on` | `object` | sobre ese objeto (cama, silla, hamaca...) |
| `row` / `col` | `value`: número, `top`/`bottom`, `first`/`last` | fila o columna concreta |
| `area_row` / `area_col` | `value`: `top`/`bottom`, `left`/`right` | fila superior/inferior o columna izquierda/derecha de su zona |
| `corner` | `of`: `grid` \| `area` | en una esquina de la cuadrícula o de su zona |
| `no_object_in_line` | `object`, `line`: `column` \| `row` | no hay ese objeto en su columna/fila |
| `object_in_area` | `object` | hay ese objeto en su zona |
| `in_front_of_door` | — | en una de las casillas frente a una puerta/ventana |
| `direction` | `who`, `dir` (`north`...`southwest`), `exact` / `min` / `max` | al norte/sur/este/oeste de alguien, opcionalmente con número de filas/columnas |
| `same_row` / `same_col` | `who` | misma fila/columna que alguien |
| `with` / `not_with` | `who` | misma zona que alguien |
| `alone` | — | nadie más en su zona |
| `alone_with` | `who` | a solas con alguien (solo ellos dos en la zona) |
| `not_alone` | — | alguien más en su zona |
| `only_on` | `object` | la única persona sobre ese tipo de objeto (e implica estar sobre él) |
| `other_beside_in_area` | `object` | otra persona de su zona está junto a ese objeto |
| `someone_in_area` | `sex` / `attr` / `group`, `on` (objeto), `area` (restringe también la propia zona) | en su zona hay alguien con esas características |
| `someone_exact_rows_beside` | `rows`, `dir` (`north`/`south`), `object` | alguien exactamente N filas al norte/sur está junto a ese objeto |
| `no_attr_adjacent_columns` | `attr` | nadie con esa etiqueta en una columna adyacente |
| `area_count` (global) | `area`, `min` / `max`, `sex` / `attr` / `group` | cada zona que casa con `area` tiene entre min y max personas (con esas características) |
| `empty_area` (global) | `area` | esa zona está vacía |

El rol `victim` añade automáticamente la regla del asesinato cuando `objective` es `murder`. El rol `treasure` crea una entidad que puede ocupar cualquier casilla (también con objeto) y que se queda con la fila y la columna sobrantes.
