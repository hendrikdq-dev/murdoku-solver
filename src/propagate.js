'use strict';
// Constraint propagation shared by the solver and the deduction engine.
// State: { cand: cells[] per character }. Rules: fixed entities exclude their row/column, hidden
// singles (when every row/column holds exactly one entity), line confinement, naked subsets of
// rows/columns, and the clue-specific `revise` hooks of the constraints.

class Contra extends Error {}

function createPropagator(P, constraints, opts = {}) {
  const n = P.characters.length;
  const exactCover = opts.exactCover ?? (n === P.width && n === P.height);
  const subsets = opts.subsets ?? true;
  const name = k => P.characters[k].name;
  const S = c => P.label(c);
  const fmtCells = cells => (cells.length <= 6 ? ' (' + cells.map(S).join(' ') + ')' : '');
  // the two line dimensions of the grid, in the order the rules look at them
  const DIMS = [
    { word: 'fila', size: P.height, of: c => P.row(c) },
    { word: 'columna', size: P.width, of: c => P.col(c) },
  ];

  function makeEmit(st, log) {
    return (k, pred, reason) => {
      const before = st.cand[k];
      const after = before.filter(pred);
      if (after.length === before.length) return false;
      st.cand[k] = after;
      if (log) {
        const removed = before.filter(c => !pred(c));
        log.push(`[${reason}] ${name(k)}: quedan ${after.length}${fmtCells(after)} — se eliminan ${removed.length <= 8 ? removed.map(S).join(' ') : removed.length + ' casillas'}`);
      }
      if (!after.length) throw new Contra(`${name(k)} se queda sin casilla`);
      return true;
    };
  }

  function pass(st, log) {
    const emit = makeEmit(st, log);
    let ch = false;
    // 1. a fixed entity excludes everybody else from its row and column
    for (let k = 0; k < n; k++) if (st.cand[k].length === 1) {
      const c = st.cand[k][0], r = P.row(c), col = P.col(c);
      for (let m = 0; m < n; m++) if (m !== k) ch = emit(m, d => P.row(d) !== r && P.col(d) !== col, `${name(k)} está en ${S(c)}: fila y columna ocupadas`) || ch;
    }
    if (ch) return true;
    // 2. hidden singles: a line that only one entity can occupy belongs to it
    if (exactCover) {
      for (const { word, size, of } of DIMS) for (let v = 1; v <= size; v++) {
        const w = []; for (let k = 0; k < n; k++) if (st.cand[k].some(c => of(c) === v)) w.push(k);
        if (!w.length) throw new Contra(`${word} ${v} sin nadie posible`);
        if (w.length === 1) ch = emit(w[0], c => of(c) === v, `solo ${name(w[0])} puede ocupar la ${word} ${v}`) || ch;
      }
      if (ch) return true;
    }
    // 3. line confinement: an entity confined to one line excludes the others from it
    for (let k = 0; k < n; k++) {
      if (st.cand[k].length <= 1) continue;
      for (const { word, of } of DIMS) {
        const lines = new Set(st.cand[k].map(of));
        if (lines.size === 1) { const v = [...lines][0]; for (let m = 0; m < n; m++) if (m !== k) ch = emit(m, d => of(d) !== v, `${name(k)} tiene que estar en la ${word} ${v}`) || ch; }
      }
    }
    if (ch) return true;
    // 4. naked subsets: 2 (or 3) persons confined to the same 2 (or 3) lines own those lines
    if (subsets) {
      for (const { word, of } of DIMS) {
        const ents = []; for (let k = 0; k < n; k++) if (P.isPerson(k) && st.cand[k].length > 1) ents.push(k);
        const lines = new Map(ents.map(k => [k, [...new Set(st.cand[k].map(of))]]));
        const small = ents.filter(k => lines.get(k).length <= 3);
        for (let a = 0; a < small.length; a++) for (let b = a + 1; b < small.length; b++) {
          const groups = [[small[a], small[b]]];
          for (let c = b + 1; c < small.length; c++) groups.push([small[a], small[b], small[c]]);
          for (const g of groups) {
            const u = [...new Set(g.flatMap(k => lines.get(k)))];
            if (u.length !== g.length) continue;
            for (let m = 0; m < n; m++) if (!g.includes(m)) ch = emit(m, c => !u.includes(of(c)), `${g.map(name).join(', ')} solo pueden estar en ${word}s ${u.join('/')}: esas ${word}s son suyas`) || ch;
          }
        }
      }
      if (ch) return true;
    }
    // 5. clue-specific rules. A revise signals a logical contradiction by throwing Contra (directly or
    // through emit). Any other exception is a programming error and must surface instead of silently
    // pruning the branch.
    for (const con of constraints) if (con.revise) ch = con.revise(st, emit) || ch;
    return ch;
  }
  function propagate(st, log = null) { while (pass(st, log)) { /* fixpoint */ } }
  const clone = st => ({ cand: st.cand.map(a => a.slice()) });
  return { propagate, clone };
}

module.exports = { createPropagator, Contra };
