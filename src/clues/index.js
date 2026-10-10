'use strict';
// Clue library: turns the JSON constraint specs of a puzzle into constraint objects usable by both
// the exhaustive solver and the deduction engine.
//
// A constraint is a plain object with these fields (every hook is optional):
//   owner                 index of the character the clue belongs to; null for global clues
//   type, spec            the specification it was built from
//   text                  Spanish reading of the clue (shown by the `clues` command)
//   unary(cell)           keep `cell` as an initial candidate of the owner
//   check(pos)            consistency of a partial assignment (pos[k] = cell or -1); solver only
//   support(pos, candOf)  existential support: some witness must still be possible; solver only
//   revise(st, emit)      deduction rule run by the propagation until fixpoint. st.cand[k] are the
//                         candidate cells of character k; emit(k, keep, reason) keeps the cells of k
//                         that satisfy `keep`, logs `reason` and returns true when it removed
//                         something (it throws Contra when k runs out of cells). A rule signals a
//                         logical contradiction of its own by throwing Contra; any other exception
//                         is a programming error.
//
// The builders are grouped by family: unary.js, binary.js, existential.js and global.js. Each
// receives a context { P, spec, owner, me, myName, obj, neg, N, base, build } where `obj` is the
// normalised spec.object, `neg` is spec.not, N(x) applies the negation, `base` has the common
// fields and `build(spec2)` builds another clue for the same owner (aliases, composition).
const { normObj } = require('../model');
const { cname } = require('./helpers');

const BUILDERS = { ...require('./unary'), ...require('./binary'), ...require('./existential'), ...require('./global') };
const CLUE_TYPES = Object.keys(BUILDERS);

function build(P, spec, owner) {
  const builder = BUILDERS[spec.type];
  if (!builder) throw new Error(`tipo de pista desconocido: ${spec.type}`);
  const neg = !!spec.not;
  return builder({
    P,
    spec,
    owner,
    me: owner,
    myName: owner === null ? '' : cname(P, owner),
    obj: spec.object !== undefined ? normObj(spec.object) : null,
    neg,
    N: x => (neg ? !x : x),
    base: { type: spec.type, owner, spec, text: '', unary: null, check: () => true },
    build: spec2 => build(P, spec2, owner),
  });
}

/** All constraints of a puzzle: the clues of each character, the murder rule of the victim, the global clues. */
function buildConstraints(P) {
  const out = [];
  // errors in a clue specification are reported with their owner and type
  const add = (spec, k, where) => {
    try {
      out.push(build(P, spec || {}, k));
    } catch (e) {
      throw new Error(`${where} (${spec && spec.type}): ${e.message}`);
    }
  };
  P.characters.forEach((ch, k) => {
    for (const spec of ch.constraints) add(spec, k, `pista de ${ch.name}`);
    if (ch.role === 'victim' && P.objective === 'murder') out.push(build(P, { type: 'victim' }, k));
  });
  for (const spec of P.global) add(spec, null, 'pista global');
  return out;
}

/** Initial candidate cells per character: free cells (all cells for the treasure) filtered by unary constraints. */
function initialCandidates(P, constraints) {
  return P.characters.map((ch, k) => {
    let cells = ch.role === 'treasure' ? P.allCells() : P.freeCells();
    for (const c of constraints) if (c.owner === k && c.unary) cells = cells.filter(c.unary);
    return cells;
  });
}

/**
 * Initial state of both engines: candidate cells per character, restricted by the hypotheses
 * [{ who, row?, col?, cell? }] ("what if X were in row 3?").
 */
function initialState(P, constraints, hypotheses = []) {
  const cand = initialCandidates(P, constraints);
  for (const h of hypotheses || []) {
    const k = P.charIndex(h.who);
    cand[k] = cand[k].filter(
      c =>
        (h.row === undefined || P.row(c) === +h.row) &&
        (h.col === undefined || P.col(c) === +h.col) &&
        (h.cell === undefined || c === h.cell)
    );
  }
  return { cand };
}

module.exports = { buildConstraints, initialState, CLUE_TYPES };
