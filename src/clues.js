'use strict';
// Clue library: turns the JSON constraint specs of a puzzle into constraint objects usable by both
// the exhaustive solver (check / support on partial assignments) and the deduction engine (revise).
//
// Conventions: `pos` is an array (one entry per character) with the assigned cell or -1;
// `st.cand[k]` is the array of candidate cells of character k in the deduction engine;
// `emit(k, keepPredicate, reasonText)` keeps the cells of k satisfying the predicate and returns
// true when something was removed (it throws when k runs out of cells).
const { normObj } = require('./model');
const { Contra } = require('./propagate');

const DIRS = {
  north: [-1, 0], south: [1, 0], east: [0, 1], west: [0, -1],
  northeast: [-1, 1], northwest: [-1, -1], southeast: [1, 1], southwest: [1, -1],
};
const DIR_ES = { north: 'al norte de', south: 'al sur de', east: 'al este de', west: 'al oeste de', northeast: 'al noreste de', northwest: 'al noroeste de', southeast: 'al sureste de', southwest: 'al suroeste de' };

function buildConstraints(P) {
  const out = [];
  // errors in a clue specification are reported with their owner and type
  const add = (spec, k, where) => {
    try { out.push(build(P, spec || {}, k)); }
    catch (e) { throw new Error(`${where} (${spec && spec.type}): ${e.message}`); }
  };
  P.characters.forEach((ch, k) => {
    for (const spec of ch.constraints) add(spec, k, `pista de ${ch.name}`);
    if (ch.role === 'victim' && P.objective === 'murder') out.push(build(P, { type: 'victim' }, k));
  });
  for (const spec of P.global) add(spec, null, 'pista global');
  return out;
}

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
const DIMS = P => [{ word: 'fila', of: c => P.row(c) }, { word: 'columna', of: c => P.col(c) }];

// ---------- generic helpers for check / support ----------
/** check of a binary clue: nothing to say until both characters are placed. */
function binaryCheck(me, w, pred) { return pos => (pos[me] < 0 || pos[w] < 0) ? true : pred(pos[me], pos[w]); }

/** check + support of an existential clue: once `me` is placed, some witness among `ps` must (still) be possible. */
function existential(P, me, ps, witness) {
  return {
    check: pos => { if (pos[me] < 0 || ps.some(k => pos[k] < 0)) return true; return ps.some(k => witness(pos[me], pos[k])); },
    support: (pos, candOf) => existentialSupport(P, pos, candOf, me, ps, witness),
  };
}

// ---------- generic helpers for revise ----------
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

function pairRevise(P, st, emit, a, b, pred, reason) {
  // a <- cells c with some d in cand[b], different row & col, pred(c,d); and symmetric
  const ok = (c, d) => c !== d && P.row(c) !== P.row(d) && P.col(c) !== P.col(d) && pred(c, d);
  let ch = false;
  ch = emit(a, c => st.cand[b].some(d => ok(c, d)), reason) || ch;
  ch = emit(b, d => st.cand[a].some(c => ok(c, d)), reason) || ch;
  return ch;
}

/**
 * Existential constraint of `me`: some other person k (among `witnessSet`) must stand on a cell d
 * with witness(c, d, k) true, where c is the cell of `me`. Applies support filtering, witness
 * narrowing and the "occupied line" inference.
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

/** Existential support check for the solver: me assigned at c; some witness must still be possible. */
function existentialSupport(P, pos, candOf, me, witnessSet, witness) {
  const c = pos[me];
  if (c < 0) return true;
  for (const k of witnessSet) {
    if (pos[k] >= 0) { if (witness(c, pos[k], k)) return true; }
    else if (candOf(k).some(d => witness(c, d, k))) return true;
  }
  return false;
}

// ---------- constraint builders ----------
function build(P, spec, owner) {
  const t = spec.type;
  const me = owner;
  const myName = owner === null ? '' : cname(P, owner);
  const base = { type: t, owner, spec, text: '', unary: null, check: () => true };
  const obj = spec.object !== undefined ? normObj(spec.object) : null;
  const neg = !!spec.not;
  const N = x => (neg ? !x : x);

  switch (t) {
    case 'in_area': {
      const m = P.areaMatcher(spec.area);
      return { ...base, text: `${myName}: ${neg ? 'no ' : ''}en ${spec.area}`, unary: c => N(m(P.areaOf(c)) || m(P.rawAreaOf(c))) };
    }
    case 'not_beside': return build(P, { ...spec, type: 'beside', not: true }, owner);
    case 'beside': {
      // "beside <person>" is impossible: two characters never share a row or a column, so they are
      // never orthogonally adjacent. Only objects and areas are supported.
      if (obj) return { ...base, text: `${myName}: ${neg ? 'no ' : ''}junto a ${obj}`, unary: c => N(P.besideObject(c, obj)) };
      if (spec.area) { const m = P.areaMatcher(spec.area); return { ...base, text: `${myName}: ${neg ? 'no ' : ''}junto a ${spec.area}`, unary: c => N(P.besideArea(c, m)) }; }
      throw new Error('falta "object" o "area"');
    }
    case 'on': return { ...base, text: `${myName}: ${neg ? 'no ' : ''}sobre ${obj}`, unary: c => N(P.objectAt(c) === obj) };
    case 'row': {
      const v = spec.value === 'top' ? 1 : spec.value === 'bottom' ? P.height : +spec.value;
      return { ...base, text: `${myName}: ${neg ? 'no ' : ''}en la fila ${v}`, unary: c => N(P.row(c) === v) };
    }
    case 'col': {
      const v = spec.value === 'first' ? 1 : spec.value === 'last' ? P.width : +spec.value;
      return { ...base, text: `${myName}: ${neg ? 'no ' : ''}en la columna ${v}`, unary: c => N(P.col(c) === v) };
    }
    case 'area_row': {
      const top = spec.value !== 'bottom';
      return { ...base, text: `${myName}: en la fila ${top ? 'superior' : 'inferior'} de su zona`, unary: c => N(P.row(c) === (top ? P.topRowOfArea(P.areaOf(c)) : P.bottomRowOfArea(P.areaOf(c)))) };
    }
    case 'area_col': {
      const left = spec.value !== 'right';
      return { ...base, text: `${myName}: en la columna ${left ? 'izquierda' : 'derecha'} de su zona`, unary: c => N(P.col(c) === (left ? P.leftColOfArea(P.areaOf(c)) : P.rightColOfArea(P.areaOf(c)))) };
    }
    case 'corner': {
      const grid = spec.of === 'grid';
      return { ...base, text: `${myName}: en una esquina ${grid ? 'de la cuadrícula' : 'de su zona'}`, unary: c => N(grid ? P.isGridCorner(c) : P.isAreaCorner(c)) };
    }
    case 'no_object_in_line': {
      const col = (spec.line || 'column') === 'column';
      return { ...base, text: `${myName}: sin ${obj} en su ${col ? 'columna' : 'fila'}`, unary: c => N(!(col ? P.columnHasObject(P.col(c), obj) : P.rowHasObject(P.row(c), obj))) };
    }
    case 'object_in_area': return { ...base, text: `${myName}: ${neg ? 'ningún' : 'hay un'} ${obj} en su zona`, unary: c => N(P.areaHasObject(P.areaOf(c), obj)) };
    case 'in_front_of_door': return { ...base, text: `${myName}: ${neg ? 'no ' : ''}frente a una puerta`, unary: c => N(P.inFrontOfDoor(c)) };
    case 'direction': {
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
      return { ...base, text: `${myName}: ${neg ? 'no ' : ''}${qual}${unit}${DIR_ES[spec.dir]} ${cname(P, w)}`,
        check: binaryCheck(me, w, pred),
        revise: (st, emit) => {
          if (neg) return false;
          if (st.cand[me].length * st.cand[w].length <= 4000) return pairRevise(P, st, emit, me, w, pred, `${myName} ${qual}${unit}${DIR_ES[spec.dir]} ${cname(P, w)}`);
          // bounds for the common one-axis case
          if (dr && dc) return false;
          const axis = dr ? P.row.bind(P) : P.col.bind(P), sign = dr || dc;
          const lo = +(spec.exact ?? spec.min ?? 1), hi = spec.exact !== undefined ? +spec.exact : (spec.max !== undefined ? +spec.max : Infinity);
          const wv = st.cand[w].map(axis), mv = st.cand[me].map(axis);
          const wMin = Math.min(...wv), wMax = Math.max(...wv), mMin = Math.min(...mv), mMax = Math.max(...mv);
          let ch = false;
          const r = `${myName} ${qual}${unit}${DIR_ES[spec.dir]} ${cname(P, w)}`;
          // me = who + sign*delta, delta in [lo,hi]
          ch = emit(me, c => { const v = axis(c); return sign > 0 ? (v - wMin >= lo && v - wMax <= hi) : (wMax - v >= lo && wMin - v <= hi); }, r) || ch;
          ch = emit(w, d => { const v = axis(d); return sign > 0 ? (mMax - v >= lo && mMin - v <= hi) : (v - mMin >= lo && v - mMax <= hi); }, r) || ch;
          return ch;
        } };
    }
    case 'not_with': return build(P, { ...spec, type: 'with', not: true }, owner);
    case 'with': {
      const w = who(P, spec.who);
      const pred = (c, d) => N(P.areaOf(c) === P.areaOf(d));
      return { ...base, text: `${myName}: ${neg ? 'no ' : ''}en la misma zona que ${cname(P, w)}`,
        check: binaryCheck(me, w, pred),
        revise: (st, emit) => {
          if (neg) return false;
          const areasW = new Set(st.cand[w].map(d => P.areaOf(d))), areasM = new Set(st.cand[me].map(c => P.areaOf(c)));
          let ch = emit(me, c => areasW.has(P.areaOf(c)), `${myName} con ${cname(P, w)}`);
          ch = emit(w, d => areasM.has(P.areaOf(d)), `${myName} con ${cname(P, w)}`) || ch;
          if (st.cand[me].length * st.cand[w].length <= 2000) ch = pairRevise(P, st, emit, me, w, pred, `${myName} con ${cname(P, w)}`) || ch;
          return ch;
        } };
    }
    case 'alone': {
      const ps = persons(P).filter(k => k !== me);
      return { ...base, text: `${myName}: a solas en su zona`,
        check: pos => { if (pos[me] < 0) return true; const a = P.areaOf(pos[me]); return !ps.some(k => pos[k] >= 0 && P.areaOf(pos[k]) === a); },
        revise: (st, emit) => {
          let ch = false;
          if (st.cand[me].length === 1) { const a = P.areaOf(st.cand[me][0]); for (const k of ps) ch = emit(k, d => P.areaOf(d) !== a, `${myName} está a solas en ${P.areaName(a)}`) || ch; }
          for (const k of ps) if (st.cand[k].length === 1) { const a = P.areaOf(st.cand[k][0]); ch = emit(me, c => P.areaOf(c) !== a, `${myName} está a solas: no puede compartir zona con ${cname(P, k)}`) || ch; }
          return ch;
        } };
    }
    case 'alone_with': {
      const w = who(P, spec.who);
      const ps = persons(P).filter(k => k !== me && k !== w);
      const withC = build(P, { type: 'with', who: spec.who }, owner);
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
    }
    case 'not_alone': {
      const ps = persons(P).filter(k => k !== me);
      const witness = (c, d) => P.areaOf(c) === P.areaOf(d);
      return { ...base, text: `${myName}: no estaba a solas`,
        ...existential(P, me, ps, witness),
        revise: (st, emit) => existentialRevise(P, st, emit, me, ps, witness, `${myName} no está a solas`) };
    }
    case 'only_on': {
      const ps = persons(P).filter(k => k !== me);
      return { ...base, text: `${myName}: la única persona sobre ${obj}`, unary: c => P.objectAt(c) === obj,
        check: pos => (pos[me] < 0 ? true : !ps.some(k => pos[k] >= 0 && P.objectAt(pos[k]) === obj)),
        revise: (st, emit) => { let ch = false; for (const k of ps) ch = emit(k, d => P.objectAt(d) !== obj, `${myName} es la única persona sobre ${obj}`) || ch; return ch; } };
    }
    case 'other_beside_in_area': {
      const ps = persons(P).filter(k => k !== me);
      const witness = (c, d) => P.areaOf(c) === P.areaOf(d) && P.besideObject(d, obj);
      return { ...base, text: `${myName}: otra persona de su zona estaba junto a ${obj}`,
        unary: c => P.cellsOfArea(P.areaOf(c)).some(d => d !== c && P.isFree(d) && P.besideObject(d, obj)),
        ...existential(P, me, ps, witness),
        revise: (st, emit) => existentialRevise(P, st, emit, me, ps, witness, `${myName}: alguien más junto a ${obj} en su zona`) };
    }
    case 'someone_in_area': {
      const ps = filterPersons(P, spec).filter(k => k !== me);
      const onObj = spec.on ? normObj(spec.on) : null;
      const m = spec.area ? P.areaMatcher(spec.area) : null;
      const witness = (c, d) => P.areaOf(c) === P.areaOf(d) && (!onObj || P.objectAt(d) === onObj);
      const what = [spec.sex ? sexEs(spec.sex) : spec.attr ? `alguien con ${spec.attr}` : spec.group ? `alguien del grupo ${spec.group}` : 'alguien', onObj ? `sobre ${onObj}` : ''].filter(Boolean).join(' ');
      return { ...base, text: `${myName}: ${what} en su zona${spec.area ? ` (${spec.area})` : ''}`,
        unary: m ? (c => m(P.areaOf(c)) || m(P.rawAreaOf(c))) : null,
        ...existential(P, me, ps, witness),
        revise: (st, emit) => existentialRevise(P, st, emit, me, ps, witness, `${myName}: ${what} en su zona`) };
    }
    case 'someone_exact_rows_beside': {
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
          // all possible witness cells share a line? (even when me is not fixed yet)
          const myRows = [...new Set(st.cand[me].map(P.row.bind(P)))];
          const cells = tcells.filter(d => myRows.includes(P.row(d) - sign * rows));
          const pairs = []; for (const k of ps) for (const d of st.cand[k]) if (cells.includes(d)) pairs.push([k, d]);
          const ks = [...new Set(pairs.map(p => p[0]))], ds = [...new Set(pairs.map(p => p[1]))];
          ch = lineOwnedBy(P, st, emit, me, ks, ds, DIMS(P).slice(1), (word, v, names) => `la ${word} ${v} la ocupa quien está junto a ${obj} (${names})`) || ch;
          return ch;
        } };
    }
    case 'no_attr_adjacent_columns': {
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
    }
    case 'victim': {
      const ps = persons(P).filter(k => k !== me);
      return { ...base, text: `${myName} (víctima): a solas con el asesino`,
        check: pos => {
          if (pos[me] < 0) return true;
          const a = P.areaOf(pos[me]);
          const inA = ps.filter(k => pos[k] >= 0 && P.areaOf(pos[k]) === a).length;
          if (inA > 1) return false;
          if (ps.every(k => pos[k] >= 0)) return inA === 1;
          return true;
        },
        support: (pos, candOf) => { if (pos[me] < 0) return true; const a = P.areaOf(pos[me]); return ps.some(k => (pos[k] >= 0 ? P.areaOf(pos[k]) === a : candOf(k).some(d => P.areaOf(d) === a))); },
        revise: (st, emit) => {
          let ch = false;
          if (st.cand[me].length === 1) {
            const a = P.areaOf(st.cand[me][0]);
            const can = ps.filter(k => st.cand[k].some(d => P.areaOf(d) === a));
            if (can.length === 0) throw new Contra('nadie puede acompañar a la víctima');
            if (can.length === 1) ch = emit(can[0], d => P.areaOf(d) === a, `solo ${cname(P, can[0])} puede estar con la víctima en ${P.areaName(a)}`) || ch;
            const fixed = ps.filter(k => st.cand[k].every(d => P.areaOf(d) === a));
            if (fixed.length === 1) for (const k of ps) if (k !== fixed[0]) ch = emit(k, d => P.areaOf(d) !== a, `${cname(P, fixed[0])} está con la víctima en ${P.areaName(a)}: nadie más puede estar allí`) || ch;
          }
          // the victim cannot be in an area where two other persons are already fixed
          const fixedAreas = new Map();
          for (const k of ps) if (st.cand[k].length === 1) { const a = P.areaOf(st.cand[k][0]); fixedAreas.set(a, (fixedAreas.get(a) || 0) + 1); }
          for (const [a, n] of fixedAreas) if (n >= 2) ch = emit(me, c => P.areaOf(c) !== a, `en ${P.areaName(a)} ya hay dos personas: la víctima no puede estar allí`) || ch;
          return ch;
        } };
    }
    case 'area_count': {
      const ps = filterPersons(P, spec);
      const areas = [...P.areasMatching(spec.area)];
      const min = spec.min !== undefined ? +spec.min : 0, max = spec.max !== undefined ? +spec.max : Infinity;
      const whoTxt = spec.attr ? `personas con ${spec.attr}` : spec.group ? `del grupo ${spec.group}` : spec.sex ? (spec.sex[0] === 'f' ? 'mujeres' : 'hombres') : 'personas';
      return { ...base, text: `cada zona ${spec.area}: entre ${min} y ${max === Infinity ? '∞' : max} ${whoTxt}`,
        check: pos => {
          for (const a of areas) {
            const inA = ps.filter(k => pos[k] >= 0 && P.areaOf(pos[k]) === a).length;
            if (inA > max) return false;
            if (ps.every(k => pos[k] >= 0) && inA < min) return false;
          }
          return true;
        },
        support: (pos, candOf) => areas.every(a => ps.filter(k => (pos[k] >= 0 ? P.areaOf(pos[k]) === a : candOf(k).some(d => P.areaOf(d) === a))).length >= min),
        revise: (st, emit) => {
          let ch = false;
          for (const a of areas) {
            const can = ps.filter(k => st.cand[k].some(d => P.areaOf(d) === a));
            const fixed = ps.filter(k => st.cand[k].every(d => P.areaOf(d) === a));
            if (can.length < min) throw new Contra(`la zona ${P.areaName(a)} no puede tener ${min} ${whoTxt}`);
            if (min > 0 && can.length === min) for (const k of can) ch = emit(k, d => P.areaOf(d) === a, `solo ${can.map(x => cname(P, x)).join('/')} pueden cubrir ${P.areaName(a)} (mínimo ${min} ${whoTxt})`) || ch;
            if (fixed.length >= max) for (const k of ps) if (!fixed.includes(k)) ch = emit(k, d => P.areaOf(d) !== a, `${P.areaName(a)} ya tiene su máximo de ${whoTxt}`) || ch;
          }
          return ch;
        } };
    }
    case 'empty_area': {
      const cells = new Set(P.cellsMatchingArea(spec.area));
      const ps = persons(P);
      return { ...base, text: `zona vacía: ${spec.area}`,
        check: pos => !ps.some(k => pos[k] >= 0 && cells.has(pos[k])),
        revise: (st, emit) => { let ch = false; for (const k of ps) ch = emit(k, d => !cells.has(d), `la zona ${spec.area} está vacía`) || ch; return ch; } };
    }
    default:
      throw new Error(`tipo de pista desconocido: ${t}`);
  }
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
    cand[k] = cand[k].filter(c => (h.row === undefined || P.row(c) === +h.row) && (h.col === undefined || P.col(c) === +h.col) && (h.cell === undefined || c === h.cell));
  }
  return { cand };
}

module.exports = { buildConstraints, initialState };
