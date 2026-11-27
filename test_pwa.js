/* 驗證：頁面正常、離線可用、手機寬度不溢出、manifest 與圖示齊備。 */
const { chromium } = require('playwright');
const errs = [];

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
  const p = await ctx.newPage();
  p.on('pageerror', e => errs.push('pageerror: ' + e.message));
  p.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });

  await p.goto('http://localhost:8787/', { waitUntil: 'load' });
  await p.waitForFunction(() => window.ALL && window.ALL.length);

  const base = await p.evaluate(() => ({
    laws: ALL.length,
    manifest: document.querySelector('link[rel=manifest]').getAttribute('href'),
    touch: document.querySelector('link[rel=apple-touch-icon]').getAttribute('href'),
    capable: document.querySelector('meta[name=apple-mobile-web-app-capable]').content,
    title: document.querySelector('meta[name=apple-mobile-web-app-title]').content,
    viewport: document.querySelector('meta[name=viewport]').content,
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
  }));
  console.log('條文 %d 筆｜viewport=%s', base.laws, base.viewport);
  console.log('manifest=%s｜touch-icon=%s｜capable=%s｜名稱=%s',
    base.manifest, base.touch, base.capable, base.title);
  if (base.overflow > 0) errs.push('手機寬度橫向溢出 ' + base.overflow + ' px');

  // manifest 與圖示是否真的取得到
  for (const u of ['manifest.json', 'icon/icon-180.png', 'icon/icon-192.png',
                   'icon/icon-512.png', 'sw.js']) {
    const r = await p.evaluate(u => fetch(u).then(r => r.status), u);
    if (r !== 200) errs.push(u + ' 取不到，HTTP ' + r);
  }
  const mani = await p.evaluate(() => fetch('manifest.json').then(r => r.json()));
  if (mani.display !== 'standalone') errs.push('manifest display 不是 standalone');
  if (mani.start_url !== './') errs.push('manifest start_url 不是相對路徑');
  console.log('manifest：%s／%s｜display=%s｜圖示 %d 組',
    mani.name, mani.short_name, mani.display, mani.icons.length);

  // Service Worker
  await p.evaluate(() => navigator.serviceWorker.ready);
  const cached = await p.evaluate(async () => {
    const ks = await caches.keys();
    const c = await caches.open(ks[0]);
    return { cache: ks[0], n: (await c.keys()).length };
  });
  console.log('快取 %s，已存 %d 項', cached.cache, cached.n);
  if (cached.n < 4) errs.push('快取項目不足，離線可能失效');

  // 搜尋功能
  await p.fill('#q', '建蔽率');
  await p.waitForTimeout(400);
  const hits = await p.evaluate(() => document.querySelectorAll('#list .card').length);
  console.log('查詢「建蔽率」命中 %d 筆', hits);
  if (!hits) errs.push('線上查詢沒有結果');

  // 離線重載
  await ctx.setOffline(true);
  await p.reload({ waitUntil: 'load' });
  await p.waitForFunction(() => window.ALL && window.ALL.length, { timeout: 15000 })
    .catch(() => errs.push('離線後頁面載不起來'));
  await p.fill('#q', '停車');
  await p.waitForTimeout(400);
  const off = await p.evaluate(() => document.querySelectorAll('#list .card').length);
  console.log('離線後查詢「停車」命中 %d 筆', off);
  if (!off) errs.push('離線後查詢沒有結果');

  await b.close();
  if (errs.length) { console.log('\n✗ ' + errs.join('\n✗ ')); process.exit(1); }
  console.log('\n✓ 全部通過');
})();
