'use strict';
// Puzzle model: grid, areas, objects, characters. Cells are 0-based indices (row-major);
// rows/columns in the public API are 1-based (R1..Rh, C1..Cw) like in the puzzles.
const { OCCUPIABLE_BY_NAME } = require('./objects');

const DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]];

class Puzzle {
  constructor(spec) {
    this.name = spec.name || 'puzzle';
    this.objective = spec.objective || 'murder'; // 'murder' | 'treasure' | 'none'
    this.width = spec.width;
    this.height = spec.height;
    this.n = this.width * this.height;
    this.areaIds = spec.areaIds;                 // raw area id per cell
    this.areaNames = spec.areaNames;             // name per raw area id
    this.subareaOf = spec.subareaOf || new Map(); // raw id -> main id
    this.mainIds = this.areaIds.map(a => (this.subareaOf.has(a) ? this.subareaOf.get(a) : a));
    this.objects = spec.objects;                 // lower-case object name per cell, or null
    this.occupiableNames = spec.occupiableNames; // Set of lower-case names
    this.frontCells = spec.frontCells || [];     // [[cellA, cellB], ...] in front of doors/windows
    this.areaGroups = spec.areaGroups || {};     // group name -> [area names]
    this.characters = spec.characters;           // [{name, sex, attrs:Set, role, clue, constraints:[...]}]
    this.global = spec.global || [];             // global constraint specs
    this.meta = spec.meta || {};
    this._areaCells = new Map();
    for (let i = 0; i < this.n; i++) {
      const a = this.mainIds[i];
      if (!this._areaCells.has(a)) this._areaCells.set(a, []);
      this._areaCells.get(a).push(i);
    }
    this._front = new Set(this.frontCells.flat());
    this._nameIndex = new Map(this.characters.map((ch, k) => [ch.name.toLowerCase(), k]));
  }

  idx(r, c) { return (r - 1) * this.width + (c - 1); }
  row(i) { return Math.floor(i / this.width) + 1; }
  col(i) { return (i % this.width) + 1; }
  label(i) { return `R${this.row(i)}C${this.col(i)}`; }
  inside(r, c) { return r >= 1 && r <= this.height && c >= 1 && c <= this.width; }

  areaOf(i) { return this.mainIds[i]; }
  rawAreaOf(i) { return this.areaIds[i]; }
  areaName(id) { return this.areaNames[id] ?? `area ${id}`; }
  areaNameOf(i) { return this.areaName(this.mainIds[i]); }
  rawAreaNameOf(i) { return this.areaName(this.areaIds[i]); }
  cellsOfArea(id) { return this._areaCells.get(id) || []; }
  mainAreaIds() { return [...this._areaCells.keys()]; }

  objectAt(i) { return this.objects[i]; }
  isFree(i) { const o = this.objects[i]; return o === null || o === undefined || this.occupiableNames.has(o); }
  freeCells() { const out = []; for (let i = 0; i < this.n; i++) if (this.isFree(i)) out.push(i); return out; }
  allCells() { return Array.from({ length: this.n }, (_, i) => i); }

  neighbors(i) {
    const r = this.row(i), c = this.col(i), out = [];
    for (const [dr, dc] of DIRS) { const rr = r + dr, cc = c + dc; if (this.inside(rr, cc)) out.push(this.idx(rr, cc)); }
    return out;
  }
  /** Orthogonally adjacent and in the same (main) area: the official meaning of "beside". */
  sameAreaNeighbors(i) { return this.neighbors(i).filter(j => this.mainIds[j] === this.mainIds[i]); }
  besideObject(i, name) { return this.sameAreaNeighbors(i).some(j => this.objects[j] === name); }
  besideCell(i, j) { return this.mainIds[i] === this.mainIds[j] && this.neighbors(i).includes(j); }
  besideArea(i, matcher) { return this.neighbors(i).some(j => matcher(this.mainIds[j]) || matcher(this.areaIds[j])); }
  inFrontOfDoor(i) { return this._front.has(i); }
  areaHasObject(id, name) { return this.cellsOfArea(id).some(j => this.objects[j] === name); }
  cellsWithObject(name) { const out = []; for (let i = 0; i < this.n; i++) if (this.objects[i] === name) out.push(i); return out; }
  columnHasObject(c, name) { for (let r = 1; r <= this.height; r++) if (this.objects[this.idx(r, c)] === name) return true; return false; }
  rowHasObject(r, name) { for (let c = 1; c <= this.width; c++) if (this.objects[this.idx(r, c)] === name) return true; return false; }
  topRowOfArea(id) { return Math.min(...this.cellsOfArea(id).map(i => this.row(i))); }
  bottomRowOfArea(id) { return Math.max(...this.cellsOfArea(id).map(i => this.row(i))); }
  leftColOfArea(id) { return Math.min(...this.cellsOfArea(id).map(i => this.col(i))); }
  rightColOfArea(id) { return Math.max(...this.cellsOfArea(id).map(i => this.col(i))); }
  /** A cell is a corner of its area when a vertical and a horizontal neighbour both lie outside the area (or off-grid). */
  isAreaCorner(i) {
    const r = this.row(i), c = this.col(i), a = this.mainIds[i];
    const out = (rr, cc) => !this.inside(rr, cc) || this.mainIds[this.idx(rr, cc)] !== a;
    return (out(r - 1, c) || out(r + 1, c)) && (out(r, c - 1) || out(r, c + 1));
  }
  isGridCorner(i) { const r = this.row(i), c = this.col(i); return (r === 1 || r === this.height) && (c === 1 || c === this.width); }

  /**
   * Build a matcher for an area specification: exact name, a "kind" (e.g. "Cabin" matches "Cabin A",
   * "Habitat" matches "Bear Habitat") or a group defined in areaGroups (e.g. "ship").
   */
  areaMatcher(spec) {
    const s = String(spec).trim().toLowerCase();
    const group = Object.entries(this.areaGroups).find(([g]) => g.toLowerCase() === s);
    const groupNames = group ? new Set(group[1].map(x => x.toLowerCase())) : null;
    const ok = new Set();
    this.areaNames.forEach((name, id) => {
      const n = (name || '').toLowerCase();
      if (!n) return;
      if (n === s || n.startsWith(s + ' ') || n.endsWith(' ' + s) || (groupNames && groupNames.has(n))) ok.add(id);
    });
    return id => ok.has(id);
  }
  /** Main area ids matching a spec (through main or raw names). */
  areasMatching(spec) {
    const m = this.areaMatcher(spec), out = new Set();
    for (let i = 0; i < this.n; i++) if (m(this.mainIds[i]) || m(this.areaIds[i])) out.add(this.mainIds[i]);
    return out;
  }
  /** Cells whose raw or main area matches the spec. */
  cellsMatchingArea(spec) {
    const m = this.areaMatcher(spec), out = [];
    for (let i = 0; i < this.n; i++) if (m(this.mainIds[i]) || m(this.areaIds[i])) out.push(i);
    return out;
  }

  charIndex(name) {
    const k = this._nameIndex.get(String(name).toLowerCase());
    if (k === undefined) throw new Error(`Unknown character: ${name}`);
    return k;
  }
  charsWith(filter = {}) {
    return this.characters.map((ch, k) => k).filter(k => {
      const ch = this.characters[k];
      if (filter.sex && ch.sex !== filter.sex) return false;
      if (filter.attr && !ch.attrs.has(filter.attr)) return false;
      if (filter.group && !ch.attrs.has(filter.group)) return false;
      return true;
    });
  }
  isPerson(k) { return this.characters[k].role !== 'treasure'; }
}

/** Normalise an object name as used in puzzle files and clue specs. */
function normObj(name) { return name == null ? null : String(name).trim().toLowerCase(); }

/** Default occupiable set: official table plus the generic ones used in hand-written puzzles. */
function defaultOccupiable(extra = []) {
  const s = new Set();
  for (const [name, occ] of OCCUPIABLE_BY_NAME) if (occ) s.add(name);
  for (const e of extra) s.add(normObj(e));
  return s;
}

module.exports = { Puzzle, normObj, defaultOccupiable, DIRS };
