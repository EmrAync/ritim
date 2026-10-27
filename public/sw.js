// Service worker: the app shell works offline. Rhythm MP3s are stored by
// the app itself (Cache "ritim-mp3-v1"), so they are not handled here.
const SHELL = 'ritim-shell-v2';

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(['./', 'rhythms.json', 'manifest.webmanifest', 'icon.svg'])).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('ritim-shell-') && k !== SHELL).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function networkFirst(req, key) {
  const c = await caches.open(SHELL);
  try {
    const res = await fetch(req);
    if (res.ok) await c.put(key ?? req, res.clone());
    return res;
  } catch {
    return (await c.match(key ?? req)) ?? Response.error();
  }
}

async function cacheFirst(req) {
  const c = await caches.open(SHELL);
  const hit = await c.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) await c.put(req, res.clone());
  return res;
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  if (url.pathname.endsWith('.mp3')) return;
  if (req.mode === 'navigate') {
    e.respondWith(networkFirst(req, './'));
    return;
  }
  if (url.pathname.endsWith('rhythms.json')) {
    e.respondWith(networkFirst(req));
    return;
  }
  e.respondWith(cacheFirst(req));
});
