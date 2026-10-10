'use strict';
// Loader for the project's own puzzle format (JSON written by hand).
// See puzzles/FORMAT.md for the description of the format.
const fs = require('fs');
const { Puzzle, normObj, defaultOccupiable, cellIndex, doorCells, applyGroups } = require('./model');

function parseCellKey(key) {
  const m1 = /^R(\d+)C(\d+)$/i.exec(key.trim());
  if (m1) return [+m1[1], +m1[2]];
  const m2 = /^(\d+)\s*,\s*(\d+)$/.exec(key.trim());
  if (m2) return [+m2[1], +m2[2]];
  throw new Error(`Bad cell key: ${key}`);
}

function fromSpec(j) {
  const height = j.height ?? j.areas.length;
  const width = j.width ?? j.areas[0].length;
  if (j.areas.length !== height) throw new Error('areas: wrong number of rows');
  const codes = [];
  const areaIds = [];
  for (const rowStr of j.areas) {
    if (rowStr.length !== width) throw new Error(`areas: row "${rowStr}" has ${rowStr.length} cells, expected ${width}`);
    for (const ch of rowStr) {
      let id = codes.indexOf(ch);
      if (id < 0) { id = codes.length; codes.push(ch); }
      areaIds.push(id);
    }
  }
  const areaNames = codes.map(ch => (j.areaNames && j.areaNames[ch]) || ch);
  const subareaOf = new Map();
  if (j.subareas) for (const [sub, main] of Object.entries(j.subareas)) subareaOf.set(codes.indexOf(sub), codes.indexOf(main));
  const objects = new Array(width * height).fill(null);
  for (const [key, name] of Object.entries(j.objects || {})) {
    const [r, c] = parseCellKey(key);
    if (r < 1 || r > height || c < 1 || c > width) throw new Error(`object outside grid: ${key}`);
    objects[cellIndex(r, c, width)] = normObj(name);
  }
  const occupiableNames = j.occupiable ? new Set(j.occupiable.map(normObj)) : defaultOccupiable();
  if (j.occupiableExtra) for (const e of j.occupiableExtra) occupiableNames.add(normObj(e));
  const frontCells = doorCells(j.doors, width);
  const characters = (j.characters || []).map(ch => ({
    name: ch.name,
    sex: ch.sex ? ch.sex[0].toLowerCase() : null,            // 'm' | 'f' | null
    attrs: new Set((ch.attrs || []).map(a => String(a).toLowerCase())),
    role: ch.role || 'suspect',                               // 'suspect' | 'victim' | 'treasure'
    clue: ch.clue || '',
    constraints: ch.constraints || [],
  }));
  applyGroups(characters, j.groups);
  return new Puzzle({
    name: j.name, objective: j.objective || (characters.some(c => c.role === 'treasure') ? 'treasure' : 'murder'),
    width, height, areaIds, areaNames, subareaOf, objects, occupiableNames, frontCells,
    areaGroups: j.areaGroups || {}, characters, global: j.global || [], meta: { source: 'own' },
  });
}

function loadPuzzle(path) {
  return fromSpec(JSON.parse(fs.readFileSync(path, 'utf8')));
}

module.exports = { loadPuzzle, fromSpec };
