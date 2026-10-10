'use strict';
// Board renderer: produces a self-contained SVG of the grid (areas, walls, objects, labels) with
// optional overlays (letters, circles, crosses, row/column bands). Dependency-free.

const PALETTE = [
  '#cde7c5',
  '#f6dfb3',
  '#bcd8f0',
  '#e9d3f2',
  '#f5c6c6',
  '#d9e5c0',
  '#ffe8a8',
  '#c9eef0',
  '#f0d2b8',
  '#dcdcdc',
  '#c8d6f5',
  '#e6f0b8',
  '#f7c8e2',
  '#d5f0d9',
  '#f3e2c0',
  '#c6e2e9',
  '#e2d2c3',
  '#d8c8f0',
  '#f5e1a4',
  '#cfe8dc',
];

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function abbr(name) {
  if (!name) return '';
  const w = name.split(/\s+/);
  return (w.length > 1 ? w.map(x => x[0]).join('') : name.slice(0, 4)).toUpperCase();
}

/**
 * @param P Puzzle
 * @param opts { cell: px (default 34), overlay: {cells:[{r,c,text,fill,circle,cross,textColor,small}], rows:[{r,fill}], cols:[{c,fill}]},
 *               crop: [r1,c1,r2,c2], legend: bool, title: string, placements: {Name: cell} (letters) }
 */
function renderSvg(P, opts = {}) {
  const cs = opts.cell ?? 34;
  const [r1, c1, r2, c2] = opts.crop || [1, 1, P.height, P.width];
  const ml = 34,
    mt = opts.title ? 48 : 26,
    mr = 10,
    mb = 10;
  const gw = (c2 - c1 + 1) * cs,
    gh = (r2 - r1 + 1) * cs;
  const legendH = opts.legend ? 18 * Math.ceil(P.mainAreaIds().length / 3) + 14 : 0;
  const W = ml + gw + mr,
    H = mt + gh + mb + legendH;
  const X = c => ml + (c - c1) * cs,
    Y = r => mt + (r - r1) * cs;
  const out = [];
  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Arial, Helvetica, sans-serif">`
  );
  out.push(`<rect width="${W}" height="${H}" fill="#fdfaeb"/>`);
  if (opts.title)
    out.push(`<text x="${ml}" y="20" font-size="15" font-weight="bold" fill="#333">${esc(opts.title)}</text>`);
  // cells
  const mainList = P.mainAreaIds();
  const colorOf = id => PALETTE[mainList.indexOf(id) % PALETTE.length];
  for (let r = r1; r <= r2; r++)
    for (let c = c1; c <= c2; c++) {
      const i = P.idx(r, c);
      out.push(
        `<rect x="${X(c)}" y="${Y(r)}" width="${cs}" height="${cs}" fill="${colorOf(P.areaOf(i))}" stroke="#9a9a9a" stroke-width="0.6"/>`
      );
      const o = P.objectAt(i);
      if (o) {
        if (!P.isFree(i))
          out.push(
            `<rect x="${X(c) + 1}" y="${Y(r) + 1}" width="${cs - 2}" height="${cs - 2}" fill="rgba(70,50,30,0.22)"/>`
          );
        out.push(
          `<text x="${X(c) + cs / 2}" y="${Y(r) + cs - 4}" font-size="${Math.max(7, cs * 0.26)}" text-anchor="middle" fill="#4a3a2a">${esc(abbr(o))}</text>`
        );
      }
      if (P.inFrontOfDoor(i))
        out.push(
          `<rect x="${X(c) + 3}" y="${Y(r) + 3}" width="${cs - 6}" height="${cs - 6}" fill="none" stroke="#c0507a" stroke-width="1.2" stroke-dasharray="3 2"/>`
        );
    }
  // row / column bands
  for (const b of (opts.overlay && opts.overlay.rows) || [])
    if (b.r >= r1 && b.r <= r2)
      out.push(
        `<rect x="${X(c1)}" y="${Y(b.r)}" width="${gw}" height="${cs}" fill="${b.fill || 'rgba(255,200,0,0.35)'}"/>`
      );
  for (const b of (opts.overlay && opts.overlay.cols) || [])
    if (b.c >= c1 && b.c <= c2)
      out.push(
        `<rect x="${X(b.c)}" y="${Y(r1)}" width="${cs}" height="${gh}" fill="${b.fill || 'rgba(255,200,0,0.35)'}"/>`
      );
  // walls: thick line where neighbouring raw areas differ, plus the outer border
  for (let r = r1; r <= r2; r++)
    for (let c = c1; c <= c2; c++) {
      const i = P.idx(r, c);
      const wall = (rr, cc) => !P.inside(rr, cc) || P.rawAreaOf(P.idx(rr, cc)) !== P.rawAreaOf(i);
      if (wall(r - 1, c))
        out.push(`<line x1="${X(c)}" y1="${Y(r)}" x2="${X(c) + cs}" y2="${Y(r)}" stroke="#111" stroke-width="3"/>`);
      if (wall(r + 1, c))
        out.push(
          `<line x1="${X(c)}" y1="${Y(r) + cs}" x2="${X(c) + cs}" y2="${Y(r) + cs}" stroke="#111" stroke-width="3"/>`
        );
      if (wall(r, c - 1))
        out.push(`<line x1="${X(c)}" y1="${Y(r)}" x2="${X(c)}" y2="${Y(r) + cs}" stroke="#111" stroke-width="3"/>`);
      if (wall(r, c + 1))
        out.push(
          `<line x1="${X(c) + cs}" y1="${Y(r)}" x2="${X(c) + cs}" y2="${Y(r) + cs}" stroke="#111" stroke-width="3"/>`
        );
    }
  // labels
  for (let r = r1; r <= r2; r++)
    out.push(`<text x="4" y="${Y(r) + cs * 0.62}" font-size="11" font-weight="bold" fill="#666">R${r}</text>`);
  for (let c = c1; c <= c2; c++)
    out.push(`<text x="${X(c) + 3}" y="${mt - 6}" font-size="11" font-weight="bold" fill="#666">C${c}</text>`);
  // placements (letters)
  const cells = [...((opts.overlay && opts.overlay.cells) || [])];
  if (opts.placements)
    for (const [nm, cell] of Object.entries(opts.placements)) {
      const ch = P.characters.find(x => x.name === nm);
      cells.push({
        r: P.row(cell),
        c: P.col(cell),
        text: ch && ch.role === 'treasure' ? 'T' : nm[0].toUpperCase(),
        circle: ch && ch.role === 'treasure' ? '#e63946' : ch && ch.role === 'victim' ? '#9bd1ff' : '#ffd166',
        textColor: ch && ch.role === 'treasure' ? '#fff' : '#000',
      });
    }
  for (const cl of cells) {
    if (cl.r < r1 || cl.r > r2 || cl.c < c1 || cl.c > c2) continue;
    const x = X(cl.c),
      y = Y(cl.r);
    if (cl.fill) out.push(`<rect x="${x}" y="${y}" width="${cs}" height="${cs}" fill="${cl.fill}"/>`);
    if (cl.border)
      out.push(
        `<rect x="${x + 1.5}" y="${y + 1.5}" width="${cs - 3}" height="${cs - 3}" fill="none" stroke="${cl.border}" stroke-width="2.5"/>`
      );
    if (cl.circle)
      out.push(
        `<circle cx="${x + cs / 2}" cy="${y + cs / 2}" r="${cs * 0.4}" fill="${cl.circle}" stroke="#111" stroke-width="1.5"/>`
      );
    if (cl.cross)
      out.push(
        `<line x1="${x + 6}" y1="${y + 6}" x2="${x + cs - 6}" y2="${y + cs - 6}" stroke="${cl.cross}" stroke-width="2.5"/><line x1="${x + 6}" y1="${y + cs - 6}" x2="${x + cs - 6}" y2="${y + 6}" stroke="${cl.cross}" stroke-width="2.5"/>`
      );
    if (cl.text)
      out.push(
        `<text x="${x + cs / 2}" y="${y + cs / 2 + (cl.small ? 3 : cs * 0.18)}" font-size="${cl.small ? Math.max(8, cs * 0.28) : cs * 0.52}" font-weight="bold" text-anchor="middle" fill="${cl.textColor || '#000'}">${esc(cl.text)}</text>`
      );
  }
  if (opts.legend) {
    let k = 0;
    for (const id of mainList) {
      const lx = ml + (k % 3) * (gw / 3),
        ly = mt + gh + 16 + Math.floor(k / 3) * 18;
      out.push(
        `<rect x="${lx}" y="${ly - 10}" width="12" height="12" fill="${colorOf(id)}" stroke="#333"/><text x="${lx + 16}" y="${ly}" font-size="11" fill="#333">${esc(P.areaName(id))} (${P.cellsOfArea(id).length})</text>`
      );
      k++;
    }
  }
  out.push('</svg>');
  return out.join('\n');
}

module.exports = { renderSvg };
