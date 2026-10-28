const V = 'oh-v313';
const FILES = ['./', 'index.html', 'engine.js?v=313', 'parlay.js?v=313', 'advisor.js?v=313', 'importer.js?v=313', 'dataload.js?v=313', 'app.js?v=313', 'manifest.json', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png', 'data/matches.json'];
self.addEventListener('install', e => { e.waitUntil(caches.open(V).then(c => Promise.all(FILES.map(f => c.add(f).catch(() => { })))).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;   // Worker / Gemini 等跨站請求不處理
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request).then(res => { if (res.ok) { const cp = res.clone(); caches.open(V).then(c => c.put(e.request, cp)); } return res; }).catch(() => caches.match('index.html'))));
});
