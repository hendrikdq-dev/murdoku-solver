'use strict';
// Loader of the murdoku.com/play JSON format, exercised with a small synthetic puzzle written in that
// format (test/fixtures/, own data: no official puzzle is distributed with the repository). Covers the
// orientation of the room_code_<x>_<y> keys, subrooms, the official object table (including objects
// that occupy the cell to their right and the 2x2 bus), unknown object codes, victim detection,
// translations, hints, warnings and the file-based loader.
//
//   y=0: Hall  Hall  Lounge Lounge        objects: bed at (0,1) [extends to (1,1)], chair at (3,0),
//   y=1: Hall  Hall  Lounge Lounge                 table at (3,2), bus at (0,2) [2x2], code 999 at (2,3)
//   y=2: Yard  Yard  Yard   Yard
//   y=3: Yard  Yard  Yard   Shed (subroom of Yard)
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { loadOfficial, loadOfficialJson } = require('../src/load-official');
const { solve, murdererOf } = require('../src/solver');
const { explain } = require('../src/logic');

const FIX = path.join(__dirname, 'fixtures');
const JSON_PATH = path.join(FIX, 'puzzle-synthetic-manor.json');
const ANN_PATH = path.join(FIX, 'synthetic-manor.clues.json');
const OFFICIAL = JSON.parse(fs.readFileSync(JSON_PATH, 'utf8'));
const ANNOTATIONS = JSON.parse(fs.readFileSync(ANN_PATH, 'utf8'));

test('official format: orientation, subrooms, objects (extension, bus, unknown code)', () => {
  const P = loadOfficialJson(OFFICIAL, ANNOTATIONS, 'en');
  assert.strictEqual(P.name, 'Synthetic Manor');
  assert.strictEqual(P.width, 4);
  assert.strictEqual(P.height, 4);
  assert.strictEqual(P.areaNameOf(P.idx(1, 4)), 'Lounge'); // room_code_3_0 -> row 1, column 4
  assert.strictEqual(P.areaNameOf(P.idx(4, 4)), 'Yard'); // Shed is a subroom of Yard
  assert.strictEqual(P.areaName(P.rawAreaOf(P.idx(4, 4))), 'Shed');
  assert.strictEqual(P.objectAt(P.idx(2, 1)), 'bed');
  assert.strictEqual(P.objectAt(P.idx(2, 2)), 'bed'); // extends to the right
  assert.ok(P.isFree(P.idx(2, 1)) && P.isFree(P.idx(2, 2)));
  for (const [r, c] of [
    [3, 1],
    [3, 2],
    [4, 1],
    [4, 2],
  ]) {
    assert.strictEqual(P.objectAt(P.idx(r, c)), 'bus', `R${r}C${c}`);
    assert.ok(P.isFree(P.idx(r, c)));
  }
  assert.strictEqual(P.objectAt(P.idx(1, 4)), 'chair');
  assert.strictEqual(P.objectAt(P.idx(3, 4)), 'table');
  assert.ok(!P.isFree(P.idx(3, 4)));
  assert.strictEqual(P.objectAt(P.idx(4, 3)), 'obj999');
  assert.ok(!P.isFree(P.idx(4, 3)));
  assert.ok(P.inFrontOfDoor(P.idx(1, 2)) && P.inFrontOfDoor(P.idx(1, 3)));
  assert.strictEqual(P.meta.edges.length, 1);
});

test('official format: characters, victim detection, attributes, groups, metadata and warnings', () => {
  const P = loadOfficialJson(OFFICIAL, ANNOTATIONS, 'en');
  assert.deepStrictEqual(
    P.characters.map(c => c.name),
    ['Ivy', 'Jack', 'Kim', 'Leo']
  );
  assert.deepStrictEqual(
    P.characters.map(c => c.sex),
    ['f', 'm', 'f', 'm']
  );
  assert.deepStrictEqual(
    P.characters.map(c => c.role),
    ['victim', 'suspect', 'suspect', 'suspect']
  ); // "I am the victim." (no annotation role)
  assert.strictEqual(P.characters[0].clue, 'I am the victim. I was in the Shed.');
  assert.ok(P.characters[1].attrs.has('hat') && P.characters[1].attrs.has('gents'));
  assert.ok(
    P.characters[3].attrs.has('beard') && P.characters[3].attrs.has('gents') && !P.characters[3].attrs.has('hat')
  );
  assert.strictEqual(P.characters[3].official.accessory, 2);
  assert.strictEqual(P.objective, 'murder');
  assert.strictEqual(P.meta.murdererIndex, 3);
  assert.deepStrictEqual(P.meta.hints, ['Start with Jack.', 'Then Kim.']);
  assert.deepStrictEqual(P.meta.solution, ['Leo did it.']);
  assert.deepStrictEqual(P.meta.customRules, ['Nobody was in the Hall.']);
  // doubtful choices are reported, not silently taken
  assert.strictEqual(P.meta.warnings.length, 2);
  assert.match(P.meta.warnings[0], /código de objeto desconocido 999 en R4C3/);
  assert.match(P.meta.warnings[1], /Ivy se considera la víctima por el texto de su pista/);
  const confirmed = loadOfficialJson(
    OFFICIAL,
    {
      ...ANNOTATIONS,
      characters: { ...ANNOTATIONS.characters, Ivy: { ...ANNOTATIONS.characters.Ivy, role: 'victim' } },
    },
    'en'
  );
  assert.strictEqual(confirmed.meta.warnings.length, 1);
  const odd = JSON.parse(JSON.stringify(OFFICIAL));
  odd.CHARACTERS.char_sex_2 = 7;
  delete odd.PROPERTIES.total_chars;
  const W = loadOfficialJson(odd, ANNOTATIONS, 'en').meta.warnings;
  assert.ok(W.some(w => /no indica total_chars/.test(w)));
  assert.strictEqual(loadOfficialJson(odd, ANNOTATIONS, 'en').characters.length, 0);
  odd.PROPERTIES.total_chars = 4;
  assert.ok(
    loadOfficialJson(odd, ANNOTATIONS, 'en').meta.warnings.some(w => /Kim: valor de sexo no reconocido \(7\)/.test(w))
  );
});

test('official format: Spanish texts with fallback to English', () => {
  const P = loadOfficialJson(OFFICIAL, ANNOTATIONS, 'es');
  assert.strictEqual(P.name, 'Mansión sintética');
  assert.strictEqual(P.characters[0].clue, 'Soy la víctima. Estaba en el cobertizo.');
  assert.strictEqual(P.characters[0].role, 'victim'); // "la víctima" is recognised too
  assert.strictEqual(P.characters[1].clue, 'I was on the bed, west of Leo.'); // no Spanish text: English kept
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
  const P = loadOfficial(JSON_PATH, ANN_PATH, 'en');
  assert.strictEqual(solve(P, { limit: 2 }).solutions.length, 1);
  const noAnn = loadOfficial(JSON_PATH, path.join(FIX, 'missing.json'), 'en'); // a missing annotation file is tolerated
  assert.ok(noAnn.characters.every(c => c.constraints.length === 0));
  assert.throws(() => loadOfficialJson({ PROPERTIES: {}, GRID: {} }), /tamaño de rejilla ausente/);
  assert.throws(
    () => loadOfficialJson(OFFICIAL, { groups: { gents: ['Nobody'] } }),
    /grupo gents: miembro desconocido Nobody/
  );
});
