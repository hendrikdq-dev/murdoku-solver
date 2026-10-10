'use strict';
// Loader for the public puzzle JSON files served by https://murdoku.com/play
// (https://murdoku.com/play_puzzles/<lang>/puzzle-<slug>.json). Verified against the site's
// own loader (puzzle-core bundle) on 10 Oct 2026: keys are `room_code_<x>_<y>` with x = column
// and y = row (0-based). Clues are plain text; their logical encoding comes from an annotation file.
const fs = require('fs');
const { Puzzle, normObj, defaultOccupiable, doorCells, applyGroups } = require('./model');
const { BY_ID } = require('./objects');

// Objects stored in one cell but drawn (and occupying) also the cell to the right / a 2x2 block.
const EXTEND_RIGHT = new Set([6, 119, 21, 22, 90]);
const BUS_IDS = new Set([56]);

const num = v => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

function cellMap(obj, prefix, w, h) {
  const out = new Array(w * h).fill(null);
  const re = new RegExp(`^${prefix}(\\d+)_(\\d+)$`);
  for (const [k, v] of Object.entries(obj)) {
    const m = re.exec(k);
    if (!m) continue;
    const x = +m[1],
      y = +m[2];
    if (x < 0 || y < 0 || x >= w || y >= h) continue;
    out[y * w + x] = num(v);
  }
  return out;
}

function loadOfficialJson(json, annotations = {}, lang = 'en') {
  const props = json.PROPERTIES || {},
    grid = json.GRID || {},
    chars = json.CHARACTERS || {};
  const w = num(props.grid_w),
    h = num(props.grid_h);
  if (!w || !h) throw new Error('tamaño de rejilla ausente (PROPERTIES.grid_w / grid_h)');
  const warnings = [];
  const label = i => `R${Math.floor(i / w) + 1}C${(i % w) + 1}`;
  const rawCodes = cellMap(grid, 'room_code_', w, h);
  const codesPresent = [...new Set(rawCodes.filter(c => c !== null))].sort((a, b) => a - b);
  const maxCode = Math.max(...codesPresent);
  const areaNames = [];
  for (let k = 0; k <= maxCode; k++) areaNames[k] = (grid[`room_name_${k}`] ?? '').trim() || `Zona ${k}`;
  const subareaOf = new Map();
  for (let k = 0; k <= maxCode; k++) {
    const sub = num(grid[`room_subroom_${k}`]),
      main = num(grid[`room_subroom_mainroom_${k}`]);
    if (sub === 1 && main !== null && main !== k) subareaOf.set(k, main);
  }
  const areaIds = rawCodes.map(c => (c === null ? 0 : c));
  // objects
  const objCodes = cellMap(grid, 'room_objects_', w, h);
  const objects = new Array(w * h).fill(null);
  const occupiableNames = defaultOccupiable();
  for (let i = 0; i < w * h; i++) {
    const code = objCodes[i];
    if (code === null || code <= 0) continue;
    const def = BY_ID.get(code);
    const name = def ? normObj(def.name) : `obj${code}`;
    if (!def)
      warnings.push(`código de objeto desconocido ${code} en ${label(i)}: se trata como no ocupable ("${name}")`);
    const put = j => {
      if (objects[j] === null) objects[j] = name;
    };
    put(i);
    const x = i % w,
      y = Math.floor(i / w);
    if (EXTEND_RIGHT.has(code) && x + 1 < w) put(i + 1);
    if (BUS_IDS.has(code)) {
      if (x + 1 < w) put(i + 1);
      if (y + 1 < h) put(i + w);
      if (x + 1 < w && y + 1 < h) put(i + w + 1);
    }
    if (def && def.occupiable === true) occupiableNames.add(name);
  }
  // doors / windows: edge flags exist in the format (room_windows_h/v) but their orientation is not
  // verified yet; we expose them raw and let annotations give the "in front" pairs explicitly.
  const edges = [];
  for (const [k, v] of Object.entries(grid)) {
    const m = /^room_windows_([hv])_(\d+)_(\d+)$/.exec(k);
    if (m && num(v)) edges.push({ kind: m[1], x: +m[2], y: +m[3], value: num(v) });
  }
  const frontCells = doorCells(annotations.doors, w);
  // characters
  const total = num(props.total_chars) ?? num(props.total_char) ?? 0;
  if (!total) warnings.push('el JSON no indica total_chars: no se carga ningún personaje');
  const characters = [];
  for (let k = 0; k < total; k++) {
    const name = (chars[`char_name_${k}`] ?? '').trim();
    if (!name) continue;
    const quote =
      `${chars[`char_quote_${lang}_${k}`] ?? chars[`char_quote_en_${k}`] ?? ''} ${chars[`char_subquote_${lang}_${k}`] ?? chars[`char_subquote_en_${k}`] ?? ''}`
        .replace(/\s+/g, ' ')
        .trim();
    const attrs = new Set();
    if (num(chars[`char_hat_${k}`])) attrs.add('hat');
    const ann = (annotations.characters || {})[name] || {};
    for (const a of ann.attrs || []) attrs.add(String(a).toLowerCase());
    const victimByText = /\b(the victim|la v[ií]ctima|la victime|a v[ií]tima)\b/i.test(quote);
    if (!ann.role && victimByText)
      warnings.push(
        `${name} se considera la víctima por el texto de su pista ("${quote}"); confírmalo con "role": "victim" en la anotación`
      );
    const sexCode = num(chars[`char_sex_${k}`]);
    if (sexCode !== 0 && sexCode !== 1)
      warnings.push(`${name}: valor de sexo no reconocido (${chars[`char_sex_${k}`]}); se asume hombre`);
    characters.push({
      name,
      sex: sexCode === 1 ? 'f' : 'm',
      attrs,
      role: ann.role || (victimByText ? 'victim' : 'suspect'),
      clue: quote,
      constraints: ann.constraints || [],
      official: { index: k, accessory: num(chars[`char_accessory_${k}`]), hat: num(chars[`char_hat_${k}`]) },
    });
  }
  if (characters.length) applyGroups(characters, annotations.groups); // without characters the warning above is the useful message
  const hints = [],
    solution = [];
  for (let i = 1; i <= 40; i++) {
    const t = props[`player_hint_${i}_${lang}`] ?? props[`player_hint_${i}_en`];
    if (t) hints.push(t);
  }
  for (let i = 0; i < 40; i++) {
    const t = props[`solution_text_${lang.toUpperCase()}_${i}`] ?? props[`solution_text_EN_${i}`];
    if (t) solution.push(t);
  }
  const customRules = [1, 2, 3].map(i => props[`clue_custom_text${i}`]).filter(Boolean);
  const title = grid[`title_${lang}_`] || grid.title_en_ || 'puzzle';
  return new Puzzle({
    name: title,
    objective: annotations.objective || 'murder',
    width: w,
    height: h,
    areaIds,
    areaNames,
    subareaOf,
    objects,
    occupiableNames,
    frontCells,
    areaGroups: annotations.areaGroups || {},
    characters,
    global: annotations.global || [],
    meta: {
      source: 'official',
      murdererIndex: num(props.murderer),
      hints,
      solution,
      customRules,
      edges,
      annotated: !!annotations.characters,
      warnings,
    },
  });
}

function loadOfficial(jsonPath, annotationsPath = null, lang = 'en') {
  const json = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  const ann =
    annotationsPath && fs.existsSync(annotationsPath) ? JSON.parse(fs.readFileSync(annotationsPath, 'utf8')) : {};
  return loadOfficialJson(json, ann, lang);
}

module.exports = { loadOfficial, loadOfficialJson };
