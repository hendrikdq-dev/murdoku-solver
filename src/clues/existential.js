'use strict';
// Clues about the company of the owner: who else is (or is not) in its area, on an object, or in a
// given row (hooks `check`, `support` and `revise`; some also narrow the owner with `unary`).
const { normObj } = require('../model');
const { persons, who, cname, filterPersons, sexEs, DIMS, existential, existentialRevise, lineOwnedBy } = require('./helpers');

module.exports = {
  alone({ P, me, myName, base }) {
    const ps = persons(P).filter(k => k !== me);
    return { ...base, text: `${myName}: a solas en su zona`,
      check: pos => { if (pos[me] < 0) return true; const a = P.areaOf(pos[me]); return !ps.some(k => pos[k] >= 0 && P.areaOf(pos[k]) === a); },
      revise: (st, emit) => {
        let ch = false;
        if (st.cand[me].length === 1) { const a = P.areaOf(st.cand[me][0]); for (const k of ps) ch = emit(k, d => P.areaOf(d) !== a, `${myName} está a solas en ${P.areaName(a)}`) || ch; }
        for (const k of ps) if (st.cand[k].length === 1) { const a = P.areaOf(st.cand[k][0]); ch = emit(me, c => P.areaOf(c) !== a, `${myName} está a solas: no puede compartir zona con ${cname(P, k)}`) || ch; }
        return ch;
      } };
  },

  alone_with({ P, spec, me, myName, base, build }) {
    const w = who(P, spec.who);
    const ps = persons(P).filter(k => k !== me && k !== w);
    const withC = build({ type: 'with', who: spec.who });
    return { ...base, text: `${myName}: a solas con ${cname(P, w)}`,
      check: pos => {
        if (!withC.check(pos)) return false;
        const cells = [pos[me], pos[w]].filter(x => x >= 0);
        for (const c of cells) { const a = P.areaOf(c); if (ps.some(k => pos[k] >= 0 && P.areaOf(pos[k]) === a)) return false; }
        return true;
      },
      revise: (st, emit) => {
        let ch = withC.revise(st, emit);
        for (const x of [me, w]) if (st.cand[x].length === 1) { const a = P.areaOf(st.cand[x][0]); for (const k of ps) ch = emit(k, d => P.areaOf(d) !== a, `${myName} y ${cname(P, w)} están a solas en ${P.areaName(a)}`) || ch; }
        for (const k of ps) if (st.cand[k].length === 1) { const a = P.areaOf(st.cand[k][0]); for (const x of [me, w]) ch = emit(x, c => P.areaOf(c) !== a, `${myName} y ${cname(P, w)} están a solas: ${cname(P, k)} ya ocupa ${P.areaName(a)}`) || ch; }
        return ch;
      } };
  },

  not_alone({ P, me, myName, base }) {
    const ps = persons(P).filter(k => k !== me);
    const witness = (c, d) => P.areaOf(c) === P.areaOf(d);
    return { ...base, text: `${myName}: no estaba a solas`,
      ...existential(P, me, ps, witness),
      revise: (st, emit) => existentialRevise(P, st, emit, me, ps, witness, `${myName} no está a solas`) };
  },

  only_on({ P, me, myName, obj, base }) {
    const ps = persons(P).filter(k => k !== me);
    return { ...base, text: `${myName}: la única persona sobre ${obj}`, unary: c => P.objectAt(c) === obj,
      check: pos => (pos[me] < 0 ? true : !ps.some(k => pos[k] >= 0 && P.objectAt(pos[k]) === obj)),
      revise: (st, emit) => { let ch = false; for (const k of ps) ch = emit(k, d => P.objectAt(d) !== obj, `${myName} es la única persona sobre ${obj}`) || ch; return ch; } };
  },

  other_beside_in_area({ P, me, myName, obj, base }) {
    const ps = persons(P).filter(k => k !== me);
    const witness = (c, d) => P.areaOf(c) === P.areaOf(d) && P.besideObject(d, obj);
    return { ...base, text: `${myName}: otra persona de su zona estaba junto a ${obj}`,
      unary: c => P.cellsOfArea(P.areaOf(c)).some(d => d !== c && P.isFree(d) && P.besideObject(d, obj)),
      ...existential(P, me, ps, witness),
      revise: (st, emit) => existentialRevise(P, st, emit, me, ps, witness, `${myName}: alguien más junto a ${obj} en su zona`) };
  },

  someone_in_area({ P, spec, me, myName, base }) {
    const ps = filterPersons(P, spec).filter(k => k !== me);
    const onObj = spec.on ? normObj(spec.on) : null;
    const m = spec.area ? P.areaMatcher(spec.area) : null;
    const witness = (c, d) => P.areaOf(c) === P.areaOf(d) && (!onObj || P.objectAt(d) === onObj);
    const what = [spec.sex ? sexEs(spec.sex) : spec.attr ? `alguien con ${spec.attr}` : spec.group ? `alguien del grupo ${spec.group}` : 'alguien', onObj ? `sobre ${onObj}` : ''].filter(Boolean).join(' ');
    return { ...base, text: `${myName}: ${what} en su zona${spec.area ? ` (${spec.area})` : ''}`,
      unary: m ? (c => m(P.areaOf(c)) || m(P.rawAreaOf(c))) : null,
      ...existential(P, me, ps, witness),
      revise: (st, emit) => existentialRevise(P, st, emit, me, ps, witness, `${myName}: ${what} en su zona`) };
  },

  someone_exact_rows_beside({ P, spec, me, myName, obj, base }) {
    const ps = persons(P).filter(k => k !== me);
    const sign = (spec.dir || 'north') === 'north' ? -1 : 1;
    const rows = +spec.rows;
    const witness = (c, d) => P.row(d) === P.row(c) + sign * rows && P.besideObject(d, obj);
    const tcells = P.freeCells().filter(d => P.besideObject(d, obj));
    return { ...base, text: `${myName}: alguien exactamente ${rows} filas ${sign < 0 ? 'al norte' : 'al sur'} estaba junto a ${obj}`,
      unary: c => tcells.some(d => P.row(d) === P.row(c) + sign * rows),
      ...existential(P, me, ps, witness),
      revise: (st, emit) => {
        let ch = existentialRevise(P, st, emit, me, ps, witness, `${myName}: alguien junto a ${obj} ${rows} filas ${sign < 0 ? 'más al norte' : 'más al sur'}`);
        // do all the cells where a witness could stand share a column? (even when me is not fixed yet)
        const myRows = [...new Set(st.cand[me].map(P.row.bind(P)))];
        const cells = tcells.filter(d => myRows.includes(P.row(d) - sign * rows));
        const pairs = []; for (const k of ps) for (const d of st.cand[k]) if (cells.includes(d)) pairs.push([k, d]);
        const ks = [...new Set(pairs.map(p => p[0]))], ds = [...new Set(pairs.map(p => p[1]))];
        ch = lineOwnedBy(P, st, emit, me, ks, ds, DIMS(P).slice(1), (word, v, names) => `la ${word} ${v} la ocupa quien está junto a ${obj} (${names})`) || ch;
        return ch;
      } };
  },

  no_attr_adjacent_columns({ P, spec, me, myName, base }) {
    const attr = String(spec.attr).toLowerCase();
    const hs = filterPersons(P, { attr }).filter(k => k !== me);
    return { ...base, text: `${myName}: nadie con ${attr} en una columna adyacente`,
      check: pos => { if (pos[me] < 0) return true; const c = P.col(pos[me]); return !hs.some(k => pos[k] >= 0 && Math.abs(P.col(pos[k]) - c) === 1); },
      revise: (st, emit) => {
        let ch = false;
        const myCols = [...new Set(st.cand[me].map(P.col.bind(P)))];
        for (const k of hs) ch = emit(k, d => !myCols.every(x => Math.abs(P.col(d) - x) <= 1), `${cname(P, k)} lleva ${attr}: no puede estar en la columna de ${myName} ni en una adyacente (${myName} en col ${myCols.join('/')})`) || ch;
        for (const k of hs) { const cs = [...new Set(st.cand[k].map(P.col.bind(P)))]; ch = emit(me, c => !cs.every(x => Math.abs(P.col(c) - x) <= 1), `${myName} no puede estar en la columna de ${cname(P, k)} (${attr}) ni adyacente (${cname(P, k)} en col ${cs.join('/')})`) || ch; }
        return ch;
      } };
  },
};
