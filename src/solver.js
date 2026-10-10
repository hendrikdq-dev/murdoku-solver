'use strict';
// Exhaustive solver: depth-first search over candidate sets with full constraint propagation at
// every node (same rules as the deduction engine, without explanations) and support checks for
// the existential constraints. Used to prove uniqueness and to test hypotheses.
const { buildConstraints, initialCandidates } = require('./clues');
const { createPropagator, Contra } = require('./propagate');

/**
 * @param P Puzzle
 * @param opts { limit: max solutions to find (default 2), hypotheses: [{who, row?, col?, cell?}] }
 * @returns { solutions: [cells[]], nodes, constraints }
 */
function solve(P, opts = {}) {
  const limit = opts.limit ?? 2;
  const constraints = opts.constraints || buildConstraints(P);
  const n = P.characters.length;
  const prop = createPropagator(P, constraints, opts);
  const st0 = { cand: initialCandidates(P, constraints) };
  for (const h of opts.hypotheses || []) {
    const k = P.charIndex(h.who);
    st0.cand[k] = st0.cand[k].filter(c => (h.row === undefined || P.row(c) === +h.row) && (h.col === undefined || P.col(c) === +h.col) && (h.cell === undefined || c === h.cell));
  }
  // the default check of a constraint is `() => true` (arity 0): only real checks are evaluated
  const withCheck = constraints.filter(c => typeof c.check === 'function' && c.check.length > 0);
  const withSupport = constraints.filter(c => c.support);
  const solutions = [];
  let nodes = 0;
  const posOf = st => st.cand.map(a => (a.length === 1 ? a[0] : -1));
  function consistent(st) {
    const pos = posOf(st);
    for (const c of withCheck) if (!c.check(pos)) return false;
    const candOf = k => st.cand[k];
    for (const c of withSupport) if (!c.support(pos, candOf)) return false;
    return true;
  }
  function rec(st) {
    nodes++;
    try { prop.propagate(st); } catch (e) { if (e instanceof Contra) return; throw e; }
    if (!consistent(st)) return;
    let best = -1;
    for (let k = 0; k < n; k++) if (st.cand[k].length > 1 && (best < 0 || st.cand[k].length < st.cand[best].length)) best = k;
    if (best < 0) { solutions.push(st.cand.map(a => a[0])); return; }
    for (const c of st.cand[best]) {
      if (solutions.length >= limit) return;
      const t = prop.clone(st); t.cand[best] = [c];
      rec(t);
    }
  }
  rec(st0);
  return { solutions, nodes, constraints };
}

/** Pretty description of a solution. */
function describeSolution(P, sol) {
  const lines = P.characters.map((ch, k) => `${ch.name.padEnd(12)} ${P.label(sol[k]).padEnd(7)} ${P.areaNameOf(sol[k])}${P.objectAt(sol[k]) ? ' (' + P.objectAt(sol[k]) + ')' : ''}`);
  if (P.objective === 'murder') {
    const v = P.characters.findIndex(c => c.role === 'victim');
    if (v >= 0) {
      const a = P.areaOf(sol[v]);
      const m = P.characters.map((c, k) => k).filter(k => k !== v && P.isPerson(k) && P.areaOf(sol[k]) === a);
      lines.push(`Asesino: ${m.map(k => P.characters[k].name).join(', ') || '?'} (a solas con ${P.characters[v].name} en ${P.areaName(a)})`);
    }
  }
  if (P.objective === 'treasure') {
    const t = P.characters.findIndex(c => c.role === 'treasure');
    if (t >= 0) lines.push(`Tesoro: fila ${P.row(sol[t])}, columna ${P.col(sol[t])}`);
  }
  return lines.join('\n');
}

/** Index of the murderer in a solution of a murder puzzle (or -1). */
function murdererOf(P, sol) {
  const v = P.characters.findIndex(c => c.role === 'victim');
  if (v < 0) return -1;
  const a = P.areaOf(sol[v]);
  const m = P.characters.map((c, k) => k).filter(k => k !== v && P.isPerson(k) && P.areaOf(sol[k]) === a);
  return m.length === 1 ? m[0] : -1;
}

module.exports = { solve, describeSolution, murdererOf };
