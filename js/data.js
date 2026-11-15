// Island data: one grid (surface, run/trail id, objects, height) at 4 m per tile, plus the world list.
export const W = {};          // world8.json
export let G = null;          // grid info
let SURF, PID, OBJ, HGT;
export const SEA = 255;
export const S = {};          // surface name -> index

async function gunzip(buf) {
  const u = new Uint8Array(buf);
  if (!(u[0] === 0x1f && u[1] === 0x8b)) return buf;        // the server already unzipped it
  const ds = new DecompressionStream("gzip");
  const out = new Response(new Blob([buf]).stream().pipeThrough(ds));
  return await out.arrayBuffer();
}

async function fetchProgress(url, onp) {
  const r = await fetch(url);
  if (!r.ok) throw new Error("could not load " + url);
  const len = +r.headers.get("content-length") || 0;
  if (!r.body || !len) return await r.arrayBuffer();
  const rd = r.body.getReader(); const parts = []; let got = 0;
  for (;;) {
    const { done, value } = await rd.read();
    if (done) break;
    parts.push(value); got += value.length; onp && onp(Math.min(1, got / len));
  }
  const all = new Uint8Array(got); let o = 0;
  for (const p of parts) { all.set(p, o); o += p.length; }
  return all.buffer;
}

function b64(s) { const bin = atob(s); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u.buffer; }
export async function load(onp) {
  // single-file build: the island is packed into the page itself (works when opened by double-click)
  const E = window.__SHRED8_DATA;
  const wj = E ? Promise.resolve(JSON.parse(new TextDecoder().decode(new Uint8Array(await gunzip(b64(E.world)))))) : fetch("data/world8.json").then(r => r.json());
  const raw = E ? b64(E.grid) : await fetchProgress("data/grid.bin.gz", p => onp && onp(p * 0.85));
  const buf = await gunzip(raw);
  Object.assign(W, await wj);
  G = W.grid;
  const N = G.nx * G.nz;
  SURF = new Uint8Array(buf, 0, N);
  PID = new Uint8Array(buf, N, N);
  OBJ = new Uint8Array(buf, 2 * N, N);
  HGT = new Int16Array(buf.slice(3 * N, 3 * N + 2 * N));
  G.surfaces.forEach((n, i) => S[n] = i);
  onp && onp(1);
  indexWorld();
}

export const surfT = (i, j) => (i < 0 || j < 0 || i >= G.nx || j >= G.nz) ? SEA : SURF[j * G.nx + i];
export const pidT = (i, j) => (i < 0 || j < 0 || i >= G.nx || j >= G.nz) ? 0 : PID[j * G.nx + i];
export const objT = (i, j) => (i < 0 || j < 0 || i >= G.nx || j >= G.nz) ? 0 : OBJ[j * G.nx + i];
export const hT = (i, j) => {
  i = i < 0 ? 0 : i >= G.nx ? G.nx - 1 : i; j = j < 0 ? 0 : j >= G.nz ? G.nz - 1 : j;
  return HGT[j * G.nx + i] * 0.1;
};
export const ti = x => Math.round((x - G.x0) / G.res);
export const tj = z => Math.round((z - G.z0) / G.res);

// ground height in metres, smooth between tiles
export function hAt(x, z) {
  const fx = (x - G.x0) / G.res, fz = (z - G.z0) / G.res;
  const i = Math.floor(fx), j = Math.floor(fz), a = fx - i, b = fz - j;
  return (hT(i, j) * (1 - a) + hT(i + 1, j) * a) * (1 - b) + (hT(i, j + 1) * (1 - a) + hT(i + 1, j + 1) * a) * b;
}
export function gradAt(x, z) {
  const e = 2.0;
  return [(hAt(x + e, z) - hAt(x - e, z)) / (2 * e), (hAt(x, z + e) - hAt(x, z - e)) / (2 * e)];
}
export const surfAt = (x, z) => surfT(ti(x), tj(z));
export const pidAt = (x, z) => pidT(ti(x), tj(z));
export const objAt = (x, z) => objT(ti(x), tj(z));

export function inLake(x, z) {
  const L = W.lake; if (!L) return false;
  const lx = L.x ?? L[0], lz = L.z ?? L[1], lr = L.r ?? L[2], lv = L.level ?? L[3];
  return (x - lx) ** 2 + (z - lz) ** 2 < (lr + 30) ** 2 && hAt(x, z) < lv - 0.3;
}
export function lakeLevel() { const L = W.lake; return L ? (L.level ?? L[3]) : 0; }
export function isWaterT(i, j) {
  const s = surfT(i, j);
  if (s === SEA || s === S.river) return true;
  const L = W.lake; if (!L) return false;
  const x = G.x0 + i * G.res, z = G.z0 + j * G.res;
  return inLake(x, z);
}
export const isWater = (x, z) => isWaterT(ti(x), tj(z));
export function waterLevel(x, z) { return inLake(x, z) ? lakeLevel() : 0; }

// ---- spatial indexes
export const CH = 32;                 // tiles per render chunk
export let chunksBld = new Map(), chunksFeat = new Map(), chunksRail = new Map();
export const keyOf = (ci, cj) => ci * 10000 + cj;
function addTo(map, x0, z0, x1, z1, item, upM = 0) {
  // world-metre bbox (with extra height drawn upward on screen: upM metres = upM px... in tiles)
  const c0 = Math.floor((x0 - G.x0) / G.res / CH), c1 = Math.floor((x1 - G.x0) / G.res / CH);
  const r0 = Math.floor(((z0 - upM) - G.z0) / G.res / CH), r1 = Math.floor((z1 - G.z0) / G.res / CH);
  for (let ci = c0; ci <= c1; ci++) for (let cj = r0; cj <= r1; cj++) {
    const k = keyOf(ci, cj); if (!map.has(k)) map.set(k, []); map.get(k).push(item);
  }
}
export let RAILS = [];        // grindable lines: {x1,z1,y1,x2,z2,y2,len,ux,uz}
export let FEATS = [];
function indexWorld() {
  chunksBld = new Map(); chunksFeat = new Map(); chunksRail = new Map();
  for (const b of W.buildings) {
    const [x, z, w, d, h] = b; const r = Math.hypot(w, d) / 2 + 1;
    addTo(chunksBld, x - r, z - r, x + r, z + r, b, h * 0.5 + 4);
  }
  FEATS = W.features.map(f => {
    const [t, x, z, L, Wd, h, r, top, m, g] = f;
    return { t, x, z, L, W: Wd, h, r, top, m, g, ux: Math.cos(r), uz: Math.sin(r) };
  });
  for (const f of FEATS) { const rr = Math.hypot(f.L, f.W) / 2 + 1; addTo(chunksFeat, f.x - rr, f.z - rr, f.x + rr, f.z + rr, f, f.h * 0.5 + 2); }
  RAILS = [];
  for (const r of W.rails) {
    const [x1, z1, y1, x2, z2, y2] = r; const len = Math.hypot(x2 - x1, z2 - z1);
    if (len < 0.5) continue;
    RAILS.push({ x1, z1, y1, x2, z2, y2, len, ux: (x2 - x1) / len, uz: (z2 - z1) / len, kind: r[6] });
  }
  // ledge edges of low boxes are grindable too
  for (const f of FEATS) {
    if (f.t !== "box" || f.g || f.h < 0.25 || f.h > 1.3 || Math.max(f.L, f.W) > 60) continue;
    const top = f.top ?? null;
    for (const s of [-1, 1]) {
      const vx = -f.uz, vz = f.ux;
      const cx = f.x + vx * s * f.W / 2, cz = f.z + vz * s * f.W / 2;
      const x1 = cx - f.ux * f.L / 2, z1 = cz - f.uz * f.L / 2, x2 = cx + f.ux * f.L / 2, z2 = cz + f.uz * f.L / 2;
      RAILS.push({ x1, z1, x2, z2, y1: top ?? hAt(x1, z1) + f.h, y2: top ?? hAt(x2, z2) + f.h, len: f.L, ux: f.ux, uz: f.uz, kind: "ledge" });
    }
  }
  for (const r of RAILS) addTo(chunksRail, Math.min(r.x1, r.x2) - 1, Math.min(r.z1, r.z2) - 1, Math.max(r.x1, r.x2) + 1, Math.max(r.z1, r.z2) + 1, r, 3);
}

export function featsNear(x, z) {
  const ci = Math.floor((x - G.x0) / G.res / CH), cj = Math.floor((z - G.z0) / G.res / CH);
  return chunksFeat.get(keyOf(ci, cj)) || [];
}
export function railsNear(x, z) {
  const ci = Math.floor((x - G.x0) / G.res / CH), cj = Math.floor((z - G.z0) / G.res / CH);
  return chunksRail.get(keyOf(ci, cj)) || [];
}

// feature surface height added on top of the ground at (x, z) (kickers, tables, rollers, quarter pipes, decks)
export function featHeight(f, x, z) {
  const dx = x - f.x, dz = z - f.z;
  const lx = dx * f.ux + dz * f.uz, lz = -dx * f.uz + dz * f.ux;
  if (Math.abs(lx) > f.L / 2 || Math.abs(lz) > f.W / 2) return null;
  const u = (lx + f.L / 2) / f.L;        // 0 at the run-in, 1 at the lip
  switch (f.t) {
    case "kicker": case "wedge": return { h: f.h * u, lip: u > 0.9, slope: f.h / f.L };
    case "qp": case "pipe": return { h: f.h * u * u, lip: u > 0.85, slope: 2 * f.h * u / f.L, qp: true };
    case "table": {
      const r = 0.3;
      const h = u < r ? f.h * u / r : u > 1 - r ? f.h * (1 - u) / r : f.h;
      return { h, lip: u > r - 0.04 && u < r + 0.02, slope: f.h / (f.L * r) };
    }
    case "roller": return { h: f.h * Math.sin(Math.PI * u), lip: false, slope: 0 };
    case "box": {
      if (f.g) return { h: (f.top ?? 0) - hAt(x, z), deck: true, slope: 0 };
      // ledges, decks and platforms: ride on top, a wall from below
      return { h: f.top != null ? f.top - hAt(x, z) : f.h, ledge: true, slope: 0 };
    }
    case "stairs": return { h: f.h * u, lip: false, slope: f.h / f.L };
  }
  return null;
}

// names of places for the HUD
export function placeName(x, z) {
  let best = null;
  for (const t of W.towns || []) {
    const [n, tx, tz, , r] = t;
    const d = Math.hypot(x - tx, z - tz);
    if (d < (r || 150) + 40 && (!best || d < best.d)) best = { n, d };
  }
  if (best) return best.n;
  for (const d of W.districts || []) {
    const [n, , rc] = d;
    if (x > rc[0] && x < rc[2] && z > rc[1] && z < rc[3]) return n;
  }
  let rb = null;
  for (const r of W.regions || []) {
    const n = r.n ?? r[0], rx = r.x ?? r[1], rz = r.z ?? r[2];
    const d = Math.hypot(x - rx, z - rz);
    if (!rb || d < rb.d) rb = { n, d };
  }
  return rb ? rb.n : "";
}
