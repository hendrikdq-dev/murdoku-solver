'use strict';
// Loader for the project's own puzzle format (JSON written by hand).
// See puzzles/FORMAT.md for the description of the format. Structural problems throw; doubtful
// choices that the loader resolves on its own are reported in P.meta.warnings.
const fs = require('fs');
const { Puzzle, normObj, defaultOccupiable, cellIndex, doorCells, applyGroups } = require('./model');
const { OCCUPIABLE_BY_NAME } = require('./objects');

const OBJECTIVES = ['murder', 'treasure', 'none'];
const ROLES = ['suspect', 'victim', 'treasure'];

function parseCellKey(key) {
  const m1 = /^R(\d+)C(\d+)$/i.exec(key.trim());
  if (m1) return [+m1[1], +m1[2]];
  const m2 = /^(\d+)\s*,\s*(\d+)$/.exec(key.trim());
  if (m2) return [+m2[1], +m2[2]];
  throw new Error(`clave de casilla no válida: ${key} (usa "R3C4" o "3,4")`);
}

function fromSpec(j) {
  if (!j || !Array.isArray(j.areas) || !j.areas.length) throw new Error('falta "areas" (una cadena por fila)');
  const warnings = [];
  const height = j.height ?? j.areas.length;
  const width = j.width ?? j.areas[0].length;
  if (j.areas.length !== height) throw new Error(`areas: se esperaban ${height} filas y hay ${j.areas.length}`);
  if (j.objective !== undefined && !OBJECTIVES.includes(j.objective))
    throw new Error(`objective no válido: "${j.objective}" (${OBJECTIVES.join(', ')})`);
  const inside = (r, c) => r >= 1 && r <= height && c >= 1 && c <= width;
  const codes = [];
  const areaIds = [];
  for (const rowStr of j.areas) {
    if (rowStr.length !== width)
      throw new Error(`areas: la fila "${rowStr}" tiene ${rowStr.length} casillas y se esperaban ${width}`);
    for (const ch of rowStr) {
      let id = codes.indexOf(ch);
      if (id < 0) {
        id = codes.length;
        codes.push(ch);
      }
      areaIds.push(id);
    }
  }
  const areaNames = codes.map(ch => (j.areaNames && j.areaNames[ch]) || ch);
  for (const code of Object.keys(j.areaNames || {}))
    if (!codes.includes(code)) warnings.push(`areaNames: el código "${code}" no aparece en "areas"`);
  const subareaOf = new Map();
  for (const [sub, main] of Object.entries(j.subareas || {})) {
    if (!codes.includes(sub)) throw new Error(`subareas: código desconocido "${sub}"`);
    if (!codes.includes(main)) throw new Error(`subareas: zona principal desconocida "${main}" (para "${sub}")`);
    subareaOf.set(codes.indexOf(sub), codes.indexOf(main));
  }
  const occupiableNames = j.occupiable ? new Set(j.occupiable.map(normObj)) : defaultOccupiable();
  if (j.occupiableExtra) for (const e of j.occupiableExtra) occupiableNames.add(normObj(e));
  const declared = new Set([...(j.occupiable || []), ...(j.occupiableExtra || [])].map(normObj));
  const objects = new Array(width * height).fill(null);
  for (const [key, name] of Object.entries(j.objects || {})) {
    const [r, c] = parseCellKey(key);
    if (!inside(r, c)) throw new Error(`objeto fuera del tablero: ${key}`);
    const obj = normObj(name);
    objects[cellIndex(r, c, width)] = obj;
    if (!OCCUPIABLE_BY_NAME.has(obj) && !declared.has(obj))
      warnings.push(
        `objeto desconocido "${obj}" en R${r}C${c}: se trata como no ocupable (añádelo a "occupiable" u "occupiableExtra" si se puede ocupar)`
      );
  }
  for (const pair of j.doors || [])
    for (const [r, c] of pair) if (!inside(r, c)) throw new Error(`doors: casilla fuera del tablero R${r}C${c}`);
  const frontCells = doorCells(j.doors, width);
  const seen = new Set();
  const characters = (j.characters || []).map(ch => {
    if (!ch.name) throw new Error('personaje sin nombre');
    if (seen.has(ch.name.toLowerCase())) throw new Error(`personaje duplicado: ${ch.name}`);
    seen.add(ch.name.toLowerCase());
    const sex = ch.sex ? String(ch.sex)[0].toLowerCase() : null;
    if (sex !== null && sex !== 'm' && sex !== 'f')
      throw new Error(`${ch.name}: sexo no válido "${ch.sex}" (usa m o f)`);
    const role = ch.role || 'suspect';
    if (!ROLES.includes(role)) throw new Error(`${ch.name}: rol no válido "${ch.role}" (${ROLES.join(', ')})`);
    return {
      name: ch.name,
      sex, // 'm' | 'f' | null
      attrs: new Set((ch.attrs || []).map(a => String(a).toLowerCase())),
      role, // 'suspect' | 'victim' | 'treasure'
      clue: ch.clue || '',
      constraints: ch.constraints || [],
    };
  });
  applyGroups(characters, j.groups);
  return new Puzzle({
    name: j.name,
    objective: j.objective || (characters.some(c => c.role === 'treasure') ? 'treasure' : 'murder'),
    width,
    height,
    areaIds,
    areaNames,
    subareaOf,
    objects,
    occupiableNames,
    frontCells,
    areaGroups: j.areaGroups || {},
    characters,
    global: j.global || [],
    meta: { source: 'own', warnings },
  });
}

function loadPuzzle(path) {
  return fromSpec(JSON.parse(fs.readFileSync(path, 'utf8')));
}

module.exports = { loadPuzzle, fromSpec };
