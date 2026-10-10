'use strict';
// Human-style deduction engine: propagation (see propagate.js) plus one-level "what if" hypotheses
// chosen by shortest refutation. Produces an explained chain of deductions (Spanish) and, normally,
// the full solution.
const { buildConstraints, initialState } = require('./clues');
const { createPropagator, Contra } = require('./propagate');

function explain(P, opts = {}) {
  const constraints = opts.constraints || buildConstraints(P);
  const n = P.characters.length;
  const maxWhatIf = opts.maxWhatIf ?? 14;
  const prop = createPropagator(P, constraints, opts);
  const name = k => P.characters[k].name;
  const S = c => P.label(c);
  const solved = st => st.cand.every(a => a.length === 1);

  const st = initialState(P, constraints, opts.hypotheses);
  // steps: { kind: 'deduce', who, name, reason, kept, removed, fixedAt, text } (one per narrowing, see
  // propagate.js) or { kind: 'whatif', who, cell, text, details: [text] } (a refuted hypothesis)
  const steps = [];
  const deduce = log => {
    for (const e of log) steps.push({ kind: 'deduce', ...e });
  };
  let stuck = false,
    contradiction = null;
  try {
    const log0 = [];
    prop.propagate(st, log0);
    deduce(log0);
    while (!solved(st)) {
      const order = [];
      for (let k = 0; k < n; k++)
        if (P.isPerson(k) && st.cand[k].length > 1 && st.cand[k].length <= maxWhatIf) order.push(k);
      let best = null;
      for (const k of order)
        for (const cell of st.cand[k]) {
          const t = prop.clone(st);
          t.cand[k] = [cell];
          const sub = [];
          try {
            prop.propagate(t, sub);
          } catch (e) {
            if (!(e instanceof Contra)) throw e;
            if (!best || sub.length < best.sub.length) best = { k, cell, sub, msg: e.message };
          }
        }
      if (!best) {
        stuck = true;
        break;
      }
      const fixed = best.sub.filter(e => e.fixedAt).map(e => `${e.name}=${e.fixedAt}`);
      steps.push({
        kind: 'whatif',
        who: best.k,
        cell: best.cell,
        text: `SUPONGAMOS ${name(best.k)} en ${S(best.cell)} ⇒ ${fixed.length ? fixed.join(', ') + ' ⇒ ' : ''}CONTRADICCIÓN: ${best.msg}`,
        details: best.sub.map(e => e.text),
      });
      st.cand[best.k] = st.cand[best.k].filter(c => c !== best.cell);
      const log = [];
      prop.propagate(st, log);
      deduce(log);
    }
  } catch (e) {
    if (!(e instanceof Contra)) throw e;
    contradiction = e.message;
  }
  return { steps, state: st, solved: solved(st), stuck, contradiction, constraints };
}

/** Render the explanation as text. */
function formatSteps(result, { details = true } = {}) {
  const lines = [];
  let i = 0;
  for (const s of result.steps) {
    lines.push(`${++i}. ${s.text}`);
    if (details && s.kind === 'whatif') for (const d of s.details) lines.push(`      · ${d}`);
  }
  if (result.contradiction) lines.push(`CONTRADICCIÓN EN LA LÍNEA PRINCIPAL: ${result.contradiction}`);
  if (result.stuck) lines.push('ATASCADO: no se encontró ninguna hipótesis refutable de un nivel.');
  return lines.join('\n');
}

/** Condensed list of milestones: cells fixed on the main line and the refuted hypotheses. */
function milestones(result) {
  const out = [];
  for (const s of result.steps) {
    if (s.kind === 'whatif') out.push(s.text);
    else if (s.fixedAt) out.push(`${s.name} fijado en ${s.fixedAt} — ${s.reason}`);
  }
  return out;
}

module.exports = { explain, formatSteps, milestones };
