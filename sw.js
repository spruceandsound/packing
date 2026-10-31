// Pack service worker: opens offline. Same-origin files are network-first (updates show
// right away); the Supabase library from the CDN is cache-first. /api and /content are never cached.
const CACHE = "pack-v4";
const SHELL = ["/", "/app.js", "/app.css", "/manifest.webmanifest", "/apple-touch-icon.png", "/icon-192.png"];
const LIB = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js";
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then(async (c) => { await c.addAll(SHELL); try { await c.add(new Request(LIB, { mode: "no-cors" })); } catch {} }));
  self.skipWaiting();
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener("fetch", (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== "GET") return;
  if (url.href === LIB) {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => { const c = res.clone(); caches.open(CACHE).then((x) => x.put(req, c)); return res; })));
    return;
  }
  if (url.origin !== location.origin || url.pathname.startsWith("/api/") || url.pathname.startsWith("/content/")) return;
  e.respondWith(
    fetch(req).then((res) => { if (res.ok) { const c = res.clone(); caches.open(CACHE).then((x) => x.put(req, c)); } return res; })
      .catch(() => caches.match(req).then((r) => r || (req.mode === "navigate" ? caches.match("/") : Response.error())))
  );
});
