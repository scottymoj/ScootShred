// Life on the island: cars on the roads, skiers and boarders on the runs, bikers on the trails, people in town,
// surfers in the lineups, gulls over the coast.
import { W, hAt, isWater, surfAt, objAt } from "./data.js";
import { TS, waveList } from "./sim.js";
import { LOOKS } from "./sprites.js";

export const NPCS = [];
function polyLen(p) { let L = 0; for (let k = 0; k + 1 < p.length; k++) L += Math.hypot(p[k + 1][0] - p[k][0], p[k + 1][1] - p[k][1]); return L; }
function polyAt(p, s) {
  for (let k = 0; k + 1 < p.length; k++) {
    const L = Math.hypot(p[k + 1][0] - p[k][0], p[k + 1][1] - p[k][1]);
    if (s <= L || k + 2 === p.length) {
      const t = L > 0 ? Math.min(1, s / L) : 0;
      return [p[k][0] + (p[k + 1][0] - p[k][0]) * t, p[k][1] + (p[k + 1][1] - p[k][1]) * t, Math.atan2(p[k + 1][0] - p[k][0], p[k + 1][1] - p[k][1])];
    }
    s -= L;
  }
  const n = p.length - 1; return [p[n][0], p[n][1], 0];
}
let RNG = 12345; const rnd = () => (RNG = (RNG * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const pick = a => a[Math.floor(rnd() * a.length)];

export function initNPCs() {
  NPCS.length = 0;
  const roads = W.paths.filter(p => p.k === "road" && p.p.length > 1); roads.forEach(p => p.L = polyLen(p.p));
  const runs = W.paths.filter(p => p.k === "run" && p.d !== "park" && p.p.length > 1); runs.forEach(p => p.L = polyLen(p.p));
  const trails = W.paths.filter(p => p.k === "trail" && p.p.length > 1); trails.forEach(p => p.L = polyLen(p.p));
  const bigRoads = roads.filter(r => r.L > 300);
  for (let k = 0; k < 90; k++) {
    const p = pick(bigRoads.length ? bigRoads : roads);
    NPCS.push({ t: "car", p, s: rnd() * p.L, dir: rnd() < 0.5 ? 1 : -1, v: (p.c === 1 ? 9 : 13) + rnd() * 4, col: Math.floor(rnd() * 8), x: 0, z: 0, a: 0 });
  }
  for (let k = 0; k < 70; k++) {
    const p = pick(runs);
    NPCS.push({ t: "skier", p, s: rnd() * p.L, v: 6 + rnd() * 7 * ({ green: 0.6, blue: 1, black: 1.2, dbl: 1.3 }[p.d] || 1), sport: rnd() < 0.5 ? "ski" : "snowboard",
      look: pick(LOOKS), ph: rnd() * 6, amp: 3 + rnd() * 6, x: 0, z: 0, a: 0 });
  }
  for (let k = 0; k < 24; k++) {
    const p = pick(trails);
    NPCS.push({ t: "biker", p, s: rnd() * p.L, v: 5 + rnd() * 4, sport: "bike", look: pick(LOOKS), ph: 0, amp: 0.6, x: 0, z: 0, a: 0 });
  }
  // walkers around towns and the city
  const towns = W.towns || [];
  for (let k = 0; k < 120; k++) {
    let x, z;
    if (k < 70) { const d = pick(W.districts); const r = d[2]; x = r[0] + rnd() * (r[2] - r[0]); z = r[1] + rnd() * (r[3] - r[1]); }
    else { const t = pick(towns); x = t[1] + (rnd() - 0.5) * 220; z = t[2] + (rnd() - 0.5) * 220; }
    NPCS.push({ t: "walker", x, z, a: rnd() * 6.28, v: 1.1 + rnd() * 0.4, look: pick(LOOKS), turnT: rnd() * 4, skate: rnd() < 0.25 });
  }
  // surfers sitting in every lineup
  for (const B of waveList()) {
    for (let k = 0; k < 3; k++) {
      const s = B.s0 + rnd() * (B.s1 - B.s0), n = B.b.breakN + 8 + rnd() * 25;
      NPCS.push({ t: "surfer", B, s, n, x: B.O[0] + B.T[0] * s + B.N[0] * n, z: B.O[1] + B.T[1] * s + B.N[1] * n, a: Math.atan2(-B.N[0], -B.N[1]), look: pick(LOOKS), ph: rnd() * 6, ride: null });
    }
  }
  for (let k = 0; k < 26; k++) {
    const B = pick(W.breaks);
    NPCS.push({ t: "gull", cx: B.O[0] + (rnd() - 0.5) * 200, cz: B.O[1] + (rnd() - 0.5) * 200, r: 30 + rnd() * 60, ph: rnd() * 6, w: (rnd() < 0.5 ? -1 : 1) * (0.15 + rnd() * 0.15), x: 0, z: 0, a: 0 });
  }
}

export function stepNPCs(dtReal, px, pz) {
  const dt = dtReal * TS;
  for (const n of NPCS) {
    const far = Math.abs(n.x - px) > 700 || Math.abs(n.z - pz) > 500;
    switch (n.t) {
      case "car": {
        n.s += n.v * n.dir * dt;
        if (n.s > n.p.L) { n.s = n.p.L; n.dir = -1; } else if (n.s < 0) { n.s = 0; n.dir = 1; }
        if (far) { const q = polyAt(n.p.p, n.s); n.x = q[0]; n.z = q[1]; break; }
        const q = polyAt(n.p.p, n.s); const side = (n.p.w / 4) * n.dir;
        n.a = n.dir > 0 ? q[2] : q[2] + Math.PI;
        n.x = q[0] + Math.cos(q[2]) * side; n.z = q[1] - Math.sin(q[2]) * side;
        break;
      }
      case "skier": case "biker": {
        n.s += n.v * dt;
        if (n.s >= n.p.L) { n.s = 0; if (n.t === "skier") { n.ph = rnd() * 6; } }
        const q = polyAt(n.p.p, n.s);
        n.ph += dt * (n.t === "skier" ? 0.9 : 0.5);
        const off = Math.sin(n.ph) * n.amp;
        n.x = q[0] + Math.cos(q[2]) * off; n.z = q[1] - Math.sin(q[2]) * off;
        n.a = q[2] + Math.cos(n.ph) * (n.t === "skier" ? 0.5 : 0.1);
        break;
      }
      case "walker": {
        if (far) break;
        n.turnT -= dtReal;
        const nx = n.x + Math.sin(n.a) * n.v * (n.skate ? 3 : 1) * dt, nz = n.z + Math.cos(n.a) * n.v * (n.skate ? 3 : 1) * dt;
        const o = objAt(nx, nz);
        if (n.turnT < 0 || o === 20 || o === 21 || isWater(nx, nz)) { n.a += (rnd() - 0.5) * 3; n.turnT = 2 + rnd() * 5; }
        else { n.x = nx; n.z = nz; }
        break;
      }
      case "surfer": {
        n.ph += dtReal * 2;
        n.x = n.B.O[0] + n.B.T[0] * n.s + n.B.N[0] * n.n; n.z = n.B.O[1] + n.B.T[1] * n.s + n.B.N[1] * n.n;
        break;
      }
      case "gull": {
        n.ph += n.w * dtReal * 2;
        n.x = n.cx + Math.cos(n.ph) * n.r; n.z = n.cz + Math.sin(n.ph) * n.r * 0.6;
        break;
      }
    }
  }
}

// cars knock you over
export function carHit(x, z, speed) {
  for (const n of NPCS) {
    if (n.t !== "car") continue;
    if (Math.abs(n.x - x) < 3 && Math.abs(n.z - z) < 3) return true;
  }
  return false;
}
