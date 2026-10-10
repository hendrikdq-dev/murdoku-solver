#!/usr/bin/env node
'use strict';
// Command line interface. Run `node src/cli.js` for usage. The module is importable: main(argv, io)
// runs a command with injectable output functions (used by the tests).
const fs = require('fs');
const path = require('path');
const { loadPuzzle } = require('./load-puzzle');
const { loadOfficialJson } = require('./load-official');
const { buildConstraints } = require('./clues');
const { solve, describeSolution, murdererOf } = require('./solver');
const { explain, formatSteps, milestones } = require('./logic');
const { renderSvg } = require('./render-svg');

const ROOT = path.resolve(__dirname, '..');
const ANNOT = path.join(ROOT, 'puzzles', 'annotations');
const LANGS = ['en', 'es', 'fr', 'pt', 'de', 'it', 'nl'];
const FETCH_TIMEOUT_MS = 20000;

/** Directory of the cached official JSON files: --cache, $MURDOKU_CACHE or <repo>/cache/official. */
function cacheDir(args) { return args.cache || process.env.MURDOKU_CACHE || path.join(ROOT, 'cache', 'official'); }

const USAGE = `murdoku — herramientas para puzles Murdoku

  node src/cli.js fetch <slug> [--lang es]      descarga el JSON oficial de murdoku.com/play a la caché
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
o el slug de un puzle ya descargado en la caché. Para los oficiales se buscan las pistas codificadas en
puzzles/annotations/<slug>.clues.json (o en --annotations f). Opciones comunes: --lang en|es (textos de los
puzles oficiales) y --cache dir (caché de JSON oficiales; por defecto $MURDOKU_CACHE o cache/official/ en
el repositorio). Los avisos sobre el puzle (objetos desconocidos, víctima deducida del texto...) van a stderr.
`;

// --name value | --name (flag) | --hyp value (repeatable)
const OPTIONS = { lang: 'value', cache: 'value', limit: 'value', out: 'value', annotations: 'value', overlay: 'value', crop: 'value', hyp: 'list', solution: 'flag', legend: 'flag', brief: 'flag' };

function parseArgs(argv) {
  const args = { _: [], hyp: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { args._.push(a); continue; }
    const key = a.slice(2), kind = OPTIONS[key];
    if (!kind) throw new Error(`opción desconocida: ${a}`);
    if (kind === 'flag') { args[key] = true; continue; }
    const v = argv[++i];
    if (v === undefined || v.startsWith('--')) throw new Error(`falta el valor de ${a}`);
    if (kind === 'list') args.hyp.push(v); else args[key] = v;
  }
  return args;
}

function readJson(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (e) { throw new Error(`no se puede leer ${file}: ${e.message}`); }
  try { return JSON.parse(text); } catch (e) { throw new Error(`${file}: JSON mal formado (${e.message})`); }
}

function parseInteger(value, option, min = 1) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min) throw new Error(`${option} debe ser un entero ≥ ${min} (recibido "${value}")`);
  return n;
}

/** Merge a translation file (sections holding only texts) into an official puzzle JSON. */
function mergeTexts(json, texts) {
  for (const sec of Object.keys(texts)) Object.assign(json[sec] = json[sec] || {}, texts[sec]);
}

/**
 * Load the puzzle named by `ref`: a file in the project's format, an official JSON file (or its
 * translation file), or the slug of an official puzzle cached in cache/official/.
 */
function resolvePuzzle(ref, args, warn = console.error) {
  const lang = args.lang || 'en';
  if (!LANGS.includes(lang)) throw new Error(`idioma no válido: "${lang}" (${LANGS.join(', ')})`);
  let file = ref;
  if (!fs.existsSync(file)) {
    const cached = path.join(cacheDir(args), `${ref}.json`);
    if (fs.existsSync(cached)) file = cached;
    else throw new Error(`No encuentro el puzle "${ref}" (ni fichero ni ${cached}; usa "fetch ${ref}")`);
  }
  let json = readJson(file);
  const isOfficial = j => j && j.PROPERTIES && j.GRID;
  // a translation file (puzzle-<slug>-es.json) only holds texts: use the English file as the base
  const base = path.basename(file, '.json').replace(new RegExp(`-(${LANGS.join('|')})$`), '');
  if (isOfficial(json) && !json.PROPERTIES.grid_w) {
    const baseFile = path.join(path.dirname(file), `${base}.json`);
    if (!fs.existsSync(baseFile)) throw new Error(`${file} solo contiene textos; falta ${baseFile}`);
    const texts = json; json = readJson(baseFile);
    mergeTexts(json, texts);
  }
  if (isOfficial(json)) {
    const annPath = args.annotations || path.join(ANNOT, `${base}.clues.json`);
    if (lang !== 'en') {
      const alt = path.join(path.dirname(file), `${base}-${lang}.json`);
      if (fs.existsSync(alt)) mergeTexts(json, readJson(alt));
      else warn(`aviso: no hay textos en "${lang}" en caché; usa "fetch ${base} --lang ${lang}"`);
    }
    const ann = fs.existsSync(annPath) ? readJson(annPath) : {};
    const P = loadOfficialJson(json, ann, lang);
    P.meta.annotationsPath = annPath;
    return P;
  }
  if (!json || typeof json !== 'object' || !Array.isArray(json.areas)) throw new Error(`${file}: no parece un puzle (ni formato propio con "areas" ni JSON oficial con PROPERTIES/GRID)`);
  return loadPuzzle(file);
}

async function fetchText(url) {
  let res;
  try { res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), headers: { accept: 'application/json' } }); }
  catch (e) { throw new Error(`no se pudo descargar ${url}: ${e.name === 'TimeoutError' ? `sin respuesta en ${FETCH_TIMEOUT_MS / 1000} s` : e.message}`); }
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.text();
}

/** --hyp Nombre=fila,col (either may be *) -> { who, row?, col? }, validated against the puzzle. */
function parseHyps(list, P) {
  return (list || []).map(h => {
    const m = /^(.+?)=(\*|\d+)\s*,\s*(\*|\d+)$/.exec(h);
    if (!m) throw new Error(`hipótesis mal formada: ${h} (usa Nombre=fila,col; fila o col pueden ser *)`);
    if (m[2] === '*' && m[3] === '*') throw new Error(`hipótesis ${h}: fila y columna no pueden ser las dos *`);
    const out = { who: P.characters[P.charIndex(m[1])].name };
    if (m[2] !== '*') { out.row = +m[2]; if (out.row < 1 || out.row > P.height) throw new Error(`hipótesis ${h}: fila fuera de rango (1-${P.height})`); }
    if (m[3] !== '*') { out.col = +m[3]; if (out.col < 1 || out.col > P.width) throw new Error(`hipótesis ${h}: columna fuera de rango (1-${P.width})`); }
    return out;
  });
}

function parseCrop(value, P) {
  const parts = value.split(',');
  if (parts.length !== 4) throw new Error(`--crop debe ser r1,c1,r2,c2 (recibido "${value}")`);
  const [r1, c1, r2, c2] = parts.map(x => parseInteger(x, '--crop'));
  if (r1 > r2 || c1 > c2 || r2 > P.height || c2 > P.width) throw new Error(`--crop fuera del tablero o invertido: filas 1-${P.height}, columnas 1-${P.width}`);
  return [r1, c1, r2, c2];
}

async function main(argv, io = {}) {
  const log = io.log || console.log, warn = io.warn || console.error;
  const args = parseArgs(argv);
  const cmd = args._[0];
  if (!cmd || cmd === 'help') { log(USAGE); return; }
  if (cmd === 'fetch') {
    const slug = args._[1]; if (!slug) throw new Error('falta el slug');
    if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) throw new Error(`slug no válido: "${slug}" (minúsculas, dígitos y guiones, como en la URL)`);
    const lang = args.lang || 'en';
    if (!LANGS.includes(lang)) throw new Error(`idioma no válido: "${lang}" (${LANGS.join(', ')})`);
    const cache = cacheDir(args);
    fs.mkdirSync(cache, { recursive: true });
    const url = lang === 'en' ? `https://murdoku.com/play_puzzles/en/puzzle-${slug}.json` : `https://murdoku.com/play_puzzles/${lang}/puzzle-${slug}-${lang}.json`;
    const body = await fetchText(url);
    try { JSON.parse(body); } catch (e) { throw new Error(`la respuesta de ${url} no es JSON (${e.message})`); }
    const out = path.join(cache, lang === 'en' ? `${slug}.json` : `${slug}-${lang}.json`);
    fs.writeFileSync(out, body);
    log(`guardado ${out} (${body.length} bytes)`);
    return;
  }
  const ref = args._[1]; if (!ref) throw new Error('falta el puzle');
  const P = resolvePuzzle(ref, args, warn);
  for (const w of P.meta.warnings || []) warn(`aviso: ${w}`);
  const encoded = P.characters.filter(c => c.constraints.length || c.role !== 'suspect').length;
  if (cmd === 'info') {
    log(`${P.name} — ${P.width}x${P.height}, ${P.characters.length} personajes, objetivo: ${P.objective}`);
    log('Zonas: ' + P.mainAreaIds().map(id => `${P.areaName(id)} (${P.cellsOfArea(id).length})`).join(' · '));
    const objs = {}; for (let i = 0; i < P.n; i++) { const o = P.objectAt(i); if (o) (objs[o] = objs[o] || []).push(P.label(i)); }
    log('Objetos: ' + Object.entries(objs).map(([o, cells]) => `${o}${P.occupiableNames.has(o) ? '*' : ''} ×${cells.length}`).join(' · ') + '   (* = se puede ocupar)');
    if (P.frontCells.length) log('Frente a puertas: ' + P.frontCells.map(p => p.map(c => P.label(c)).join('/')).join(' · '));
    if (P.meta.customRules && P.meta.customRules.length) log('Reglas extra: ' + P.meta.customRules.join(' | '));
    log(`Pistas codificadas: ${encoded}/${P.characters.length}${P.meta.annotationsPath ? ` (fichero: ${path.relative(ROOT, P.meta.annotationsPath)})` : ''}`);
    if (P.meta.hints) log(`Pistas oficiales: ${P.meta.hints.length} · texto de solución oficial: ${P.meta.solution.length} líneas · índice del asesino: ${P.meta.murdererIndex}`);
    return;
  }
  if (cmd === 'clues') {
    // the constraint texts are the Spanish reading of the encoding; building them also validates it
    const texts = new Map();
    const strip = (t, name) => (t.startsWith(`${name}: `) ? t.slice(name.length + 2) : t);
    for (const c of buildConstraints(P)) if (c.text) (texts.get(c.owner) || texts.set(c.owner, []).get(c.owner)).push(c.owner === null ? c.text : strip(c.text, P.characters[c.owner].name));
    P.characters.forEach((ch, k) => {
      log(`${ch.name} [${ch.sex || '?'}${ch.attrs.size ? ' ' + [...ch.attrs].join(',') : ''}${ch.role !== 'suspect' ? ' ' + ch.role : ''}]: ${ch.clue}`);
      if (ch.constraints.length) { log(`    ${(texts.get(k) || []).join(' · ')}`); log(`    ${JSON.stringify(ch.constraints)}`); }
      else if (ch.role === 'suspect') log('    (sin codificar)');
    });
    if (P.global.length) { log('\nReglas globales:'); for (const t of texts.get(null) || []) log(`  · ${t}`); }
    if (P.meta.hints && P.meta.hints.length) { log('\nPistas oficiales:'); P.meta.hints.forEach((h, i) => log(`  ${i + 1}. ${h}`)); }
    return;
  }
  if (cmd === 'solve') {
    const limit = args.limit === undefined ? 2 : parseInteger(args.limit, '--limit');
    const r = solve(P, { limit, hypotheses: parseHyps(args.hyp, P) });
    log(`soluciones encontradas: ${r.solutions.length}${r.solutions.length >= limit ? ' (límite alcanzado)' : ''} · nodos: ${r.nodes}`);
    r.solutions.forEach((s, i) => { log(`--- solución ${i + 1}`); log(describeSolution(P, s)); });
    if (r.solutions.length === 1 && P.meta.murdererIndex !== undefined && P.meta.murdererIndex !== null) {
      const m = murdererOf(P, r.solutions[0]);
      log(m === P.meta.murdererIndex ? `✔ coincide con el asesino oficial (${P.characters[m].name})` : `✘ NO coincide con el asesino oficial (índice ${P.meta.murdererIndex} = ${P.characters[P.meta.murdererIndex] && P.characters[P.meta.murdererIndex].name})`);
    }
    return;
  }
  if (cmd === 'explain' || cmd === 'hints') {
    const e = explain(P, { hypotheses: parseHyps(args.hyp, P) });
    const text = cmd === 'hints' ? milestones(e).map((m, i) => `${i + 1}. ${m}`).join('\n') : formatSteps(e, { details: !args.brief });
    const status = e.solved ? 'resuelto' : e.contradiction ? 'contradicción: ' + e.contradiction : 'atascado (sin hipótesis refutables de un nivel)';
    if (args.out) { fs.writeFileSync(args.out, text + '\n'); log(`escrito ${args.out} · ${e.steps.length} pasos · ${status}`); }
    else { log(text); log(`\n${e.steps.length} pasos · ${status}`); }
    return;
  }
  if (cmd === 'render') {
    const opts = { legend: !!args.legend, title: P.name };
    if (args.crop) opts.crop = parseCrop(args.crop, P);
    if (args.overlay) opts.overlay = readJson(args.overlay);
    if (args.solution) { const r = solve(P, { limit: 1 }); if (!r.solutions.length) throw new Error('sin solución'); opts.placements = Object.fromEntries(P.characters.map((c, k) => [c.name, r.solutions[0][k]])); }
    const svg = renderSvg(P, opts);
    const out = args.out || path.join(ROOT, 'out', `${path.basename(ref).replace(/\.json$/, '')}${args.solution ? '-solucion' : ''}.svg`);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, svg);
    log(`escrito ${out}`);
    return;
  }
  throw new Error(`comando desconocido: ${cmd}\n${USAGE}`);
}

if (require.main === module) main(process.argv.slice(2)).catch(e => { console.error('Error:', e.message); process.exit(1); });

module.exports = { parseArgs, parseHyps, parseCrop, readJson, resolvePuzzle, main, USAGE };
