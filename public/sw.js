// Service worker: the app shell works offline. Rhythm MP3s are stored by
// the app itself (Cache "ritim-mp3-v1"), so they are not handled here.
//
// The page is always revalidated with the server (never an old copy from the
// browser's HTTP cache), and files of older versions are kept: an old page
// that is still open can always load the styles and scripts it refers to.
const SHELL = 'ritim-shell';

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches
      .open(SHELL)
      .then((c) => c.addAll([new Request('./', { cache: 'no-cache' }), 'manifest.webmanifest', 'icon.svg']))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(self.clients.claim());
});

async function networkFirst(req, key) {
  const c = await caches.open(SHELL);
  try {
    const res = await fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' });
    if (res.ok) await c.put(key ?? req, res.clone());
    return res;
  } catch {
    return (await caches.match(key ?? req)) ?? Response.error();
  }
}

async function cacheFirst(req) {
  // Any cache, including those of earlier versions (ritim-shell-v1…v4).
  const hit = await caches.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) await (await caches.open(SHELL)).put(req, res.clone());
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
  if (url.pathname.endsWith('rhythms.json') || url.pathname.endsWith('manifest.webmanifest')) {
    e.respondWith(networkFirst(req));
    return;
  }
  e.respondWith(cacheFirst(req));
});
