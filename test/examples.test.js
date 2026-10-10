'use strict';
// Public example puzzles (puzzles/examples/) and the textual output of both engines.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { loadPuzzle, fromSpec } = require('../src/load-puzzle');
const { solve, describeSolution, murdererOf } = require('../src/solver');
const { explain, formatSteps, milestones } = require('../src/logic');
const { renderSvg } = require('../src/render-svg');

const EXAMPLES = path.join(__dirname, '..', 'puzzles', 'examples');
const TOY = path.join(EXAMPLES, 'toy-murder.json');
const FARO = path.join(EXAMPLES, 'faro-tesoro.json');

test('faro-tesoro (7x7, treasure): unique solution, explained by propagation alone', () => {
  const P = loadPuzzle(FARO);
  assert.strictEqual(P.objective, 'treasure');
  assert.strictEqual(P.areaNameOf(P.idx(1, 1)), 'Faro'); // "Faro (torre)" is a subarea of Faro
  assert.notStrictEqual(P.rawAreaOf(P.idx(1, 1)), P.rawAreaOf(P.idx(2, 1)));
  assert.ok(P.characters[P.charIndex('Pau')].attrs.has('marineros')); // groups become attributes
  const r = solve(P, { limit: 5 });
  assert.strictEqual(r.solutions.length, 1);
  const sol = r.solutions[0];
  const place = Object.fromEntries(P.characters.map((c, k) => [c.name, P.label(sol[k])]));
  assert.deepStrictEqual(place, {
    Marina: 'R2C1',
    Tomás: 'R4C3',
    Olga: 'R1C5',
    Pau: 'R6C4',
    Rita: 'R7C2',
    Simón: 'R5C6',
    Tesoro: 'R3C7',
  });
  const text = describeSolution(P, sol);
  assert.match(text, /^Pau\s+R6C4\s+Cabaña \(bed\)$/m);
  assert.match(text, /^Tesoro: fila 3, columna 7$/m);
  const e = explain(P);
  assert.ok(e.solved && !e.contradiction && !e.stuck);
  assert.deepStrictEqual(
    e.state.cand.map(a => a[0]),
    sol
  );
  assert.strictEqual(e.steps.filter(s => s.kind === 'whatif').length, 0);
  const ms = milestones(e);
  assert.strictEqual(ms.length, 7);
  for (const ch of P.characters)
    assert.ok(
      ms.some(m => m.startsWith(`${ch.name} fijado en ${place[ch.name]}`)),
      ch.name
    );
  // a hypothesis against the solution is refuted; one compatible with it keeps the solution
  assert.strictEqual(solve(P, { hypotheses: [{ who: 'Olga', col: 6 }] }).solutions.length, 0);
  assert.strictEqual(solve(P, { hypotheses: [{ who: 'Tesoro', row: 3 }] }).solutions.length, 1);
  // SVG: one marker per entity, the treasure drawn as "T"
  const svg = renderSvg(P, {
    placements: Object.fromEntries(P.characters.map((c, k) => [c.name, sol[k]])),
    legend: true,
    title: P.name,
    crop: [1, 1, 7, 7],
  });
  assert.strictEqual((svg.match(/<circle/g) || []).length, 7);
  assert.match(svg, />T<\/text>/);
});

test('faro-tesoro without one clue: several solutions, refuted hypotheses, stuck, brief output', () => {
  const spec = JSON.parse(fs.readFileSync(FARO, 'utf8'));
  const simon = spec.characters.find(c => c.name === 'Simón');
  simon.constraints = simon.constraints.filter(c => c.type !== 'beside');
  const P = fromSpec(spec);
  const sols = solve(P, { limit: 10 }).solutions;
  assert.strictEqual(sols.length, 4);
  const e = explain(P);
  assert.ok(!e.solved && e.stuck && !e.contradiction);
  const whatifs = e.steps.filter(s => s.kind === 'whatif');
  assert.ok(whatifs.length > 0);
  for (const s of whatifs) {
    assert.match(s.text, /^SUPONGAMOS .+ ⇒ .*CONTRADICCIÓN: /);
    assert.ok(s.details.length > 0);
  }
  // soundness: the refutations never eliminate a cell that belongs to a solution
  for (const sol of sols) sol.forEach((cell, k) => assert.ok(e.state.cand[k].includes(cell), P.characters[k].name));
  const full = formatSteps(e),
    brief = formatSteps(e, { details: false });
  assert.ok(full.split('\n').some(l => l.startsWith('      · ')));
  assert.ok(!brief.split('\n').some(l => l.startsWith('      · ')));
  assert.ok(brief.endsWith('ATASCADO: no se encontró ninguna hipótesis refutable de un nivel.'));
  assert.strictEqual(brief.split('\n').filter(l => /^\d+\. /.test(l)).length, e.steps.length);
  assert.deepStrictEqual(
    milestones(e).filter(m => m.startsWith('SUPONGAMOS')),
    whatifs.map(s => s.text)
  );
});

test('toy-murder: textual output, milestones and a contradictory hypothesis', () => {
  const P = loadPuzzle(TOY);
  const sol = solve(P).solutions[0];
  const text = describeSolution(P, sol);
  assert.match(text, /^Alba\s+R1C2\s+Living Room$/m);
  assert.match(text, /^Asesino: Clara \(a solas con Alba en Living Room\)$/m);
  assert.strictEqual(murdererOf(P, sol), P.charIndex('Clara'));
  const e = explain(P);
  const lines = formatSteps(e).split('\n');
  assert.strictEqual(lines.length, e.steps.length);
  lines.forEach((l, i) => assert.ok(l.startsWith(`${i + 1}. `)));
  assert.deepStrictEqual(
    milestones(e).map(m => m.split(' — ')[0]),
    ['Clara fijado en R2C3', 'Alba fijado en R1C2']
  );
  const eh = explain(P, { hypotheses: [{ who: 'Clara', row: 1 }] });
  assert.ok(eh.contradiction && !eh.solved);
  assert.ok(formatSteps(eh).endsWith(`CONTRADICCIÓN EN LA LÍNEA PRINCIPAL: ${eh.contradiction}`));
});
