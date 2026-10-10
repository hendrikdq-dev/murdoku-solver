#!/usr/bin/env node
'use strict';
// Command line interface. Run `node src/cli.js` for usage.
const fs = require('fs');
const path = require('path');
const https = require('https');
const { loadPuzzle } = require('./load-puzzle');
const { loadOfficialJson } = require('./load-official');
const { solve, describeSolution, murdererOf } = require('./solver');
const { explain, formatSteps, milestones } = require('./logic');
const { renderSvg } = require('./render-svg');

const ROOT = path.resolve(__dirname, '..');
const CACHE = path.join(ROOT, 'cache', 'official');
const ANNOT = path.join(ROOT, 'puzzles', 'annotations');

const USAGE = `murdoku — herramientas para puzles Murdoku

  node src/cli.js fetch <slug> [--lang es]      descarga el JSON oficial de murdoku.com/play a cache/official/
                                                (slug como en la URL: p. ej. preppers-medium, the-zoo-expert)
  node src/cli.js info <puzle>                  resumen: zonas, objetos, personajes y pistas (y si están codificadas)
  node src/cli.js clues <puzle>                 pistas de cada personaje y su codificación lógica
  node src/cli.js solve <puzle> [--limit N] [--hyp Nombre=fila,col ...]
                                                búsqueda exhaustiva; --hyp fija hipótesis (fila o col pueden ser *)
  node src/cli.js explain <puzle> [--out f] [--brief]
                                                cadena de deducciones explicada (español)
  node src/cli.js hints <puzle>                 hitos de la cadena (para dar pistas progresivas)
  node src/cli.js render <puzle> [--out f.svg] [--solution] [--overlay spec.json] [--crop r1,c1,r2,c2] [--legend]
                                                dibuja el tablero en SVG

<puzle> puede ser: un fichero JSON en formato propio (ver puzzles/FORMAT.md), un fichero JSON oficial,
o el slug de un puzle ya descargado en cache/official/. Para los oficiales se buscan las pistas codificadas
en puzzles/annotations/<slug>.clues.json. Opción común: --lang en|es (textos de los puzles oficiales).
`;

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      if (key === 'hyp') { (args.hyp = args.hyp || []).push(argv[++i]); }
      else if (i + 1 < argv.length && !argv[i + 1].startsWith('--') && !['solution', 'legend', 'brief'].includes(key)) args[key] = argv[++i];
      else args[key] = true;
    } else args._.push(a);
  }
  return args;
}

function resolvePuzzle(ref, args) {
  const lang = args.lang || 'en';
  let file = ref;
  if (!fs.existsSync(file)) {
    if (fs.existsSync(path.join(CACHE, `${ref}.json`))) file = path.join(CACHE, `${ref}.json`);
    else throw new Error(`No encuentro el puzle "${ref}" (ni fichero ni cache/official/${ref}.json; usa "fetch ${ref}")`);
  }
  let json = JSON.parse(fs.readFileSync(file, 'utf8'));
  const isOfficial = j => j && j.PROPERTIES && j.GRID;
  // a translation file (puzzle-<slug>-es.json) only holds texts: use the English file as the base
  const base = path.basename(file, '.json').replace(/-(en|es|fr|pt|de|it|nl)$/, '');
  if (isOfficial(json) && !json.PROPERTIES.grid_w) {
    const baseFile = path.join(path.dirname(file), `${base}.json`);
    if (!fs.existsSync(baseFile)) throw new Error(`${file} solo contiene textos; falta ${baseFile}`);
    const texts = json; json = JSON.parse(fs.readFileSync(baseFile, 'utf8'));
    for (const sec of Object.keys(texts)) Object.assign(json[sec] = json[sec] || {}, texts[sec]);
  }
  if (isOfficial(json)) {
    const annPath = args.annotations || path.join(ANNOT, `${base}.clues.json`);
    if (lang !== 'en') {
      const alt = path.join(path.dirname(file), `${base}-${lang}.json`);
      if (fs.existsSync(alt)) { const j2 = JSON.parse(fs.readFileSync(alt, 'utf8')); for (const sec of Object.keys(j2)) Object.assign(json[sec] = json[sec] || {}, j2[sec]); }
      else console.error(`(aviso: no hay textos en "${lang}" en caché; usa "fetch ${base} --lang ${lang}")`);
    }
    const ann = fs.existsSync(annPath) ? JSON.parse(fs.readFileSync(annPath, 'utf8')) : {};
    const P = loadOfficialJson(json, ann, lang);
    P.meta.annotationsPath = annPath;
    return P;
  }
  return loadPuzzle(file);
}

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`HTTP ${res.statusCode} ${url}`)); }
      const chunks = []; res.on('data', d => chunks.push(d)); res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    }).on('error', reject);
  });
}

function parseHyps(list, P) {
  return (list || []).map(h => {
    const m = /^(.+?)=(\*|\d+)\s*,\s*(\*|\d+)$/.exec(h);
    if (!m) throw new Error(`hipótesis mal formada: ${h} (usa Nombre=fila,col)`);
    P.charIndex(m[1]);
    const out = { who: m[1] }; if (m[2] !== '*') out.row = +m[2]; if (m[3] !== '*') out.col = +m[3];
    return out;
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0];
  if (!cmd || cmd === 'help') { console.log(USAGE); return; }
  if (cmd === 'fetch') {
    const slug = args._[1]; if (!slug) throw new Error('falta el slug');
    fs.mkdirSync(CACHE, { recursive: true });
    const lang = args.lang || 'en';
    const url = lang === 'en' ? `https://murdoku.com/play_puzzles/en/puzzle-${slug}.json` : `https://murdoku.com/play_puzzles/${lang}/puzzle-${slug}-${lang}.json`;
    const body = await fetchUrl(url);
    JSON.parse(body);
    const out = path.join(CACHE, lang === 'en' ? `${slug}.json` : `${slug}-${lang}.json`);
    fs.writeFileSync(out, body);
    console.log(`guardado ${out} (${body.length} bytes)`);
    return;
  }
  const ref = args._[1]; if (!ref) throw new Error('falta el puzle');
  const P = resolvePuzzle(ref, args);
  const encoded = P.characters.filter(c => c.constraints.length || c.role !== 'suspect').length;
  if (cmd === 'info') {
    console.log(`${P.name} — ${P.width}x${P.height}, ${P.characters.length} personajes, objetivo: ${P.objective}`);
    console.log('Zonas: ' + P.mainAreaIds().map(id => `${P.areaName(id)} (${P.cellsOfArea(id).length})`).join(' · '));
    const objs = {}; for (let i = 0; i < P.n; i++) { const o = P.objectAt(i); if (o) (objs[o] = objs[o] || []).push(P.label(i)); }
    console.log('Objetos: ' + Object.entries(objs).map(([o, cells]) => `${o}${P.occupiableNames.has(o) ? '*' : ''} ×${cells.length}`).join(' · ') + '   (* = se puede ocupar)');
    if (P.frontCells.length) console.log('Frente a puertas: ' + P.frontCells.map(p => p.map(c => P.label(c)).join('/')).join(' · '));
    if (P.meta.customRules && P.meta.customRules.length) console.log('Reglas extra: ' + P.meta.customRules.join(' | '));
    console.log(`Pistas codificadas: ${encoded}/${P.characters.length}${P.meta.annotationsPath ? ` (fichero: ${path.relative(ROOT, P.meta.annotationsPath)})` : ''}`);
    if (P.meta.hints) console.log(`Pistas oficiales: ${P.meta.hints.length} · texto de solución oficial: ${P.meta.solution.length} líneas · índice del asesino: ${P.meta.murdererIndex}`);
    return;
  }
  if (cmd === 'clues') {
    for (const ch of P.characters) console.log(`${ch.name} [${ch.sex || '?'}${ch.attrs.size ? ' ' + [...ch.attrs].join(',') : ''}${ch.role !== 'suspect' ? ' ' + ch.role : ''}]: ${ch.clue}\n    ${ch.constraints.length ? JSON.stringify(ch.constraints) : ch.role === 'suspect' ? '(sin codificar)' : ''}`);
    if (P.meta.hints && P.meta.hints.length) { console.log('\nPistas oficiales:'); P.meta.hints.forEach((h, i) => console.log(`  ${i + 1}. ${h}`)); }
    return;
  }
  if (cmd === 'solve') {
    const r = solve(P, { limit: +(args.limit || 2), hypotheses: parseHyps(args.hyp, P) });
    console.log(`soluciones encontradas: ${r.solutions.length}${r.solutions.length >= +(args.limit || 2) ? ' (límite alcanzado)' : ''} · nodos: ${r.nodes}`);
    r.solutions.forEach((s, i) => { console.log(`--- solución ${i + 1}`); console.log(describeSolution(P, s)); });
    if (r.solutions.length === 1 && P.meta.murdererIndex !== undefined && P.meta.murdererIndex !== null) {
      const m = murdererOf(P, r.solutions[0]);
      console.log(m === P.meta.murdererIndex ? `✔ coincide con el asesino oficial (${P.characters[m].name})` : `✘ NO coincide con el asesino oficial (índice ${P.meta.murdererIndex} = ${P.characters[P.meta.murdererIndex] && P.characters[P.meta.murdererIndex].name})`);
    }
    return;
  }
  if (cmd === 'explain' || cmd === 'hints') {
    const e = explain(P, { hypotheses: parseHyps(args.hyp, P) });
    const text = cmd === 'hints' ? milestones(e).map((m, i) => `${i + 1}. ${m}`).join('\n') : formatSteps(e, { details: !args.brief });
    const status = e.solved ? 'resuelto' : e.contradiction ? 'contradicción: ' + e.contradiction : 'atascado (sin hipótesis refutables de un nivel)';
    if (args.out) { fs.writeFileSync(args.out, text + '\n'); console.log(`escrito ${args.out} · ${e.steps.length} pasos · ${status}`); }
    else { console.log(text); console.log(`\n${e.steps.length} pasos · ${status}`); }
    return;
  }
  if (cmd === 'render') {
    const opts = { legend: !!args.legend, title: P.name };
    if (args.crop) opts.crop = args.crop.split(',').map(Number);
    if (args.overlay) opts.overlay = JSON.parse(fs.readFileSync(args.overlay, 'utf8'));
    if (args.solution) { const r = solve(P, { limit: 1 }); if (!r.solutions.length) throw new Error('sin solución'); opts.placements = Object.fromEntries(P.characters.map((c, k) => [c.name, r.solutions[0][k]])); }
    const svg = renderSvg(P, opts);
    const out = args.out || path.join(ROOT, 'out', `${path.basename(ref).replace(/\.json$/, '')}${args.solution ? '-solucion' : ''}.svg`);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, svg);
    console.log(`escrito ${out}`);
    return;
  }
  throw new Error(`comando desconocido: ${cmd}\n${USAGE}`);
}

main().catch(e => { console.error('Error:', e.message); process.exit(1); });
