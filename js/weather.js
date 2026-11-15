// Weather: changes every 8 game hours. Snow falls where the ground is snowy, rain everywhere else.
// Swell days make the surf breaks send bigger waves. Purely visual apart from the swell.

export const WX = {
  kind: "clear",      // clear | cloudy | precip | storm
  swell: false,
  period: -1,
  amt: 0,             // how much is falling right now (eases in and out), 0..1
  cloud: 0,           // darkening from cloud cover, 0..1
  snowy: 0,           // 0 = rain, 1 = snow (eases as you move between the two)
  flash: 0,           // lightning
  on: true,
};

const KINDS = [["clear", 38], ["cloudy", 24], ["precip", 28], ["storm", 10]];
function rnd(n) { let x = (n * 2654435761) >>> 0; x ^= x >>> 15; x = Math.imul(x, 2246822519) >>> 0; x ^= x >>> 13; return (x >>> 0) / 4294967296; }

// period: which 8-hour block of the game we are in
export function setPeriod(p) {
  if (p === WX.period) return false;
  WX.period = p;
  const r = rnd(p * 3 + 1) * 100; let acc = 0;
  for (const [k, w] of KINDS) { acc += w; if (r < acc) { WX.kind = k; break; } }
  WX.swell = rnd(p * 3 + 2) < 0.35 || WX.kind === "storm";
  return true;
}

const P = [];               // falling particles in screen space
let lastW = 0, lastH = 0;

export function stepWeather(dt, snowyHere, camDX, camDY, VW, VH) {
  const target = !WX.on ? 0 : WX.kind === "precip" ? 0.7 : WX.kind === "storm" ? 1 : 0;
  const tc = !WX.on ? 0 : WX.kind === "cloudy" ? 0.35 : WX.kind === "precip" ? 0.55 : WX.kind === "storm" ? 0.85 : 0;
  WX.amt += (target - WX.amt) * Math.min(1, dt * 0.3);
  WX.cloud += (tc - WX.cloud) * Math.min(1, dt * 0.3);
  WX.snowy += ((snowyHere ? 1 : 0) - WX.snowy) * Math.min(1, dt * 0.8);
  if (WX.kind === "storm" && WX.on && WX.snowy < 0.5 && Math.random() < dt * 0.08) WX.flash = 1;
  WX.flash = Math.max(0, WX.flash - dt * 3);
  // particle count follows the amount and the screen size
  const want = Math.round(WX.amt * (VW * VH) / 380);
  if (VW !== lastW || VH !== lastH) { P.length = 0; lastW = VW; lastH = VH; }
  while (P.length < want) P.push({ x: Math.random() * VW, y: Math.random() * VH, z: 0.5 + Math.random() * 0.8, ph: Math.random() * 6.28 });
  if (P.length > want) P.length = want;
  const snow = WX.snowy > 0.5;
  for (const p of P) {
    if (snow) { p.y += dt * 18 * p.z; p.x += dt * (6 * Math.sin(p.ph + p.y * 0.05) + 4); }
    else { p.y += dt * 170 * p.z; p.x += dt * 30 * p.z; }
    // the world scrolls under the camera: particles move with it (a little, for depth)
    p.x -= camDX * 0.6 * p.z; p.y -= camDY * 0.6 * p.z;
    if (p.y > VH + 4) { p.y -= VH + 8; p.x = Math.random() * VW; }
    if (p.y < -4) p.y += VH + 8;
    if (p.x > VW + 4) p.x -= VW + 8; if (p.x < -4) p.x += VW + 8;
  }
}

// cloud cover darkens and greys the scene (drawn before the night tint)
export function drawCloud(ctx, VW, VH) {
  if (WX.cloud < 0.02) return;
  const snow = WX.snowy > 0.5;
  ctx.fillStyle = snow ? `rgba(200,210,226,${(WX.cloud * 0.22).toFixed(3)})` : `rgba(40,48,64,${(WX.cloud * 0.28).toFixed(3)})`;
  ctx.fillRect(0, 0, VW, VH);
}

// falling snow / rain and lightning (drawn after the night tint and lights)
export function drawPrecip(ctx, VW, VH) {
  if (WX.flash > 0.05) { ctx.fillStyle = `rgba(230,236,255,${(WX.flash * 0.45).toFixed(3)})`; ctx.fillRect(0, 0, VW, VH); }
  if (!P.length) return;
  const snow = WX.snowy > 0.5;
  if (snow) {
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    for (const p of P) { const s = p.z > 1.0 ? 2 : 1; ctx.fillRect(Math.round(p.x), Math.round(p.y), s, s); }
  } else {
    ctx.fillStyle = "rgba(190,210,240,0.55)";
    for (const p of P) { const x = Math.round(p.x), y = Math.round(p.y), L = p.z > 1 ? 4 : 3; for (let k = 0; k < L; k++) ctx.fillRect(x - Math.floor(k / 3), y - k, 1, 1); }
  }
}

// tiny pixel icon for the HUD (9 x 7)
export function drawIcon(ctx, x, y, night = false) {
  const r = (c, a, b, w, h) => { ctx.fillStyle = c; ctx.fillRect(x + a, y + b, w, h); };
  const k = WX.on ? WX.kind : "clear";
  if (k === "clear" && night) { r("#f4f0d0", 3, 1, 3, 5); r("#f4f0d0", 2, 2, 1, 3); r("#f4f0d0", 6, 2, 1, 3); r("#1a2236", 5, 1, 2, 4); }
  else if (k === "clear") { r("#ffd040", 3, 1, 3, 5); r("#ffd040", 2, 2, 5, 3); r("#ffe680", 0, 3, 1, 1); r("#ffe680", 8, 3, 1, 1); r("#ffe680", 4, 0, 1, 1); r("#ffe680", 4, 6, 1, 1); }
  else {
    r(k === "storm" ? "#8a90a0" : "#dfe6f0", 1, 2, 7, 3); r(k === "storm" ? "#8a90a0" : "#dfe6f0", 3, 1, 3, 1);
    if (k === "precip" || k === "storm") {
      if (WX.snowy > 0.5) { r("#fff", 2, 6, 1, 1); r("#fff", 5, 6, 1, 1); }
      else { r("#7ab4ff", 2, 6, 1, 1); r("#7ab4ff", 4, 6, 1, 1); r("#7ab4ff", 6, 6, 1, 1); }
      if (k === "storm" && WX.snowy <= 0.5) r("#ffe040", 4, 5, 1, 2);
    }
  }
  if (WX.swell && WX.on) { r("#5ec8ff", 10, 4, 2, 1); r("#5ec8ff", 12, 3, 1, 1); r("#5ec8ff", 13, 4, 2, 1); }
}

export function label() {
  const k = WX.kind, s = WX.snowy > 0.5;
  const t = k === "clear" ? "CLEAR SKIES" : k === "cloudy" ? "CLOUDY" : k === "precip" ? (s ? "SNOWING" : "RAINING") : (s ? "SNOWSTORM" : "THUNDERSTORM");
  return t + (WX.swell ? " - SWELL'S UP!" : "");
}
