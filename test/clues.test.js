'use strict';
// Consistency tests of the clue library against an independent oracle.
// For every constraint type: enumerate all solutions of a small board without the clue, keep the ones
// that satisfy a plain restatement of the clue's meaning written here, and require that the solver
// (unary + check + support + revise) finds exactly that set. The deduction engine must agree with the
// solver and must never eliminate a cell that belongs to a solution (soundness of the propagation).
const test = require('node:test');
const assert = require('node:assert');
const { fromSpec } = require('../src/load-puzzle');
const { solve } = require('../src/solver');
const { explain } = require('../src/logic');
const { buildConstraints } = require('../src/clues');

// 5x5 board, 5 characters (one per row and column), 3 blocked cells, no clues: 7680 solutions.
const BASE = {
  name: 'oracle 5x5', objective: 'none',
  areas: ['AABBB', 'AABBB', 'CCCDD', 'CCCDD', 'EEEDD'],
  areaNames: { A: 'Kitchen', B: 'Living Room', C: 'Bedroom', D: 'Garden', E: 'Hall' },
  objects: { R1C1: 'chair', R3C2: 'chair', R4C5: 'chair', R4C2: 'bed', R2C3: 'table', R5C4: 'tree', R1C5: 'plant' },
  doors: [[[1, 2], [1, 3]], [[3, 3], [3, 4]]],
  groups: { staff: ['Carlos', 'Elena'] },
  characters: [
    { name: 'Ana', sex: 'f' },
    { name: 'Bea', sex: 'f', attrs: ['glasses'] },
    { name: 'Carlos', sex: 'm', attrs: ['hat'] },
    { name: 'David', sex: 'm' },
    { name: 'Elena', sex: 'f', attrs: ['hat'] },
  ],
};
const [ANA, BEA, CARLOS, DAVID, ELENA] = [0, 1, 2, 3, 4];

function makePuzzle(constraintsByName = {}, global = [], mutate = null) {
  const spec = JSON.parse(JSON.stringify(BASE));
  for (const ch of spec.characters) ch.constraints = constraintsByName[ch.name] || [];
  spec.global = global;
  if (mutate) mutate(spec);
  return fromSpec(spec);
}
const allSolutions = P => solve(P, { limit: Infinity }).solutions;
const key = sol => sol.join(',');
let baseSolutions = null;

// ---- geometry helpers for the oracles (model level, covered by model.test.js) ----
const row = (P, c) => P.row(c), col = (P, c) => P.col(c);
const area = (P, c) => P.areaNameOf(c);
const sameArea = (P, a, b) => P.areaOf(a) === P.areaOf(b);
const neighbors = (P, c) => P.neighbors(c);
const objAt = (P, c) => P.objectAt(c);
const besideObj = (P, c, obj) => neighbors(P, c).some(n => objAt(P, n) === obj && sameArea(P, n, c));
const others = (P, k) => P.characters.map((c, i) => i).filter(i => i !== k);
const hasAttr = (P, k, a) => P.characters[k].attrs.has(a);
const sex = (P, k) => P.characters[k].sex;
const cellsOfArea = (P, c) => P.cellsOfArea(P.areaOf(c));
const outOfArea = (P, c, r, cc) => !P.inside(r, cc) || P.areaOf(P.idx(r, cc)) !== P.areaOf(c);
function dirDelta(P, a, b, dir) { // > 0 when a lies in direction `dir` from b; diagonals need both components
  const dr = row(P, a) - row(P, b), dc = col(P, a) - col(P, b);
  const straight = { north: -dr, south: dr, east: dc, west: -dc }[dir];
  if (straight !== undefined) return straight;
  const vr = dir.startsWith('north') ? -dr : dr, vc = dir.endsWith('east') ? dc : -dc;
  return vr > 0 && vc > 0 ? Math.min(vr, vc) : -1;
}

function checkExplainAgrees(P, sols) {
  const e = explain(P);
  if (e.solved) {
    assert.strictEqual(sols.length, 1, 'explain reports "solved" on a puzzle without a unique solution');
    assert.deepStrictEqual(e.state.cand.map(a => a[0]), sols[0], 'explain and solver disagree on the solution');
  }
  if (e.contradiction) assert.strictEqual(sols.length, 0, `explain reports a contradiction on a solvable puzzle: ${e.contradiction}`);
  else for (const sol of sols) sol.forEach((cell, k) => assert.ok(e.state.cand[k].includes(cell), `explain removed ${P.label(cell)} from ${P.characters[k].name}, which belongs to a solution`));
  return e;
}

/** Solver result == base solutions filtered by the oracle; returns the number of solutions. */
function assertOracle(constraintsByName, global, oracle, { allowEmpty = false, mutate = null } = {}) {
  const P = makePuzzle(constraintsByName, global, mutate);
  baseSolutions = baseSolutions || allSolutions(makePuzzle());
  const expected = baseSolutions.filter(sol => oracle(P, sol)).map(key).sort();
  const got = allSolutions(P).map(key).sort();
  assert.deepStrictEqual(got, expected);
  if (!allowEmpty) assert.ok(expected.length > 0 && expected.length < baseSolutions.length, `the clue must be satisfiable and restrictive (${expected.length}/${baseSolutions.length})`);
  checkExplainAgrees(P, got.map(s => s.split(',').map(Number)));
  return expected.length;
}

test('base board: 7680 solutions, the deduction engine gets stuck without claiming anything', () => {
  baseSolutions = baseSolutions || allSolutions(makePuzzle());
  assert.strictEqual(baseSolutions.length, 7680);
  const e = checkExplainAgrees(makePuzzle(), baseSolutions);
  assert.ok(e.stuck && !e.solved && !e.contradiction);
});

// ---------------- unary clues ----------------
test('in_area: exact name, kind match and negation', () => {
  assertOracle({ Ana: [{ type: 'in_area', area: 'Kitchen' }] }, [], (P, s) => area(P, s[ANA]) === 'Kitchen');
  assertOracle({ Ana: [{ type: 'in_area', area: 'Room' }] }, [], (P, s) => area(P, s[ANA]) === 'Living Room');
  assertOracle({ Ana: [{ type: 'in_area', area: 'Garden', not: true }] }, [], (P, s) => area(P, s[ANA]) !== 'Garden');
});

test('on / not on an object', () => {
  assertOracle({ Bea: [{ type: 'on', object: 'chair' }] }, [], (P, s) => objAt(P, s[BEA]) === 'chair');
  assertOracle({ Bea: [{ type: 'on', object: 'chair', not: true }] }, [], (P, s) => objAt(P, s[BEA]) !== 'chair');
});

test('row and col: number, top/bottom, first/last', () => {
  assertOracle({ Carlos: [{ type: 'row', value: 3 }] }, [], (P, s) => row(P, s[CARLOS]) === 3);
  assertOracle({ Carlos: [{ type: 'row', value: 'bottom' }] }, [], (P, s) => row(P, s[CARLOS]) === 5);
  assertOracle({ David: [{ type: 'col', value: 'first' }] }, [], (P, s) => col(P, s[DAVID]) === 1);
  assertOracle({ David: [{ type: 'col', value: 'last' }] }, [], (P, s) => col(P, s[DAVID]) === 5);
  assertOracle({ David: [{ type: 'col', value: 4, not: true }] }, [], (P, s) => col(P, s[DAVID]) !== 4);
});

test('area_row and area_col: edges of the own area', () => {
  const rows = (P, c) => cellsOfArea(P, c).map(x => row(P, x)), cols = (P, c) => cellsOfArea(P, c).map(x => col(P, x));
  assertOracle({ Elena: [{ type: 'area_row', value: 'top' }] }, [], (P, s) => row(P, s[ELENA]) === Math.min(...rows(P, s[ELENA])));
  assertOracle({ Elena: [{ type: 'area_row', value: 'bottom' }] }, [], (P, s) => row(P, s[ELENA]) === Math.max(...rows(P, s[ELENA])));
  assertOracle({ Elena: [{ type: 'area_col', value: 'left' }] }, [], (P, s) => col(P, s[ELENA]) === Math.min(...cols(P, s[ELENA])));
  assertOracle({ Elena: [{ type: 'area_col', value: 'right' }] }, [], (P, s) => col(P, s[ELENA]) === Math.max(...cols(P, s[ELENA])));
});

test('corner of the grid and corner of the own area', () => {
  assertOracle({ Ana: [{ type: 'corner', of: 'grid' }] }, [], (P, s) => [1, 5].includes(row(P, s[ANA])) && [1, 5].includes(col(P, s[ANA])));
  assertOracle({ Bea: [{ type: 'corner', of: 'area' }] }, [], (P, s) => {
    const c = s[BEA], r = row(P, c), cc = col(P, c);
    return (outOfArea(P, c, r - 1, cc) || outOfArea(P, c, r + 1, cc)) && (outOfArea(P, c, r, cc - 1) || outOfArea(P, c, r, cc + 1));
  });
});

test('no_object_in_line: column and row', () => {
  const lineHas = (P, cells, obj) => cells.some(x => objAt(P, x) === obj);
  const colCells = (P, c) => P.allCells().filter(x => col(P, x) === col(P, c)), rowCells = (P, c) => P.allCells().filter(x => row(P, x) === row(P, c));
  assertOracle({ Carlos: [{ type: 'no_object_in_line', object: 'tree', line: 'column' }] }, [], (P, s) => !lineHas(P, colCells(P, s[CARLOS]), 'tree'));
  assertOracle({ Carlos: [{ type: 'no_object_in_line', object: 'chair', line: 'row' }] }, [], (P, s) => !lineHas(P, rowCells(P, s[CARLOS]), 'chair'));
});

test('object_in_area and its negation', () => {
  assertOracle({ David: [{ type: 'object_in_area', object: 'chair' }] }, [], (P, s) => cellsOfArea(P, s[DAVID]).some(x => objAt(P, x) === 'chair'));
  assertOracle({ David: [{ type: 'object_in_area', object: 'bed', not: true }] }, [], (P, s) => !cellsOfArea(P, s[DAVID]).some(x => objAt(P, x) === 'bed'));
});

test('in_front_of_door: the cells listed in `doors`', () => {
  const doorCells = P => new Set(BASE.doors.flat().map(([r, c]) => P.idx(r, c)));
  assertOracle({ Elena: [{ type: 'in_front_of_door' }] }, [], (P, s) => doorCells(P).has(s[ELENA]));
  assertOracle({ Elena: [{ type: 'in_front_of_door', not: true }] }, [], (P, s) => !doorCells(P).has(s[ELENA]));
});

test('beside an object (orthogonal and same area) and beside an area', () => {
  assertOracle({ Ana: [{ type: 'beside', object: 'chair' }] }, [], (P, s) => besideObj(P, s[ANA], 'chair'));
  assertOracle({ Ana: [{ type: 'not_beside', object: 'chair' }] }, [], (P, s) => !besideObj(P, s[ANA], 'chair'));
  // FORMAT.md: "adyacente a alguna casilla de esa zona" (the own cell may itself be in the area)
  assertOracle({ Ana: [{ type: 'beside', area: 'Garden' }] }, [], (P, s) => neighbors(P, s[ANA]).some(n => area(P, n) === 'Garden'));
});

// ---------------- binary clues ----------------
test('direction: straight, diagonal, exact/min/max and negation', () => {
  const d = (P, s, dir) => dirDelta(P, s[ANA], s[BEA], dir);
  assertOracle({ Ana: [{ type: 'direction', who: 'Bea', dir: 'north' }] }, [], (P, s) => d(P, s, 'north') > 0);
  assertOracle({ Ana: [{ type: 'direction', who: 'Bea', dir: 'east', exact: 2 }] }, [], (P, s) => d(P, s, 'east') === 2);
  assertOracle({ Ana: [{ type: 'direction', who: 'Bea', dir: 'south', min: 2 }] }, [], (P, s) => d(P, s, 'south') >= 2);
  assertOracle({ Ana: [{ type: 'direction', who: 'Bea', dir: 'west', max: 1 }] }, [], (P, s) => d(P, s, 'west') === 1);
  assertOracle({ Ana: [{ type: 'direction', who: 'Bea', dir: 'northeast' }] }, [], (P, s) => d(P, s, 'northeast') > 0);
  assertOracle({ Ana: [{ type: 'direction', who: 'Bea', dir: 'southwest', min: 2 }] }, [], (P, s) => d(P, s, 'southwest') >= 2);
  assertOracle({ Ana: [{ type: 'direction', who: 'Bea', dir: 'north', not: true }] }, [], (P, s) => !(d(P, s, 'north') > 0));
});

test('with / not_with / with+not', () => {
  assertOracle({ Ana: [{ type: 'with', who: 'Bea' }] }, [], (P, s) => sameArea(P, s[ANA], s[BEA]));
  assertOracle({ Ana: [{ type: 'not_with', who: 'Bea' }] }, [], (P, s) => !sameArea(P, s[ANA], s[BEA]));
  assertOracle({ Ana: [{ type: 'with', who: 'Bea', not: true }] }, [], (P, s) => !sameArea(P, s[ANA], s[BEA]));
});

test('alone, alone_with, not_alone', () => {
  const inArea = (P, s, k, c) => sameArea(P, s[k], c);
  assertOracle({ Carlos: [{ type: 'alone' }] }, [], (P, s) => !others(P, CARLOS).some(k => inArea(P, s, k, s[CARLOS])));
  assertOracle({ Ana: [{ type: 'alone_with', who: 'Bea' }] }, [], (P, s) => sameArea(P, s[ANA], s[BEA]) && !others(P, ANA).filter(k => k !== BEA).some(k => inArea(P, s, k, s[ANA])));
  assertOracle({ David: [{ type: 'not_alone' }] }, [], (P, s) => others(P, DAVID).some(k => inArea(P, s, k, s[DAVID])));
});

test('only_on: on the object and nobody else on that kind of object', () => {
  assertOracle({ Bea: [{ type: 'only_on', object: 'chair' }] }, [], (P, s) => objAt(P, s[BEA]) === 'chair' && !others(P, BEA).some(k => objAt(P, s[k]) === 'chair'));
});

test('other_beside_in_area: someone else of the own area beside the object', () => {
  assertOracle({ Ana: [{ type: 'other_beside_in_area', object: 'chair' }] }, [], (P, s) => others(P, ANA).some(k => sameArea(P, s[k], s[ANA]) && besideObj(P, s[k], 'chair')));
});

test('someone_in_area: by sex, attr, group, on an object, and restricted to an area', () => {
  const mate = (P, s, me, f) => others(P, me).some(k => sameArea(P, s[k], s[me]) && f(k, s[k]));
  assertOracle({ Carlos: [{ type: 'someone_in_area', sex: 'f' }] }, [], (P, s) => mate(P, s, CARLOS, k => sex(P, k) === 'f'));
  assertOracle({ Ana: [{ type: 'someone_in_area', attr: 'hat' }] }, [], (P, s) => mate(P, s, ANA, k => hasAttr(P, k, 'hat')));
  assertOracle({ Ana: [{ type: 'someone_in_area', group: 'staff' }] }, [], (P, s) => mate(P, s, ANA, k => hasAttr(P, k, 'staff')));
  assertOracle({ Ana: [{ type: 'someone_in_area', on: 'bed' }] }, [], (P, s) => mate(P, s, ANA, (k, c) => objAt(P, c) === 'bed'));
  assertOracle({ Ana: [{ type: 'someone_in_area', sex: 'm', area: 'Garden' }] }, [], (P, s) => area(P, s[ANA]) === 'Garden' && mate(P, s, ANA, k => sex(P, k) === 'm'));
});

test('someone_exact_rows_beside: N rows north/south, beside the object', () => {
  const witness = (P, s, me, delta, obj) => others(P, me).some(k => row(P, s[k]) === row(P, s[me]) + delta && besideObj(P, s[k], obj));
  assertOracle({ Ana: [{ type: 'someone_exact_rows_beside', rows: 1, dir: 'south', object: 'chair' }] }, [], (P, s) => witness(P, s, ANA, 1, 'chair'));
  assertOracle({ Ana: [{ type: 'someone_exact_rows_beside', rows: 2, dir: 'north', object: 'bed' }] }, [], (P, s) => witness(P, s, ANA, -2, 'bed'));
});

test('no_attr_adjacent_columns', () => {
  assertOracle({ Ana: [{ type: 'no_attr_adjacent_columns', attr: 'hat' }] }, [], (P, s) => !others(P, ANA).some(k => hasAttr(P, k, 'hat') && Math.abs(col(P, s[k]) - col(P, s[ANA])) === 1));
});

// ---------------- global clues and the victim rule ----------------
test('area_count: min/max, by group and by sex', () => {
  const count = (P, s, name, f) => P.characters.map((c, k) => k).filter(k => area(P, s[k]) === name && f(k)).length;
  assertOracle({}, [{ type: 'area_count', area: 'Garden', min: 1 }], (P, s) => count(P, s, 'Garden', () => true) >= 1);
  assertOracle({}, [{ type: 'area_count', area: 'Room', group: 'staff', max: 1 }], (P, s) => count(P, s, 'Living Room', k => hasAttr(P, k, 'staff')) <= 1);
  assertOracle({}, [{ type: 'area_count', area: 'Bedroom', sex: 'f', min: 2 }], (P, s) => count(P, s, 'Bedroom', k => sex(P, k) === 'f') >= 2);
  assertOracle({}, [{ type: 'area_count', area: 'Kitchen', min: 1, max: 1 }], (P, s) => count(P, s, 'Kitchen', () => true) === 1);
});

test('empty_area', () => {
  assertOracle({}, [{ type: 'empty_area', area: 'Hall' }], (P, s) => !s.some(c => area(P, c) === 'Hall'));
});

test('victim rule (objective murder): exactly one other person in the victim area', () => {
  const victimAna = spec => { spec.objective = 'murder'; spec.characters[ANA].role = 'victim'; };
  assertOracle({}, [], (P, s) => others(P, ANA).filter(k => sameArea(P, s[k], s[ANA])).length === 1, { mutate: victimAna });
});

test('several clues at once combine as a conjunction', () => {
  const n = assertOracle(
    { Ana: [{ type: 'in_area', area: 'Kitchen' }], Bea: [{ type: 'not_with', who: 'Ana' }, { type: 'direction', who: 'Carlos', dir: 'south' }] },
    [{ type: 'empty_area', area: 'Hall' }],
    (P, s) => area(P, s[ANA]) === 'Kitchen' && !sameArea(P, s[BEA], s[ANA]) && dirDelta(P, s[BEA], s[CARLOS], 'south') > 0 && !s.some(c => area(P, c) === 'Hall'));
  assert.ok(n > 1);
});

// ---------------- clue variants that can never be satisfied are rejected ----------------
test('beside who / same_row / same_col do not exist: two persons never share a row or a column', () => {
  // Hence they are never orthogonally adjacent nor aligned; the oracle confirms it on the base board.
  const adjacent = (P, a, b) => Math.abs(row(P, a) - row(P, b)) + Math.abs(col(P, a) - col(P, b)) === 1;
  const P = makePuzzle();
  baseSolutions = baseSolutions || allSolutions(P);
  assert.ok(!baseSolutions.some(s => adjacent(P, s[ANA], s[BEA]) || row(P, s[ANA]) === row(P, s[BEA]) || col(P, s[ANA]) === col(P, s[BEA])));
  assert.throws(() => solve(makePuzzle({ Ana: [{ type: 'beside', who: 'Bea' }] })), /pista de Ana \(beside\): falta "object" o "area"/);
  assert.throws(() => solve(makePuzzle({ Ana: [{ type: 'same_row', who: 'Bea' }] })), /tipo de pista desconocido: same_row/);
  assert.throws(() => solve(makePuzzle({ Ana: [{ type: 'same_col', who: 'Bea' }] })), /tipo de pista desconocido: same_col/);
});

// ---------------- error handling ----------------
test('a programming error inside a revise surfaces instead of being reported as a contradiction', () => {
  const P = makePuzzle({ Ana: [{ type: 'in_area', area: 'Kitchen' }] });
  const broken = { owner: null, check: () => true, revise: () => { throw new TypeError('simulated bug'); } };
  const constraints = [...buildConstraints(P), broken];
  assert.throws(() => solve(P, { constraints }), TypeError);
  assert.throws(() => explain(P, { constraints }), TypeError);
  // whereas a genuine contradiction raised by a clue is still handled: no solutions, no exception
  const impossible = [{ type: 'empty_area', area: 'Hall' }, { type: 'area_count', area: 'Hall', min: 1 }];
  assert.strictEqual(solve(makePuzzle({}, impossible)).solutions.length, 0);
  assert.match(explain(makePuzzle({}, impossible)).contradiction, /la zona Hall no puede tener 1 personas/);
});

// ---------------- loader and builder errors ----------------
test('loader and builder reject malformed input with a message naming the culprit', () => {
  assert.throws(() => solve(makePuzzle({ Ana: [{ type: 'levitating' }] })), /pista de Ana \(levitating\): tipo de pista desconocido: levitating/);
  assert.throws(() => solve(makePuzzle({ Ana: [{ type: 'with', who: 'Zoe' }] })), /pista de Ana \(with\): personaje desconocido: Zoe/);
  assert.throws(() => solve(makePuzzle({ Ana: [{ type: 'direction', who: 'Bea', dir: 'norte' }] })), /pista de Ana \(direction\): dirección no válida: "norte" \(usa north, /);
  assert.throws(() => solve(makePuzzle({}, [{ type: 'empty_area' }, { type: 'nope' }])), /pista global \(nope\): tipo de pista desconocido/);
  assert.throws(() => makePuzzle({}, [], spec => { spec.areas[2] = 'CCC'; }), /areas: la fila "CCC" tiene 3 casillas y se esperaban 5/);
  assert.throws(() => makePuzzle({}, [], spec => { spec.height = 5; spec.areas.push('EEEEE'); }), /areas: se esperaban 5 filas y hay 6/);
  assert.throws(() => makePuzzle({}, [], spec => { delete spec.areas; }), /falta "areas"/);
  assert.throws(() => makePuzzle({}, [], spec => { spec.objects['R9C1'] = 'chair'; }), /objeto fuera del tablero: R9C1/);
  assert.throws(() => makePuzzle({}, [], spec => { spec.objects['x1'] = 'chair'; }), /clave de casilla no válida: x1/);
  assert.throws(() => makePuzzle({}, [], spec => { spec.groups.staff.push('Nadie'); }), /grupo staff: miembro desconocido Nadie/);
  assert.throws(() => makePuzzle({}, [], spec => { spec.characters.push({ name: 'ana' }); }), /personaje duplicado: ana/);
  assert.throws(() => makePuzzle({}, [], spec => { spec.characters.push({ sex: 'm' }); }), /personaje sin nombre/);
  assert.throws(() => makePuzzle({}, [], spec => { spec.characters[0].sex = 'x'; }), /Ana: sexo no válido "x"/);
  assert.throws(() => makePuzzle({}, [], spec => { spec.characters[0].role = 'vicitm'; }), /Ana: rol no válido "vicitm"/);
  assert.throws(() => makePuzzle({}, [], spec => { spec.objective = 'theft'; }), /objective no válido: "theft"/);
  assert.throws(() => makePuzzle({}, [], spec => { spec.subareas = { Z: 'A' }; }), /subareas: código desconocido "Z"/);
  assert.throws(() => makePuzzle({}, [], spec => { spec.subareas = { A: 'Z' }; }), /subareas: zona principal desconocida "Z"/);
  assert.throws(() => makePuzzle({}, [], spec => { spec.doors.push([[6, 1], [6, 2]]); }), /doors: casilla fuera del tablero R6C1/);
  // doubtful choices are warnings, not errors
  const P = makePuzzle({}, [], spec => { spec.objects.R2C1 = 'chiar'; spec.areaNames.Z = 'Nowhere'; });
  assert.match(P.meta.warnings.find(w => w.startsWith('objeto')), /objeto desconocido "chiar" en R2C1: se trata como no ocupable/);
  assert.match(P.meta.warnings.find(w => w.startsWith('areaNames')), /código "Z" no aparece en "areas"/);
  assert.ok(!P.isFree(P.idx(2, 1)));
  assert.deepStrictEqual(makePuzzle().meta.warnings, []);
});
