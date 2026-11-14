/* Hazina service worker: opens the app offline. The app files are refreshed from the network
   whenever there is a connection; the figures themselves are kept by the app on the device and
   sync with Supabase when the connection returns. Database calls are never cached here. */
const VER = new URL(self.location).searchParams.get('v') || '1';
const APP = 'hazina-app-' + VER;          // index.html, config.js, manifest, icons
const LIB = 'hazina-lib-v1';              // versioned libraries and fonts from CDNs (safe to keep)
const CORE = ['./', './index.html', './config.js', './manifest.webmanifest', './icons/icon-192.png', './icons/apple-touch-icon.png'];
const LIBS = [
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js',
  'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js',
  'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js',
  'https://cdn.jsdelivr.net/npm/jspdf-autotable@3.8.2/dist/jspdf.plugin.autotable.min.js',
  'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js'
];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const app = await caches.open(APP), lib = await caches.open(LIB);
    await Promise.all(CORE.map(u => app.add(new Request(u, { cache: 'reload' })).catch(() => {})));
    await Promise.all(LIBS.map(async u => { if (!(await lib.match(u))) await lib.add(new Request(u, { mode: 'cors' })).catch(() => {}); }));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith('hazina-app-') && k !== APP).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

const isLib = u => /(^|\.)(jsdelivr\.net|unpkg\.com|fonts\.googleapis\.com|fonts\.gstatic\.com)$/.test(u.hostname);

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) {
    if (/\/sw\.js$/.test(url.pathname)) return;
    e.respondWith(networkFirst(req, url));
  } else if (isLib(url)) {
    e.respondWith(cacheFirst(req));
  }
  // everything else (Supabase API, auth) goes straight to the network
});

/* app files: newest from the network, the saved copy when offline */
async function networkFirst(req, url) {
  const cache = await caches.open(APP);
  const key = req.mode === 'navigate' ? './index.html' : url.pathname.replace(/^.*\//, './') || './index.html';
  try {
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 6000);
    const res = await fetch(req, { signal: ctl.signal, cache: 'no-store' });
    clearTimeout(t);
    if (res && res.ok && !url.searchParams.has('check')) cache.put(req.mode === 'navigate' ? './index.html' : req, res.clone()).catch(() => {});
    return res;
  } catch (err) {
    const hit = (await cache.match(req, { ignoreSearch: true })) || (await cache.match(key, { ignoreSearch: true })) ||
      (req.mode === 'navigate' ? await cache.match('./index.html') : null);
    if (hit) return hit;
    return new Response('', { status: 503, statusText: 'Offline' });
  }
}

/* libraries and fonts have fixed versions in their address, so a saved copy never goes stale */
async function cacheFirst(req) {
  const cache = await caches.open(LIB);
  const hit = await cache.match(req, { ignoreVary: true });
  if (hit) return hit;
  try {
    const res = await fetch(req);
    if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone()).catch(() => {});
    return res;
  } catch (err) {
    return new Response('', { status: 503, statusText: 'Offline' });
  }
}
