'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { loadPuzzle } = require('../src/load-puzzle');
const { solve, murdererOf } = require('../src/solver');
const { explain } = require('../src/logic');
const { renderSvg } = require('../src/render-svg');

const TOY = path.join(__dirname, '..', 'puzzles', 'examples', 'toy-murder.json');

test('model helpers: beside is orthogonal and same-area, matchers, corners, doors', () => {
  const P = loadPuzzle(TOY);
  assert.strictEqual(P.width, 4);
  assert.strictEqual(P.areaNameOf(P.idx(1, 1)), 'Kitchen');
  assert.ok(P.besideObject(P.idx(2, 1), 'table'));      // same room (Kitchen), below the table
  assert.ok(!P.besideObject(P.idx(1, 2), 'table'));     // adjacent but in the Living Room: not beside
  assert.ok(P.besideObject(P.idx(1, 2), 'chair') && P.besideObject(P.idx(2, 3), 'chair'));
  assert.ok(!P.isFree(P.idx(1, 1)) && !P.isFree(P.idx(4, 3)));   // table, tree
  assert.ok(P.isFree(P.idx(3, 1)) && P.isFree(P.idx(1, 3)));      // bed, chair
  assert.ok(P.inFrontOfDoor(P.idx(2, 3)) && P.inFrontOfDoor(P.idx(2, 2)) && !P.inFrontOfDoor(P.idx(1, 2)));
  assert.ok(P.isGridCorner(P.idx(4, 4)) && !P.isGridCorner(P.idx(2, 2)));
  assert.ok(P.isAreaCorner(P.idx(1, 1)) && !P.isAreaCorner(P.idx(2, 3)));
  assert.ok(P.areaMatcher('Living')(P.areaOf(P.idx(1, 3))));   // kind match ("Living" ~ "Living Room")
  assert.ok(!P.areaMatcher('Yard')(P.areaOf(P.idx(1, 3))));
  assert.strictEqual(P.topRowOfArea(P.areaOf(P.idx(4, 1))), 3);
});

test('toy murder puzzle: unique solution, murderer Clara, explained without search', () => {
  const P = loadPuzzle(TOY);
  const r = solve(P, { limit: 5 });
  assert.strictEqual(r.solutions.length, 1);
  const sol = r.solutions[0];
  const place = Object.fromEntries(P.characters.map((c, k) => [c.name, P.label(sol[k])]));
  assert.deepStrictEqual(place, { Alba: 'R1C2', Bruno: 'R3C1', Clara: 'R2C3', Dani: 'R4C4' });
  assert.strictEqual(P.characters[murdererOf(P, sol)].name, 'Clara');
  const e = explain(P);
  assert.ok(e.solved && !e.contradiction);
  assert.deepStrictEqual(e.state.cand.map(a => a[0]), sol);
  // hypotheses
  assert.strictEqual(solve(P, { hypotheses: [{ who: 'Clara', row: 1 }] }).solutions.length, 0);
  // renderer produces an SVG with one circle per placed character
  const svg = renderSvg(P, { placements: Object.fromEntries(P.characters.map((c, k) => [c.name, sol[k]])), legend: true });
  assert.ok(svg.startsWith('<svg') && (svg.match(/<circle/g) || []).length === 4);
});
