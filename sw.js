// keeps the game playable offline once it has loaded
const V = "shred8-v4";
const FILES = ["./", "index.html", "manifest.webmanifest", "js/main.js", "js/data.js", "js/render.js", "js/sim.js", "js/sprites.js", "js/npc.js",
  "js/font.js", "js/audio.js", "js/weather.js", "data/world8.json", "data/grid.bin.gz", "icons/icon-180.png", "icons/icon-192.png", "icons/icon-512.png"];
self.addEventListener("install", e => e.waitUntil(caches.open(V).then(c => c.addAll(FILES)).then(() => self.skipWaiting())));
self.addEventListener("activate", e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener("fetch", e => e.respondWith(caches.match(e.request).then(r => r || fetch(e.request))));
