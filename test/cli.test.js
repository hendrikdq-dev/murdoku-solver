'use strict';
// Command line interface, driven in-process through main(argv, io) with captured output.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseArgs, parseHyps, parseCrop, resolvePuzzle, main, USAGE } = require('../src/cli');
const { loadPuzzle } = require('../src/load-puzzle');

const ROOT = path.join(__dirname, '..');
const TOY = path.join(ROOT, 'puzzles', 'examples', 'toy-murder.json');
const FARO = path.join(ROOT, 'puzzles', 'examples', 'faro-tesoro.json');
const FIX = path.join(__dirname, 'fixtures');
const OFFICIAL = path.join(FIX, 'puzzle-synthetic-manor.json');
const ANN = path.join(FIX, 'synthetic-manor.clues.json');

async function run(...argv) {
  const out = [],
    err = [];
  await main(argv, { log: (...a) => out.push(a.join(' ')), warn: (...a) => err.push(a.join(' ')) });
  return { out: out.join('\n'), err: err.join('\n') };
}
const rejects = (argv, re) => assert.rejects(() => run(...argv), re);
const withTempDir = async fn => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'murdoku-cli-'));
  try {
    await fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

test('parseArgs: positionals, values, flags, repeatable --hyp, and errors', () => {
  const a = parseArgs(['solve', 'x.json', '--limit', '3', '--hyp', 'A=1,2', '--hyp', 'B=*,3', '--brief']);
  assert.deepStrictEqual(a, { _: ['solve', 'x.json'], hyp: ['A=1,2', 'B=*,3'], limit: '3', brief: true });
  assert.throws(() => parseArgs(['--limt', '3']), /opción desconocida: --limt/);
  assert.throws(() => parseArgs(['explain', 'x', '--out']), /falta el valor de --out/);
  assert.throws(() => parseArgs(['explain', 'x', '--out', '--brief']), /falta el valor de --out/);
});

test('parseHyps and parseCrop validate against the puzzle', () => {
  const P = loadPuzzle(TOY);
  assert.deepStrictEqual(parseHyps(['clara=1,*', 'Dani=*,4'], P), [
    { who: 'Clara', row: 1 },
    { who: 'Dani', col: 4 },
  ]);
  assert.throws(() => parseHyps(['Clara=9,1'], P), /fila fuera de rango \(1-4\)/);
  assert.throws(() => parseHyps(['Clara=1,0'], P), /columna fuera de rango \(1-4\)/);
  assert.throws(() => parseHyps(['Clara=*,*'], P), /no pueden ser las dos \*/);
  assert.throws(() => parseHyps(['Clara-1,2'], P), /hipótesis mal formada/);
  assert.throws(() => parseHyps(['Zoe=1,2'], P), /personaje desconocido: Zoe/);
  assert.deepStrictEqual(parseCrop('1,2,3,4', P), [1, 2, 3, 4]);
  assert.throws(() => parseCrop('1,2,3', P), /--crop debe ser r1,c1,r2,c2/);
  assert.throws(() => parseCrop('3,1,2,4', P), /fuera del tablero o invertido/);
  assert.throws(() => parseCrop('1,1,9,4', P), /fuera del tablero o invertido/);
  assert.throws(() => parseCrop('1,a,2,2', P), /--crop debe ser un entero/);
});

test('help, unknown command, missing puzzle, malformed JSON', async () => {
  assert.strictEqual((await run()).out, USAGE);
  assert.ok((await run('help')).out.includes('node src/cli.js solve'));
  await rejects(['frobnicate', TOY], /comando desconocido: frobnicate/);
  await rejects(['solve'], /falta el puzle/);
  await rejects(['solve', 'no-existe'], /No encuentro el puzle "no-existe"/);
  await withTempDir(async dir => {
    const bad = path.join(dir, 'bad.json');
    fs.writeFileSync(bad, '{ "areas": [');
    await rejects(['info', bad], /bad\.json: JSON mal formado/);
    const notPuzzle = path.join(dir, 'x.json');
    fs.writeFileSync(notPuzzle, '{"hello": 1}');
    await rejects(['info', notPuzzle], /no parece un puzle/);
  });
});

test('info, clues, solve, explain, hints on the example puzzles', async () => {
  const info = (await run('info', TOY)).out;
  assert.match(info, /^Ejemplo de juguete \(4x4\) — 4x4, 4 personajes, objetivo: murder$/m);
  assert.match(info, /^Pistas codificadas: 4\/4$/m);
  const clues = (await run('clues', FARO)).out;
  assert.match(clues, /^Marina \[f\]: Estaba en el Faro, junto a una cama\.\n {4}en Faro · junto a bed\n {4}\[/m);
  assert.match(clues, /^Tesoro \[\? treasure\]: /m);
  assert.match(clues, /Reglas globales:\n {2}· zona vacía: Faro \(torre\)\n/);
  const solved = (await run('solve', TOY)).out;
  assert.match(solved, /^soluciones encontradas: 1 · nodos: \d+$/m);
  assert.match(solved, /^Asesino: Clara /m);
  assert.match(
    (await run('solve', FARO, '--hyp', 'Olga=1,6', '--limit', '5')).out,
    /^soluciones encontradas: 0 · nodos/m
  );
  await rejects(['solve', FARO, '--limit', 'abc'], /--limit debe ser un entero ≥ 1/);
  await rejects(['solve', FARO, '--limit', '0'], /--limit debe ser un entero ≥ 1/);
  await rejects(['solve', FARO, '--hyp', 'Olga=9,1'], /fila fuera de rango \(1-7\)/);
  const explained = (await run('explain', TOY, '--brief')).out;
  assert.match(explained, /^1\. \[/m);
  assert.match(explained, /\n4 pasos · resuelto$/);
  assert.match((await run('hints', TOY)).out, /^1\. Clara fijado en R2C3 — /m);
});

test('explain --out and render write files; render validates --crop and reads overlays', async () => {
  await withTempDir(async dir => {
    const txt = path.join(dir, 'faro.txt');
    assert.match((await run('explain', FARO, '--out', txt)).out, /^escrito .*faro\.txt · 15 pasos · resuelto$/m);
    assert.ok(fs.readFileSync(txt, 'utf8').startsWith('1. '));
    const svg = path.join(dir, 'faro.svg');
    assert.match(
      (await run('render', FARO, '--out', svg, '--solution', '--legend', '--crop', '1,1,7,7')).out,
      /^escrito .*faro\.svg$/m
    );
    const content = fs.readFileSync(svg, 'utf8');
    assert.ok(content.startsWith('<svg') && (content.match(/<circle/g) || []).length === 7);
    await rejects(['render', FARO, '--out', svg, '--crop', '1,2,3'], /--crop debe ser r1,c1,r2,c2/);
    const overlay = path.join(dir, 'overlay.json');
    fs.writeFileSync(
      overlay,
      JSON.stringify({
        rows: [{ r: 2 }],
        cols: [{ c: 1, fill: '#fee' }],
        cells: [{ r: 1, c: 1, text: 'X', cross: '#f00', border: '#00f', small: true }],
      })
    );
    assert.match((await run('render', TOY, '--out', svg, '--overlay', overlay)).out, /^escrito /);
    assert.ok(fs.readFileSync(svg, 'utf8').includes('>X</text>'));
  });
});

test('official puzzles: annotations option, translation files, language check and warnings', async () => {
  const warn = [];
  const P = resolvePuzzle(OFFICIAL, { annotations: ANN, lang: 'es' }, w => warn.push(w));
  assert.strictEqual(P.name, 'Mansión sintética');
  assert.strictEqual(P.characters[1].clue, 'Estaba en la cama, al oeste de Leo.'); // from puzzle-synthetic-manor-es.json
  assert.deepStrictEqual(warn, []);
  const P2 = resolvePuzzle(OFFICIAL, { annotations: ANN, lang: 'fr' }, w => warn.push(w));
  assert.strictEqual(P2.name, 'Synthetic Manor');
  assert.match(warn[0], /no hay textos en "fr" en caché/);
  // the translation file alone resolves to the English base plus its texts
  const P3 = resolvePuzzle(path.join(FIX, 'puzzle-synthetic-manor-es.json'), { annotations: ANN, lang: 'es' });
  assert.strictEqual(P3.name, 'Mansión sintética');
  assert.strictEqual(P3.characters.length, 4);
  await rejects(['info', OFFICIAL, '--lang', 'xx'], /idioma no válido: "xx"/);
  // slug lookup in the cache directory: --cache option or MURDOKU_CACHE
  assert.strictEqual(resolvePuzzle('puzzle-synthetic-manor', { cache: FIX, annotations: ANN }).name, 'Synthetic Manor');
  process.env.MURDOKU_CACHE = FIX;
  try {
    assert.strictEqual(resolvePuzzle('puzzle-synthetic-manor', { annotations: ANN }).characters.length, 4);
  } finally {
    delete process.env.MURDOKU_CACHE;
  }
  await rejects(
    ['info', 'puzzle-synthetic-manor', '--cache', path.join(FIX, 'nowhere')],
    /No encuentro el puzle "puzzle-synthetic-manor" \(ni fichero ni .*nowhere/
  );
  const r = await run('solve', OFFICIAL, '--annotations', ANN);
  assert.match(r.out, /✔ coincide con el asesino oficial \(Leo\)/);
  assert.match(r.err, /^aviso: código de objeto desconocido 999 en R4C3/m);
  assert.match(r.err, /^aviso: Ivy se considera la víctima por el texto de su pista/m);
  assert.match(
    (await run('info', OFFICIAL, '--annotations', ANN)).out,
    /Pistas oficiales: 2 · texto de solución oficial: 1 líneas · índice del asesino: 3/
  );
});

test('own puzzles: unknown object names are reported as warnings', async () => {
  await withTempDir(async dir => {
    const spec = JSON.parse(fs.readFileSync(TOY, 'utf8'));
    spec.objects.R2C2 = 'chiar';
    const file = path.join(dir, 'typo.json');
    fs.writeFileSync(file, JSON.stringify(spec));
    assert.match(
      (await run('info', file)).err,
      /^aviso: objeto desconocido "chiar" en R2C2: se trata como no ocupable/m
    );
  });
});

test('fetch validates the slug and the language before touching the network', async () => {
  await rejects(['fetch'], /falta el slug/);
  await rejects(['fetch', '../etc'], /slug no válido/);
  await rejects(['fetch', 'Preppers-Medium'], /slug no válido/);
  await rejects(['fetch', 'preppers-medium', '--lang', 'xx'], /idioma no válido/);
});
