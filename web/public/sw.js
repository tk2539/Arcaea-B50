// service worker: 共有メニューからの画像受け取り (Web Share Target) とオフライン用キャッシュ
const APP_CACHE = "app-v1";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method === "POST" && url.pathname.endsWith("/share-target")) {
    e.respondWith(receiveShare(e.request));
    return;
  }
  // 同一オリジンの GET はネットワーク優先、失敗したらキャッシュ (オフラインでも開けるように)
  if (e.request.method === "GET" && url.origin === self.location.origin) {
    e.respondWith(
      fetch(e.request)
        .then((resp) => {
          if (resp.ok) {
            const copy = resp.clone();
            caches.open(APP_CACHE).then((c) => c.put(e.request, copy));
          }
          return resp;
        })
        .catch(() => caches.match(e.request, { ignoreSearch: true })),
    );
  }
});

// 共有された画像をキャッシュに置いて、アプリ本体に ?shared を付けて渡す
async function receiveShare(request) {
  const form = await request.formData();
  const cache = await caches.open("share-target");
  const files = form.getAll("images");
  await Promise.all(files.map((f, i) => cache.put(
    new URL(`shared/${Date.now()}-${i}`, self.registration.scope).href,
    new Response(f, { headers: {
      "content-type": f.type,
      "x-filename": encodeURIComponent(f.name),
      "x-modified": String(f.lastModified || Date.now()),
    } }),
  )));
  return Response.redirect(new URL("./?shared=1", self.registration.scope).href, 303);
}
