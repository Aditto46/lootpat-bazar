/* LootPat Bazar service worker.
 *
 * The shop stays installable and opens offline. Business responses are never
 * cached: API calls under /functions always go to the network so prices, stock,
 * orders and payments can never be served from a stale cache.
 *
 * The offline screen is inlined below because the host rewrites loose .html
 * routes to the SPA entry, so a separate /offline.html file would not survive
 * deployment.
 */
const VERSION = "lootpat-v3";
const SHELL = [
  "/manifest.json",
  "/logo.svg",
  "/icon-192.png",
  "/icon-512.png",
  "/icon-maskable-512.png",
  "/apple-touch-icon.png",
];

const NEVER_CACHE = ["/functions/", "/api/", "/__qoder", "/storage", "/rest/v1", "/supabase", "/sw.js"];

const OFFLINE_HTML = `<!doctype html>
<html lang="bn">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>অফলাইন · লুটপাট বাজার</title>
<style>
  *{box-sizing:border-box}
  body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;
    background:radial-gradient(circle at 50% 0%,#1c1030 0%,#0B0B10 55%);
    color:#f5f3ff;font-family:"Noto Sans Bengali","Space Grotesk",system-ui,sans-serif;text-align:center}
  main{max-width:22rem}
  img{width:72px;height:72px;border-radius:20px;margin-bottom:20px}
  h1{font-size:1.35rem;line-height:1.4;margin:0 0 8px}
  p{margin:0 0 22px;color:#b9b4c7;font-size:.95rem;line-height:1.65}
  button{border:0;border-radius:999px;padding:12px 24px;font:inherit;font-weight:600;
    color:#12081f;background:#c4a7ff;cursor:pointer}
  button:active{transform:scale(.98)}
  small{display:block;margin-top:18px;color:#7d778c;font-size:.75rem}
</style>
</head>
<body>
<main>
  <img src="/icon-192.png" alt="">
  <h1>ইন্টারনেট সংযোগ নেই</h1>
  <p>লুটপাট বাজারের ক্যাশ করা পাতা দেখছেন। অর্ডার, পেমেন্ট বা অ্যাকাউন্টের তথ্য দেখতে হলে আবার অনলাইনে আসুন।</p>
  <button type="button" onclick="location.reload()">আবার চেষ্টা করুন</button>
  <small>লুটপাট বাজার · ০১৪১০২৮৬৮২২</small>
</main>
</body>
</html>`;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== VERSION).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

function isCacheableRequest(request, url) {
  if (request.method !== "GET") return false;
  if (url.origin !== self.location.origin) return false;
  if (NEVER_CACHE.some((prefix) => url.pathname.startsWith(prefix))) return false;
  return true;
}

function isStaticAsset(url) {
  return (
    url.pathname.startsWith("/assets/") ||
    url.pathname.startsWith("/products/") ||
    /\.(?:css|js|png|webp|jpg|jpeg|svg|woff2?)$/.test(url.pathname)
  );
}

function offlineResponse() {
  return new Response(OFFLINE_HTML, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}

async function networkFirst(request) {
  try {
    return await fetch(request);
  } catch {
    // Every route needs live catalogue data, so a half-loaded app shell would
    // only show empty sections. The branded offline screen is the honest state.
    return offlineResponse();
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(VERSION);
    cache.put(request, response.clone());
  }
  return response;
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (!isCacheableRequest(event.request, url)) return;

  if (event.request.mode === "navigate") {
    event.respondWith(networkFirst(event.request));
    return;
  }
  if (isStaticAsset(url)) {
    event.respondWith(cacheFirst(event.request));
  }
});
