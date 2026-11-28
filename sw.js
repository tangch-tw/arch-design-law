/* 建築法規導航　離線快取
 *
 * 更新方式：每次改版把下面的 VERSION 換成新的日期字串，舊快取會在新版啟用時自動刪除。
 * 不改 VERSION 就改 index.html，已安裝的裝置仍會先看到舊頁面，直到背景更新完成後的下一次開啟。
 *
 * 策略：同源 GET 一律 stale-while-revalidate。
 *   先回快取讓畫面立刻出來，同時在背景向伺服器要新版寫回快取，
 *   下一次開啟就是新版。離線時沒有網路可要，直接用快取，功能不受影響。
 */
const VERSION = '2026-11-28b';
const CACHE = 'arch-design-law-' + VERSION;

const PRECACHE = [
  './',
  './index.html',
  './manifest.json',
  './icon/icon-180.png',
  './icon/icon-192.png',
  './icon/icon-512.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE)
      // 單一檔案失敗不應讓整個安裝失敗，因此逐檔處理
      .then(function (c) {
        return Promise.all(PRECACHE.map(function (u) {
          return c.add(new Request(u, { cache: 'reload' })).catch(function () { return null; });
        }));
      })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys()
      .then(function (ks) {
        return Promise.all(ks.map(function (k) {
          return k === CACHE ? null : caches.delete(k);
        }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  // 跨網域的東西（全國法規資料庫、openlawtw 等外連）一律交給瀏覽器處理，不進快取
  if (url.origin !== self.location.origin) return;

  e.respondWith(
    caches.open(CACHE).then(function (cache) {
      return cache.match(req, { ignoreSearch: true }).then(function (hit) {
        const net = fetch(req).then(function (res) {
          if (res && res.ok && res.type === 'basic') cache.put(req, res.clone());
          return res;
        }).catch(function () { return null; });

        if (hit) return hit;
        return net.then(function (res) {
          if (res) return res;
          // 離線且沒快取：導向請求退回首頁，其餘回 503
          if (req.mode === 'navigate') {
            return cache.match('./index.html') ||
                   new Response('離線中，且尚未快取此頁。', {
                     status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
          }
          return new Response('', { status: 503 });
        });
      });
    })
  );
});
