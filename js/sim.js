// Rider physics for all five sports, plus waves and lifts. World units are metres; the game runs at TS x real time.
import { W, S, SEA, hAt, gradAt, surfAt, objAt, isWater, waterLevel, featsNear, railsNear, featHeight, pidAt, ti, tj, objT } from "./data.js";

export const TS = 2.0;              // arcade time scale
const GRAV = 9.8;
const SOLID_TREES = new Set([1, 2, 3, 4, 5, 6, 7, 8, 10]);

export const R = {
  x: 0, z: 0, y: 0, vx: 0, vz: 0, vy: 0, a: 0, state: "ride", sport: "skate",
  snowSport: "snowboard", landSport: "skate", air: 0, spin: 0, spinDir: 0, grab: 0, grabName: "", flipName: "",
  bailT: 0, bailMsg: "", rail: null, railS: 0, railDir: 1, railT: 0, lift: null, liftT: 0, wave: null,
  pose: "ride", safe: [], safeT: 0, push: 0, lastTrickT: 0, tricksThisAir: [], airStartY: 0,
  surfOn: false, ridesWave: 0, tubeT: 0,
};

// ---------- scoring hooks (set by main)
export const hooks = { trick: () => {}, bail: () => {}, flash: () => {}, sfx: () => {} };

export function groupAt(x, z) {
  if (isWater(x, z)) return "water";
  const s = surfAt(x, z), n = W.grid.surfaces[s];
  if (n === "snow" || n === "run" || n === "snowlane") return "snow";
  if (n === "park" && hAt(x, z) > 40) return "snow";
  if (n === "asphalt" || n === "concrete" || n === "cobble" || n === "park" || n === "sandlane") return "hard";
  if (n === "sand") return "sand";
  if (n === "trail" || n === "dirt" || n === "gravel") return "dirt";
  return "grass";
}
export function sportFor(group) {
  if (group === "water") return "surf";
  if (group === "snow") return R.snowSport;
  if (group === "dirt") return R.dirtSport || "bike";        // trails and dirt: mountain bike (SPORT button can pick the board)
  return R.landSport;
}

// friction (m/s^2) by sport and ground
function friction(sport, g) {
  const T = {
    snowboard: { snow: 0.25, hard: 3, dirt: 3, grass: 4, sand: 5 },
    ski: { snow: 0.22, hard: 3, dirt: 3, grass: 4, sand: 5 },
    skate: { hard: 0.18, snow: 3, dirt: 2.2, grass: 4, sand: 6 },
    bike: { hard: 0.22, dirt: 0.32, grass: 0.9, snow: 2, sand: 2.5 },
  };
  return (T[sport] || {})[g] ?? 2;
}
const DRAG = { snowboard: 0.0042, ski: 0.0036, skate: 0.006, bike: 0.0045, surf: 0.02 };
const GRIP = { snowboard: 14, ski: 16, skate: 14, bike: 16, surf: 4.5 };
const TURN = { snowboard: 3.2, ski: 3.4, skate: 3.6, bike: 3.2, surf: 2.6 };     // rad/s real time

// ground height including ramps, ledges and decks
export function surfaceAt(x, z, yNow = 1e9) {
  let h = hAt(x, z), feat = null;
  for (const f of featsNear(x, z)) {
    const fh = featHeight(f, x, z); if (!fh) continue;
    if (fh.ledge || fh.deck) {
      const top = hAt(x, z) + fh.h;
      if (yNow >= top - 0.35 || fh.deck) { if (top > h) { h = top; feat = { f, fh }; } }
      continue;
    }
    const th = hAt(x, z) + fh.h;
    if (th > h) { h = th; feat = { f, fh }; }
  }
  return { h, feat };
}
function wallAt(x, z, yNow) {
  // ledges and boxes taller than a step block the way unless you're above them
  for (const f of featsNear(x, z)) {
    const fh = featHeight(f, x, z); if (!fh || !fh.ledge) continue;
    const top = hAt(x, z) + fh.h;
    if (yNow < top - 0.35) return true;
  }
  return false;
}
function solidAt(x, z) {
  const o = objAt(x, z);
  if (o === 20 || o === 21) return "WALL!";
  if (SOLID_TREES.has(o)) {
    const cx = W.grid.x0 + ti(x) * W.grid.res, cz = W.grid.z0 + tj(z) * W.grid.res;
    if ((x - cx) ** 2 + (z - cz) ** 2 < 1.4 * 1.4) return o === 10 ? "ROCK!" : "TREE!";
  }
  return null;
}

export function place(x, z, a = 0, sport = null) {
  R.x = x; R.z = z; R.a = a; R.vx = R.vz = R.vy = 0;
  const g = groupAt(x, z); R.sport = sport || sportFor(g);
  R.y = g === "water" ? waterLevel(x, z) : surfaceAt(x, z).h;
  R.state = g === "water" ? "paddle" : "ride"; R.air = 0; R.spin = 0; R.grab = 0; R.rail = null; R.lift = null; R.wave = null;
  R.safe = [[x, z, a]]; R.bailT = 0;
}

let bTapT = 0, lastB = false;
export function step(dtReal, inp) {
  const dt = dtReal * TS;
  if (R.state === "lift") return stepLift(dtReal, inp);
  if (R.state === "bail") {
    R.bailT -= dtReal; R.vx *= Math.exp(-4 * dt); R.vz *= Math.exp(-4 * dt);
    moveFree(dt); R.pose = "bail";
    if (R.bailT <= 0) recover();
    return;
  }
  if (R.state === "paddle" || R.state === "surf" || (R.state === "air" && R.sport === "surf")) return stepSurf(dtReal, dt, inp);
  if (R.state === "grind") return stepGrind(dtReal, dt, inp);

  // ------- land and snow
  const g = groupAt(R.x, R.z);
  if (g === "water" && R.state !== "air") { enterWater(); return; }
  const want = sportFor(g);
  if (R.state !== "air" && want !== R.sport) { R.sport = want; hooks.flash(want.toUpperCase()); }
  const sp = R.sport;
  const fx = Math.sin(R.a), fz = Math.cos(R.a);
  let speed = Math.hypot(R.vx, R.vz);

  if (R.state === "air") {
    stepAir(dtReal, dt, inp);
    return;
  }
  // steering: the stick is the direction you want to go
  if (inp.mag > 0.2) {
    const target = Math.atan2(inp.jx, inp.jy);
    let d = wrap(target - R.a);
    const boardSwitch = (sp === "snowboard" || sp === "skate") && Math.abs(d) > 2.2 && speed > 2;
    if (boardSwitch) d = wrap(d - Math.PI);          // riding switch is fine for boarders
    const rate = TURN[sp] * (speed < 3 ? 1.6 : 1) * Math.min(1, inp.mag * 1.3);
    R.a = wrap(R.a + clamp(d, -rate * dtReal, rate * dtReal));
  }
  // gravity along the slope (including ramps)
  const here = surfaceAt(R.x, R.z, R.y);
  let [gxS, gzS] = gradAt(R.x, R.z);
  if (here.feat && !here.feat.fh.ledge && !here.feat.fh.deck) { gxS += here.feat.f.ux * here.feat.fh.slope; gzS += here.feat.f.uz * here.feat.fh.slope; }
  if (here.feat && (here.feat.fh.ledge || here.feat.fh.deck)) { gxS = 0; gzS = 0; }
  const gm = Math.hypot(gxS, gzS); if (gm > 0.9) { gxS *= 0.9 / gm; gzS *= 0.9 / gm; }     // very steep pitches don't keep piling on speed
  R.vx -= GRAV * gxS * dt; R.vz -= GRAV * gzS * dt;
  // grip: sideways speed bleeds away (carving), forward speed rolls on
  const f2x = Math.sin(R.a), f2z = Math.cos(R.a);
  let vf = R.vx * f2x + R.vz * f2z, vl = R.vx * f2z - R.vz * f2x;
  const braking = inp.Bh && R.state === "ride";
  let mu = friction(sp, g) + (braking ? 11 : 0);
  if (inp.mag > 0.2 && Math.abs(vl) > 4 && (sp === "snowboard" || sp === "ski")) R.spray = 1;
  vl *= Math.exp(-(GRIP[sp] + (braking ? 6 : 0)) * dt);
  const dec = (mu + DRAG[sp] * vf * vf) * dt;
  vf = Math.abs(vf) <= dec ? 0 : vf - Math.sign(vf) * dec;
  // push (skate), pedal (bike), skate-step on flats (ski / board)
  R.push = Math.max(0, R.push - dtReal);
  let pushMax = 0, pushAcc = 0;
  if (sp === "skate") { pushMax = g === "hard" ? 9.5 : 3; pushAcc = 3.0; }
  else if (sp === "bike") { pushMax = g === "hard" ? 11 : g === "dirt" ? 9.5 : 6; pushAcc = 2.8; }
  else { pushMax = g === "snow" ? 4 : 2.5; pushAcc = 1.8; }
  if (inp.mag > 0.55 && Math.abs(wrap(Math.atan2(inp.jx, inp.jy) - R.a)) < 1.0 && vf < pushMax && !braking) {
    vf += pushAcc * dt; R.push = 0.25;
  }
  R.vx = vf * f2x + vl * f2z; R.vz = vf * f2z - vl * f2x;
  speed = Math.hypot(R.vx, R.vz);
  if (speed > 45) { R.vx *= 45 / speed; R.vz *= 45 / speed; }
  // move with collisions
  const ox = R.x, oz = R.z, oy = R.y;
  if (!moveSolid(dt)) return;
  // stick to the ground; fly only off ramps and real cliffs
  const there = surfaceAt(R.x, R.z, R.y);
  const offLip = here.feat && here.feat.fh.lip && !here.feat.fh.qp && (!there.feat || there.feat.f !== here.feat.f || there.h < oy - 0.05) && speed > 3;
  const cliff = oy - there.h > Math.max(3.0, speed * dt * 1.2);
  if (offLip) {
    const ramp = Math.atan(here.feat.fh.slope * 1.35);
    R.vy = speed * Math.sin(ramp) + 1.2; R.y = oy; R.state = "air"; startAir(here.feat); hooks.sfx("jump");
  } else if (cliff) {
    R.vy = Math.min(0, R.vy); R.y = oy; R.state = "air"; startAir(null);
  } else {
    if (there.h > oy + 0.45 && there.feat && there.feat.fh.ledge) { R.x = ox; R.z = oz; R.vx *= -0.2; R.vz *= -0.2; return; }
    R.vy = (there.h - oy) / dt; R.y = there.h;
    // quarter pipes send you straight up
    if (there.feat && there.feat.fh.qp && there.feat.fh.lip) {
      const f = there.feat.f; const vin = R.vx * f.ux + R.vz * f.uz;
      if (vin > 3) {
        R.vy = vin * 0.95; R.vx -= f.ux * vin; R.vz -= f.uz * vin; R.qpBack = [f.ux * vin * 0.9, f.uz * vin * 0.9];
        R.state = "air"; startAir(there.feat);
      }
    }
  }
  // ollie / hop
  if (inp.A && R.state === "ride") {
    R.vy = sp === "bike" ? 5.0 : sp === "skate" ? 5.3 : 4.6;
    R.state = "air"; R.y += 0.02; startAir(null); hooks.sfx("jump");
  }
  R.pose = braking ? "tuck" : (R.push > 0 && sp === "skate") ? "ride" : speed > 14 ? "tuck" : "ride";
  safeTick(dtReal);
}

function startAir(feat) {
  R.air = 0; R.spin = 0; R.grab = 0; R.flipName = ""; R.grabName = ""; R.tricksThisAir = [];
  R.airStartY = R.y; R.launchKick = !!feat;
}

function stepAir(dtReal, dt, inp) {
  const sp = R.sport;
  R.air += dtReal;
  // B: tap = grab or flip, hold = spin (stick left/right picks the direction)
  if (inp.B) bTapT = 0;
  if (inp.Bh) {
    bTapT += dtReal;
    if (bTapT > 0.16) {
      const dir = inp.jx < -0.3 ? -1 : inp.jx > 0.3 ? 1 : (R.spinDir || 1);
      R.spinDir = dir;
      const rate = 7.5 * dtReal * dir; R.a = wrap(R.a + rate); R.spin += Math.abs(rate);
    }
  } else if (lastB && bTapT <= 0.16) {
    R.grab = 0.7;
    const names = { snowboard: ["INDY", "MELON", "METHOD", "MUTE", "STALEFISH", "TAIL GRAB"], ski: ["MUTE GRAB", "SAFETY", "JAPAN", "TAIL GRAB", "CROSS"],
      skate: ["KICKFLIP", "HEELFLIP", "TRE FLIP", "VARIAL", "POP SHOVE-IT", "HARDFLIP"], bike: ["NO HANDER", "SUPERMAN", "TABLETOP", "TAILWHIP", "CAN-CAN"],
      surf: ["ALLEY-OOP", "AIR REVERSE", "GRAB"] };
    const L = names[sp] || ["GRAB"]; const n = L[Math.floor(Math.random() * L.length)];
    if (!R.tricksThisAir.includes(n)) R.tricksThisAir.push(n);
    hooks.sfx("trick");
  }
  lastB = inp.Bh;
  if (R.grab > 0) R.grab -= dtReal;
  R.pose = R.grab > 0 ? "grab" : "air";
  R.vy -= GRAV * 0.62 * dt;
  R.y += R.vy * dt;
  if (!moveSolid(dt)) return;
  if (inp.mag > 0.2 && !inp.Bh) {           // a little air control
    const t = Math.atan2(inp.jx, inp.jy); R.vx += Math.sin(t) * 0.8 * dt; R.vz += Math.cos(t) * 0.8 * dt;
  }
  // grind if you come down on a rail or ledge
  if (R.vy < 0 && tryGrind()) return;
  const g = surfaceAt(R.x, R.z, R.y);
  const wl = isWater(R.x, R.z) ? waterLevel(R.x, R.z) : -1e9;
  const ground = Math.max(g.h, wl);
  if (R.y <= ground) land(g, ground, wl > g.h);
}

function land(g, ground, inWater) {
  if (R.qpBack) { R.vx = -R.qpBack[0]; R.vz = -R.qpBack[1]; R.qpBack = null; R.a = wrap(R.a + 0); }
  const speed = Math.hypot(R.vx, R.vz);
  const [gx, gz] = gradAt(R.x, R.z);
  const groundRate = gx * R.vx + gz * R.vz;       // how fast the ground under you is rising (+) or falling (-)
  // impact = speed straight into the slope (landing along a steep transition is fine, flat-bottoming is not)
  const nl = Math.hypot(gx, 1, gz);
  const impact = (R.vy * 1 - R.vx * gx - R.vz * gz) / nl;
  R.y = ground; R.vy = 0;
  if (inWater) { R.state = "air"; enterWater(); return; }
  // landing direction: boards can land switch
  let ok = true, msg = "";
  if (speed > 2) {
    const mv = Math.atan2(R.vx, R.vz); let d = Math.abs(wrap(R.a - mv));
    const board = R.sport === "snowboard" || R.sport === "skate";
    if (board) d = Math.min(d, Math.PI - d);
    if (d > (board ? 0.75 : 0.85)) { ok = false; msg = "SKETCHY LANDING!"; }
    else R.a = board && Math.abs(wrap(R.a - mv)) > Math.PI / 2 ? wrap(mv + Math.PI) : mv;
  }
  if (impact < -15) { ok = false; msg = "LANDED TOO HARD!"; R.dbg = "imp " + impact.toFixed(1) + " air " + R.air.toFixed(2) + " drop " + (R.airStartY - ground).toFixed(1) + " v " + speed.toFixed(1) + " gr " + groundRate.toFixed(1); }
  if (R.grab > 0.25) { ok = false; msg = "STILL GRABBING!"; }
  if (!ok) { bail(msg); return; }
  R.state = "ride"; hooks.sfx("land");
  // score the air
  const spins = Math.round(R.spin / Math.PI) * 180;
  const parts = [];
  if (spins >= 180) parts.push((R.spinDir > 0 ? "FS " : "BS ") + spins);
  parts.push(...R.tricksThisAir);
  const pts = Math.round(R.air * 60 * TS) + Math.round(spins / 180) * 150 + R.tricksThisAir.length * 200;
  if (R.air > 0.45 || parts.length) hooks.trick(parts.length ? parts.join(" + ") : (R.air > 1.2 ? "BIG AIR" : "AIR"), pts, R.air);
  R.spin = 0; R.tricksThisAir = [];
}

export function bail(msg) {
  R.state = "bail"; R.bailT = 1.1; R.bailMsg = msg; R.rail = null; R.vy = 0;
  R.y = surfaceAt(R.x, R.z).h; hooks.bail(msg); hooks.sfx("bail");
}
function recover() {
  // back on your feet; if you're inside something, go back to the last safe spot
  if (solidAt(R.x, R.z) || isWater(R.x, R.z) && R.sport !== "surf") {
    const s = R.safe[0] || [R.x, R.z, R.a]; R.x = s[0]; R.z = s[1]; R.a = s[2];
  }
  R.vx = R.vz = 0; R.vy = 0;
  const g = groupAt(R.x, R.z);
  if (g === "water") { R.sport = "surf"; R.state = "paddle"; R.y = waterLevel(R.x, R.z); return; }
  R.state = "ride"; R.sport = sportFor(g); R.y = surfaceAt(R.x, R.z).h;
}
function safeTick(dtReal) {
  R.safeT += dtReal;
  if (R.safeT > 0.5) { R.safeT = 0; R.safe.push([R.x, R.z, R.a]); if (R.safe.length > 8) R.safe.shift(); }
}

function moveFree(dt) { R.x += R.vx * dt; R.z += R.vz * dt; if (R.state !== "paddle" && !isWater(R.x, R.z)) R.y = surfaceAt(R.x, R.z).h; }
function moveSolid(dt) {
  const nx = R.x + R.vx * dt, nz = R.z + R.vz * dt;
  const speed = Math.hypot(R.vx, R.vz);
  const hit = solidAt(nx, nz) || (R.state !== "air" && wallAt(nx, nz, R.y) ? "LEDGE!" : null);
  // in the air you clear trees and roofs only if you're high enough above them
  const high = R.state === "air" && R.y - hAt(nx, nz) > 9;
  if (hit && !high) {
    if (speed > 7.5 && hit !== "LEDGE!") { bail(hit); return false; }
    // slide along it
    if (!solidAt(nx, R.z) && !wallAt(nx, R.z, R.y)) { R.x = nx; R.vz *= -0.1; }
    else if (!solidAt(R.x, nz) && !wallAt(R.x, nz, R.y)) { R.z = nz; R.vx *= -0.1; }
    else { R.vx *= -0.2; R.vz *= -0.2; }
    return true;
  }
  R.x = nx; R.z = nz;
  return true;
}

// ---------- grinding
const GRINDS = { skate: ["50-50", "BOARDSLIDE", "5-0", "CROOKED", "SMITH", "NOSESLIDE"], snowboard: ["BOARDSLIDE", "50-50", "LIPSLIDE", "TAILPRESS"],
  ski: ["SWITCH SLIDE", "RAIL SLIDE", "SWAP"], bike: ["FEEBLE", "ICEPICK", "PEG GRIND"] };
function tryGrind() {
  for (const r of railsNear(R.x, R.z)) {
    const dx = R.x - r.x1, dz = R.z - r.z1;
    const s = dx * r.ux + dz * r.uz; if (s < 0 || s > r.len) continue;
    const off = Math.abs(-dx * r.uz + dz * r.ux); if (off > 0.9) continue;
    const ry = r.y1 + (r.y2 - r.y1) * s / r.len;
    if (R.y < ry - 0.35 || R.y > ry + 1.2) continue;
    const along = R.vx * r.ux + R.vz * r.uz; const speed = Math.hypot(R.vx, R.vz);
    if (Math.abs(along) < speed * 0.55 || speed < 2) continue;
    R.state = "grind"; R.rail = r; R.railS = s; R.railDir = Math.sign(along) || 1; R.railV = Math.max(3, Math.abs(along));
    R.railT = 0; R.y = ry;
    const L = GRINDS[R.sport] || ["GRIND"]; R.grindName = L[Math.floor(Math.random() * L.length)];
    hooks.sfx("grind");
    return true;
  }
  return false;
}
function stepGrind(dtReal, dt, inp) {
  const r = R.rail;
  const slope = (r.y2 - r.y1) / r.len * R.railDir;
  R.railV += -GRAV * slope * 0.6 * dt - 0.5 * dt;
  R.railS += R.railDir * R.railV * dt; R.railT += dtReal;
  R.x = r.x1 + r.ux * R.railS; R.z = r.z1 + r.uz * R.railS;
  R.y = r.y1 + (r.y2 - r.y1) * Math.max(0, Math.min(1, R.railS / r.len));
  R.vx = r.ux * R.railDir * R.railV; R.vz = r.uz * R.railDir * R.railV;
  R.a = Math.atan2(R.vx, R.vz) + ((R.sport === "skate" || R.sport === "snowboard") ? Math.PI / 2 : 0);
  R.pose = "ride";
  const off = R.railS < 0 || R.railS > r.len;
  if (inp.A || off || R.railV < 0.8) {
    R.a = Math.atan2(R.vx, R.vz);
    R.state = "air"; R.vy = inp.A ? 3.8 : 1.2; startAir(null);
    R.tricksThisAir = []; R.air = 0.3;
    hooks.trick(R.grindName, Math.round(R.railT * 260 * TS) + 100, 0.5);
    R.rail = null;
  }
}

// ---------- lifts
export function nearLift() {
  for (const L of W.lifts) {
    if (Math.hypot(R.x - L.a[0], R.z - L.a[1]) < 14) return L;
  }
  return null;
}
export function startLift(L) {
  R.state = "lift"; R.lift = L; R.liftT = 0; R.vx = R.vz = R.vy = 0; R.spin = 0;
  R.sport = sportFor(groupAt(L.b[0], L.b[1]));
  hooks.sfx("lift");
}
function stepLift(dtReal, inp) {
  const L = R.lift; const len = Math.hypot(L.b[0] - L.a[0], L.b[1] - L.a[1]);
  R.liftT += dtReal * Math.max(TS * (L.cab ? 7 : 5) / len, 1 / 20);
  if (inp.B) R.liftT = 1;                  // skip the ride
  const t = Math.min(1, R.liftT);
  R.x = L.a[0] + (L.b[0] - L.a[0]) * t; R.z = L.a[1] + (L.b[1] - L.a[1]) * t;
  R.y = hAt(R.x, R.z) + 12; R.a = Math.atan2(L.b[0] - L.a[0], L.b[1] - L.a[1]); R.pose = "seat";
  if (t >= 1) {
    const ux = (L.b[0] - L.a[0]) / len, uz = (L.b[1] - L.a[1]) / len;
    let x = L.b[0] + ux * 10, z = L.b[1] + uz * 10;
    if (solidAt(x, z)) { x = L.b[0] - uz * 10; z = L.b[1] + ux * 10; }
    const [gx, gz] = gradAt(x, z);
    place(x, z, Math.atan2(-gx, -gz) || 0);
    hooks.flash("TOP OF " + L.n.toUpperCase());
  }
}

// ---------- water and surfing
const BREAKS = [];
export function initWaves() {
  BREAKS.length = 0;
  for (const b of W.breaks) {
    BREAKS.push({ b, O: b.O, N: b.N, T: b.T, waves: [], t: Math.random() * b.every, s0: b.s0, s1: b.s1, A: Math.min(b.A, 6) * 0.8 + 0.6 });
  }
}
export function waveList() { return BREAKS; }
const WAVE_C = 5.2;      // m/s toward the beach
let SWELL = 1;                 // > 1 on swell days: bigger waves
export function setSwell(m) { SWELL = m; }
export function stepWaves(dtReal) {
  const dt = dtReal * TS;
  for (const B of BREAKS) {
    B.t += dt;
    if (B.t > B.b.every) { B.t = 0; B.waves.push({ n: B.b.spawnN, broke: null, A: B.A * SWELL * (0.75 + Math.random() * 0.5), id: Math.random() }); }
    for (const w of B.waves) {
      w.n -= WAVE_C * dt;
      if (w.n <= B.b.breakN && !w.broke) w.broke = [B.b.peak, B.b.peak];
      if (w.broke) {
        const p = B.b.peel * dt * 0.9;
        if (B.b.pdir >= 0) w.broke[1] += p;
        if (B.b.pdir <= 0) w.broke[0] -= p;
        if (B.b.pdir > 0) w.broke[0] = Math.min(w.broke[0], B.b.peak); if (B.b.pdir < 0) w.broke[1] = Math.max(w.broke[1], B.b.peak);
      }
    }
    B.waves = B.waves.filter(w => w.n > B.b.dieN);
  }
}
function waveFrame(B, x, z) {
  const dx = x - B.O[0], dz = z - B.O[1];
  return [dx * B.T[0] + dz * B.T[1], dx * B.N[0] + dz * B.N[1]];    // s along the wave, n out to sea
}
// face shape: 0 at the trough (shore side) up to the lip at the crest
export const FACE_W = A => 2.4 * A + 3;
function waveAt(x, z) {
  for (const B of BREAKS) {
    const [s, n] = waveFrame(B, x, z);
    if (s < B.s0 - 6 || s > B.s1 + 6 || n < B.b.dieN - 10 || n > B.b.spawnN + 20) continue;
    for (const w of B.waves) {
      const F = FACE_W(w.A), q = (n - (w.n - F)) / F;      // 0 bottom .. 1 lip
      if (q >= -0.15 && q <= 1.05) {
        const broken = w.broke && s >= w.broke[0] && s <= w.broke[1];
        const inRange = s >= B.s0 && s <= B.s1;
        return { B, w, s, n, q, broken, inRange, F };
      }
    }
  }
  return null;
}
export { waveAt };

function enterWater() {
  R.sport = "surf"; R.state = "paddle"; R.vy = 0; R.y = waterLevel(R.x, R.z);
  hooks.sfx("splash");
}
function stepSurf(dtReal, dt, inp) {
  const inWater = isWater(R.x, R.z);
  if (!inWater && R.state !== "air") {
    // walked out of the sea
    const g = groupAt(R.x, R.z); R.sport = sportFor(g); R.state = "ride"; R.y = surfaceAt(R.x, R.z).h; R.vx *= 0.3; R.vz *= 0.3;
    return;
  }
  const wv = waveAt(R.x, R.z);
  if (R.state === "paddle") {
    R.pose = "prone";
    if (inp.mag > 0.2) {
      const t = Math.atan2(inp.jx, inp.jy); const d = wrap(t - R.a);
      R.a = wrap(R.a + clamp(d, -2.4 * dtReal, 2.4 * dtReal));
      R.vx += Math.sin(R.a) * 1.4 * dt * inp.mag; R.vz += Math.cos(R.a) * 1.4 * dt * inp.mag;
    }
    R.vx *= Math.exp(-0.9 * dt); R.vz *= Math.exp(-0.9 * dt);
    // the wave pushes you toward the beach as it passes
    if (wv && wv.inRange) { R.vx += -wv.B.N[0] * 1.2 * dt * (1 - Math.abs(wv.q - 0.6)); R.vz += -wv.B.N[1] * 1.2 * dt * (1 - Math.abs(wv.q - 0.6)); }
    if (wv && wv.broken && wv.q > 0.1) { R.vx += -wv.B.N[0] * 3 * dt; R.vz += -wv.B.N[1] * 3 * dt; }
    moveSurf(dt);
    R.y = waterLevel(R.x, R.z) + (wv ? wv.q * wv.w.A * 0.5 : 0);
    // pop up on an unbroken face
    if (inp.A) {
      if (wv && wv.inRange && !wv.broken && wv.q > 0.25 && wv.q < 0.95) {
        R.state = "surf"; R.wave = wv.w; R.waveB = wv.B;
        // go toward the open shoulder, angled a little down the face
        const B = wv.B; let dir = B.b.pdir !== 0 ? B.b.pdir : (wv.s >= B.b.peak ? 1 : -1);
        const ang = Math.atan2(B.T[0] * dir - B.N[0] * 0.35, B.T[1] * dir - B.N[1] * 0.35);
        R.a = ang; R.ws = wv.s; R.wq = Math.max(0.35, Math.min(0.8, wv.q)); R.wv = 6;
        R.ridesWave = 0; R.tubeT = 0; R.lastTurnA = R.a; R.turnAcc = 0;
        hooks.flash("UP!"); hooks.sfx("wave");
      } else hooks.flash(wv && wv.broken ? "TOO LATE - IT BROKE" : "WAIT FOR A WAVE");
    }
    return;
  }
  if (R.state === "air") { stepSurfAir(dtReal, dt, inp); return; }
  // ---- riding the face, worked out in the wave's own frame: s along the wave, q from trough (0) to lip (1)
  const B = R.waveB, w = R.wave;
  const endRide = (msg) => { R.state = "paddle"; hooks.trick("WAVE RIDE", Math.round(R.ridesWave * 140 * w.A / 3), 0); if (msg) hooks.flash(msg); };
  if (!B || !w || !B.waves.includes(w)) { R.state = "paddle"; hooks.trick("WAVE RIDE", Math.round(R.ridesWave * 140), 0); return; }
  if (inp.mag > 0.2) {
    const t = Math.atan2(inp.jx, inp.jy); const d = wrap(t - R.a);
    R.a = wrap(R.a + clamp(d, -TURN.surf * dtReal, TURN.surf * dtReal));
  }
  const F = FACE_W(w.A), slope = w.A / F;
  const fx = Math.sin(R.a), fz = Math.cos(R.a);
  const hT = fx * B.T[0] + fz * B.T[1], hN = fx * B.N[0] + fz * B.N[1];   // hN > 0 = up the face (out to sea)
  // dropping down the face builds speed, climbing costs it, the pocket by the curl drives you
  R.wv += (-GRAV * slope * hN * 1.1 - 0.35 - 0.012 * R.wv * R.wv) * dt;
  let nearCurl = false;
  if (w.broke) {
    const edge = R.ws > w.broke[1] ? w.broke[1] : R.ws < w.broke[0] ? w.broke[0] : null;
    if (edge != null && Math.abs(R.ws - edge) < 16) { R.wv += 2.6 * dt; nearCurl = Math.abs(R.ws - edge) < 6; }
  }
  R.wv = clamp(R.wv, 0, 17);
  R.ws += R.wv * hT * dt;
  R.wq += R.wv * hN * dt / F * 0.9;
  if (inp.mag < 0.2) R.wq += (0.55 - R.wq) * 0.5 * dt;          // let go and you settle into the pocket
  const n = w.n - F + R.wq * F;
  R.x = B.O[0] + B.T[0] * R.ws + B.N[0] * n; R.z = B.O[1] + B.T[1] * R.ws + B.N[1] * n;
  R.vx = B.T[0] * R.wv * hT + B.N[0] * R.wv * hN * 0.9 - B.N[0] * WAVE_C; R.vz = B.T[1] * R.wv * hT + B.N[1] * R.wv * hN * 0.9 - B.N[1] * WAVE_C;
  R.y = waterLevel(R.x, R.z) + clamp(R.wq, 0, 1) * w.A * 0.6;
  R.pose = R.wv > 10 ? "tuck" : "ride";
  R.ridesWave += dtReal;
  if (nearCurl && R.wq < 0.45) { R.tubeT += dtReal; if (R.tubeT > 0.8 && !R.tubeCalled) { R.tubeCalled = true; hooks.trick("TUBE RIDE!", 600, 1); } } else { R.tubeT = 0; R.tubeCalled = false; }
  // cutbacks: a big turn back toward the curl
  R.turnAcc += Math.abs(wrap(R.a - R.lastTurnA)); R.lastTurnA = R.a;
  if (R.turnAcc > 2.4) { R.turnAcc = 0; hooks.trick("CUTBACK", 250, 0.5); }
  R.turnAcc = Math.max(0, R.turnAcc - dtReal * 0.8);
  // the whitewater catches you if you're behind the curl (unless you're tucked in the barrel)
  const broken = w.broke && R.ws >= w.broke[0] && R.ws <= w.broke[1];
  if (broken && !(R.tubeT > 0 && R.wq < 0.45)) { bail("WIPEOUT!"); R.sport = "surf"; return; }
  if (R.wq > 1.08) { endRide("OFF THE BACK"); return; }
  if (R.wq < -0.25 || R.wv < 0.8) { endRide(R.wv < 0.8 ? "LOST THE WAVE" : "OUT ON THE FLATS"); return; }
  if (R.ws < B.s0 - 3 || R.ws > B.s1 + 3) { endRide("END OF THE WAVE"); return; }
  if (w.n < B.b.dieN + 4) { endRide("RODE IT TO THE BEACH"); return; }
  // aerial off the lip
  if (inp.A && R.wq > 0.72 && R.wv > 6) {
    R.state = "air"; R.vy = 4.8; R.y += 0.2; startAir(null); hooks.sfx("jump");
  }
}
function stepSurfAir(dtReal, dt, inp) {
  const B = R.waveB, w = R.wave;
  stepAirSpinOnly(dtReal, inp);
  R.vy -= GRAV * 0.62 * dt; R.y += R.vy * dt;
  moveSurf(dt);
  const base = waterLevel(R.x, R.z);
  if (R.y <= base + 0.5) {
    if (!B || !w || !B.waves.includes(w)) { R.state = "paddle"; return; }
    const [s_, n_] = waveFrame(B, R.x, R.z); R.ws = s_; R.wq = clamp((n_ - (w.n - FACE_W(w.A))) / FACE_W(w.A), 0.2, 0.9);
    const spins = Math.round(R.spin / Math.PI) * 180;
    const mv = Math.atan2(R.vx, R.vz); const d = Math.abs(wrap(R.a - mv));
    if (d > 1.0 || R.grab > 0.25) { bail("WIPEOUT!"); R.sport = "surf"; return; }
    R.state = "surf"; R.vy = 0; hooks.sfx("land"); R.wv = Math.max(R.wv, 5);
    const parts = []; if (spins >= 180) parts.push("AIR " + spins); parts.push(...R.tricksThisAir); if (!parts.length) parts.push("AERIAL");
    hooks.trick(parts.join(" + "), 300 + Math.round(spins / 180) * 200 + R.tricksThisAir.length * 200, R.air);
  }
}
function stepAirSpinOnly(dtReal, inp) {
  R.air += dtReal;
  if (inp.B) bTapT = 0;
  if (inp.Bh) { bTapT += dtReal; if (bTapT > 0.16) { const dir = inp.jx < -0.3 ? -1 : 1; const r = 7 * dtReal * dir; R.a = wrap(R.a + r); R.spin += Math.abs(r); } }
  else if (lastB && bTapT <= 0.16) { R.grab = 0.6; const L = ["ALLEY-OOP", "AIR REVERSE", "GRAB"]; const n = L[Math.floor(Math.random() * 3)]; if (!R.tricksThisAir.includes(n)) R.tricksThisAir.push(n); }
  lastB = inp.Bh; if (R.grab > 0) R.grab -= dtReal;
  R.pose = R.grab > 0 ? "grab" : "air";
}
function moveSurf(dt) {
  const nx = R.x + R.vx * dt, nz = R.z + R.vz * dt;
  if (solidAt(nx, nz)) { R.vx *= -0.3; R.vz *= -0.3; return; }
  R.x = nx; R.z = nz;
}

export const wrap = a => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
export function speedKmh() { return Math.hypot(R.vx, R.vz) * 3.6; }
