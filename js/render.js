// Pixel renderer: the island is drawn in cached 256x256 chunks (32x32 tiles of 8 px = 4 m).
import { W, G, S, SEA, CH, surfT, pidT, objT, hT, isWaterT, keyOf, chunksBld, chunksFeat, chunksRail, hAt, featHeight, lakeLevel, inLake } from "./data.js";

export const PX = 2;                 // pixels per metre on the ground
export const TP = 8;                 // pixels per tile
export const CP = CH * TP;           // pixels per chunk (256)
const DIFF_RGB = { green: [60, 180, 75], blue: [40, 110, 230], black: [20, 20, 24], dbl: [220, 40, 40], park: [235, 120, 30], "": [150, 110, 70] };
export { DIFF_RGB };

// world metres <-> global pixels
export const gx = x => (x - G.x0) * PX + TP / 2;
export const gy = z => (z - G.z0) * PX + TP / 2;
export const wx = px => G.x0 + (px - TP / 2) / PX;
export const wz = py => G.z0 + (py - TP / 2) / PX;

const pack = (r, g, b) => (255 << 24) | ((b & 255) << 16) | ((g & 255) << 8) | (r & 255);
const cl = v => v < 0 ? 0 : v > 255 ? 255 : v | 0;
const mul = (c, f) => pack(cl(c[0] * f), cl(c[1] * f), cl(c[2] * f));
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
function hash(i, j) { let h = (i * 374761393 + j * 668265263) | 0; h = (h ^ (h >>> 13)) * 1274126177 | 0; return (h ^ (h >>> 16)) >>> 0; }
const rnd = (i, j) => (hash(i, j) & 0xffff) / 65536;
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map(v => (v + 0.5) / 16);

// ---------- ground colours
const BASE = {
  grass: [92, 166, 66], field: [148, 176, 78], dirt: [104, 112, 62], trail: [170, 126, 82], river: [74, 146, 212],
  gravel: [150, 142, 122], snow: [232, 238, 248], run: [246, 249, 255], park: [196, 198, 204], snowlane: [238, 242, 250],
  sand: [232, 212, 150], sandlane: [214, 194, 142], asphalt: [74, 76, 82], concrete: [178, 178, 172], cobble: [152, 132, 116],
};
const ROCK = [128, 124, 118], ROCK_SNOW = [150, 156, 170];
const SNOWSH = [150, 172, 214];
const SHADE = [0.66, 0.82, 1.0, 1.1];
const HARD = new Set(["asphalt", "concrete", "cobble", "park", "sandlane"]);
const NATURAL = new Set(["grass", "field", "dirt", "snow", "sand", "gravel"]);
const LX = -0.5, LY = 1.0, LZ = -0.62, LN = Math.hypot(LX, LY, LZ), LAM0 = LY / LN;

let SN = null;   // surface names by index
function sname(s) { return s === SEA ? "sea" : SN[s]; }

function tileInfo(i, j) {
  const h = hT(i, j);
  const dx = (hT(i + 1, j) - hT(i - 1, j)) / 8, dz = (hT(i, j + 1) - hT(i, j - 1)) / 8;
  const n = Math.hypot(dx, 1, dz);
  const lam = (-dx * LX + LY - dz * LZ) / (n * LN);
  const lev = Math.max(0, Math.min(3, 2 + (lam - LAM0) * 9));
  return { h, slope: Math.hypot(dx, dz), lev };
}

function waterCol(depth, lake) {
  if (lake) return depth < 1.2 ? [96, 178, 200] : depth < 4 ? [64, 140, 196] : [44, 104, 176];
  return depth < 1.0 ? [110, 206, 214] : depth < 3 ? [72, 176, 210] : depth < 8 ? [48, 136, 200] : depth < 20 ? [36, 100, 180] : [28, 74, 150];
}

// ---------- sprites for trees and small objects: letters index a per-sprite palette
const SPR = {
  pine: { a: [4, 13], p: { g: [44, 110, 52], G: [70, 140, 70], t: [96, 66, 40] }, r: [
    "....g....", "...ggg...", "...gGg...", "..ggggg..", "..gGgGg..", "...ggg...", "..ggggg..", ".gGgggGg.", ".ggggggg.", "..ggggg..",
    ".ggggggg.", "gGgggggGg", "ggggggggg", "....t...."] },
  spruce: { a: [4, 13], p: { g: [32, 84, 62], G: [52, 112, 84], t: [86, 60, 40] }, r: [
    "....g....", "....g....", "...ggg...", "...gGg...", "..ggggg..", "...ggg...", "..gGggg..", ".ggggggg.", "..ggggg..", ".gggGggg.",
    "ggggggggg", ".ggggggg.", "....t....", "....t...."] },
  tallpine: { a: [4, 17], p: { g: [38, 96, 50], G: [62, 128, 66], t: [96, 66, 40] }, r: [
    "....g....", "...ggg...", "...gGg...", "..ggggg..", "...ggg...", "..gGggg..", ".ggggggg.", "..ggggg..", ".ggGgggg.", "ggggggggg",
    "..ggggg..", ".gggggGg.", "ggggggggg", "ggGgggggg", "....t....", "....t....", "....t....", "....t...."] },
  snowpine: { a: [4, 13], p: { g: [40, 96, 62], G: [60, 124, 80], w: [244, 248, 255], t: [90, 64, 44] }, r: [
    "....w....", "...www...", "...gwg...", "..wwwww..", "..ggggg..", "...www...", "..wwgww..", ".gggggGg.", ".ggggggg.", "..wwwww..",
    ".wwwgwww.", "gggggggGg", "ggggggggg", "....t...."] },
  oak: { a: [5, 11], p: { g: [58, 128, 50], G: [92, 160, 66], d: [40, 96, 40], t: [100, 70, 44] }, r: [
    "...gggg....", "..gGGggg...", ".gGGgggGg..", "ggGgggGGgg.", "gggggggGggg", "ggdgggggggg", ".gggdggdgg.", "..gdggggd..", "....ttd....", "....tt.....",
    "....tt....."] },
  broad: { a: [5, 10], p: { g: [70, 140, 58], G: [104, 172, 74], d: [48, 104, 44], t: [100, 70, 44] }, r: [
    "...ggggg...", ".ggGGgggg..", "gggGgggGgg.", "ggggggggggg", "gdgggggdggg", ".ggdggggdg.", "...gggdg...", "....tt.....", "....tt....", "....tt...."] },
  birch: { a: [3, 11], p: { g: [120, 176, 70], G: [160, 204, 90], t: [236, 236, 228], k: [40, 40, 40] }, r: [
    "..ggg..", ".gGggg.", "ggGgggg", "gggggGg", ".ggggg.", "..gtg..", "...t...", "...k...", "...t...", "...t...", "...k...", "...t..."] },
  palm: { a: [4, 13], p: { g: [60, 150, 60], G: [100, 190, 80], t: [150, 110, 70], d: [120, 86, 54] }, r: [
    "g.G...g..", ".gGg.gG..", "gg.ggg.gg", "...gGg...", "..g.t.g..", ".g..t..g.", "....t....", "....d....", "....t....", "...t.....", "...d.....",
    "...t.....", "...t.....", "...d....."] },
  bush: { a: [3, 3], p: { g: [60, 130, 54], G: [90, 160, 70] }, r: [".gGg...", "ggggGg.", "gggggg.", ".gggg.."] },
  rock: { a: [3, 4], p: { r: [128, 126, 122], R: [170, 168, 162], d: [92, 90, 88] }, r: ["..RR...", ".RRrr..", "Rrrrrd.", "rrrrddd", ".dddd.."] },
  grass: { a: [2, 2], p: { g: [60, 130, 50], G: [100, 170, 70] }, r: ["G.g.G", ".gGg.", "g.g.g"] },
  lamp: { a: [1, 10], p: { k: [60, 62, 70], y: [255, 236, 150] }, r: ["kkk", "kyk", ".k.", ".k.", ".k.", ".k.", ".k.", ".k.", ".k.", ".k.", "kkk"] },
  umbrella: { a: [3, 6], p: { r: [230, 70, 70], w: [250, 250, 250], k: [90, 80, 70] }, r: ["..rwr..", ".rwrwr.", "rwrwrwr", "...k...", "...k...", "...k...", "...k..."] },
};
const OBJ_SPR = [null, "snowpine", "tallpine", "pine", "spruce", "oak", "broad", "birch", "palm", "bush", "rock", "grass", "lamp", "umbrella"];
// precompile to packed colours
for (const k in SPR) {
  const s = SPR[k]; s.h = s.r.length; s.w = Math.max(...s.r.map(r => r.length));
  s.px = s.r.map(row => [...row].map(ch => ch === "." ? 0 : pack(...s.p[ch])));
}
export { SPR };

// ---------- chunk cache
const cache = new Map(); const order = [];
const MAXC = 90;
// tall objects (trees, lamps, umbrellas) stand up on their own in the turning view; low ones stay in the ground
export const UPRIGHT = new Set([1, 2, 3, 4, 5, 6, 7, 8, 12, 13]);
let FLAT = false;                 // drawing a chunk for the turning view: everything seen straight from above
const sprCv = {};
// a canvas of an object sprite plus its anchor, for drawing it standing up
export function objSprite(o) {
  const name = OBJ_SPR[o]; const sp = SPR[name]; if (!sp) return null;
  if (sprCv[name]) return sprCv[name];
  const c = document.createElement("canvas"); c.width = sp.w; c.height = sp.h;
  const g = c.getContext("2d"), im = g.createImageData(sp.w, sp.h), b = new Uint32Array(im.data.buffer);
  for (let r = 0; r < sp.h; r++) for (let q = 0; q < sp.px[r].length; q++) if (sp.px[r][q]) b[r * sp.w + q] = sp.px[r][q];
  g.putImageData(im, 0, 0);
  return (sprCv[name] = { cv: c, ax: sp.a[0], ay: sp.a[1], lamp: name === "lamp" });
}
// where an object stands inside its tile (world pixel coords), same as the chunk renderer uses
export function objBase(i, j) { const hh = hash(i, j); return [i * TP + 4 + ((hh & 3) - 1), j * TP + 6 + (((hh >> 2) & 3) - 1)]; }
export function chunkCanvas(ci, cj, flat = false) {
  const k = flat ? keyOf(ci, cj) + "|f" : keyOf(ci, cj);
  let c = cache.get(k);
  if (c) return c;
  FLAT = flat;
  try { c = renderChunk(ci, cj); } finally { FLAT = false; }
  cache.set(k, c); order.push(k);
  if (order.length > MAXC) { const old = order.shift(); cache.delete(old); }
  return c;
}
export const hasChunk = (ci, cj) => cache.has(keyOf(ci, cj));
export function clearChunks() { cache.clear(); order.length = 0; }

function renderChunk(ci, cj) {
  if (!SN) SN = G.surfaces;
  const img = new ImageData(CP, CP);
  const buf = new Uint32Array(img.data.buffer);
  const i0 = ci * CH, j0 = cj * CH, ox = i0 * TP, oy = j0 * TP;
  const LAKE = lakeLevel();
  // shading levels at tile centres (one tile of margin) for smooth per-pixel blending
  const LV = new Float32Array((CH + 2) * (CH + 2));
  for (let b = 0; b < CH + 2; b++) for (let a = 0; a < CH + 2; a++) LV[b * (CH + 2) + a] = tileInfo(i0 + a - 1, j0 + b - 1).lev;
  const levAt = (px, py) => {
    const fx = (px - ox - 3.5) / TP + 1, fy = (py - oy - 3.5) / TP + 1;
    const a = Math.max(0, Math.min(CH, Math.floor(fx))), b = Math.max(0, Math.min(CH, Math.floor(fy)));
    const u = Math.max(0, Math.min(1, fx - a)), v = Math.max(0, Math.min(1, fy - b)), R_ = CH + 2;
    return (LV[b * R_ + a] * (1 - u) + LV[b * R_ + a + 1] * u) * (1 - v) + (LV[(b + 1) * R_ + a] * (1 - u) + LV[(b + 1) * R_ + a + 1] * u) * v;
  };
  // roads and trails from their centre lines, pixel by pixel (1 = road, 2 = trail)
  const M = new Uint8Array(CP * CP);
  for (const p of W.paths) {
    if (p.k !== "road" && p.k !== "trail") continue;
    if (!bboxHit(p, ox, oy)) continue;
    const hw = (p.k === "road" ? p.w / 2 : Math.max(1.6, p.w / 2)) * PX, val = p.k === "road" ? 1 : 2;
    for (let k = 0; k + 1 < p.p.length; k++) {
      const ax = gx(p.p[k][0]) - ox, ay = gy(p.p[k][1]) - oy, bx = gx(p.p[k + 1][0]) - ox, by = gy(p.p[k + 1][1]) - oy;
      const x0 = Math.max(0, Math.floor(Math.min(ax, bx) - hw)), x1 = Math.min(CP - 1, Math.ceil(Math.max(ax, bx) + hw));
      const y0 = Math.max(0, Math.floor(Math.min(ay, by) - hw)), y1 = Math.min(CP - 1, Math.ceil(Math.max(ay, by) + hw));
      if (x0 > x1 || y0 > y1) continue;
      const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy || 1;
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        let t = ((x + 0.5 - ax) * dx + (y + 0.5 - ay) * dy) / L2; t = t < 0 ? 0 : t > 1 ? 1 : t;
        const ex = ax + dx * t - x - 0.5, ey = ay + dy * t - y - 0.5;
        if (ex * ex + ey * ey <= hw * hw && (M[y * CP + x] === 0 || val === 1)) M[y * CP + x] = val;
      }
    }
  }
  const mAt = (u, v) => (u < 0 || v < 0 || u >= CP || v >= CP) ? 255 : M[v * CP + u];
  // ---- ground
  for (let tj_ = 0; tj_ < CH; tj_++) for (let ti_ = 0; ti_ < CH; ti_++) {
    const i = i0 + ti_, j = j0 + tj_;
    const s = surfT(i, j); const nm = sname(s);
    const inf = tileInfo(i, j);
    const water = isWaterT(i, j);
    let base, mode0 = nm;
    if (water) {
      const lake = s !== SEA && nm !== "river";
      const depth = (lake ? LAKE : 0) - inf.h;
      base = nm === "river" ? BASE.river : waterCol(depth, lake); mode0 = "water";
    } else {
      base = BASE[nm] || BASE.grass;
      if (nm === "park" && inf.h > 40) { base = BASE.run; mode0 = "run"; }
      if (NATURAL.has(nm) && inf.slope > (nm === "snow" ? 1.05 : 1.45)) { base = nm === "snow" ? ROCK_SNOW : ROCK; mode0 = "rock"; }
    }
    // a road or trail tile outside the drawn line shows the ground around it
    let fbBase = null, fbMode = null;
    if (!water && (nm === "asphalt" || nm === "trail")) {
      const cnt = {};
      for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1], [2, 0], [-2, 0], [0, 2], [0, -2]]) {
        const n2 = sname(surfT(i + a, j + b)); if (n2 && n2 !== nm && n2 !== "sea" && BASE[n2] && !isWaterT(i + a, j + b)) cnt[n2] = (cnt[n2] || 0) + 1;
      }
      let bm = null; for (const k in cnt) if (!bm || cnt[k] > cnt[bm]) bm = k;
      fbMode = bm || (nm === "trail" ? "dirt" : "grass"); fbBase = BASE[fbMode];
    }
    const snowy0 = mode0 === "snow" || mode0 === "run" || mode0 === "snowlane";
    // contour ledge to the south (Pokemon-style terraces)
    let ledge = false;
    if (!water && (NATURAL.has(nm) || mode0 === "rock")) {
      const hs = hT(i, j + 1);
      if (Math.floor(inf.h / 20) > Math.floor(hs / 20) && inf.h - hs > 0.8 && !isWaterT(i, j + 1)) ledge = true;
    }
    // neighbours for edges
    const nS = sname(surfT(i, j + 1)), nN = sname(surfT(i, j - 1)), nE = sname(surfT(i + 1, j)), nWs = sname(surfT(i - 1, j));
    const landNear = water && (!isWaterT(i + 1, j) || !isWaterT(i - 1, j) || !isWaterT(i, j + 1) || !isWaterT(i, j - 1));
    for (let v = 0; v < TP; v++) for (let u = 0; u < TP; u++) {
      const px = ox + ti_ * TP + u, py = oy + tj_ * TP + v;   // global pixel
      const lev = levAt(px, py);
      const b = BAYER[(py & 3) * 4 + (px & 3)];
      let L = Math.floor(lev) + ((lev - Math.floor(lev)) > b ? 1 : 0); if (L > 3) L = 3; if (L < 0) L = 0;
      // pixel-level roads and trails
      const mv = M[(py - oy) * CP + (px - ox)];
      let mode = mode0, base_ = base;
      if (fbMode && !(nm === "asphalt" ? mv === 1 : mv >= 1)) { mode = fbMode; base_ = fbBase; }
      else if (mv === 1 && !water && NATURAL.has(nm)) { mode = "asphalt"; base_ = BASE.asphalt; }
      else if (mv === 2 && !water && (nm === "grass" || nm === "field" || nm === "dirt" || nm === "gravel")) { mode = "trail"; base_ = BASE.trail; }
      const snowy = mode === "snow" || mode === "run" || mode === "snowlane";
      let c = base_, f = SHADE[L];
      const r = rnd(px, py);
      switch (mode) {
        case "grass": if (r < 0.08) f *= 0.86; else if (r > 0.985) f *= 1.12; if (inf.h < 60 && r > 0.9975) c = r > 0.9988 ? [250, 230, 90] : [250, 250, 250]; break;
        case "field": if ((py % 6) < 2) f *= 1.07; break;
        case "dirt": case "trail": if (r < 0.14) f *= 0.84; else if (r > 0.96) f *= 1.1; break;
        case "gravel": if (r < 0.2) f *= 0.82; else if (r > 0.8) f *= 1.12; break;
        case "sand": case "sandlane": if (r < 0.1) f *= 0.9; else if (r > 0.97) f *= 1.06; break;
        case "asphalt": if (r < 0.08) f *= 1.15; break;
        case "concrete": if (px % 16 === 0 || py % 16 === 0) f *= 0.88; break;
        case "park": if (px % 32 === 0 || py % 32 === 0) f *= 0.86; break;
        case "cobble": { const row = Math.floor(py / 4); if (py % 4 === 0 || (px + (row & 1) * 3) % 6 === 0) f *= 0.8; else if (r < 0.2) f *= 0.92; break; }
        case "rock": if ((py + Math.floor(px / 5)) % 5 === 0) f *= 0.84; else if (r < 0.1) f *= 0.9; break;
        case "run": if (py % 3 === 0) f *= 0.97; break;
        case "water": f = 1; if ((px + 2 * py + Math.floor(py / 3)) % 29 === 0) f = 1.12; if (landNear && r < 0.3) c = [236, 248, 250]; break;
      }
      if (snowy) {          // snow shadows go blue instead of grey
        const t = L === 0 ? 0.55 : L === 1 ? 0.25 : 0;
        c = mix(c, SNOWSH, t); f = L >= 2 ? (L === 3 ? 1.02 : 1) : 1;
        if (mode === "snow" && r > 0.992) f = 1.06;
      }
      // edges: kerbs along roads, darker rims on trails and runs
      if (mode === "asphalt" && mv === 1) {
        const U = px - ox, V = py - oy;
        const edge = (q) => q !== 1 && q !== 255;
        if (edge(mAt(U + 1, V)) || edge(mAt(U - 1, V)) || edge(mAt(U, V + 1)) || edge(mAt(U, V - 1))) {
          const t2 = sname(surfT(Math.floor(px / TP), Math.floor(py / TP)));
          if (!HARD.has(t2) || t2 === "asphalt") { c = [190, 190, 186]; f = 1; }
        }
      } else if (mode === "trail" && mv === 2) {
        const U = px - ox, V = py - oy;
        if (mAt(U + 1, V) === 0 || mAt(U - 1, V) === 0 || mAt(U, V + 1) === 0 || mAt(U, V - 1) === 0) f *= 0.8;
      }
      buf[(py - oy) * CP + (px - ox)] = mul(c, f);
    }
  }
  const lb = new Uint32Array(CP * CP);          // night-lights layer: lit pixels, cleared again by anything drawn in front
  const ctx = { buf, ox, oy, lb, lit: 0 };
  // ---- road centre lines
  for (const p of W.paths) {
    if (p.k !== "road" || p.w < 8) continue;
    if (!bboxHit(p, ox, oy)) continue;
    const col = p.c === 1 ? pack(235, 235, 225) : pack(240, 200, 60);
    linePath(ctx, p.p, 0, (x, y, d) => { if ((d % 12) < 6) setIfSurf(ctx, x, y, col, "asphalt"); });
  }
  // ---- objects sorted by base row
  const items = [];
  for (let j = j0 - 1; j < j0 + CH + 4; j++) for (let i = i0 - 2; i < i0 + CH + 2; i++) {
    const o = objT(i, j);
    if (o > 0 && o < OBJ_SPR.length) items.push({ y: j * TP + 6, kind: 0, i, j, o });
    const pid = pidT(i, j);
    if (pid && i >= i0 && i < i0 + CH && j >= j0 && j < j0 + CH) {
      const P = W.paths[pid - 1];
      if (P && (P.k === "run" || P.k === "trail") && (hash(i, j) % 7 === 0)) {
        const edge = pidT(i + 1, j) === 0 || pidT(i - 1, j) === 0 || pidT(i, j + 1) === 0 || pidT(i, j - 1) === 0;
        if (edge && o === 0) items.push({ y: j * TP + 5, kind: 3, i, j, P });
      }
    }
  }
  for (const b of chunksBld.get(keyOf(ci, cj)) || []) items.push({ y: gy(b[1]) + Math.hypot(b[2], b[3]) * 0.5, kind: 1, b });
  for (const f of chunksFeat.get(keyOf(ci, cj)) || []) items.push({ y: gy(f.z) - 1000, kind: 2, f });   // ground features first
  for (const r of chunksRail.get(keyOf(ci, cj)) || []) items.push({ y: Math.max(gy(r.z1), gy(r.z2)) - 999, kind: 4, r });
  items.sort((a, b) => a.y - b.y);
  for (const it of items) {
    if (it.kind === 0) drawObj(ctx, it.i, it.j, it.o);
    else if (it.kind === 1) drawBuilding(ctx, it.b);
    else if (it.kind === 2) drawFeature(ctx, it.f);
    else if (it.kind === 3) drawMarker(ctx, it.i, it.j, it.P);
    else if (it.kind === 4) drawRail(ctx, it.r);
  }
  // ---- run and trail head signs, lift lines
  for (const p of W.paths) {
    if (p.k !== "run" && p.k !== "trail") continue;
    const [x, z] = p.p[0];
    const sx = Math.round(gx(x)) + 6, sy = Math.round(gy(z)) - 2;
    if (sx < ox - 10 || sx > ox + CP + 10 || sy < oy - 4 || sy > oy + CP + 16) continue;
    drawSign(ctx, sx, sy, p.d, p.k);
  }
  for (const L of W.lifts) drawLift(ctx, L);
  const cv = document.createElement("canvas"); cv.width = CP; cv.height = CP;
  cv.getContext("2d").putImageData(img, 0, 0);
  cv._lb = ctx.lit ? lb : null;          // turned into a canvas the first time it is night here
  return cv;
}
// the night-lights layer for a chunk (null when nothing glows there)
export function lightsCanvas(ci, cj, flat = false) {
  const c = chunkCanvas(ci, cj, flat);
  if (c._lc !== undefined) return c._lc;
  if (!c._lb) { c._lc = null; return null; }
  const lc = document.createElement("canvas"); lc.width = CP; lc.height = CP;
  lc.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(c._lb.buffer), CP, CP), 0, 0);
  c._lc = lc; c._lb = null; return lc;
}

function bboxHit(p, ox, oy) {
  if (!p._bb) {
    let a = 1e9, b = 1e9, c = -1e9, d = -1e9;
    for (const [x, z] of p.p) { a = Math.min(a, x); b = Math.min(b, z); c = Math.max(c, x); d = Math.max(d, z); }
    p._bb = [gx(a) - 20, gy(b) - 20, gx(c) + 20, gy(d) + 20];
  }
  const B = p._bb; return !(B[2] < ox || B[0] > ox + CP || B[3] < oy || B[1] > oy + CP);
}
function linePath(ctx, pts, lift, fn) {
  let d = 0;
  for (let k = 0; k + 1 < pts.length; k++) {
    const x0 = gx(pts[k][0]), y0 = gy(pts[k][1]), x1 = gx(pts[k + 1][0]), y1 = gy(pts[k + 1][1]);
    const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0));
    for (let s = 0; s < n; s++) { fn(Math.round(x0 + (x1 - x0) * s / n), Math.round(y0 + (y1 - y0) * s / n - lift), d); d++; }
  }
}
function put(ctx, x, y, col, lit = 0) {
  const u = x - ctx.ox, v = y - ctx.oy;
  if (u < 0 || v < 0 || u >= CP || v >= CP) return;
  ctx.buf[v * CP + u] = col;
  if (ctx.lb) { ctx.lb[v * CP + u] = lit; if (lit) ctx.lit++; }
}
// soft glow pixels in the lights layer (never darker than what is there)
function glowPx(ctx, x, y, r, g, b, a) {
  const u = x - ctx.ox, v = y - ctx.oy;
  if (!ctx.lb || u < 0 || v < 0 || u >= CP || v >= CP) return;
  const old = ctx.lb[v * CP + u] >>> 24;
  if (old >= a) return;
  ctx.lb[v * CP + u] = ((a << 24) | (b << 16) | (g << 8) | r) >>> 0; ctx.lit++;
}
function lampGlow(ctx, x, y) {
  for (let dy = -9; dy <= 9; dy++) for (let dx = -9; dx <= 9; dx++) {
    const d = Math.hypot(dx, dy * 1.4); if (d > 9) continue;
    glowPx(ctx, x + dx, y + dy, 255, 214, 130, Math.round(70 * (1 - d / 9)));
  }
}
const LIT_A = [255, 214, 120], LIT_B = [255, 236, 170], LIT_C = [240, 180, 90];
const packA = c => ((255 << 24) | (c[2] << 16) | (c[1] << 8) | c[0]) >>> 0;
function darken(ctx, x, y, f) {
  const u = x - ctx.ox, v = y - ctx.oy;
  if (u < 0 || v < 0 || u >= CP || v >= CP) return;
  const c = ctx.buf[v * CP + u];
  ctx.buf[v * CP + u] = pack((c & 255) * f, ((c >> 8) & 255) * f, ((c >> 16) & 255) * f);
}
function setIfSurf(ctx, x, y, col, nm) {
  const i = Math.floor(x / TP), j = Math.floor(y / TP);
  if (sname(surfT(i, j)) === nm) put(ctx, x, y, col);
}

function drawObj(ctx, i, j, o) {
  const name = OBJ_SPR[o]; const s = SPR[name]; if (!s) return;
  const hh = hash(i, j);
  const bx = i * TP + 4 + ((hh & 3) - 1), by = j * TP + 6 + (((hh >> 2) & 3) - 1);
  const x0 = bx - s.a[0], y0 = by - s.a[1];
  if (name !== "grass" && name !== "lamp") {     // soft shadow to the south-east
    for (let dy = -1; dy <= 1; dy++) for (let dx = -2; dx <= 3; dx++) if (Math.abs(dx - 0.5) + Math.abs(dy) * 2 < 4) darken(ctx, bx + dx + 1, by + dy + 1, 0.78);
  }
  if (FLAT && UPRIGHT.has(o)) {
    // the object itself is drawn standing up each frame; keep a bigger round shadow under trees and the lamp's light pool
    if (name === "lamp") { for (let dy = -4; dy <= 4; dy++) for (let dx = -8; dx <= 8; dx++) { const d = Math.hypot(dx / 8, dy / 4); if (d < 1) glowPx(ctx, bx + dx, by + dy, 255, 220, 140, Math.round(70 * (1 - d))); } }
    else for (let dy = -2; dy <= 2; dy++) for (let dx = -3; dx <= 3; dx++) if (dx * dx / 9 + dy * dy / 4 < 1) darken(ctx, bx + dx, by + dy, 0.82);
    return;
  }
  const isLamp = name === "lamp";
  for (let r = 0; r < s.h; r++) {
    const row = s.px[r];
    for (let c = 0; c < row.length; c++) if (row[c]) put(ctx, x0 + c, y0 + r, row[c], isLamp && r === 1 && c === 1 ? packA([255, 244, 190]) : 0);
  }
  if (isLamp) { lampGlow(ctx, x0 + 1, y0 + 1); for (let dy = -3; dy <= 3; dy++) for (let dx = -6; dx <= 6; dx++) { const d = Math.hypot(dx / 6, dy / 3); if (d < 1) glowPx(ctx, bx + dx, by + dy, 255, 220, 140, Math.round(60 * (1 - d))); } }
}

// buildings in 3/4 view: roof shifted up by the height, front wall below it
const ROOFS = [[160, 72, 52], [96, 98, 108], [124, 84, 58], [70, 118, 120], [180, 96, 64], [110, 62, 50]];
const WALL_STYLE = { brick: [170, 86, 64], glass: [120, 164, 206], concrete: [176, 176, 170], timber: [132, 86, 52], chalet: [128, 82, 48], stone: [152, 146, 136] };
function hex(h) { return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]; }
export function drawBuildingPx(put_, b, override) {
  const [x, z, w, d, h, ry, style, roof, colhex, snow, tiers] = b;
  const ux = [Math.cos(ry), -Math.sin(ry)], uz = [Math.sin(ry), Math.cos(ry)];
  const cx = gx(x), cy = gy(z);
  const C = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, c]) => [cx + (ux[0] * a * w / 2 + uz[0] * c * d / 2) * PX, cy + (ux[1] * a * w / 2 + uz[1] * c * d / 2) * PX]);
  const hpx = override?.flat ? 0 : Math.max(2, Math.round(h * (override?.hk ?? 1)));
  let wall = override?.wall || WALL_STYLE[style] || hex(colhex);
  const hh = hash(Math.round(x), Math.round(z));
  let rc = override?.roof || (style === "mission" ? [196, 104, 64] : roof === "flat" ? (style === "glass" ? [96, 102, 112] : [150, 150, 146]) : roof === "chalet" ? [92, 60, 42] :
    (style === "stucco" || style === "beach") ? [190, 104, 70] : ROOFS[hh % ROOFS.length]);
  const flat = (roof === "flat" || roof === "stadium" || roof === "tower") && !override?.gable;
  const ridgeAlongX = w >= d;
  const minX = Math.floor(Math.min(...C.map(c => c[0]))), maxX = Math.ceil(Math.max(...C.map(c => c[0])));
  let prevYmax = null;
  for (let X = minX; X <= maxX; X++) {
    const xs = X + 0.5; let ymin = 1e9, ymax = -1e9;
    for (let k = 0; k < 4; k++) {
      const [ax, ay] = C[k], [bx, by] = C[(k + 1) % 4];
      if ((xs - ax) * (xs - bx) > 0 || ax === bx) continue;
      const t = (xs - ax) / (bx - ax), y = ay + (by - ay) * t;
      ymin = Math.min(ymin, y); ymax = Math.max(ymax, y);
    }
    if (ymin > ymax) continue;
    const y0 = Math.round(ymin), y1 = Math.round(ymax);
    const slope = prevYmax == null ? 0 : y1 - prevYmax; prevYmax = y1;
    const wallF = slope > 0 ? 1.0 : slope < 0 ? 0.78 : 0.9;
    for (let Y = y0 - hpx; Y <= y1; Y++) {
      if (Y <= y1 - hpx) {
        // roof pixel: find its ground point to shade gable sides
        const gpx = (X + 0.5 - cx) / PX, gpz = (Y + hpx + 0.5 - cy) / PX;
        const a = gpx * ux[0] + gpz * ux[1], c = gpx * uz[0] + gpz * uz[1];
        let f = 1;
        if (flat) {
          if (Math.abs(a) > w / 2 - 0.7 || Math.abs(c) > d / 2 - 0.7) f = 1.12;
          else if (w * d > 300 && (hash(Math.floor(a / 3) + hh, Math.floor(c / 3)) % 23 === 0)) f = 0.8;
        } else {
          const across = ridgeAlongX ? c : a;
          const nrm = ridgeAlongX ? (across < 0 ? [-uz[0], -uz[1]] : uz) : (across < 0 ? [-ux[0], -ux[1]] : ux);
          f = (nrm[0] * -0.6 + nrm[1] * -0.8) > 0 ? 1.12 : 0.82;
          if (Math.abs(across) < 0.6) f = 0.7;
          if ((Y & 1) === 0 && !snow) f *= 0.95;
        }
        let col = rc;
        if (snow && !flat) col = Math.abs(ridgeAlongX ? c : a) < (ridgeAlongX ? d : w) / 2 - 0.8 ? [236, 240, 250] : rc;
        if (style === "stadium") {
          const ia = w / 2 - 20, ic = d / 2 - 20;
          if (Math.abs(a) < ia && Math.abs(c) < ic) { col = Math.floor((a + ia) / 7) % 2 ? [70, 150, 60] : [84, 166, 70]; f = 1;
            if (Math.abs(a) < 0.5 || Math.abs(Math.abs(a) - ia + 0.6) < 0.5 || Math.abs(Math.abs(c) - ic + 0.6) < 0.5) col = [240, 240, 240]; }
          else { const rim = Math.min(w / 2 - Math.abs(a), d / 2 - Math.abs(c)); col = rim < 1.5 ? [176, 176, 170] : (Math.floor(rim / 2.2) % 2 ? [40, 90, 190] : [230, 230, 236]); f = 1; }
        } else if (roof === "tower") { col = Math.hypot(a, c) < 2.4 ? [196, 104, 64] : [244, 238, 220]; f = Math.hypot(a, c) < 2.4 ? (a + c < 0 ? 1.1 : 0.85) : 1; }
        // seen from above: lit windows show as lights around the roof edge at night
        let lit = 0;
        if (override?.flat && !override?.dark && style !== "stadium") {
          const e = Math.min(w / 2 - Math.abs(a), d / 2 - Math.abs(c));
          if (e < 0.9 && e >= 0 && hash(X * 3 + hh, Y) % 3 === 0) lit = packA(hash(X, Y + hh) & 1 ? LIT_B : LIT_A);
        }
        put_(X, Y, mul(col, f), lit);
      } else {
        const k = y1 - Y;                       // metres above ground
        let col = wall, f = wallF;
        const winRow = (k % 3) === 1 && k > 0 && k < hpx - 1;
        if (style === "glass") { if ((X + k) % 4 === 0) f *= 1.15; if (k % 4 === 0) f *= 0.8; }
        else if (style === "stadium") { col = [176, 176, 170]; if ((X % 10) < 2) f *= 0.85; if (k < 3 && (X % 24) < 6) col = [50, 50, 56]; }
        else if (style === "mission") { col = [244, 238, 220]; if (roof === "tower" && k > hpx - 8 && k < hpx - 3 && (X % 4) < 2) col = [50, 40, 34]; if (roof !== "tower" && k > 2 && k < 7 && (X % 6) === 2) col = [60, 46, 36]; }
        else if (winRow && ((X + hh) % 3) !== 0 && style !== "stadium" && style !== "mission") col = override?.win || [44, 62, 92];
        if (k <= 1 && Math.abs(X - cx) < 1.5 && !override?.nodoor) col = [92, 60, 40];
        if (k === 0) f *= 0.8;
        // night: about two windows in three are lit (each window keeps its own state)
        let lit = 0;
        if (!override?.dark) {
          const wk = hash(Math.floor((X + hh) / 3) * 7 + hh, Math.floor(k / 3));
          if (style === "glass") { if ((k % 3) === 1 && k < hpx - 1 && (X % 4) && wk % 3) lit = packA(wk & 4 ? LIT_B : LIT_A); }
          else if (style === "mission") { if ((roof === "tower" && k > hpx - 8 && k < hpx - 3 && (X % 4) < 2) || (roof !== "tower" && k > 2 && k < 7 && (X % 6) === 2)) lit = packA(LIT_C); }
          else if (style !== "stadium" && winRow && ((X + hh) % 3) !== 0 && wk % 3) lit = packA(wk & 4 ? LIT_B : LIT_A);
        }
        put_(X, Y, mul(col, f), lit);
      }
    }
  }
}
function drawBuilding(ctx, b) {
  if (!FLAT) { drawBuildingPx((x, y, c, l) => put(ctx, x, y, c, l), b, b._ov); return; }
  // turning view: a shadow cast to the south-east (longer for taller buildings), then the roof
  const h = b[4], sh = Math.min(10, h * 0.45);
  const sb = b.slice(); sb[0] = b[0] + sh * 0.8; sb[1] = b[1] + sh * 0.6;
  drawBuildingPx((x, y) => darken(ctx, x, y, 0.72), sb, { flat: true, dark: true });
  drawBuildingPx((x, y, c, l) => put(ctx, x, y, c, l), b, Object.assign({}, b._ov || {}, { flat: true }));
}

function drawFeature(ctx, f) {
  const cx = gx(f.x), cy = gy(f.z);
  const L = f.L * PX, Wd = f.W * PX;
  const r = Math.hypot(L, Wd) / 2 + 2;
  const onSnow = ["snow", "run", "snowlane", "park"].includes(sname(surfT(Math.floor(cx / TP), Math.floor(cy / TP)))) && hAt(f.x, f.z) > 40;
  const mat = f.m === "wood" ? [150, 110, 70] : onSnow ? [244, 248, 255] : f.m === "concrete" ? [190, 190, 186] : f.m === "dirt" ? [160, 116, 74] : [200, 200, 196];
  if (f.t === "box") {
    const top = f.top != null ? f.top : hAt(f.x, f.z) + f.h;
    const raise = Math.max(1, Math.round((top - hAt(f.x, f.z)) * 1.0));
    const deck = !!f.g;
    const b = [f.x, f.z, f.L, f.W, raise, -f.r, "box", "flat", "c8c8c4", 0, 1];
    drawBuildingPx((x, y, c) => {
      put(ctx, x, y, c);
    }, b, { flat: FLAT, dark: true, wall: deck ? [110, 80, 50] : mat.map(v => v * 0.85), roof: deck ? [176, 132, 86] : mat, nodoor: true, win: deck ? [70, 50, 32] : mat.map(v => v * 0.85) });
    return;
  }
  for (let y = Math.floor(cy - r); y <= cy + r; y++) for (let x = Math.floor(cx - r); x <= cx + r; x++) {
    const X = (x + 0.5 - cx) / PX + f.x, Z = (y + 0.5 - cy) / PX + f.z;
    const fh = featHeight(f, X, Z); if (!fh) continue;
    const lx = (X - f.x) * f.ux + (Z - f.z) * f.uz; const u = (lx + f.L / 2) / f.L;
    let fac = 0.82 + 0.3 * Math.min(1, fh.h / Math.max(f.h, 0.1));
    if (fh.lip) fac = 1.18;
    if (f.t === "roller") fac = 0.9 + 0.2 * Math.sin(Math.PI * u * 2);
    if (f.t === "table" && u > 0.3 && u < 0.7) fac = 1.05;
    put(ctx, x, y, mul(onSnow ? (fh.lip ? [180, 210, 250] : mat) : mat, fac));
  }
}

function drawRail(ctx, r) {
  const x0 = gx(r.x1), y0 = gy(r.z1), x1 = gx(r.x2), y1 = gy(r.z2);
  const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0)));
  const g0 = hAt(r.x1, r.z1), g1 = hAt(r.x2, r.z2);
  const lift0 = Math.max(1, Math.round((r.y1 - g0) * 2)), lift1 = Math.max(1, Math.round((r.y2 - g1) * 2));
  const col = r.kind === "ledge" ? null : pack(70, 74, 86), hi = pack(150, 156, 170);
  for (let s = 0; s <= n; s++) {
    const t = s / n, x = Math.round(x0 + (x1 - x0) * t), y = Math.round(y0 + (y1 - y0) * t);
    if (r.kind === "ledge") continue;
    darken(ctx, x + 1, y + 1, 0.7);
    const l = Math.round(lift0 + (lift1 - lift0) * t);
    put(ctx, x, y - l, col); put(ctx, x, y - l - 1, hi);
    if (s === 0 || s === n) for (let k = 0; k < l; k++) put(ctx, x, y - k, col);
  }
}

function drawMarker(ctx, i, j, P) {
  const x = i * TP + 4, y = j * TP + 6;
  const c = P.k === "trail" ? [150, 100, 60] : DIFF_RGB[P.d] || [230, 120, 40];
  put(ctx, x, y, pack(60, 50, 40)); put(ctx, x, y - 1, pack(230, 120, 40)); put(ctx, x, y - 2, pack(230, 120, 40));
  put(ctx, x, y - 3, pack(...c)); put(ctx, x, y - 4, pack(...c));
}
function drawSign(ctx, x, y, d, k) {
  // post and a board with the difficulty symbol
  for (let v = 0; v < 6; v++) put(ctx, x, y - v, pack(90, 66, 44));
  const bx = x - 4, by = y - 14;
  for (let v = 0; v < 9; v++) for (let u = 0; u < 9; u++) put(ctx, bx + u, by + v, (u === 0 || v === 0 || u === 8 || v === 8) ? pack(60, 44, 30) : pack(250, 250, 244));
  const c = pack(...(k === "trail" ? [150, 100, 60] : DIFF_RGB[d] || [230, 120, 40]));
  const cx = bx + 4, cy = by + 4;
  for (let v = -3; v <= 3; v++) for (let u = -3; u <= 3; u++) {
    let on = false;
    if (k === "trail" || d === "park") on = Math.abs(u) <= 2 && Math.abs(v) <= 2 && (Math.abs(u) === 2 || Math.abs(v) === 2 || (u === 0 && v === 0));
    else if (d === "green") on = u * u + v * v <= 6;
    else if (d === "blue") on = Math.abs(u) <= 2 && Math.abs(v) <= 2;
    else if (d === "black") on = Math.abs(u) + Math.abs(v) <= 3;
    else if (d === "dbl") on = Math.abs(u) + Math.abs(v) <= 2 || false;
    if (on) put(ctx, cx + u, cy + v, c);
  }
  if (d === "dbl") for (let v = -2; v <= 2; v++) for (let u = -2; u <= 2; u++) if (Math.abs(u) + Math.abs(v) <= 2) { put(ctx, cx + u - 2, cy + v, c); put(ctx, cx + u + 2, cy + v, c); }
}

const LIFT_H = 12;   // cable height in pixels (metres)
export { LIFT_H };
function drawLift(ctx, L) {
  const [ax, az] = L.a, [bx, bz] = L.b;
  const x0 = gx(ax), y0 = gy(az), x1 = gx(bx), y1 = gy(bz);
  if (Math.max(x0, x1) < ctx.ox - 30 || Math.min(x0, x1) > ctx.ox + CP + 30 || Math.max(y0, y1) < ctx.oy - 30 || Math.min(y0, y1) > ctx.oy + CP + 30) return;
  const len = Math.hypot(bx - ax, bz - az), n = Math.ceil(Math.hypot(x1 - x0, y1 - y0));
  const px_ = -(y1 - y0) / n, py_ = (x1 - x0) / n;
  const steel = pack(54, 56, 66), pole = pack(120, 124, 134);
  // towers every ~60 m
  const nt = Math.max(1, Math.round(len / 60));
  for (let k = 1; k < nt; k++) {
    const t = k / nt, x = Math.round(x0 + (x1 - x0) * t), y = Math.round(y0 + (y1 - y0) * t);
    darken(ctx, x + 1, y + 1, 0.7); darken(ctx, x + 2, y + 1, 0.7);
    if (FLAT) { for (let u = -3; u <= 3; u++) put(ctx, Math.round(x + px_ * u), Math.round(y + py_ * u), pole, Math.abs(u) === 3 ? packA([255, 70, 60]) : 0); continue; }
    for (let v = 0; v < LIFT_H; v++) put(ctx, x, y - v, pole);
    for (let u = -3; u <= 3; u++) put(ctx, Math.round(x + px_ * u), Math.round(y - LIFT_H + py_ * u), steel, Math.abs(u) === 3 ? packA([255, 70, 60]) : 0);
  }
  for (const side of [-2.5, 2.5]) for (let s = 0; s <= n; s++) {
    const t = s / n;
    put(ctx, Math.round(x0 + (x1 - x0) * t + px_ * side), Math.round(y0 + (y1 - y0) * t - (FLAT ? 0 : LIFT_H) + py_ * side), steel);
  }
  // stations
  for (const [sx, sz, top] of [[ax, az, 0], [bx, bz, 1]]) {
    drawBuildingPx((x, y, c, l) => put(ctx, x, y, c, l), [sx, sz, 9, 7, 6, Math.atan2(bx - ax, bz - az), "timber", "gable", "8a5a36", 0, 1],
      { wall: L.cab ? [200, 60, 50] : [110, 120, 140], roof: [70, 74, 84], nodoor: false, flat: FLAT });
  }
}

// ---------- overview map image (1 px per 2 tiles)
export function buildMapImage() {
  if (!SN) SN = G.surfaces;
  const sx = 2, w = Math.ceil(G.nx / sx), h = Math.ceil(G.nz / sx);
  const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
  const img = new ImageData(w, h), buf = new Uint32Array(img.data.buffer);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = x * sx, j = y * sx, s = surfT(i, j), nm = sname(s);
    const inf = tileInfo(i, j);
    let c;
    if (isWaterT(i, j)) c = waterCol((s === SEA ? 0 : lakeLevel()) - inf.h, s !== SEA && nm !== "river");
    else {
      c = BASE[nm] || BASE.grass;
      if (NATURAL.has(nm) && inf.slope > (nm === "snow" ? 1.05 : 1.45)) c = nm === "snow" ? ROCK_SNOW : ROCK;
      const o = objT(i, j); if (o >= 1 && o <= 8 && nm !== "snow") c = [52, 118, 52];
      if (o >= 1 && o <= 4 && nm === "snow") c = [70, 120, 100];
      if (o === 20) c = [160, 150, 150];
    }
    const snowy = nm === "snow" || nm === "run" || nm === "snowlane";
    const f = SHADE[Math.round(inf.lev)];
    buf[y * w + x] = snowy && inf.lev < 1.5 ? mul(mix(c, SNOWSH, 0.4), 1) : mul(c, f);
  }
  const g = cv.getContext("2d"); g.putImageData(img, 0, 0);
  // runs, trails and roads on top
  const tx = x => (x - G.x0) / G.res / sx, tz = z => (z - G.z0) / G.res / sx;
  for (const p of W.paths) {
    if (p.k === "river") continue;
    g.strokeStyle = p.k === "road" ? (p.c === 1 ? "#d8d4c8" : "#f4e8b0") : p.k === "trail" ? "#7a4a22" : "rgb(" + (DIFF_RGB[p.d] || [230, 120, 40]).join(",") + ")";
    g.lineWidth = p.k === "road" ? (p.c === 1 ? 0.8 : 1.4) : 1.1;
    if (p.k === "trail") g.setLineDash([2, 1.5]); else g.setLineDash([]);
    g.beginPath(); p.p.forEach(([x, z], k) => k ? g.lineTo(tx(x), tz(z)) : g.moveTo(tx(x), tz(z))); g.stroke();
  }
  g.setLineDash([]); g.strokeStyle = "#202024"; g.lineWidth = 1;
  for (const L of W.lifts) { g.beginPath(); g.moveTo(tx(L.a[0]), tz(L.a[1])); g.lineTo(tx(L.b[0]), tz(L.b[1])); g.stroke(); }
  return cv;
}
