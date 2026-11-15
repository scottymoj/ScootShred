// Chiptune sound: square, triangle and noise channels made with WebAudio
let AC = null, master = null, musicGain = null, sfxGain = null;
export const AUDIO = { sound: true, music: true };
export function unlock() {
  if (AC) { if (AC.state === "suspended") AC.resume(); return; }
  AC = new (window.AudioContext || window.webkitAudioContext)();
  master = AC.createGain(); master.gain.value = 0.5; master.connect(AC.destination);
  sfxGain = AC.createGain(); sfxGain.gain.value = 0.55; sfxGain.connect(master);
  musicGain = AC.createGain(); musicGain.gain.value = 0.22; musicGain.connect(master);
}
function tone(type, f0, f1, dur, vol = 0.3, when = 0, dest = sfxGain) {
  if (!AC) return;
  const t = AC.currentTime + when;
  const o = AC.createOscillator(), g = AC.createGain();
  o.type = type; o.frequency.setValueAtTime(f0, t); if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g); g.connect(dest); o.start(t); o.stop(t + dur + 0.02);
}
let noiseBuf = null;
function noise(dur, vol = 0.3, f = 1200, when = 0, dest = sfxGain) {
  if (!AC) return;
  if (!noiseBuf) { noiseBuf = AC.createBuffer(1, AC.sampleRate, AC.sampleRate); const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
  const t = AC.currentTime + when;
  const s = AC.createBufferSource(); s.buffer = noiseBuf;
  const fl = AC.createBiquadFilter(); fl.type = "lowpass"; fl.frequency.value = f;
  const g = AC.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  s.connect(fl); fl.connect(g); g.connect(dest); s.start(t); s.stop(t + dur + 0.02);
}
export function sfx(name) {
  if (!AUDIO.sound || !AC) return;
  switch (name) {
    case "jump": tone("square", 220, 660, 0.12, 0.18); break;
    case "land": noise(0.12, 0.35, 600); break;
    case "trick": tone("square", 660, 0, 0.06, 0.15); tone("square", 880, 0, 0.06, 0.15, 0.06); tone("square", 1320, 0, 0.1, 0.15, 0.12); break;
    case "bail": tone("square", 440, 80, 0.5, 0.2); noise(0.4, 0.3, 900); break;
    case "grind": noise(0.25, 0.18, 3000); break;
    case "lift": tone("triangle", 784, 0, 0.2, 0.3); tone("triangle", 1046, 0, 0.3, 0.3, 0.15); break;
    case "splash": noise(0.35, 0.3, 2500); break;
    case "wave": noise(0.6, 0.25, 1500); tone("triangle", 330, 660, 0.3, 0.2); break;
    case "coin": tone("square", 988, 0, 0.06, 0.16); tone("square", 1319, 0, 0.18, 0.16, 0.06); break;
    case "menu": tone("square", 660, 0, 0.05, 0.12); break;
    case "select": tone("square", 523, 0, 0.06, 0.15); tone("square", 784, 0, 0.1, 0.15, 0.06); break;
    case "travel": for (let k = 0; k < 6; k++) tone("square", 300 + k * 120, 0, 0.06, 0.12, k * 0.05); break;
  }
}

// ---- music: a short loop per area (snow, city, surf, bike)
const NOTE = n => 440 * Math.pow(2, (n - 69) / 12);
const SONGS = {
  snow: { bpm: 132, lead: [76, 79, 83, 79, 76, 74, 76, 0, 72, 76, 79, 76, 74, 72, 71, 0, 76, 79, 83, 86, 84, 83, 79, 0, 81, 79, 76, 74, 76, 0, 0, 0],
    bass: [52, 52, 59, 59, 48, 48, 55, 55, 45, 45, 52, 52, 47, 47, 54, 54] },
  city: { bpm: 140, lead: [69, 0, 72, 69, 74, 0, 72, 69, 67, 0, 69, 0, 64, 0, 67, 0, 69, 0, 72, 69, 76, 74, 72, 69, 74, 72, 69, 67, 69, 0, 0, 0],
    bass: [45, 45, 45, 45, 41, 41, 43, 43, 45, 45, 45, 45, 41, 41, 40, 40] },
  surf: { bpm: 124, lead: [72, 76, 79, 76, 74, 77, 81, 77, 72, 76, 79, 84, 83, 79, 76, 74, 72, 76, 79, 76, 77, 81, 84, 81, 79, 76, 74, 71, 72, 0, 0, 0],
    bass: [48, 48, 55, 55, 50, 50, 57, 57, 48, 48, 55, 55, 43, 43, 47, 47] },
  bike: { bpm: 150, lead: [64, 64, 67, 64, 69, 67, 64, 62, 64, 0, 64, 67, 71, 69, 67, 0, 64, 64, 67, 64, 72, 71, 69, 67, 69, 67, 64, 62, 64, 0, 0, 0],
    bass: [40, 40, 40, 47, 45, 45, 43, 43, 40, 40, 40, 47, 48, 48, 47, 47] },
};
let cur = null, nextT = 0, stepI = 0;
export function setSong(name) { if (cur !== name) { cur = name; stepI = 0; nextT = AC ? AC.currentTime + 0.05 : 0; } }
export function tickMusic() {
  if (!AC || !cur) return;
  if (!AUDIO.music) { nextT = AC.currentTime + 0.05; return; }
  const S = SONGS[cur]; const st = 60 / S.bpm / 2;
  while (nextT < AC.currentTime + 0.25) {
    const when = nextT - AC.currentTime;
    const n = S.lead[stepI % S.lead.length]; if (n) tone("square", NOTE(n), 0, st * 0.9, 0.12, when, musicGain);
    if (stepI % 2 === 0) { const b = S.bass[(stepI / 2) % S.bass.length]; tone("triangle", NOTE(b), 0, st * 1.8, 0.35, when, musicGain); }
    if (stepI % 4 === 2) noise(0.05, 0.12, 6000, when, musicGain);
    if (stepI % 8 === 0) noise(0.08, 0.2, 400, when, musicGain);
    nextT += st; stepI++;
  }
}
