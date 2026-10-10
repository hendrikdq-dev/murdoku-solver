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
  const isTreasure = k => P.characters[k].role === 'treasure';
  const fmtCells = cells => (cells.length <= 6 ? ' (' + cells.map(S).join(' ') + ')' : '');

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
    for (let k = 0; k < n; k++) if (st.cand[k].length === 1) {
      const c = st.cand[k][0], r = P.row(c), col = P.col(c);
      for (let m = 0; m < n; m++) if (m !== k) ch = emit(m, d => P.row(d) !== r && P.col(d) !== col, `${name(k)} está en ${S(c)}: fila y columna ocupadas`) || ch;
    }
    if (ch) return true;
    if (exactCover) {
      for (let r = 1; r <= P.height; r++) {
        const w = []; for (let k = 0; k < n; k++) if (st.cand[k].some(c => P.row(c) === r)) w.push(k);
        if (!w.length) throw new Contra(`fila ${r} sin nadie posible`);
        if (w.length === 1) ch = emit(w[0], c => P.row(c) === r, `solo ${name(w[0])} puede ocupar la fila ${r}`) || ch;
      }
      for (let col = 1; col <= P.width; col++) {
        const w = []; for (let k = 0; k < n; k++) if (st.cand[k].some(c => P.col(c) === col)) w.push(k);
        if (!w.length) throw new Contra(`columna ${col} sin nadie posible`);
        if (w.length === 1) ch = emit(w[0], c => P.col(c) === col, `solo ${name(w[0])} puede ocupar la columna ${col}`) || ch;
      }
      if (ch) return true;
    }
    for (let k = 0; k < n; k++) {
      if (st.cand[k].length <= 1) continue;
      const rows = new Set(st.cand[k].map(c => P.row(c)));
      if (rows.size === 1) { const r = [...rows][0]; for (let m = 0; m < n; m++) if (m !== k) ch = emit(m, d => P.row(d) !== r, `${name(k)} está seguro en la fila ${r}`) || ch; }
      const cols = new Set(st.cand[k].map(c => P.col(c)));
      if (cols.size === 1) { const col = [...cols][0]; for (let m = 0; m < n; m++) if (m !== k) ch = emit(m, d => P.col(d) !== col, `${name(k)} está seguro en la columna ${col}`) || ch; }
    }
    if (ch) return true;
    if (subsets) {
      for (const dim of ['R', 'C']) {
        const f = dim === 'R' ? (c => P.row(c)) : (c => P.col(c));
        const word = dim === 'R' ? 'fila' : 'columna';
        const ents = []; for (let k = 0; k < n; k++) if (!isTreasure(k) && st.cand[k].length > 1) ents.push(k);
        const lines = new Map(ents.map(k => [k, [...new Set(st.cand[k].map(f))]]));
        const small = ents.filter(k => lines.get(k).length <= 3);
        for (let a = 0; a < small.length; a++) for (let b = a + 1; b < small.length; b++) {
          const groups = [[small[a], small[b]]];
          for (let c = b + 1; c < small.length; c++) groups.push([small[a], small[b], small[c]]);
          for (const g of groups) {
            const u = [...new Set(g.flatMap(k => lines.get(k)))];
            if (u.length !== g.length) continue;
            for (let m = 0; m < n; m++) if (!g.includes(m)) ch = emit(m, c => !u.includes(f(c)), `${g.map(name).join(', ')} solo pueden estar en ${word}s ${u.join('/')}: esas ${word}s son suyas`) || ch;
          }
        }
      }
      if (ch) return true;
    }
    for (const con of constraints) if (con.revise) {
      try { ch = con.revise(st, emit) || ch; }
      catch (e) { if (e instanceof Contra) throw e; throw new Contra(e.message); }
    }
    return ch;
  }
  function propagate(st, log = null) { while (pass(st, log)) { /* fixpoint */ } }
  const clone = st => ({ cand: st.cand.map(a => a.slice()) });
  return { pass, propagate, clone, makeEmit, exactCover };
}

module.exports = { createPropagator, Contra };
