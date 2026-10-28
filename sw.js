const V = 'oh-v317';
const FILES = ['./', 'index.html', 'engine.js?v=317', 'parlay.js?v=317', 'advisor.js?v=317', 'importer.js?v=317', 'dataload.js?v=317', 'app.js?v=317', 'manifest.json', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png', 'data/matches.json'];
self.addEventListener('install', e => { e.waitUntil(caches.open(V).then(c => Promise.all(FILES.map(f => c.add(f).catch(() => { })))).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;   // Worker / Gemini 等跨站請求不處理
  const page = e.request.mode === 'navigate' || /\/(index\.html)?$/.test(u.pathname) || /sw\.js$/.test(u.pathname);
  if (page) {   // 網頁本體:網路優先,離線才用快取,確保更新版本一定拿得到
    e.respondWith(fetch(e.request).then(res => { if (res.ok) { const cp = res.clone(); caches.open(V).then(c => c.put(e.request, cp)); } return res; }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('index.html'))));
    return;
  }
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request).then(res => { if (res.ok) { const cp = res.clone(); caches.open(V).then(c => c.put(e.request, cp)); } return res; }).catch(() => caches.match('index.html'))));
});
