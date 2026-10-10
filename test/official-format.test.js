'use strict';
// Loader of the murdoku.com/play JSON format, exercised with a small synthetic puzzle written in that
// format (own data: no official puzzle is distributed with the repository). Covers the orientation of
// the room_code_<x>_<y> keys, subrooms, the official object table (including objects that occupy the
// cell to their right and the 2x2 bus), unknown object codes, victim detection, translations, hints
// and the file-based loader.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadOfficial, loadOfficialJson } = require('../src/load-official');
const { solve, murdererOf } = require('../src/solver');
const { explain } = require('../src/logic');

// 4x4 board. x = column and y = row, both 0-based, as in the official files.
//   y=0: Hall  Hall  Lounge Lounge
//   y=1: Hall  Hall  Lounge Lounge
//   y=2: Yard  Yard  Yard   Yard
//   y=3: Yard  Yard  Yard   Shed (subroom of Yard)
const CODES = [[0, 0, 1, 1], [0, 0, 1, 1], [2, 2, 2, 2], [2, 2, 2, 3]];
const GRID = { title_en_: 'Synthetic Manor', title_es_: 'Mansión sintética', room_name_0: 'Hall', room_name_1: 'Lounge', room_name_2: 'Yard', room_name_3: 'Shed', room_subroom_3: 1, room_subroom_mainroom_3: 2, room_windows_h_0_0: 1 };
CODES.forEach((rowCodes, y) => rowCodes.forEach((code, x) => { GRID[`room_code_${x}_${y}`] = code; }));
GRID.room_objects_0_1 = 6;    // bed: occupies (0,1) and the cell to its right (1,1)
GRID.room_objects_3_0 = 2;    // chair
GRID.room_objects_3_2 = 4;    // table (not occupiable)
GRID.room_objects_0_2 = 56;   // bus: 2x2 block (0,2) (1,2) (0,3) (1,3)
GRID.room_objects_2_3 = 999;  // unknown code -> "obj999", not occupiable
const OFFICIAL = {
  PROPERTIES: {
    grid_w: '4', grid_h: 4, total_chars: 4, murderer: 3,
    player_hint_1_en: 'Start with Jack.', player_hint_1_es: 'Empieza por Jack.', player_hint_2_en: 'Then Kim.',
    solution_text_EN_0: 'Leo did it.', solution_text_ES_0: 'Fue Leo.', clue_custom_text1: 'Nobody was in the Hall.',
  },
  GRID,
  CHARACTERS: {
    char_name_0: 'Ivy', char_sex_0: 1, char_quote_en_0: 'I am the victim.', char_subquote_en_0: 'I was in the Shed.', char_quote_es_0: 'Soy la víctima.', char_subquote_es_0: 'Estaba en el cobertizo.',
    char_name_1: 'Jack', char_sex_1: 0, char_hat_1: 1, char_quote_en_1: 'I was on the bed, west of Leo.',
    char_name_2: 'Kim', char_sex_2: 1, char_quote_en_2: 'I was in the Lounge, beside a chair.',
    char_name_3: 'Leo', char_sex_3: 0, char_accessory_3: 2, char_quote_en_3: 'I was in the Yard, but not in the Shed.',
  },
};
const ANNOTATIONS = {
  characters: {
    Ivy: { constraints: [{ type: 'in_area', area: 'Shed' }] },
    Jack: { constraints: [{ type: 'on', object: 'bed' }, { type: 'direction', who: 'Leo', dir: 'west' }] },
    Kim: { constraints: [{ type: 'in_area', area: 'Lounge' }, { type: 'beside', object: 'chair' }] },
    Leo: { constraints: [{ type: 'in_area', area: 'Yard' }, { type: 'in_area', area: 'Shed', not: true }], attrs: ['beard'] },
  },
  groups: { gents: ['Jack', 'Leo'] },
  doors: [[[1, 2], [1, 3]]],
};

test('official format: orientation, subrooms, objects (extension, bus, unknown code)', () => {
  const P = loadOfficialJson(OFFICIAL, ANNOTATIONS, 'en');
  assert.strictEqual(P.name, 'Synthetic Manor');
  assert.strictEqual(P.width, 4); assert.strictEqual(P.height, 4);
  assert.strictEqual(P.areaNameOf(P.idx(1, 4)), 'Lounge');                   // room_code_3_0 -> row 1, column 4
  assert.strictEqual(P.areaNameOf(P.idx(4, 4)), 'Yard');                     // Shed is a subroom of Yard
  assert.strictEqual(P.areaName(P.rawAreaOf(P.idx(4, 4))), 'Shed');
  assert.strictEqual(P.objectAt(P.idx(2, 1)), 'bed'); assert.strictEqual(P.objectAt(P.idx(2, 2)), 'bed');   // extends to the right
  assert.ok(P.isFree(P.idx(2, 1)) && P.isFree(P.idx(2, 2)));
  for (const [r, c] of [[3, 1], [3, 2], [4, 1], [4, 2]]) { assert.strictEqual(P.objectAt(P.idx(r, c)), 'bus', `R${r}C${c}`); assert.ok(P.isFree(P.idx(r, c))); }
  assert.strictEqual(P.objectAt(P.idx(1, 4)), 'chair');
  assert.strictEqual(P.objectAt(P.idx(3, 4)), 'table'); assert.ok(!P.isFree(P.idx(3, 4)));
  assert.strictEqual(P.objectAt(P.idx(4, 3)), 'obj999'); assert.ok(!P.isFree(P.idx(4, 3)));
  assert.ok(P.inFrontOfDoor(P.idx(1, 2)) && P.inFrontOfDoor(P.idx(1, 3)));
  assert.strictEqual(P.meta.edges.length, 1);
});

test('official format: characters, victim detection, attributes, groups and metadata', () => {
  const P = loadOfficialJson(OFFICIAL, ANNOTATIONS, 'en');
  assert.deepStrictEqual(P.characters.map(c => c.name), ['Ivy', 'Jack', 'Kim', 'Leo']);
  assert.deepStrictEqual(P.characters.map(c => c.sex), ['f', 'm', 'f', 'm']);
  assert.deepStrictEqual(P.characters.map(c => c.role), ['victim', 'suspect', 'suspect', 'suspect']);   // "I am the victim." (no annotation role)
  assert.strictEqual(P.characters[0].clue, 'I am the victim. I was in the Shed.');
  assert.ok(P.characters[1].attrs.has('hat') && P.characters[1].attrs.has('gents'));
  assert.ok(P.characters[3].attrs.has('beard') && P.characters[3].attrs.has('gents') && !P.characters[3].attrs.has('hat'));
  assert.strictEqual(P.characters[3].official.accessory, 2);
  assert.strictEqual(P.objective, 'murder');
  assert.strictEqual(P.meta.murdererIndex, 3);
  assert.deepStrictEqual(P.meta.hints, ['Start with Jack.', 'Then Kim.']);
  assert.deepStrictEqual(P.meta.solution, ['Leo did it.']);
  assert.deepStrictEqual(P.meta.customRules, ['Nobody was in the Hall.']);
});

test('official format: Spanish texts with fallback to English', () => {
  const P = loadOfficialJson(OFFICIAL, ANNOTATIONS, 'es');
  assert.strictEqual(P.name, 'Mansión sintética');
  assert.strictEqual(P.characters[0].clue, 'Soy la víctima. Estaba en el cobertizo.');
  assert.strictEqual(P.characters[0].role, 'victim');                          // "la víctima" is recognised too
  assert.strictEqual(P.characters[1].clue, 'I was on the bed, west of Leo.');  // no Spanish text: English kept
  assert.deepStrictEqual(P.meta.hints, ['Empieza por Jack.', 'Then Kim.']);
  assert.deepStrictEqual(P.meta.solution, ['Fue Leo.']);
});

test('official format: unique solution, official murderer, annotations without role/groups', () => {
  const P = loadOfficialJson(OFFICIAL, ANNOTATIONS, 'en');
  const r = solve(P, { limit: 5 });
  assert.strictEqual(r.solutions.length, 1);
  const place = Object.fromEntries(P.characters.map((c, k) => [c.name, P.label(r.solutions[0][k])]));
  assert.deepStrictEqual(place, { Ivy: 'R4C4', Jack: 'R2C1', Kim: 'R1C3', Leo: 'R3C2' });
  assert.strictEqual(murdererOf(P, r.solutions[0]), P.meta.murdererIndex);
  assert.ok(explain(P).solved);
  // without annotations: everybody is a suspect except the regex-detected victim, no constraints
  const bare = loadOfficialJson(OFFICIAL);
  assert.ok(bare.characters.every(c => c.constraints.length === 0));
  assert.strictEqual(bare.characters[0].role, 'victim');
  assert.ok(!bare.meta.annotated);
});

test('official format: file-based loader and validation errors', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'murdoku-test-'));
  try {
    const jsonPath = path.join(dir, 'puzzle-synthetic-manor.json'), annPath = path.join(dir, 'synthetic-manor.clues.json');
    fs.writeFileSync(jsonPath, JSON.stringify(OFFICIAL));
    fs.writeFileSync(annPath, JSON.stringify(ANNOTATIONS));
    const P = loadOfficial(jsonPath, annPath, 'en');
    assert.strictEqual(solve(P, { limit: 2 }).solutions.length, 1);
    const noAnn = loadOfficial(jsonPath, path.join(dir, 'missing.json'), 'en');   // missing annotation file is tolerated
    assert.ok(noAnn.characters.every(c => c.constraints.length === 0));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  assert.throws(() => loadOfficialJson({ PROPERTIES: {}, GRID: {} }), /grid size missing/);
  assert.throws(() => loadOfficialJson(OFFICIAL, { groups: { gents: ['Nobody'] } }), /unknown member Nobody/);
});
