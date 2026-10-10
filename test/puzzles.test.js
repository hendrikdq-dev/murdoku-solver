'use strict';
// Tests against real puzzles. They are skipped when the input files are not present:
//  - private/puzzles/treasure-hunt.json and treasure-hunt.expected.json (contest puzzle and its
//    solution, kept out of the repository)
//  - cache/official/preppers-medium.json (download with: node src/cli.js fetch preppers-medium)
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { loadPuzzle } = require('../src/load-puzzle');
const { loadOfficial } = require('../src/load-official');
const { solve, murdererOf } = require('../src/solver');
const { explain } = require('../src/logic');

const ROOT = path.resolve(__dirname, '..');
const TH = path.join(ROOT, 'private', 'puzzles', 'treasure-hunt.json');
const TH_EXPECTED = path.join(ROOT, 'private', 'puzzles', 'treasure-hunt.expected.json');
const PREP = path.join(ROOT, 'cache', 'official', 'preppers-medium.json');
const PREP_ANN = path.join(ROOT, 'puzzles', 'annotations', 'preppers-medium.clues.json');

test(
  'Treasure Hunt (contest 1): unique solution, matches the recorded one, explained without search',
  { skip: !(fs.existsSync(TH) && fs.existsSync(TH_EXPECTED)) && 'private puzzle files not present' },
  () => {
    const P = loadPuzzle(TH);
    // { positions: { <name>: 'R<row>C<col>' }, refuted: [{ who, row, col }] }
    const expected = JSON.parse(fs.readFileSync(TH_EXPECTED, 'utf8'));
    const r = solve(P, { limit: 3 });
    assert.strictEqual(r.solutions.length, 1);
    const sol = r.solutions[0];
    P.characters.forEach((ch, k) => assert.strictEqual(P.label(sol[k]), expected.positions[ch.name], ch.name));
    const e = explain(P);
    assert.ok(e.solved && !e.contradiction, 'deduction engine solves it without search');
    assert.deepStrictEqual(
      e.state.cand.map(a => a[0]),
      sol
    );
    // hypotheses refuted during the solving session
    for (const h of expected.refuted || [])
      assert.strictEqual(solve(P, { hypotheses: [h] }).solutions.length, 0, `${h.who} at R${h.row}C${h.col}`);
  }
);

test(
  'Official "Preppers" (9x9): loader orientation, unique solution and official murderer',
  { skip: !fs.existsSync(PREP) && 'official JSON not cached' },
  () => {
    const P = loadOfficial(PREP, PREP_ANN, 'en');
    assert.strictEqual(P.width, 9);
    assert.strictEqual(P.characters.length, 9);
    assert.strictEqual(P.areaNameOf(P.idx(6, 2)), 'Bathroom'); // from the official hint "(H) has to be in R6 C2 ... Bathroom"
    assert.strictEqual(P.objectAt(P.idx(5, 6)), 'bed'); // "(B) ... on the bed, in R5 C6"
    const r = solve(P, { limit: 3 });
    assert.strictEqual(r.solutions.length, 1);
    assert.strictEqual(murdererOf(P, r.solutions[0]), P.meta.murdererIndex);
    assert.strictEqual(P.characters[P.meta.murdererIndex].name, 'Angelo');
    const e = explain(P);
    assert.ok(e.solved && !e.contradiction);
  }
);
