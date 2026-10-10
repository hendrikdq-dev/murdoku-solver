'use strict';
// Shared helpers of the clue builders: person filters, Spanish fragments and the generic
// check / support / revise patterns (binary, existential, "occupied line").

const DIRS = {
  north: [-1, 0], south: [1, 0], east: [0, 1], west: [0, -1],
  northeast: [-1, 1], northwest: [-1, -1], southeast: [1, 1], southwest: [1, -1],
};
const DIR_ES = { north: 'al norte de', south: 'al sur de', east: 'al este de', west: 'al oeste de', northeast: 'al noreste de', northwest: 'al noroeste de', southeast: 'al sureste de', southwest: 'al suroeste de' };

function persons(P) { return P.characters.map((c, k) => k).filter(k => P.isPerson(k)); }
function who(P, name) { return P.charIndex(name); }
function cname(P, k) { return P.characters[k].name; }
function filterPersons(P, f = {}) {
  return persons(P).filter(k => {
    const ch = P.characters[k];
    if (f.sex && ch.sex !== f.sex[0].toLowerCase()) return false;
    if (f.attr && !ch.attrs.has(String(f.attr).toLowerCase())) return false;
    if (f.group && !ch.attrs.has(String(f.group).toLowerCase())) return false;
    return true;
  });
}
const sexEs = s => (s && s[0].toLowerCase() === 'f' ? 'una mujer' : 'un hombre');
/** The two line dimensions of a grid, with the Spanish word used in explanations. */
const DIMS = P => [{ word: 'fila', of: c => P.row(c) }, { word: 'columna', of: c => P.col(c) }];

// ---------- check / support ----------
/** check of a binary clue: nothing to say until both characters are placed. */
function binaryCheck(me, w, pred) { return pos => (pos[me] < 0 || pos[w] < 0) ? true : pred(pos[me], pos[w]); }

/** Existential support for the solver: `me` placed at c, some witness must still be possible. */
function existentialSupport(P, pos, candOf, me, witnessSet, witness) {
  const c = pos[me];
  if (c < 0) return true;
  for (const k of witnessSet) {
    if (pos[k] >= 0) { if (witness(c, pos[k], k)) return true; }
    else if (candOf(k).some(d => witness(c, d, k))) return true;
  }
  return false;
}

/** check + support of an existential clue: once `me` is placed, some witness among `ps` must (still) be possible. */
function existential(P, me, ps, witness) {
  return {
    check: pos => { if (pos[me] < 0 || ps.some(k => pos[k] < 0)) return true; return ps.some(k => witness(pos[me], pos[k])); },
    support: (pos, candOf) => existentialSupport(P, pos, candOf, me, ps, witness),
  };
}

// ---------- revise ----------
/** Binary arc consistency: a keeps the cells with some compatible cell of b (different row and column), and symmetrically. */
function pairRevise(P, st, emit, a, b, pred, reason) {
  const ok = (c, d) => c !== d && P.row(c) !== P.row(d) && P.col(c) !== P.col(d) && pred(c, d);
  let ch = false;
  ch = emit(a, c => st.cand[b].some(d => ok(c, d)), reason) || ch;
  ch = emit(b, d => st.cand[a].some(c => ok(c, d)), reason) || ch;
  return ch;
}

/**
 * "Occupied line" inference: when every cell `ds` where the witnesses `ks` can satisfy a clue lies
 * on a single line, that line belongs to a witness: the others leave it and the witnesses keep
 * only the cells of `ds` on it. `reason(word, lineNumber, witnessNames)` builds the explanation.
 */
function lineOwnedBy(P, st, emit, exclude, ks, ds, dims, reason) {
  let ch = false;
  const names = ks.map(k => cname(P, k)).join('/');
  for (const { word, of } of dims) {
    const lines = [...new Set(ds.map(of))];
    if (lines.length !== 1) continue;
    const v = lines[0], why = reason(word, v, names);
    for (let k = 0; k < st.cand.length; k++) {
      if (k === exclude) continue;
      if (ks.includes(k)) ch = emit(k, d => of(d) !== v || ds.includes(d), why) || ch;
      else ch = emit(k, d => of(d) !== v, why) || ch;
    }
  }
  return ch;
}

/**
 * Existential clue of `me`: some other person k (among `witnessSet`) must stand on a cell d with
 * witness(c, d, k) true, where c is the cell of `me`. Applies support filtering, witness narrowing
 * and the occupied-line inference.
 */
function existentialRevise(P, st, emit, me, witnessSet, witness, label) {
  const ok = (c, d) => c !== d && P.row(c) !== P.row(d) && P.col(c) !== P.col(d);
  let ch = false;
  ch = emit(me, c => witnessSet.some(k => st.cand[k].some(d => ok(c, d) && witness(c, d, k))), `${label}: debe existir alguien que lo cumpla`) || ch;
  if (st.cand[me].length === 1) {
    const c = st.cand[me][0];
    const pairs = [];
    for (const k of witnessSet) for (const d of st.cand[k]) if (ok(c, d) && witness(c, d, k)) pairs.push([k, d]);
    const ks = [...new Set(pairs.map(p => p[0]))], ds = [...new Set(pairs.map(p => p[1]))];
    if (ks.length === 1) ch = emit(ks[0], d => ds.includes(d), `${label}: solo ${cname(P, ks[0])} puede cumplirlo`) || ch;
    ch = lineOwnedBy(P, st, emit, me, ks, ds, DIMS(P), (word, v, names) => `${label}: la ${word} ${v} la ocupa quien lo cumple (${names})`) || ch;
  }
  return ch;
}

module.exports = { DIRS, DIR_ES, persons, who, cname, filterPersons, sexEs, DIMS, binaryCheck, existential, existentialSupport, pairRevise, lineOwnedBy, existentialRevise };
