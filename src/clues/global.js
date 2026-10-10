'use strict';
// Rules that involve several characters at once: the murder rule of the victim and the global
// clues of a puzzle (owner null).
const { Contra } = require('../propagate');
const { persons, cname, filterPersons } = require('./helpers');

module.exports = {
  victim({ P, me, myName, base }) {
    const ps = persons(P).filter(k => k !== me);
    return {
      ...base,
      text: `${myName} (víctima): a solas con el asesino`,
      check: pos => {
        if (pos[me] < 0) return true;
        const a = P.areaOf(pos[me]);
        const inA = ps.filter(k => pos[k] >= 0 && P.areaOf(pos[k]) === a).length;
        if (inA > 1) return false;
        if (ps.every(k => pos[k] >= 0)) return inA === 1;
        return true;
      },
      support: (pos, candOf) => {
        if (pos[me] < 0) return true;
        const a = P.areaOf(pos[me]);
        return ps.some(k => (pos[k] >= 0 ? P.areaOf(pos[k]) === a : candOf(k).some(d => P.areaOf(d) === a)));
      },
      revise: (st, emit) => {
        let changed = false;
        if (st.cand[me].length === 1) {
          const a = P.areaOf(st.cand[me][0]);
          const can = ps.filter(k => st.cand[k].some(d => P.areaOf(d) === a));
          if (can.length === 0) throw new Contra('nadie puede acompañar a la víctima');
          if (can.length === 1)
            changed =
              emit(
                can[0],
                d => P.areaOf(d) === a,
                `solo ${cname(P, can[0])} puede estar con la víctima en ${P.areaName(a)}`
              ) || changed;
          const fixed = ps.filter(k => st.cand[k].every(d => P.areaOf(d) === a));
          if (fixed.length === 1)
            for (const k of ps)
              if (k !== fixed[0])
                changed =
                  emit(
                    k,
                    d => P.areaOf(d) !== a,
                    `${cname(P, fixed[0])} está con la víctima en ${P.areaName(a)}: nadie más puede estar allí`
                  ) || changed;
        }
        // the victim cannot be in an area where two other persons are already fixed
        const fixedAreas = new Map();
        for (const k of ps)
          if (st.cand[k].length === 1) {
            const a = P.areaOf(st.cand[k][0]);
            fixedAreas.set(a, (fixedAreas.get(a) || 0) + 1);
          }
        for (const [a, n] of fixedAreas)
          if (n >= 2)
            changed =
              emit(
                me,
                c => P.areaOf(c) !== a,
                `en ${P.areaName(a)} ya hay dos personas: la víctima no puede estar allí`
              ) || changed;
        return changed;
      },
    };
  },

  area_count({ P, spec, base }) {
    const ps = filterPersons(P, spec);
    const areas = [...P.areasMatching(spec.area)];
    const min = spec.min !== undefined ? +spec.min : 0,
      max = spec.max !== undefined ? +spec.max : Infinity;
    const whoTxt = spec.attr
      ? `personas con ${spec.attr}`
      : spec.group
        ? `del grupo ${spec.group}`
        : spec.sex
          ? spec.sex[0] === 'f'
            ? 'mujeres'
            : 'hombres'
          : 'personas';
    return {
      ...base,
      text: `cada zona ${spec.area}: entre ${min} y ${max === Infinity ? '∞' : max} ${whoTxt}`,
      check: pos => {
        for (const a of areas) {
          const inA = ps.filter(k => pos[k] >= 0 && P.areaOf(pos[k]) === a).length;
          if (inA > max) return false;
          if (ps.every(k => pos[k] >= 0) && inA < min) return false;
        }
        return true;
      },
      support: (pos, candOf) =>
        areas.every(
          a =>
            ps.filter(k => (pos[k] >= 0 ? P.areaOf(pos[k]) === a : candOf(k).some(d => P.areaOf(d) === a))).length >=
            min
        ),
      revise: (st, emit) => {
        let changed = false;
        for (const a of areas) {
          const can = ps.filter(k => st.cand[k].some(d => P.areaOf(d) === a));
          const fixed = ps.filter(k => st.cand[k].every(d => P.areaOf(d) === a));
          if (can.length < min) throw new Contra(`la zona ${P.areaName(a)} no puede tener ${min} ${whoTxt}`);
          if (min > 0 && can.length === min)
            for (const k of can)
              changed =
                emit(
                  k,
                  d => P.areaOf(d) === a,
                  `solo ${can.map(x => cname(P, x)).join('/')} pueden cubrir ${P.areaName(a)} (mínimo ${min} ${whoTxt})`
                ) || changed;
          if (fixed.length >= max)
            for (const k of ps)
              if (!fixed.includes(k))
                changed =
                  emit(k, d => P.areaOf(d) !== a, `${P.areaName(a)} ya tiene su máximo de ${whoTxt}`) || changed;
        }
        return changed;
      },
    };
  },

  empty_area({ P, spec, base }) {
    const cells = new Set(P.cellsMatchingArea(spec.area));
    const ps = persons(P);
    return {
      ...base,
      text: `zona vacía: ${spec.area}`,
      check: pos => !ps.some(k => pos[k] >= 0 && cells.has(pos[k])),
      revise: (st, emit) => {
        let changed = false;
        for (const k of ps) changed = emit(k, d => !cells.has(d), `la zona ${spec.area} está vacía`) || changed;
        return changed;
      },
    };
  },
};
