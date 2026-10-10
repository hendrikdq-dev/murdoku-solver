'use strict';
// Binary clues: a relation between the owner and another character (hooks `check` and `revise`).
const { DIRS, DIR_ES, who, cname, binaryCheck, pairRevise } = require('./helpers');

module.exports = {
  direction({ P, spec, me, myName, neg, N, base }) {
    const w = who(P, spec.who);
    if (!DIRS[spec.dir]) throw new Error(`dirección no válida: "${spec.dir}" (usa ${Object.keys(DIRS).join(', ')})`);
    const [dr, dc] = DIRS[spec.dir];
    // delta along the main axis: positive when me is in the stated direction from who
    const delta = (c, d) => {
      const vr = (P.row(c) - P.row(d)) * dr, vc = (P.col(c) - P.col(d)) * dc;
      if (dr && dc) return (vr > 0 && vc > 0) ? Math.min(vr, vc) : -1;
      return dr ? vr : vc;
    };
    const okDelta = v => {
      if (v <= 0) return false;
      if (spec.exact !== undefined && v !== +spec.exact) return false;
      if (spec.min !== undefined && v < +spec.min) return false;
      if (spec.max !== undefined && v > +spec.max) return false;
      return true;
    };
    const pred = (c, d) => N(okDelta(delta(c, d)));
    const qual = spec.exact !== undefined ? `exactamente ${spec.exact} ` : spec.min !== undefined ? `al menos ${spec.min} ` : '';
    const unit = qual ? (dr ? 'filas ' : 'columnas ') : '';
    const reason = `${myName} ${qual}${unit}${DIR_ES[spec.dir]} ${cname(P, w)}`;
    return { ...base, text: `${myName}: ${neg ? 'no ' : ''}${qual}${unit}${DIR_ES[spec.dir]} ${cname(P, w)}`,
      check: binaryCheck(me, w, pred),
      revise: (st, emit) => {
        if (neg) return false;
        if (st.cand[me].length * st.cand[w].length <= 4000) return pairRevise(P, st, emit, me, w, pred, reason);
        // large domains: bounds reasoning for the common one-axis case
        if (dr && dc) return false;
        const axis = dr ? P.row.bind(P) : P.col.bind(P), sign = dr || dc;
        const lo = +(spec.exact ?? spec.min ?? 1), hi = spec.exact !== undefined ? +spec.exact : (spec.max !== undefined ? +spec.max : Infinity);
        const wv = st.cand[w].map(axis), mv = st.cand[me].map(axis);
        const wMin = Math.min(...wv), wMax = Math.max(...wv), mMin = Math.min(...mv), mMax = Math.max(...mv);
        let ch = false;
        // me = who + sign*delta, delta in [lo, hi]
        ch = emit(me, c => { const v = axis(c); return sign > 0 ? (v - wMin >= lo && v - wMax <= hi) : (wMax - v >= lo && wMin - v <= hi); }, reason) || ch;
        ch = emit(w, d => { const v = axis(d); return sign > 0 ? (mMax - v >= lo && mMin - v <= hi) : (v - mMin >= lo && v - mMax <= hi); }, reason) || ch;
        return ch;
      } };
  },

  not_with: ({ spec, build }) => build({ ...spec, type: 'with', not: true }),

  with({ P, spec, me, myName, neg, N, base }) {
    const w = who(P, spec.who);
    const pred = (c, d) => N(P.areaOf(c) === P.areaOf(d));
    const reason = `${myName} con ${cname(P, w)}`;
    return { ...base, text: `${myName}: ${neg ? 'no ' : ''}en la misma zona que ${cname(P, w)}`,
      check: binaryCheck(me, w, pred),
      revise: (st, emit) => {
        if (neg) return false;
        const areasW = new Set(st.cand[w].map(d => P.areaOf(d))), areasM = new Set(st.cand[me].map(c => P.areaOf(c)));
        let ch = emit(me, c => areasW.has(P.areaOf(c)), reason);
        ch = emit(w, d => areasM.has(P.areaOf(d)), reason) || ch;
        if (st.cand[me].length * st.cand[w].length <= 2000) ch = pairRevise(P, st, emit, me, w, pred, reason) || ch;
        return ch;
      } };
  },
};
