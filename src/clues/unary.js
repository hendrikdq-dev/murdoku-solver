'use strict';
// Unary clues: they only restrict the cells of their owner (hook `unary`). Every builder receives the
// context described in index.js: { P, spec, owner, me, myName, obj, neg, N, base, build }.

module.exports = {
  in_area({ P, spec, myName, neg, N, base }) {
    const m = P.areaMatcher(spec.area);
    return { ...base, text: `${myName}: ${neg ? 'no ' : ''}en ${spec.area}`, unary: c => N(m(P.areaOf(c)) || m(P.rawAreaOf(c))) };
  },

  not_beside: ({ spec, build }) => build({ ...spec, type: 'beside', not: true }),

  beside({ P, spec, myName, obj, neg, N, base }) {
    // "beside <person>" is impossible: two characters never share a row or a column, so they are
    // never orthogonally adjacent. Only objects and areas are supported.
    if (obj) return { ...base, text: `${myName}: ${neg ? 'no ' : ''}junto a ${obj}`, unary: c => N(P.besideObject(c, obj)) };
    if (spec.area) { const m = P.areaMatcher(spec.area); return { ...base, text: `${myName}: ${neg ? 'no ' : ''}junto a ${spec.area}`, unary: c => N(P.besideArea(c, m)) }; }
    throw new Error('falta "object" o "area"');
  },

  on: ({ P, myName, obj, neg, N, base }) => ({ ...base, text: `${myName}: ${neg ? 'no ' : ''}sobre ${obj}`, unary: c => N(P.objectAt(c) === obj) }),

  row({ P, spec, myName, neg, N, base }) {
    const v = spec.value === 'top' ? 1 : spec.value === 'bottom' ? P.height : +spec.value;
    return { ...base, text: `${myName}: ${neg ? 'no ' : ''}en la fila ${v}`, unary: c => N(P.row(c) === v) };
  },

  col({ P, spec, myName, neg, N, base }) {
    const v = spec.value === 'first' ? 1 : spec.value === 'last' ? P.width : +spec.value;
    return { ...base, text: `${myName}: ${neg ? 'no ' : ''}en la columna ${v}`, unary: c => N(P.col(c) === v) };
  },

  area_row({ P, spec, myName, N, base }) {
    const top = spec.value !== 'bottom';
    return { ...base, text: `${myName}: en la fila ${top ? 'superior' : 'inferior'} de su zona`, unary: c => N(P.row(c) === (top ? P.topRowOfArea(P.areaOf(c)) : P.bottomRowOfArea(P.areaOf(c)))) };
  },

  area_col({ P, spec, myName, N, base }) {
    const left = spec.value !== 'right';
    return { ...base, text: `${myName}: en la columna ${left ? 'izquierda' : 'derecha'} de su zona`, unary: c => N(P.col(c) === (left ? P.leftColOfArea(P.areaOf(c)) : P.rightColOfArea(P.areaOf(c)))) };
  },

  corner({ P, spec, myName, N, base }) {
    const grid = spec.of === 'grid';
    return { ...base, text: `${myName}: en una esquina ${grid ? 'de la cuadrícula' : 'de su zona'}`, unary: c => N(grid ? P.isGridCorner(c) : P.isAreaCorner(c)) };
  },

  no_object_in_line({ P, spec, myName, obj, N, base }) {
    const col = (spec.line || 'column') === 'column';
    return { ...base, text: `${myName}: sin ${obj} en su ${col ? 'columna' : 'fila'}`, unary: c => N(!(col ? P.columnHasObject(P.col(c), obj) : P.rowHasObject(P.row(c), obj))) };
  },

  object_in_area: ({ P, myName, obj, neg, N, base }) => ({ ...base, text: `${myName}: ${neg ? 'ningún' : 'hay un'} ${obj} en su zona`, unary: c => N(P.areaHasObject(P.areaOf(c), obj)) }),

  in_front_of_door: ({ P, myName, neg, N, base }) => ({ ...base, text: `${myName}: ${neg ? 'no ' : ''}frente a una puerta`, unary: c => N(P.inFrontOfDoor(c)) }),
};
