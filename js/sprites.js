// Blocky 8-bit riders, cars and other moving things. Every sprite is drawn once into a small canvas and cached.
const cache = new Map();
const rgb = c => "rgb(" + c[0] + "," + c[1] + "," + c[2] + ")";

export const LOOKS = [
  { name: "RED", jacket: [214, 54, 48], pants: [40, 44, 64], helmet: [250, 250, 250], board: [30, 160, 220] },
  { name: "BLUE", jacket: [40, 110, 220], pants: [60, 60, 70], helmet: [250, 210, 40], board: [240, 120, 30] },
  { name: "GREEN", jacket: [56, 170, 80], pants: [220, 220, 210], helmet: [40, 40, 44], board: [230, 60, 120] },
  { name: "ORANGE", jacket: [240, 130, 30], pants: [40, 40, 44], helmet: [70, 160, 230], board: [250, 240, 80] },
  { name: "PURPLE", jacket: [130, 70, 200], pants: [30, 30, 36], helmet: [240, 90, 140], board: [90, 230, 200] },
  { name: "BLACK", jacket: [36, 38, 44], pants: [120, 120, 124], helmet: [220, 40, 40], board: [250, 250, 250] },
];
const SKIN = [[238, 196, 160], [206, 152, 110], [150, 100, 66], [100, 66, 44]];

// body art, 7 wide x 9 tall, letters: h helmet, s skin, g goggles, j jacket, p pants, k boots/gloves
const BODY = {
  front: ["..hhh..", ".hhhhh.", ".hgggh.", "..sss..", ".jjjjj.", "kjjjjjk", "..jjj..", "..p.p..", "..k.k.."],
  back: ["..hhh..", ".hhhhh.", ".hhhhh.", "..sss..", ".jjjjj.", "kjjjjjk", "..jjj..", "..p.p..", "..k.k.."],
  right: ["..hhh..", "..hhhh.", "..hsgg.", "...ss..", "..jjj..", "..jjjk.", "..jjj..", "..pp...", "..kk..."],
  left: ["..hhh..", ".hhhh..", ".ggsh..", "..ss...", "..jjj..", ".kjjj..", "..jjj..", "...pp..", "...kk.."],
  air: ["..hhh..", ".hhhhh.", ".hgggh.", "k.sss.k", ".jjjjj.", "..jjj..", "..jjj..", ".p...p.", ".k...k."],
  tuck: [".......", "..hhh..", ".hhhhh.", ".hgggh.", "kjjjjjk", ".jjjjj.", "..ppp..", ".pp.pp.", ".k...k."],
  prone: [".......", ".......", ".......", "..hhh..", ".kjjjk.", "..jjj..", "..ppp..", "..p.p..", "......."],
  seat: ["..hhh..", ".hhhhh.", ".hgggh.", "..sss..", "kjjjjjk", ".jjjjj.", ".ppppp.", ".k...k.", "......."],
  walk: ["..hhh..", ".hhhhh.", ".hsssh.", "..sss..", ".jjjjj.", "sjjjjjs", "..jjj..", "..p.p..", "..k.k.."],
};

function bodyView(a) {
  // a: facing angle, forward = (sin a, cos a) in world (x right, z down the screen)
  const s = Math.sin(a), c = Math.cos(a);
  if (Math.abs(s) > Math.abs(c) * 1.2) return s > 0 ? "right" : "left";
  return c >= 0 ? "front" : "back";
}

function drawRot(g, cx, cy, ang, L, Wd, col, edge, stripe) {
  // filled rotated rectangle (length along ang)
  const ux = Math.sin(ang), uy = Math.cos(ang), r = Math.ceil(Math.hypot(L, Wd) / 2) + 1;
  for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) {
    const a = (x + 0.5) * ux + (y + 0.5) * uy, b = -(x + 0.5) * uy + (y + 0.5) * ux;
    if (Math.abs(a) <= L / 2 && Math.abs(b) <= Wd / 2) {
      let c = col;
      if (edge && (Math.abs(a) > L / 2 - 1)) c = edge;
      if (stripe && Math.abs(b) < 0.6 && Math.abs(a) < L / 2 - 1) c = stripe;
      g.fillStyle = rgb(c); g.fillRect(cx + x, cy + y, 1, 1);
    }
  }
}
function drawArt(g, art, x0, y0, pal) {
  for (let r = 0; r < art.length; r++) for (let c = 0; c < art[r].length; c++) {
    const ch = art[r][c]; if (ch === ".") continue;
    g.fillStyle = rgb(pal[ch]); g.fillRect(x0 + c, y0 + r, 1, 1);
  }
}

// sport: snowboard | ski | skate | bike | surf ; pose: ride | tuck | air | grab | bail | push | prone | seat | walk
export function riderSprite(sport, ang, pose, look, skin = 0) {
  const ai = ((Math.round(ang / (Math.PI / 16)) % 32) + 32) % 32;
  const key = sport + "|" + ai + "|" + pose + "|" + look.name + "|" + skin;
  let cv = cache.get(key);
  if (cv) return cv;
  cv = document.createElement("canvas"); cv.width = 28; cv.height = 28;
  const g = cv.getContext("2d");
  const a = ai * Math.PI / 16;
  const pal = { h: look.helmet, s: SKIN[skin], g: [40, 40, 50], j: look.jacket, p: look.pants, k: [40, 36, 34] };
  const ox = 14, oy = 20;     // ground point
  // shadow
  g.fillStyle = "rgba(0,0,0,0.28)"; g.fillRect(ox - 4, oy - 1, 9, 3); g.fillRect(ox - 3, oy - 2, 7, 5);
  if (pose === "bail") {
    drawRot(g, ox + 2, oy - 1, a + 0.7, 8, 2, look.board);
    drawArt(g, ["..hh...", "khhjjj.", ".sjjjpk", "..jjpp.", "....k.."], ox - 4, oy - 4, pal);
    cache.set(key, cv); return cv;
  }
  // equipment under the body
  if (sport === "snowboard") drawRot(g, ox, oy - 1, a, 9, 3, look.board, [40, 40, 40]);
  else if (sport === "skate") { drawRot(g, ox, oy - 1, a, 7, 2.6, [180, 130, 80], null); drawRot(g, ox, oy - 1, a, 7, 2.6, look.board, [30, 30, 30]); }
  else if (sport === "ski") {
    const px = Math.cos(a), py = -Math.sin(a);
    drawRot(g, Math.round(ox + px * 1.5), Math.round(oy - 1 + py * 1.5), a, 10, 1, look.board);
    drawRot(g, Math.round(ox - px * 1.5), Math.round(oy - 1 - py * 1.5), a, 10, 1, look.board);
  } else if (sport === "surf") drawRot(g, ox, oy - 1, a, 11, 3.6, [250, 250, 245], [250, 250, 245], look.board);
  else if (sport === "bike") {
    const fx = Math.sin(a), fy = Math.cos(a);
    for (const k of [-1, 1]) { g.fillStyle = "#222"; const wx = Math.round(ox + fx * 3.5 * k), wy = Math.round(oy - 1 + fy * 3.5 * k); g.fillRect(wx - 1, wy - 1, 3, 3); g.fillStyle = "#777"; g.fillRect(wx, wy, 1, 1); }
    drawRot(g, ox, oy - 2, a, 6, 1.2, look.board);
  }
  // body: boarders stand sideways to the board
  let view = sport === "snowboard" || sport === "skate" ? bodyView(a + Math.PI / 2) : bodyView(a);
  let art = BODY[view];
  if (pose === "tuck") art = BODY.tuck; else if (pose === "air" || pose === "grab") art = view === "back" ? BODY.back : BODY.air;
  else if (pose === "prone") art = BODY.prone; else if (pose === "seat") art = BODY.seat; else if (pose === "walk") art = BODY.walk;
  let by = oy - 10;
  if (pose === "prone") by = oy - 8;
  drawArt(g, art, ox - 3, by, pal);
  if (pose === "grab") { g.fillStyle = rgb(pal.k); g.fillRect(ox + 3, oy - 3, 1, 2); }
  if (sport === "ski" && pose !== "prone" && pose !== "seat") { g.fillStyle = "#333"; g.fillRect(ox - 4, oy - 4, 1, 3); g.fillRect(ox + 4, oy - 4, 1, 3); }
  cache.set(key, cv); return cv;
}

// cars: top-down, 10 x 5, rotated
const CAR_COLS = [[220, 50, 50], [50, 100, 220], [240, 200, 40], [240, 240, 240], [40, 40, 44], [60, 170, 90], [240, 140, 40], [150, 150, 160]];
export { CAR_COLS };
export function carSprite(ang, ci) {
  const ai = ((Math.round(ang / (Math.PI / 16)) % 32) + 32) % 32;
  const key = "car|" + ai + "|" + ci;
  let cv = cache.get(key); if (cv) return cv;
  cv = document.createElement("canvas"); cv.width = 16; cv.height = 16;
  const g = cv.getContext("2d"); const a = ai * Math.PI / 16; const col = CAR_COLS[ci % CAR_COLS.length];
  g.fillStyle = "rgba(0,0,0,0.3)";
  const ux = Math.sin(a), uy = Math.cos(a);
  for (let y = -6; y <= 6; y++) for (let x = -6; x <= 6; x++) {
    const p = (x + 0.5) * ux + (y + 0.5) * uy, q = -(x + 0.5) * uy + (y + 0.5) * ux;
    if (Math.abs(p) <= 5 && Math.abs(q) <= 2.5) g.fillRect(8 + x + 1, 8 + y + 1, 1, 1);
  }
  drawRot(g, 8, 8, a, 10, 5, col, col.map(v => v * 0.7));
  // windscreen and roof
  for (let y = -6; y <= 6; y++) for (let x = -6; x <= 6; x++) {
    const p = (x + 0.5) * ux + (y + 0.5) * uy, q = -(x + 0.5) * uy + (y + 0.5) * ux;
    if (Math.abs(q) <= 1.6 && p > 0.5 && p < 2.5) { g.fillStyle = "#24364c"; g.fillRect(8 + x, 8 + y, 1, 1); }
    else if (Math.abs(q) <= 1.6 && p >= -2.5 && p <= 0.5) { g.fillStyle = rgb(col.map(v => Math.min(255, v * 1.15))); g.fillRect(8 + x, 8 + y, 1, 1); }
    if (p > 4.3 && Math.abs(q) > 1.2 && Math.abs(q) <= 2.5) { g.fillStyle = "#fff6c0"; g.fillRect(8 + x, 8 + y, 1, 1); }
  }
  cache.set(key, cv); return cv;
}

export function gullSprite(frame) {
  const key = "gull|" + frame; let cv = cache.get(key); if (cv) return cv;
  cv = document.createElement("canvas"); cv.width = 9; cv.height = 5; const g = cv.getContext("2d");
  g.fillStyle = "#fafafa";
  const art = frame ? ["#.......#", ".#.....#.", "..##.##..", "....#...."] : [".........", "#.......#", ".###.###.", "....#...."];
  art.forEach((r, y) => [...r].forEach((c, x) => { if (c === "#") g.fillRect(x, y, 1, 1); }));
  cache.set(key, cv); return cv;
}

export function chairSprite(cab) {
  const key = "chair|" + cab; let cv = cache.get(key); if (cv) return cv;
  cv = document.createElement("canvas"); cv.width = 7; cv.height = 8; const g = cv.getContext("2d");
  g.fillStyle = "#333"; g.fillRect(3, 0, 1, 3);
  if (cab) { g.fillStyle = "#d84030"; g.fillRect(0, 3, 7, 5); g.fillStyle = "#9cd0f0"; g.fillRect(1, 4, 5, 2); }
  else { g.fillStyle = "#333"; g.fillRect(0, 5, 7, 1); g.fillRect(0, 3, 1, 3); g.fillRect(6, 3, 1, 3); }
  cache.set(key, cv); return cv;
}
