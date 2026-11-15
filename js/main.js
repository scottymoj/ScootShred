// Scoot Shred 8-Bit: game loop, camera, drawing, controls, HUD, menus and map
import * as D from "./data.js";
const D_objT = D.objT;
import { W, G, hAt, isWater, pidAt, placeName, waterLevel } from "./data.js";
import * as RD from "./render.js";
import { gx, gy, PX, CP, LIFT_H, DIFF_RGB } from "./render.js";
import * as SIM from "./sim.js";
import { R, TS } from "./sim.js";
import { riderSprite, carSprite, gullSprite, chairSprite, LOOKS } from "./sprites.js";
import { NPCS, initNPCs, stepNPCs, carHit } from "./npc.js";
import * as WXM from "./weather.js";
import { WX } from "./weather.js";
import { drawText, drawTextC, drawTextR, textWidth } from "./font.js";
import * as AU from "./audio.js";

const cv = document.getElementById("game");
const SCR = cv.getContext("2d");
let ctx = SCR;                                   // current drawing target (the screen, or the turning view's ground layer)
let VW = 320, VH = 200, SCALE = 1;
const SAFE = { l: 0, r: 0, t: 0, b: 0 };      // notch and home-bar insets, in game pixels

// ---------------- save data
const SAVE_KEY = "scootshred8";
const SV = Object.assign({ total: 0, best: {}, look: 0, snow: "snowboard", land: "skate", sound: true, music: true, view: 0, lead: true, wx: true, rot: true, high: 0, last: null, help: false },
  JSON.parse(localStorage.getItem(SAVE_KEY) || "{}"));
const save = () => { try { localStorage.setItem(SAVE_KEY, JSON.stringify(SV)); } catch (e) {} };
AU.AUDIO.sound = SV.sound; AU.AUDIO.music = SV.music;

function resize() {
  const iw = window.innerWidth, ih = window.innerHeight;
  const short = [200, 250, 300][SV.view] || 200;
  SCALE = Math.min(iw, ih) / short;
  VW = Math.round(iw / SCALE); VH = Math.round(ih / SCALE);
  cv.width = VW; cv.height = VH;
  cv.style.width = iw + "px"; cv.style.height = ih + "px";
  ctx.imageSmoothingEnabled = false;
  const el = document.getElementById("safe");
  if (el) { const cs = getComputedStyle(el); SAFE.t = parseFloat(cs.paddingTop) / SCALE || 0; SAFE.r = parseFloat(cs.paddingRight) / SCALE || 0; SAFE.b = parseFloat(cs.paddingBottom) / SCALE || 0; SAFE.l = parseFloat(cs.paddingLeft) / SCALE || 0; }
}
window.addEventListener("resize", resize); window.addEventListener("orientationchange", () => setTimeout(resize, 250)); resize();

// ---------------- input
const keys = new Set();
const INP = { jx: 0, jy: 0, mag: 0, A: false, Ah: false, B: false, Bh: false, brake: false, brakeH: false, T: false, Th: false };
const touch = { stick: null, sx: 0, sy: 0, cx: 0, cy: 0, a: null, b: null, t: null };
const STICK = { x: 42, y: 160, r: 26 };       // fixed joystick: centre and travel (set each frame in drawControls)
let tapQueue = [];
window.addEventListener("keydown", e => {
  if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " ", "Tab"].includes(e.key)) e.preventDefault();
  if (!keys.has(e.code)) onKeyPress(e.code);
  keys.add(e.code); AU.unlock();
});
window.addEventListener("keyup", e => keys.delete(e.code));
function toV(e) { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) / r.width * VW, (e.clientY - r.top) / r.height * VH]; }
const btns = [];          // active on-screen buttons this frame: {x,y,w,h,id,cb}
function hitBtn(x, y) { for (let k = btns.length - 1; k >= 0; k--) { const b = btns[k]; if (x >= b.x && y >= b.y && x < b.x + b.w && y < b.y + b.h) return b; } return null; }
cv.addEventListener("pointerdown", e => {
  e.preventDefault(); AU.unlock(); cv.setPointerCapture(e.pointerId);
  const [x, y] = toV(e);
  const b = hitBtn(x, y);
  if (state === "play" && b && (b.id === "A" || b.id === "B" || b.id === "T")) { touch[b.id.toLowerCase()] = e.pointerId; if (b.id === "A") INP.A = true; else if (b.id === "B") INP.brake = true; else INP.T = true; return; }
  if (b) { AU.sfx("menu"); b.cb && b.cb(x, y); return; }
  // fixed joystick: touch on or near the stick in the bottom-left corner
  if (state === "play" && touch.stick == null && Math.hypot(x - STICK.x, y - STICK.y) < STICK.r * 1.9) { touch.stick = e.pointerId; touch.cx = x; touch.cy = y; return; }
  if (state === "map") mapDown(e.pointerId, x, y);
  else tapQueue.push([x, y]);
});
cv.addEventListener("pointermove", e => {
  const [x, y] = toV(e);
  if (e.pointerId === touch.stick) { touch.cx = x; touch.cy = y; }
  if (state === "map") mapMove(e.pointerId, x, y);
});
const up = e => {
  if (e.pointerId === touch.stick) touch.stick = null;
  if (e.pointerId === touch.a) touch.a = null;
  if (e.pointerId === touch.b) touch.b = null;
  if (e.pointerId === touch.t) touch.t = null;
  if (state === "map") mapUp(e.pointerId, ...toV(e));
};
cv.addEventListener("pointerup", up); cv.addEventListener("pointercancel", up);
cv.addEventListener("contextmenu", e => e.preventDefault());

let AUTO = null;             // test autopilot: follow a run or trail
function autopilot() {
  const P = AUTO.p, pts = P.p;
  let best = AUTO.i, bd = 1e9;
  for (let k = Math.max(0, AUTO.i - 3); k < Math.min(pts.length, AUTO.i + 16); k++) { const d = Math.hypot(pts[k][0] - R.x, pts[k][1] - R.z); if (d < bd) { bd = d; best = k; } }
  AUTO.i = best;
  // aim at a point about 12 m further along the line; brake for corners like a rider would
  const tg = pts[Math.min(pts.length - 1, best + 3)];
  const dx = tg[0] - R.x, dz = tg[1] - R.z, n = Math.hypot(dx, dz) || 1;
  INP.jx = dx / n; INP.jy = dz / n; INP.mag = 1;
  const sp = Math.hypot(R.vx, R.vz);
  let turn = 0;
  for (let k = best; k < Math.min(pts.length - 4, best + 10); k += 2) {
    const a1 = Math.atan2(pts[k + 2][0] - pts[k][0], pts[k + 2][1] - pts[k][1]), a2 = Math.atan2(pts[k + 4][0] - pts[k + 2][0], pts[k + 4][1] - pts[k + 2][1]);
    turn = Math.max(turn, Math.abs(SIM.wrap(a2 - a1)));
  }
  const vmax = (AUTO.vmax || 20) * (turn > 0.5 ? 0.55 : turn > 0.25 ? 0.75 : 1);
  if (R.state === "ride") INP.Bh = sp > vmax || bd > 8 && sp > 8;
  AUTO.maxv = Math.max(AUTO.maxv, sp * 3.6); AUTO.t += 1 / 60;
  if (best >= pts.length - 2 && bd < 30) AUTO.done = true;
}
function readInput() {
  let jx = 0, jy = 0;
  if (keys.has("ArrowLeft") || keys.has("KeyA")) jx -= 1;
  if (keys.has("ArrowRight") || keys.has("KeyD")) jx += 1;
  if (keys.has("ArrowUp") || keys.has("KeyW")) jy -= 1;
  if (keys.has("ArrowDown") || keys.has("KeyS")) jy += 1;
  let mag = Math.min(1, Math.hypot(jx, jy));
  if (touch.stick != null) {
    const dx = touch.cx - STICK.x, dy = touch.cy - STICK.y, d = Math.hypot(dx, dy);
    jx = dx; jy = dy; mag = d < 3 ? 0 : Math.min(1, d / STICK.r);
  }
  const n = Math.hypot(jx, jy) || 1;
  INP.jx = jx / n; INP.jy = jy / n; INP.mag = mag;
  if (rotOn()) {                         // turning view: up = forward, left = turn left
    const th = camA - Math.PI, c = Math.cos(-th), sn = Math.sin(-th);
    const wx = INP.jx * c - INP.jy * sn, wz = INP.jx * sn + INP.jy * c; INP.jx = wx; INP.jy = wz;
  }
  INP.Ah = keys.has("Space") || keys.has("KeyJ") || touch.a != null;
  // B = brake on the ground; TRICK = grabs, flips and spins in the air. Shift / K still do both on a keyboard.
  const shift = keys.has("ShiftLeft") || keys.has("ShiftRight") || keys.has("KeyK");
  INP.brakeH = shift || touch.b != null;
  INP.Th = shift || keys.has("KeyL") || touch.t != null;
  const inAir = R.state === "air";
  INP.Bh = inAir ? INP.Th : INP.brakeH;
  INP.B = inAir ? INP.T || INP.B : INP.brake || INP.B;
  INP.brake = false; INP.T = false;
  if (AUTO && state === "play" && !AUTO.done) autopilot();
}
function onKeyPress(code) {
  if (state === "play") {
    if (code === "Space" || code === "KeyJ") INP.A = true;
    if (code === "ShiftLeft" || code === "ShiftRight" || code === "KeyK") INP.B = true;
    if (code === "KeyL") INP.T = true;
    if (code === "KeyM") openMap();
    if (code === "KeyP" || code === "Escape") state = "pause";
    if (code === "KeyQ" || code === "Tab") switchSport();
  } else if (state === "map" && (code === "KeyM" || code === "Escape")) state = "play";
  else if (state === "pause" && (code === "KeyP" || code === "Escape")) state = "play";
  else if (state === "title" && (code === "Space" || code === "Enter")) state = "start";
}

// ---------------- game state
let state = "loading", loadP = 0;
let cam = { x: 880, z: 200 }, camLead = { x: 0, z: 0 };
let clock = 9.0;                           // hour of day
let absH = Math.random() * 240;               // game hours since start (weather changes every 8)
let lastCamPx = null;
let camA = Math.PI, lastRx = null, lastRz = null;   // turning view: heading the screen faces (PI = north up)
const MENU_STATES = new Set(["title", "start", "rider", "help", "settings"]);
const rotOn = () => SV.rot !== false && (state === "play" || state === "pause");
let GL = null, GL2 = null;                           // offscreen ground and lights layers for the turning view
let score = { pending: 0, n: 0, lastT: -99, mult: 1 };
let flashes = [], banner = null, areaName = "", areaT = 0;
let parts = [];
let waypoint = null;
let runT = null;                           // {p, idx, t, off}
let tNow = 0;
let attract = { t: 0 };
const look = () => LOOKS[SV.look % LOOKS.length];

SIM.hooks.flash = (t, col) => flash(t, col);
SIM.hooks.sfx = n => AU.sfx(n);
SIM.hooks.trick = (name, pts, air) => {
  if (pts <= 0) return;
  if (tNow - score.lastT > 3.5 && score.pending) bank();
  score.pending += pts; score.n++; score.mult = Math.min(8, score.n); score.lastT = tNow;
  flash(name, "#ffe066", "+" + pts + (score.mult > 1 ? "  X" + score.mult : ""));
};
SIM.hooks.bail = msg => {
  if (AUTO) { AUTO.bails++; { const q = AUTO.p.p[AUTO.i]; (AUTO.log = AUTO.log || []).push(msg + "@" + AUTO.i + " off " + Math.round(Math.hypot(q[0] - R.x, q[1] - R.z)) + "m [" + (R.dbg || "") + "]"); } }
  if (score.pending) flash("COMBO LOST", "#ff6060");
  score.pending = 0; score.n = 0; score.mult = 1;
  flash(msg, "#ff5050"); shake = 0.35;
};
function bank() {
  if (!score.pending) return;
  const v = score.pending * score.mult; SV.total += v; SV.high = Math.max(SV.high, v);
  flash("+" + v.toLocaleString(), "#7cff8a"); AU.sfx("coin"); save();
  score.pending = 0; score.n = 0; score.mult = 1;
}
function flash(t, col = "#fff", sub = "") { flashes.push({ t: String(t), col, sub, life: 1.8 }); if (flashes.length > 4) flashes.shift(); }
let shake = 0;

function switchSport() {
  const g = SIM.groupAt(R.x, R.z);
  if (g === "water") { flash("SURF ONLY IN THE SEA"); return; }
  if (g === "snow") { SV.snow = SV.snow === "snowboard" ? "ski" : "snowboard"; R.snowSport = SV.snow; }
  else if (g === "dirt") { R.dirtSport = (R.dirtSport || "bike") === "bike" ? "skate" : "bike"; }
  else { SV.land = SV.land === "skate" ? "bike" : "skate"; R.landSport = SV.land; }
  if (R.state === "ride") { R.sport = SIM.sportFor(g); flash(R.sport.toUpperCase()); }
  save();
}

// ---------------- boot
async function boot() {
  try {
    await D.load(p => loadP = p);
  } catch (e) { state = "error"; errMsg = String(e.message || e); return; }
  R.snowSport = SV.snow; R.landSport = SV.land;
  SIM.initWaves(); initNPCs();
  mapImg = RD.buildMapImage();
  state = "title";
  const s = W.spots.find(s => s.n === "Mountain Village") || W.spots[0];
  cam.x = s.x; cam.z = s.z;
}
let errMsg = "";
boot();

// ---------------- main loop
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now; tNow += dt;
  btns.length = 0;
  readInput();
  if (state === "loading" || state === "error") drawLoading();
  else if (state === "title" || state === "start" || state === "rider" || state === "help" || state === "settings") { updateAttract(dt); drawWorld(); drawMenus(dt); }
  else if (state === "play") { update(dt); drawWorld(); drawHUD(dt); drawControls(); }
  else if (state === "pause") { drawWorld(); drawHUD(0); drawPause(); }
  else if (state === "map") { drawMap(); }
  INP.A = false; INP.B = false; tapQueue.length = 0;
  AU.tickMusic();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

function update(dt) {
  clock = (clock + dt / 50) % 24;
  stepWeatherAll(dt, R.x, R.z);
  // lift prompt
  const L = R.state === "ride" ? SIM.nearLift() : null;
  if (L && INP.A) { SIM.startLift(L); INP.A = false; }
  SIM.step(dt, INP);
  SIM.stepWaves(dt);
  stepNPCs(dt, R.x, R.z);
  if (R.state === "ride" && Math.hypot(R.vx, R.vz) > 4 && carHit(R.x, R.z)) SIM.bail("HIT BY A CAR!");
  if (score.pending && tNow - score.lastT > 3.5) bank();
  // camera looks ahead in the direction of travel
  // lead grows with speed (full at ~65 km/h) and with the screen: up to 55% of the half-screen in each direction
  let lx = 0, lz = 0;
  const spd = Math.hypot(R.vx, R.vz);
  if (SV.lead !== false && spd > 1 && R.state !== "bail") {
    const f = Math.min(1, (spd - 1) / 17), hx = VW / 2 / PX, hz = VH / 2 / PX;
    lx = R.vx / spd * f * hx * 0.55; lz = R.vz / spd * f * hz * 0.55;
  }
  const kk = Math.min(1, dt * (spd > 1 ? 1.6 : 1.0));
  camLead.x += (lx - camLead.x) * kk; camLead.z += (lz - camLead.z) * kk;
  cam.x = R.x + camLead.x; cam.z = R.z + camLead.z;
  {
    const sp = Math.hypot(R.vx, R.vz);
    let tgt = sp > 2 ? Math.atan2(R.vx, R.vz) : R.a;
    const jumped = lastRx == null || Math.hypot(R.x - lastRx, R.z - lastRz) > 30;
    if (jumped) camA = tgt;
    else if (R.state !== "bail") camA = SIM.wrap(camA + SIM.wrap(tgt - camA) * Math.min(1, dt * (sp > 2 ? 2.4 : 1.4)));
    lastRx = R.x; lastRz = R.z;
  }
  shake = Math.max(0, shake - dt);
  // particles
  const sp = Math.hypot(R.vx, R.vz);
  if (R.spray && sp > 6) { for (let k = 0; k < 3; k++) parts.push({ x: R.x, z: R.z, y: 0, vx: R.vx * 0.3 + (Math.random() - 0.5) * 3, vz: R.vz * 0.3 + (Math.random() - 0.5) * 3, vy: 2 + Math.random() * 2, life: 0.5, col: "#f4f8ff" }); R.spray = 0; }
  if (R.state === "surf" && sp > 4 && Math.random() < 0.7) parts.push({ x: R.x, z: R.z, y: 0, vx: (Math.random() - 0.5) * 2, vz: (Math.random() - 0.5) * 2, vy: 2.5, life: 0.5, col: "#e8fbff" });
  if (R.state === "ride" && R.sport === "bike" && sp > 6 && SIM.groupAt(R.x, R.z) === "dirt" && Math.random() < 0.5) parts.push({ x: R.x, z: R.z, y: 0, vx: -R.vx * 0.1, vz: -R.vz * 0.1, vy: 1, life: 0.6, col: "#b08a60" });
  for (const p of parts) { p.x += p.vx * dt * TS; p.z += p.vz * dt * TS; p.y += p.vy * dt * TS; p.vy -= 6 * dt * TS; p.life -= dt; }
  parts = parts.filter(p => p.life > 0 && p.y > -0.5); if (parts.length > 200) parts.splice(0, parts.length - 200);
  // area names
  areaT -= dt;
  if (Math.floor(tNow * 2) % 2 === 0) {
    const n = placeName(R.x, R.z);
    if (n && n !== areaName) { areaName = n; areaT = 2.6; }
  }
  updateRun(dt);
  // waypoint reached
  if (waypoint && Math.hypot(waypoint[0] - R.x, waypoint[1] - R.z) < 25) { waypoint = null; flash("WAYPOINT REACHED", "#ff66cc"); AU.sfx("coin"); }
  // music by area
  const g = SIM.groupAt(R.x, R.z);
  AU.setSong(R.sport === "surf" || g === "sand" ? "surf" : g === "snow" ? "snow" : R.sport === "bike" ? "bike" : "city");
  if (Math.floor(tNow) % 5 === 0) { SV.last = [R.x, R.z, R.a]; }
}

function updateRun(dt) {
  const sp = Math.hypot(R.vx, R.vz);
  if (!runT && (R.state === "ride" || R.state === "air") && sp > 2) {
    for (let k = 0; k < W.paths.length; k++) {
      const p = W.paths[k]; if (p.k !== "run" && p.k !== "trail") continue;
      const [x, z] = p.p[0];
      if (Math.abs(x - R.x) < 22 && Math.abs(z - R.z) < 22 && Math.hypot(x - R.x, z - R.z) < 20) { runT = { p, idx: k, t: 0, off: 0 }; flash(p.n, "#9ad8ff", "TIMER STARTED"); break; }
    }
  }
  if (!runT) return;
  runT.t += dt;
  const onIt = pidAt(R.x, R.z) === runT.idx + 1 || Math.hypot(R.x - runT.p.p[0][0], R.z - runT.p.p[0][1]) < 40;
  runT.off = onIt ? 0 : runT.off + dt;
  const e = runT.p.p[runT.p.p.length - 1];
  if (Math.hypot(R.x - e[0], R.z - e[1]) < 28 && runT.t > 5) {
    const best = SV.best[runT.p.n];
    const nb = !best || runT.t < best;
    if (nb) SV.best[runT.p.n] = Math.round(runT.t * 10) / 10;
    flash(runT.p.n + " " + fmtT(runT.t), nb ? "#7cff8a" : "#fff", nb ? "NEW BEST!" : "BEST " + fmtT(best));
    SV.total += 500; save(); AU.sfx("coin");
    runT = null; return;
  }
  if (runT.off > 10 || R.state === "lift") runT = null;
}
const fmtT = t => Math.floor(t / 60) + ":" + String(Math.floor(t % 60)).padStart(2, "0") + "." + Math.floor((t * 10) % 10);

// ---------------- drawing the world
let mapImg = null;
function camPx() {
  const sx = (shake > 0 ? (Math.random() - 0.5) * 3 : 0), sy = (shake > 0 ? (Math.random() - 0.5) * 3 : 0);
  return [Math.round(gx(cam.x) - VW / 2 + sx), Math.round(gy(cam.z) - VH / 2 + sy)];
}
function drawWorld() {
  if (rotOn()) { drawWorldRot(); return; }
  VIEWA = 0;
  const [L, T] = camPx();
  ctx.fillStyle = "#1c4a96"; ctx.fillRect(0, 0, VW, VH);
  for (let cj = Math.floor(T / CP); cj <= Math.floor((T + VH) / CP); cj++)
    for (let ci = Math.floor(L / CP); ci <= Math.floor((L + VW) / CP); ci++)
      ctx.drawImage(RD.chunkCanvas(ci, cj), ci * CP - L, cj * CP - T);
  drawWaves(L, T);
  // moving things, sorted by their ground row
  const list = [];
  const inView = (x, z, m = 40) => { const px = gx(x) - L, py = gy(z) - T; return px > -m && py > -m && px < VW + m && py < VH + m * 2; };
  for (const n of NPCS) if (inView(n.x, n.z)) list.push({ y: gy(n.z), n });
  for (const Lf of W.lifts) liftChairs(Lf, list, inView);
  for (const Lm of W.landmarks || []) if ((Lm.t === "lighthouse" || Lm.t === "ferris") && inView(Lm.x, Lm.z, 80)) list.push({ y: gy(Lm.z), lm: Lm });
  if (state !== "title" && state !== "start" && state !== "rider" && state !== "help" && state !== "settings") list.push({ y: gy(R.z) + 0.5, me: true });
  list.sort((a, b) => a.y - b.y);
  for (const it of list) {
    if (it.me) drawMe(L, T);
    else if (it.n) drawNPC(it.n, L, T);
    else if (it.chair) ctx.drawImage(chairSprite(it.cab), Math.round(it.px - L - 3), Math.round(it.py - T));
    else if (it.lm) drawLandmark(it.lm, L, T);
  }
  for (const p of parts) { ctx.fillStyle = p.col; ctx.fillRect(Math.round(gx(p.x) - L), Math.round(gy(p.z) - T - p.y * 2), 1, 1); }
  WXM.drawCloud(ctx, VW, VH);
  const a = dayNight();
  nightLights(L, T, a);
  WXM.drawPrecip(ctx, VW, VH);
}
let VIEWA = 0;      // add to a world heading to get the heading on screen (0 = north up)
// ---- the turning view: ground drawn flat from above and rotated; trees, people and cars drawn standing up
let ROT = { th: 0, c: 1, s: 0, cx: 0, cy: 0, X0: 0, Y0: 0 };
function toS(x, z) { const dx = gx(x) - ROT.cx, dy = gy(z) - ROT.cy; return [ROT.X0 + dx * ROT.c - dy * ROT.s, ROT.Y0 + dx * ROT.s + dy * ROT.c]; }
function toSpx(px, py) { const dx = px - ROT.cx, dy = py - ROT.cy; return [ROT.X0 + dx * ROT.c - dy * ROT.s, ROT.Y0 + dx * ROT.s + dy * ROT.c]; }
function drawWorldRot() {
  const th = camA - Math.PI;
  const sh = shake > 0 ? [(Math.random() - 0.5) * 3, (Math.random() - 0.5) * 3] : [0, 0];
  ROT = { th, c: Math.cos(th), s: Math.sin(th), cx: gx(R.x), cy: gy(R.z), X0: Math.round(VW / 2 + sh[0]), Y0: Math.round(VH * (SV.lead !== false ? 0.66 : 0.5) + sh[1]) };
  VIEWA = Math.PI - camA;
  // size of the ground square that covers the whole screen at any angle
  const D = Math.ceil(2 * Math.hypot(Math.max(ROT.X0, VW - ROT.X0), Math.max(ROT.Y0, VH - ROT.Y0))) + 8;
  if (!GL || GL.width !== D) { GL = document.createElement("canvas"); GL.width = GL.height = D; GL2 = document.createElement("canvas"); GL2.width = GL2.height = D; }
  const L = Math.round(ROT.cx - D / 2), T = Math.round(ROT.cy - D / 2);
  // ground layer: flat chunks and waves, drawn north-up into G
  const g = GL.getContext("2d"); g.imageSmoothingEnabled = false;
  g.fillStyle = "#1c4a96"; g.fillRect(0, 0, D, D);
  for (let cj = Math.floor(T / CP); cj <= Math.floor((T + D) / CP); cj++)
    for (let ci = Math.floor(L / CP); ci <= Math.floor((L + D) / CP); ci++)
      g.drawImage(RD.chunkCanvas(ci, cj, true), ci * CP - L, cj * CP - T);
  { const sv = [ctx, VW, VH]; ctx = g; VW = D; VH = D; try { drawWaves(L, T); } finally { [ctx, VW, VH] = sv; } }
  const blit = (cvs, alpha) => {
    ctx.save(); ctx.imageSmoothingEnabled = false; if (alpha != null) ctx.globalAlpha = alpha;
    ctx.translate(ROT.X0, ROT.Y0); ctx.rotate(th); ctx.drawImage(cvs, L - ROT.cx, T - ROT.cy); ctx.restore();
  };
  ctx.fillStyle = "#1c4a96"; ctx.fillRect(0, 0, VW, VH);
  blit(GL);
  // everything that stands up, sorted by its row on the screen
  const list = [], M = 30;
  const onS = (sx, sy, m = M) => sx > -m && sy > -m && sx < VW + m && sy < VH + m * 2;
  const r = Math.ceil(D / 2 / RD.TP) + 1, ci0 = Math.floor(ROT.cx / RD.TP), cj0 = Math.floor(ROT.cy / RD.TP);
  for (let j = cj0 - r; j <= cj0 + r; j++) for (let i = ci0 - r; i <= ci0 + r; i++) {
    const o = D_objT(i, j); if (!o || !RD.UPRIGHT.has(o)) continue;
    const [bx, by] = RD.objBase(i, j), [sx, sy] = toSpx(bx, by);
    if (onS(sx, sy)) list.push({ y: sy, o, sx, sy });
  }
  for (const n of NPCS) { const [sx, sy] = toS(n.x, n.z); if (onS(sx, sy)) list.push({ y: sy, n, sx, sy }); }
  { const inV = (x, z) => { const [sx, sy] = toS(x, z); return onS(sx, sy); }; for (const Lf of W.lifts) liftChairs(Lf, list, inV); }
  for (const it of list) if (it.chair) { const [sx, sy] = toSpx(it.gpx, it.gpy); it.sx = sx; it.sy = sy; it.y = sy; }
  for (const Lm of W.landmarks || []) if (Lm.t === "lighthouse" || Lm.t === "ferris") { const [sx, sy] = toS(Lm.x, Lm.z); if (onS(sx, sy, 90)) list.push({ y: sy, lm: Lm, sx, sy }); }
  list.push({ y: ROT.Y0 + 0.5, me: true });
  list.sort((a, b) => a.y - b.y);
  const lamps = [];
  for (const it of list) {
    if (it.me) drawMe(gx(R.x) - ROT.X0, gy(R.z) - ROT.Y0);
    else if (it.o) { const sp = RD.objSprite(it.o); if (!sp) continue; const x0 = Math.round(it.sx) - sp.ax, y0 = Math.round(it.sy) - sp.ay; ctx.drawImage(sp.cv, x0, y0); if (sp.lamp) lamps.push([x0 + 1, y0 + 1]); }
    else if (it.n) drawNPC(it.n, gx(it.n.x) - it.sx, gy(it.n.z) - it.sy);
    else if (it.chair) ctx.drawImage(chairSprite(it.cab), Math.round(it.sx - 3), Math.round(it.sy - LIFT_H));
    else if (it.lm) drawLandmark(it.lm, gx(it.lm.x) - it.sx, gy(it.lm.z) - it.sy);
  }
  for (const p of parts) { const [sx, sy] = toS(p.x, p.z); ctx.fillStyle = p.col; ctx.fillRect(Math.round(sx), Math.round(sy - p.y * 2), 1, 1); }
  WXM.drawCloud(ctx, VW, VH);
  const a = dayNight();
  // night: ground lights layer (rotated like the ground), lamp heads, car headlights
  const s = Math.min(1, (a - 0.08) / 0.3);
  if (s > 0) {
    const g2 = GL2.getContext("2d"); g2.clearRect(0, 0, D, D);
    let any = false;
    for (let cj = Math.floor(T / CP); cj <= Math.floor((T + D) / CP); cj++)
      for (let ci = Math.floor(L / CP); ci <= Math.floor((L + D) / CP); ci++) { const lc = RD.lightsCanvas(ci, cj, true); if (lc) { g2.drawImage(lc, ci * CP - L, cj * CP - T); any = true; } }
    if (any) blit(GL2, s);
    ctx.save(); ctx.globalAlpha = s; ctx.globalCompositeOperation = "lighter";
    for (const [x, y] of lamps) { ctx.fillStyle = "rgba(255,240,180,0.9)"; ctx.fillRect(x, y, 1, 1); ctx.fillStyle = "rgba(255,214,130,0.22)"; ctx.fillRect(x - 2, y - 2, 5, 5); ctx.fillRect(x - 1, y - 3, 3, 7); ctx.fillRect(x - 3, y - 1, 7, 3); }
    for (const n of NPCS) {
      if (n.t !== "car") continue;
      const [px, py] = toS(n.x, n.z);
      if (px < -40 || py < -40 || px > VW + 40 || py > VH + 40) continue;
      const ha = n.a + VIEWA, fx = Math.sin(ha), fz = Math.cos(ha);
      for (let d = 3; d < 22; d++) {
        const w = Math.round(d * 0.35), al = 0.28 * (1 - d / 22);
        ctx.fillStyle = "rgba(255,240,190," + al.toFixed(3) + ")";
        ctx.fillRect(Math.round(px + fx * d * PX * 0.5 - w), Math.round(py + fz * d * PX * 0.5 - 3 - w * 0.5), w * 2 + 1, Math.max(1, w));
      }
    }
    ctx.restore();
  }
  WXM.drawPrecip(ctx, VW, VH);
}
function drawMe(L, T) {
  const px = gx(R.x) - L, py = gy(R.z) - T;
  const ground = R.state === "lift" ? hAt(R.x, R.z) : (R.sport === "surf" ? waterLevel(R.x, R.z) : SIM.surfaceAt(R.x, R.z).h);
  const lift = R.state === "lift" ? LIFT_H : Math.max(0, (R.y - ground)) * 2.5;
  if (lift > 1.5) { ctx.fillStyle = "rgba(0,0,0,0.3)"; ctx.fillRect(Math.round(px - 3), Math.round(py - 1), 7, 2); }
  const spr = riderSprite(R.sport, R.a + VIEWA, R.pose, look());
  ctx.drawImage(spr, Math.round(px - 14), Math.round(py - 20 - lift));
}
function drawNPC(n, L, T) {
  const px = Math.round(gx(n.x) - L), py = Math.round(gy(n.z) - T);
  switch (n.t) {
    case "car": ctx.drawImage(carSprite(n.a + VIEWA, n.col), px - 8, py - 9); break;
    case "skier": ctx.drawImage(riderSprite(n.sport, n.a + VIEWA, "ride", n.look, 1), px - 14, py - 20); break;
    case "biker": ctx.drawImage(riderSprite("bike", n.a + VIEWA, "ride", n.look, 2), px - 14, py - 20); break;
    case "walker": ctx.drawImage(riderSprite(n.skate ? "skate" : "none", n.a + VIEWA, n.skate ? "ride" : "walk", n.look, (n.x | 0) & 3), px - 14, py - 20); break;
    case "surfer": ctx.drawImage(riderSprite("surf", n.a + VIEWA + Math.sin(n.ph) * 0.2, "prone", n.look, 1), px - 14, py - 20 + Math.round(Math.sin(n.ph))); break;
    case "gull": ctx.fillStyle = "rgba(0,0,0,0.2)"; ctx.fillRect(px - 2, py + 10, 4, 1); ctx.drawImage(gullSprite(Math.floor(tNow * 4 + n.ph) & 1), px - 4, py - 16); break;
  }
}
function liftChairs(Lf, list, inView) {
  const len = Math.hypot(Lf.b[0] - Lf.a[0], Lf.b[1] - Lf.a[1]); const gap = Lf.cab ? 60 : 24;
  const x0 = gx(Lf.a[0]), y0 = gy(Lf.a[1]), x1 = gx(Lf.b[0]), y1 = gy(Lf.b[1]);
  const n = Math.hypot(x1 - x0, y1 - y0); const ppx = -(y1 - y0) / n, ppy = (x1 - x0) / n;
  const off = (tNow * TS * 4) % gap;
  for (let s = off; s < len; s += gap) {
    for (const side of [-1, 1]) {
      const t = side > 0 ? s / len : 1 - s / len;
      const wx = Lf.a[0] + (Lf.b[0] - Lf.a[0]) * t, wz = Lf.a[1] + (Lf.b[1] - Lf.a[1]) * t;
      if (!inView(wx, wz)) continue;
      list.push({ y: gy(wz), chair: true, cab: Lf.cab, wx, wz, px: gx(wx) + ppx * 2.5 * side, py: gy(wz) - LIFT_H + ppy * 2.5 * side, gpx: gx(wx) + ppx * 2.5 * side, gpy: gy(wz) + ppy * 2.5 * side });
    }
  }
}

// waves: face, lip and whitewater, drawn straight onto the screen
function drawWaves(L, T) {
  for (const B of SIM.waveList()) {
    const ox = gx(B.O[0]) - L, oy = gy(B.O[1]) - T;
    if (ox < -400 || oy < -400 || ox > VW + 400 || oy > VH + 400) continue;
    for (const w of B.waves) {
      const F = SIM.FACE_W(w.A);
      for (let s = B.s0 - 3; s <= B.s1 + 3; s += 0.5) {
        const fade = Math.min(1, Math.min(s - B.s0 + 3, B.s1 + 3 - s) / 6);
        const broken = w.broke && s >= w.broke[0] && s <= w.broke[1];
        for (let n = w.n - F; n <= w.n + 1.2; n += 0.5) {
          const q = (n - (w.n - F)) / F;
          const x = B.O[0] + B.T[0] * s + B.N[0] * n, z = B.O[1] + B.T[1] * s + B.N[1] * n;
          const px = Math.round(gx(x) - L), py = Math.round(gy(z) - T);
          if (px < 0 || py < 0 || px >= VW || py >= VH) continue;
          let col;
          if (broken) col = (q > 0.2 || Math.random() < 0.6) ? (Math.random() < 0.2 ? "#cfe8f0" : "#f6fbff") : null;
          else if (q > 1.0) col = "#f6fbff";
          else if (q > 0.86) col = "#cfeef6";
          else col = q > 0.55 ? "#2f8fc4" : q > 0.25 ? "#3aa0d0" : "#4cb2da";
          if (col && fade > Math.random() * 0.9) { ctx.fillStyle = col; ctx.fillRect(px, py, 1, 1); }
        }
        if (broken) {      // foam trailing toward the beach
          for (let n = w.n - F - 6; n < w.n - F; n += 0.5) {
            if (Math.random() < 0.35) {
              const x = B.O[0] + B.T[0] * s + B.N[0] * n, z = B.O[1] + B.T[1] * s + B.N[1] * n;
              ctx.fillStyle = "#e8f6fa"; ctx.fillRect(Math.round(gx(x) - L), Math.round(gy(z) - T), 1, 1);
            }
          }
        }
      }
    }
  }
}

// landmarks with their own sprites
function drawLandmark(Lm, L, T) {
  const px = Math.round(gx(Lm.x) - L), py = Math.round(gy(Lm.z) - T);
  if (Lm.t === "lighthouse") {
    const H = Math.round(Lm.h * 1.2), base = 5 * Lm.h / 28 + 2;
    ctx.fillStyle = "rgba(0,0,0,0.3)"; ctx.fillRect(px - 2, py - 1, Math.round(base * 2 + 6), 3);
    for (let y = 0; y < H; y++) {
      const t = y / H, w = Math.round(base * (1 - t * 0.35));
      const band = (t > 0.3 && t < 0.42) || (t > 0.62 && t < 0.74);
      ctx.fillStyle = band ? "#c8281e" : "#f4f4ee"; ctx.fillRect(px - w, py - y, w * 2 + 1, 1);
      ctx.fillStyle = band ? "#8c1a14" : "#c8c8c0"; ctx.fillRect(px + w - 1, py - y, 2, 1);
    }
    const top = py - H;
    ctx.fillStyle = "#26262c"; ctx.fillRect(px - base, top - 1, base * 2 + 1, 2);
    const night = clock < 6.5 || clock > 19.5;
    ctx.fillStyle = night && Math.floor(tNow * 2) % 2 ? "#fff8b0" : "#ffe680"; ctx.fillRect(px - 2, top - 5, 5, 4);
    ctx.fillStyle = "#c8281e"; ctx.fillRect(px - 3, top - 7, 7, 2); ctx.fillRect(px - 1, top - 9, 3, 2);
    if (night) { ctx.fillStyle = "rgba(255,240,160,0.25)"; const a = tNow * 1.2; ctx.beginPath(); ctx.moveTo(px, top - 3); ctx.lineTo(px + Math.cos(a) * 120, top - 3 + Math.sin(a) * 50); ctx.lineTo(px + Math.cos(a + 0.15) * 120, top - 3 + Math.sin(a + 0.15) * 50); ctx.fill(); }
  } else if (Lm.t === "ferris") {
    const Rr = 15, hy = py - Rr - 3;
    ctx.fillStyle = "#e8e8ee";
    for (const k of [-1, 1]) for (let t = 0; t <= 1; t += 0.05) ctx.fillRect(Math.round(px + k * 9 * (1 - t)), Math.round(py - (Rr + 3) * t), 1, 1);
    ctx.fillStyle = "rgba(0,0,0,0.25)"; ctx.fillRect(px - 10, py, 21, 2);
    const rot = tNow * 0.25;
    for (let a = 0; a < Math.PI * 2; a += 0.06) { ctx.fillStyle = "#f2f2f6"; ctx.fillRect(Math.round(px + Math.cos(a) * Rr), Math.round(hy + Math.sin(a) * Rr), 1, 1); }
    for (let k = 0; k < 8; k++) {
      const a = rot + k * Math.PI / 4;
      for (let r = 0; r < Rr; r += 1.5) { ctx.fillStyle = "#c8c8d0"; ctx.fillRect(Math.round(px + Math.cos(a) * r), Math.round(hy + Math.sin(a) * r), 1, 1); }
      const cx = Math.round(px + Math.cos(a) * Rr), cy = Math.round(hy + Math.sin(a) * Rr);
      ctx.fillStyle = ["#e84040", "#3c84e8", "#ffd030", "#40c070", "#ff8c30", "#b060e0", "#e84040", "#3c84e8"][k]; ctx.fillRect(cx - 1, cy, 3, 3);
    }
    ctx.fillStyle = "#555"; ctx.fillRect(px - 1, hy - 1, 3, 3);
  }
}
function dayNight() {
  const h = clock;
  let a = 0, col = "0,0,40";
  const N = 0.56;
  if (h < 5 || h > 21) a = N; else if (h < 7) { a = (7 - h) / 2 * N; col = "40,20,60"; } else if (h > 18.5) { a = (h - 18.5) / 2.5 * N; col = h < 20 ? "60,20,30" : "0,0,40"; }
  // heavy cloud makes evenings fall a little earlier
  a = Math.min(0.6, a + WX.cloud * 0.05 * (a > 0.05 ? 1 : 0));
  if (a > 0.01) { ctx.fillStyle = "rgba(" + col + "," + a.toFixed(2) + ")"; ctx.fillRect(0, 0, VW, VH); }
  return a;
}
// weather: one step per frame (also runs on the title screen)
function stepWeatherAll(dt, x, z) {
  absH += dt / 50;
  WX.on = SV.wx !== false;
  const changed = WXM.setPeriod(Math.floor(absH / 8));
  if (changed && state === "play" && WX.on) flash(WXM.label(), "#9ad8ff");
  SIM.setSwell(WX.swell && WX.on ? 1.35 : 1);
  let snowy = false;
  for (const [dx, dz] of [[0, 0], [30, 0], [-30, 0], [0, 30], [0, -30]]) if (SIM.groupAt(x + dx, z + dz) === "snow") { snowy = true; break; }
  const cp = camPx(); let ddx = 0, ddy = 0;
  if (lastCamPx) { ddx = cp[0] - lastCamPx[0]; ddy = cp[1] - lastCamPx[1]; if (Math.abs(ddx) > 60 || Math.abs(ddy) > 60) ddx = ddy = 0; }
  lastCamPx = cp;
  WXM.stepWeather(dt, snowy, ddx, ddy, VW, VH);
}
// night lights: windows, lamps, lift towers and stations (baked per chunk) plus car headlights
function nightLights(L, T, a) {
  const s = Math.min(1, (a - 0.08) / 0.3);
  if (s <= 0) return;
  ctx.save(); ctx.globalAlpha = s;
  for (let cj = Math.floor(T / CP); cj <= Math.floor((T + VH) / CP); cj++)
    for (let ci = Math.floor(L / CP); ci <= Math.floor((L + VW) / CP); ci++) {
      const lc = RD.lightsCanvas(ci, cj); if (lc) ctx.drawImage(lc, ci * CP - L, cj * CP - T);
    }
  ctx.globalCompositeOperation = "lighter";
  for (const n of NPCS) {
    if (n.t !== "car") continue;
    const px = gx(n.x) - L, py = gy(n.z) - T;
    if (px < -40 || py < -40 || px > VW + 40 || py > VH + 40) continue;
    const fx = Math.sin(n.a), fz = Math.cos(n.a);
    for (let d = 3; d < 22; d++) {
      const w = Math.round(d * 0.35), al = 0.28 * (1 - d / 22);
      ctx.fillStyle = "rgba(255,240,190," + al.toFixed(3) + ")";
      ctx.fillRect(Math.round(px + fx * d * PX * 0.5 - w), Math.round(py + fz * d * PX * 0.5 - 3 - w * 0.5), w * 2 + 1, Math.max(1, w));
    }
  }
  ctx.restore();
}

// ---------------- HUD and controls
function btn(id, x, y, w, h, label, cb, style = {}) {
  btns.push({ id, x, y, w, h, cb });
  ctx.fillStyle = style.bg || "rgba(10,14,24,0.72)"; ctx.fillRect(x, y, w, h);
  ctx.fillStyle = style.edge || "rgba(255,255,255,0.85)";
  ctx.fillRect(x, y, w, 1); ctx.fillRect(x, y + h - 1, w, 1); ctx.fillRect(x, y, 1, h); ctx.fillRect(x + w - 1, y, 1, h);
  if (label) drawTextC(ctx, label, x + w / 2, y + Math.floor((h - 7) / 2), style.col || "#fff", style.sc || 1);
}
function roundBtn(id, cx, cy, r, label, held, col) {
  btns.push({ id, x: cx - r - 4, y: cy - r - 4, w: 2 * r + 8, h: 2 * r + 8 });
  for (let y = -r; y <= r; y++) {
    const w = Math.round(Math.sqrt(r * r - y * y));
    ctx.fillStyle = held ? col : "rgba(10,14,24,0.55)"; ctx.fillRect(cx - w, cy + y, w * 2 + 1, 1);
    ctx.fillStyle = col; ctx.fillRect(cx - w, cy + y, 1, 1); ctx.fillRect(cx + w, cy + y, 1, 1);
  }
  ctx.fillStyle = col; ctx.fillRect(cx - Math.round(r * 0.7), cy - r, Math.round(r * 1.4), 1); ctx.fillRect(cx - Math.round(r * 0.7), cy + r, Math.round(r * 1.4), 1);
  drawTextC(ctx, label, cx + 1, cy - 3, "#fff");
}
function drawControls() {
  const m = 8, mr = m + Math.round(SAFE.r), mb = m + Math.round(SAFE.b), ml = m + Math.round(SAFE.l), mt = 4 + Math.round(SAFE.t);
  // stick
  STICK.x = ml + 34; STICK.y = VH - mb - 34;
  if (matchMedia("(pointer: coarse)").matches || touch.stick != null) {
    // base
    ctx.fillStyle = "rgba(10,14,24,0.35)"; disc(STICK.x, STICK.y, STICK.r + 3);
    ctx.fillStyle = "rgba(255,255,255,0.35)"; ring(STICK.x, STICK.y, STICK.r + 3);
    // knob: follows the thumb, clamped to the base; springs back to centre when released
    let kx = STICK.x, ky = STICK.y;
    if (touch.stick != null) { const dx = touch.cx - STICK.x, dy = touch.cy - STICK.y, d = Math.hypot(dx, dy), c = d > STICK.r ? STICK.r / d : 1; kx += dx * c; ky += dy * c; }
    ctx.fillStyle = "rgba(0,0,0,0.35)"; disc(kx, ky + 2, 10);
    ctx.fillStyle = touch.stick != null ? "rgba(255,255,255,0.85)" : "rgba(255,255,255,0.55)"; disc(kx, ky, 10);
    ctx.fillStyle = "rgba(255,255,255,0.95)"; disc(kx - 3, ky - 3, 3);
  }
  const r = Math.round(Math.min(18, VH * 0.09));
  const ax = VW - mr - r - 2, ay = VH - mb - r - 6, bx = VW - mr - r * 3 - 10, by = VH - mb - r;
  roundBtn("A", ax, ay, r, "A", INP.Ah, "#7cff8a");
  roundBtn("B", bx, by, r - 2, "B", INP.brakeH, "#ffb040");
  const tx = Math.round((ax + bx) / 2), ty = ay - r * 2 - 4;
  roundBtn("T", tx, ty, r - 3, "T", INP.Th, "#5ec8ff");
  // hint text under the buttons
  let hA = "JUMP", hB = "BRAKE", hT = "TRICK";
  if (R.state === "paddle") { hA = "POP UP"; hB = ""; }
  if (R.state === "surf") { hA = "AIR"; hB = ""; }
  if (R.state === "lift") { hA = ""; hB = "SKIP"; hT = ""; }
  if (R.state === "grind") { hA = "POP"; hB = ""; }
  if (R.state === "air") hB = "";
  if (R.state === "ride" && SIM.nearLift()) hA = "LIFT";
  drawTextC(ctx, hA, ax, VH - mb - 4, "#cfe", 1);
  drawTextC(ctx, hB, bx, VH - mb + 2 - 4, "#fec", 1);
  drawTextC(ctx, hT, tx, ty - r + 1 - 9, "#bdf", 1);
  btn("map", VW - 4 - Math.round(SAFE.r) - 26, mt, 26, 13, "MAP", () => openMap());
  btn("pause", VW - 4 - Math.round(SAFE.r) - 42, mt, 13, 13, "II", () => state = "pause");
  btn("sport", ml - 4, mt + 26, 54, 11, sportLabel(), () => switchSport(), { sc: 1 });
}
const ring = (cx, cy, r) => { for (let a = 0; a < 6.28; a += 0.08) ctx.fillRect(Math.round(cx + Math.cos(a) * r), Math.round(cy + Math.sin(a) * r), 1, 1); };
const disc = (cx, cy, r) => { for (let y = -r; y <= r; y++) { const w = Math.round(Math.sqrt(r * r - y * y)); ctx.fillRect(Math.round(cx - w), Math.round(cy + y), w * 2 + 1, 1); } };
function sportLabel() { return { snowboard: "SNOWBOARD", ski: "SKI", skate: "SKATE", bike: "BIKE", surf: "SURF" }[R.sport] || R.sport; }

function drawHUD(dt) {
  // score
  const hl = 5 + Math.round(SAFE.l), ht = 5 + Math.round(SAFE.t), hr = Math.round(SAFE.r), hb = Math.round(SAFE.b);
  drawText(ctx, "SCORE " + SV.total.toLocaleString(), hl, ht, "#fff");
  if (score.pending) drawText(ctx, score.pending + (score.mult > 1 ? " X" + score.mult : ""), hl, ht + 10, "#ffe066");
  // speed and clock
  const kmh = Math.round(SIM.speedKmh());
  drawText(ctx, kmh + " KM/H", hl, VH - hb - (matchMedia("(pointer: coarse)").matches ? 86 : 14), "#fff");
  const hh = Math.floor(clock), mm = Math.floor((clock % 1) * 60);
  if (!(runT && VW - hr < 300)) {
    const ts = ((hh + 11) % 12 + 1) + ":" + String(mm).padStart(2, "0") + (hh < 12 ? "AM" : "PM");
    drawTextR(ctx, ts, VW - 50 - hr, ht + 2, "#dde");
    if (WX.on) WXM.drawIcon(ctx, VW - 50 - hr - textWidth(ts) - (WX.swell ? 20 : 13), ht + 2, clock < 6 || clock > 20);
  }
  // area banner
  if (areaT > 0) { drawTextC(ctx, areaName, VW / 2, ht + 21, "#fff", 1); }
  // run timer
  if (runT) {
    const col = "rgb(" + (DIFF_RGB[runT.p.d] || [200, 140, 80]).join(",") + ")";
    ctx.fillStyle = "rgba(10,14,24,0.7)"; ctx.fillRect(VW / 2 - 50, ht - 1, 100, 20);
    ctx.fillStyle = col; ctx.fillRect(VW / 2 - 50, ht - 1, 3, 20);
    drawTextC(ctx, runT.p.n, VW / 2 + 1, ht + 1, "#fff"); drawTextC(ctx, fmtT(runT.t), VW / 2 + 1, ht + 10, "#9ad8ff");
  }
  // prompts
  let prompt = "";
  if (R.state === "ride") { const L = SIM.nearLift(); if (L) prompt = "A: RIDE " + L.n.toUpperCase(); }
  if (R.state === "paddle") { const wv = SIM.waveAt(R.x, R.z); prompt = wv && wv.inRange && !wv.broken && wv.q > 0.25 ? "A: POP UP NOW!" : "PADDLE OUT, WAIT FOR A WAVE"; }
  if (R.state === "lift") prompt = "B: SKIP THE RIDE";
  if (prompt) { const w = textWidth(prompt) + 8; ctx.fillStyle = "rgba(10,14,24,0.7)"; ctx.fillRect(VW / 2 - w / 2, VH - hb - 50, w, 12); drawTextC(ctx, prompt, VW / 2, VH - hb - 47, "#7cff8a"); }
  // trick flashes
  let y = VH * 0.32;
  for (const f of flashes) {
    f.life -= dt;
    const a = Math.min(1, f.life * 2);
    if (a <= 0) continue;
    drawTextC(ctx, f.t, VW / 2, Math.round(y), f.col, 1);
    if (f.sub) drawTextC(ctx, f.sub, VW / 2, Math.round(y + 9), "#fff");
    y += f.sub ? 20 : 11;
  }
  flashes = flashes.filter(f => f.life > 0);
  // waypoint arrow
  if (waypoint) {
    const dx = waypoint[0] - R.x, dz = waypoint[1] - R.z, d = Math.hypot(dx, dz);
    let ang = Math.atan2(dz, dx);
    if (rotOn()) ang += ROT.th;
    const cx = VW / 2 + Math.cos(ang) * Math.min(VW, VH) * 0.36, cy = VH / 2 + Math.sin(ang) * Math.min(VW, VH) * 0.36;
    ctx.fillStyle = "#ff3ca8";
    for (let k = 0; k < 7; k++) for (let w = -k / 2; w <= k / 2; w++) ctx.fillRect(Math.round(cx + Math.cos(ang) * (6 - k) - Math.sin(ang) * w), Math.round(cy + Math.sin(ang) * (6 - k) + Math.cos(ang) * w), 1, 1);
    drawTextC(ctx, d > 1000 ? (d / 1000).toFixed(1) + " KM" : Math.round(d) + " M", cx, cy + 8, "#ff9ad6");
    // pin on screen when close
    let px, py;
    if (rotOn()) [px, py] = toS(waypoint[0], waypoint[1]).map(Math.round);
    else { const [L, T] = camPx(); px = gx(waypoint[0]) - L; py = gy(waypoint[1]) - T; }
    if (px > 0 && py > 0 && px < VW && py < VH) { ctx.fillStyle = "#ff3ca8"; ctx.fillRect(px, py - 18, 1, 18); ctx.fillRect(px + 1, py - 18, 5, 4); }
  }
}

// ---------------- menus
let menuSel = 0;
function panel(x, y, w, h) {
  ctx.fillStyle = "rgba(8,12,22,0.86)"; ctx.fillRect(x, y, w, h);
  ctx.fillStyle = "#ffffff"; ctx.fillRect(x, y, w, 1); ctx.fillRect(x, y + h - 1, w, 1); ctx.fillRect(x, y, 1, h); ctx.fillRect(x + w - 1, y, 1, h);
  ctx.fillStyle = "#ff9a1f"; ctx.fillRect(x + 2, y + 2, w - 4, 1);
}
function logo(cy) {
  const t = "SCOOT SHRED", sc = VW > 300 ? 3 : 2;
  const w = textWidth(t, sc);
  drawText(ctx, t, VW / 2 - w / 2 + sc, cy + sc, "#5a1808", sc, null);
  drawText(ctx, t, VW / 2 - w / 2, cy, "#ffb020", sc, null);
  const b = "8-BIT"; const bw = textWidth(b) + 8;
  ctx.fillStyle = "#e83a70"; ctx.fillRect(VW / 2 + w / 2 - bw + 4, cy + 7 * sc + 4, bw, 11);
  drawText(ctx, b, VW / 2 + w / 2 - bw + 8, cy + 7 * sc + 6, "#fff", 1, null);
}
function updateAttract(dt) {
  attract.t += dt;
  // slow tour over the island
  const tour = [[880, 150], [950, -600], [904, -1500], [1950, -1200], [2470, 1370], [600, 700], [-300, 1300], [-2470, 140], [-2300, 620], [-1600, -500], [-650, -130]];
  const seg = 9, k = Math.floor(attract.t / seg) % tour.length, t = (attract.t % seg) / seg;
  const a = tour[k], b = tour[(k + 1) % tour.length];
  const e = t < 0.75 ? 0 : (t - 0.75) / 0.25;
  cam.x = a[0] + (b[0] - a[0]) * e * e * (3 - 2 * e) + Math.sin(attract.t * 0.3) * 30; cam.z = a[1] + (b[1] - a[1]) * e * e * (3 - 2 * e);
  SIM.stepWaves(dt); stepNPCs(dt, cam.x, cam.z); stepWeatherAll(dt, cam.x, cam.z);
  clock = 10;
}
const START_SPOTS = ["Mountain Village", "Summit (Shred Peak)", "Brickswich Skatepark", "Hedgemont", "Steamer Lane", "Bike Village"];
function drawMenus(dt) {
  const cx = VW / 2;
  if (state === "title") {
    logo(Math.round(VH * 0.16));
    const bw = 110, bh = 15, y0 = Math.round(VH * 0.16) + 46;
    btn("play", cx - bw / 2, y0, bw, bh, "PLAY", () => { state = "start"; }, { bg: "rgba(232,58,112,0.92)" });
    btn("rider", cx - bw / 2, y0 + bh + 4, bw, bh, "RIDER & GEAR", () => state = "rider");
    btn("help", cx - bw / 2, y0 + 2 * (bh + 4), bw, bh, "HOW TO PLAY", () => state = "help");
    btn("settings", cx - bw / 2, y0 + 3 * (bh + 4), bw, bh, "SETTINGS", () => state = "settings");
    drawTextC(ctx, "SCORE " + SV.total.toLocaleString(), cx, VH - 12, "#cde");
    for (const [x, y] of tapQueue) {} // taps outside buttons do nothing on the title
  } else if (state === "start") {
    const w = Math.min(VW - 16, 200), h = 30 + START_SPOTS.length * 15 + 34; panel(cx - w / 2, 10, w, h);
    drawTextC(ctx, "WHERE TO START?", cx, 18, "#ffb020");
    START_SPOTS.forEach((n, k) => {
      const s = W.spots.find(s => s.n === n) || W.spots[k];
      btn("s" + k, cx - w / 2 + 8, 30 + k * 15, w - 16, 13, s.n, () => startAt(s));
    });
    const yb = 30 + START_SPOTS.length * 15 + 2;
    if (SV.last) btn("cont", cx - w / 2 + 8, yb, w - 16, 13, "WHERE I LEFT OFF", () => { begin(); SIM.place(SV.last[0], SV.last[1], SV.last[2]); }, { bg: "rgba(40,120,60,0.9)" });
    btn("pickmap", cx - w / 2 + 8, yb + 15, (w - 20) / 2, 13, "PICK ON MAP", () => { begin(); SIM.place(cam.x, cam.z, 0); openMap(); });
    btn("back", cx + 2, yb + 15, (w - 20) / 2, 13, "BACK", () => state = "title");
  } else if (state === "rider") {
    const w = Math.min(VW - 16, 230), h = 150; panel(cx - w / 2, 8, w, h);
    drawTextC(ctx, "RIDER & GEAR", cx, 16, "#ffb020");
    LOOKS.forEach((Lk, k) => {
      const x = cx - w / 2 + 14 + k * ((w - 28) / LOOKS.length), y = 30;
      btn("lk" + k, x, y, 28, 34, "", () => { SV.look = k; save(); AU.sfx("select"); }, { bg: SV.look === k ? "rgba(232,58,112,0.85)" : "rgba(30,36,52,0.9)" });
      ctx.drawImage(riderSprite("skate", Math.PI / 2 * ((Math.floor(tNow * 1.5) % 4)), "ride", Lk), x, y + 2);
    });
    drawTextC(ctx, "ON SNOW", cx - w / 4, 72, "#9ad8ff");
    drawTextC(ctx, "ON LAND", cx + w / 4, 72, "#9ad8ff");
    btn("snb", cx - w / 2 + 8, 82, w / 2 - 12, 13, "SNOWBOARD", () => { SV.snow = "snowboard"; R.snowSport = SV.snow; save(); }, { bg: SV.snow === "snowboard" ? "rgba(232,58,112,0.85)" : undefined });
    btn("ski", cx - w / 2 + 8, 97, w / 2 - 12, 13, "SKI", () => { SV.snow = "ski"; R.snowSport = SV.snow; save(); }, { bg: SV.snow === "ski" ? "rgba(232,58,112,0.85)" : undefined });
    btn("skt", cx + 4, 82, w / 2 - 12, 13, "SKATEBOARD", () => { SV.land = "skate"; R.landSport = SV.land; save(); }, { bg: SV.land === "skate" ? "rgba(232,58,112,0.85)" : undefined });
    btn("bik", cx + 4, 97, w / 2 - 12, 13, "MOUNTAIN BIKE", () => { SV.land = "bike"; R.landSport = SV.land; save(); }, { bg: SV.land === "bike" ? "rgba(232,58,112,0.85)" : undefined });
    drawTextC(ctx, "IN THE SEA YOU ALWAYS SURF", cx, 116, "#cde");
    btn("back", cx - 40, 132, 80, 14, "DONE", () => state = "title");
  } else if (state === "help") {
    const lines = ["STICK: STEER. PUSH IT TO SKATE OR PEDAL", "A: JUMP / OLLIE / POP UP ON A WAVE", "B: BRAKE (AT A LIFT: SKIP THE RIDE)",
      "T IN THE AIR: TAP = GRAB OR FLIP, HOLD = SPIN", "LAND STRAIGHT OR YOU BAIL", "COME DOWN ON A RAIL OR LEDGE TO GRIND",
      "CHAIN TRICKS FOR A MULTIPLIER", "AT A LIFT BASE PRESS A TO RIDE UP", "START A RUN AT ITS SIGN FOR A TIMER",
      "SURF: PADDLE OUT, POP UP ON A FACE, STAY AHEAD OF THE WHITEWATER", "MAP: TAP A DOT TO TRAVEL, TAP LAND FOR A PIN",
      "KEYS: ARROWS, SPACE=A, SHIFT=B+T, M MAP, Q SPORT"];
    const w = Math.min(VW - 8, 250), maxW = w - 12;
    // wrap each line to the panel width (continuation lines are indented)
    const out = [];
    for (const l of lines) {
      let cur = "";
      for (const word of l.trim().split(" ")) {
        const next = cur ? cur + " " + word : word;
        if (textWidth(next) > maxW && cur) { out.push(cur); cur = "  " + word; } else cur = next;
      }
      out.push(cur);
    }
    const h = 22 + out.length * 10 + 22; panel(cx - w / 2, 6, w, h);
    drawTextC(ctx, "HOW TO PLAY", cx, 12, "#ffb020");
    out.forEach((l, k) => drawText(ctx, l, cx - w / 2 + 6, 24 + k * 10, "#fff"));
    btn("back", cx - 40, 24 + out.length * 10 + 2, 80, 14, "GOT IT", () => state = "title");
  } else if (state === "settings") {
    const w = Math.min(VW - 16, 200), h = 140; panel(cx - w / 2, 12, w, h);
    drawTextC(ctx, "SETTINGS", cx, 20, "#ffb020");
    btn("snd", cx - w / 2 + 8, 34, w - 16, 13, "SOUND: " + (SV.sound ? "ON" : "OFF"), () => { SV.sound = !SV.sound; AU.AUDIO.sound = SV.sound; save(); });
    btn("mus", cx - w / 2 + 8, 50, w - 16, 13, "MUSIC: " + (SV.music ? "ON" : "OFF"), () => { SV.music = !SV.music; AU.AUDIO.music = SV.music; save(); });
    btn("view", cx - w / 2 + 8, 66, w - 16, 13, "ZOOM: " + ["CLOSE", "FAR", "FARTHEST"][SV.view || 0], () => { SV.view = ((SV.view || 0) + 1) % 3; save(); resize(); });
    btn("lead", cx - w / 2 + 8, 82, w - 16, 13, "LOOK-AHEAD CAMERA: " + (SV.lead !== false ? "ON" : "OFF"), () => { SV.lead = SV.lead === false; save(); });
    btn("wx", cx - w / 2 + 8, 98, w - 16, 13, "WEATHER: " + (SV.wx !== false ? "ON" : "OFF"), () => { SV.wx = SV.wx === false; save(); });
    btn("rot", cx - w / 2 + 8, 114, w - 16, 13, "CAMERA: " + (SV.rot !== false ? "TURNS WITH YOU" : "NORTH UP"), () => { SV.rot = SV.rot === false; save(); });
    btn("back", cx - 40, 132, 80, 14, "DONE", () => state = "title");
  }
}
function begin() { state = "play"; AU.unlock(); }
function startAt(s) {
  begin(); runT = null;
  let x = s.x, z = s.z, a = s.h != null ? s.h : 0;
  SIM.place(x, z, a);
  if (s.brk) { R.sport = "surf"; R.state = isWater(x, z) ? "paddle" : "ride"; }
  areaName = ""; flash(s.n.toUpperCase(), "#9ad8ff");
  if (!SV.help) { SV.help = true; save(); flash("STICK STEER  A JUMP  B BRAKE  T TRICK", "#fff"); }
}
function drawPause() {
  const cx = VW / 2, w = 140, h = 110; panel(cx - w / 2, VH / 2 - h / 2, w, h);
  drawTextC(ctx, "PAUSED", cx, VH / 2 - h / 2 + 8, "#ffb020");
  const y = VH / 2 - h / 2 + 22;
  btn("res", cx - 55, y, 110, 14, "RESUME", () => state = "play", { bg: "rgba(232,58,112,0.9)" });
  btn("map2", cx - 55, y + 17, 110, 14, "MAP", () => openMap());
  btn("gear", cx - 55, y + 34, 110, 14, "SWITCH SPORT", () => { switchSport(); state = "play"; });
  btn("snd2", cx - 55, y + 51, 110, 14, "SOUND " + (SV.sound ? "ON" : "OFF") + " / MUSIC " + (SV.music ? "ON" : "OFF"), () => { if (SV.sound && SV.music) { SV.music = false; } else if (SV.sound) { SV.sound = false; } else { SV.sound = SV.music = true; } AU.AUDIO.sound = SV.sound; AU.AUDIO.music = SV.music; save(); });
  btn("quit", cx - 55, y + 68, 110, 14, "TITLE SCREEN", () => { bank(); SV.last = [R.x, R.z, R.a]; save(); state = "title"; });
}
function drawLoading() {
  ctx.fillStyle = "#0e1424"; ctx.fillRect(0, 0, VW, VH);
  logo(Math.round(VH * 0.3));
  if (state === "error") { drawTextC(ctx, "COULD NOT LOAD THE ISLAND", VW / 2, VH * 0.65, "#ff6060"); drawTextC(ctx, errMsg.slice(0, 40), VW / 2, VH * 0.65 + 12, "#fff"); return; }
  const w = 120; ctx.fillStyle = "#333a4c"; ctx.fillRect(VW / 2 - w / 2, VH * 0.65, w, 6);
  ctx.fillStyle = "#ffb020"; ctx.fillRect(VW / 2 - w / 2, VH * 0.65, Math.round(w * loadP), 6);
  drawTextC(ctx, "LOADING THE ISLAND " + Math.round(loadP * 100) + "%", VW / 2, VH * 0.65 + 12, "#fff");
}

// ---------------- map
const MAPV = { zoom: 1, cx: 0, cz: 0, drag: null, moved: 0 };
function openMap() { state = "map"; MAPV.zoom = 1; MAPV.cx = R.x; MAPV.cz = R.z; bank(); }
function mapGeom() {
  const fit = Math.min((VW - 8) / mapImg.width, (VH - 30) / mapImg.height);
  const sc = fit * MAPV.zoom;            // screen px per map px (1 map px = 2 tiles = 8 m)
  const mx = (MAPV.cx - G.x0) / (G.res * 2), mz = (MAPV.cz - G.z0) / (G.res * 2);
  let ox = VW / 2 - mx * sc, oy = (VH + 14) / 2 - mz * sc;
  if (MAPV.zoom === 1) { ox = (VW - mapImg.width * sc) / 2; oy = 18 + (VH - 22 - mapImg.height * sc) / 2; }
  return { sc, ox, oy, toS: (x, z) => [ox + (x - G.x0) / (G.res * 2) * sc, oy + (z - G.z0) / (G.res * 2) * sc], toW: (px, py) => [G.x0 + (px - ox) / sc * G.res * 2, G.z0 + (py - oy) / sc * G.res * 2] };
}
function mapDown(id, x, y) { MAPV.drag = { id, x, y }; MAPV.moved = 0; }
function mapMove(id, x, y) {
  if (!MAPV.drag || MAPV.drag.id !== id) return;
  const g = mapGeom();
  MAPV.moved += Math.abs(x - MAPV.drag.x) + Math.abs(y - MAPV.drag.y);
  if (MAPV.zoom > 1) { MAPV.cx -= (x - MAPV.drag.x) / g.sc * G.res * 2; MAPV.cz -= (y - MAPV.drag.y) / g.sc * G.res * 2; }
  MAPV.drag.x = x; MAPV.drag.y = y;
}
function mapUp(id, x, y) {
  if (!MAPV.drag || MAPV.drag.id !== id) return;
  MAPV.drag = null;
  if (MAPV.moved > 6) return;
  const g = mapGeom();
  // tap a spot to travel there, anywhere else to drop a pin
  let best = null;
  for (const s of W.spots) { const [sx, sy] = g.toS(s.x, s.z); const d = Math.hypot(sx - x, sy - y); if (d < 9 && (!best || d < best.d)) best = { s, d }; }
  if (best) { startAt(best.s); AU.sfx("travel"); return; }
  const [wx, wz] = g.toW(x, y);
  waypoint = [wx, wz]; flash("WAYPOINT SET", "#ff66cc"); AU.sfx("select");
}
const GROUP_COL = { "Snow Mountain": "#3c8cff", "Bike Mountain": "#ff8c2a", "Surf Coast": "#2fd0d8", "The City": "#e8c040" };
function drawMap() {
  ctx.fillStyle = "#123a7a"; ctx.fillRect(0, 0, VW, VH);
  const g = mapGeom();
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(mapImg, Math.round(g.ox), Math.round(g.oy), Math.round(mapImg.width * g.sc), Math.round(mapImg.height * g.sc));
  // labels
  for (const r of W.regions) { const [x, y] = g.toS(r[1], r[2]); drawTextC(ctx, r[0], x, y - 3, "#fff", 1); }
  if (MAPV.zoom > 1) for (const t of W.towns) { const [x, y] = g.toS(t[1], t[2]); drawTextC(ctx, t[0], x, y + 5, "#ffe9b0"); }
  // spots
  for (const s of W.spots) {
    const [x, y] = g.toS(s.x, s.z);
    ctx.fillStyle = "#000"; ctx.fillRect(Math.round(x) - 2, Math.round(y) - 2, 5, 5);
    ctx.fillStyle = GROUP_COL[s.g] || "#fff"; ctx.fillRect(Math.round(x) - 1, Math.round(y) - 1, 3, 3);
  }
  // waypoint and you
  if (waypoint) { const [x, y] = g.toS(waypoint[0], waypoint[1]); ctx.fillStyle = "#ff3ca8"; ctx.fillRect(Math.round(x), Math.round(y) - 9, 1, 9); ctx.fillRect(Math.round(x) + 1, Math.round(y) - 9, 5, 4); }
  const [mx, my] = g.toS(R.x, R.z);
  if (Math.floor(tNow * 3) % 2) { ctx.fillStyle = "#fff"; ctx.fillRect(Math.round(mx) - 2, Math.round(my) - 2, 5, 5); ctx.fillStyle = "#e83a70"; ctx.fillRect(Math.round(mx) - 1, Math.round(my) - 1, 3, 3); }
  // header
  const st = Math.round(SAFE.t), sl = Math.round(SAFE.l), sr = Math.round(SAFE.r);
  ctx.fillStyle = "rgba(8,12,22,0.85)"; ctx.fillRect(0, 0, VW, 16 + st);
  drawText(ctx, "MAP", 5 + sl, 5 + st, "#ffb020");
  const tip = VW - sl - sr > 330 ? "TAP A DOT TO GO THERE. TAP ANYWHERE ELSE FOR A PIN" : "TAP DOT = GO  TAP LAND = PIN";
  if (VW - sl - sr > 220) drawText(ctx, tip, 26 + sl, 5 + st, "#dde");
  btn("close", VW - 34 - sr, 2 + st, 31, 12, "BACK", () => state = "play");
  btn("zoom", VW - 66 - sr, 2 + st, 30, 12, MAPV.zoom > 1 ? "FIT" : "ZOOM", () => { MAPV.zoom = MAPV.zoom > 1 ? 1 : 3; MAPV.cx = R.x; MAPV.cz = R.z; });
  if (waypoint) btn("clear", VW - 108 - sr, 2 + st, 40, 12, "NO PIN", () => { waypoint = null; });
}

// test hook for automated play tests
window.S8 = {
  R, SIM,
  start: name => { const s = W.spots.find(s => s.n === name); startAt(s); return !!s; },
  rot: v => { SV.rot = v; },
  camA: () => camA,
  wx: (kind, swell) => { WX.kind = kind; WX.swell = !!swell; },
  clock: h => { if (h != null) clock = h; return clock; },
  WX,
  at: (x, z, a = 0) => { begin(); runT = null; SIM.place(x, z, a); },
  state: () => state, score: () => SV.total, pending: () => score.pending,
  auto: (name, vmax) => { const p = W.paths.find(p => p.n === name); begin(); runT = null; SIM.place(p.p[0][0], p.p[0][1], Math.atan2(p.p[1][0] - p.p[0][0], p.p[1][1] - p.p[0][1])); AUTO = { p, i: 0, maxv: 0, t: 0, vmax, bails: 0 }; return p.p.length; },
  autoInfo: () => AUTO && ({ bails: AUTO.bails, log: (AUTO.log || []).slice(0, 4).join(" "), i: AUTO.i, n: AUTO.p.p.length, done: !!AUTO.done, maxv: Math.round(AUTO.maxv), t: Math.round(AUTO.t), st: R.state, msg: R.bailMsg }),
  lines: () => W.paths.filter(p => (p.k === "run" || p.k === "trail") && p.d !== "park").map(p => [p.n, p.k]),
  info: () => ({ x: Math.round(R.x), z: Math.round(R.z), y: +R.y.toFixed(1), st: R.state, sport: R.sport, kmh: Math.round(SIM.speedKmh()), a: +R.a.toFixed(2), run: runT ? runT.p.n : null }),
};
