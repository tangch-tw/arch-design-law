/* 側邊預覽的回歸測試：版面、載入流程、關閉後的狀態。
   注意：本容器連不到 openlawtw，iframe 不會真的載入，因此這裡驗證的是
   「載入完成前不露出白底」與「載不動時仍會顯示」兩條路徑。 */
const { chromium } = require('playwright');
const errs = [];

(async () => {
  const b = await chromium.launch();

  for (const vp of [{ width: 390, height: 844, name: '手機 390' },
                    { width: 1280, height: 900, name: '桌機 1280' }]) {
    const ctx = await b.newContext({ viewport: { width: vp.width, height: vp.height } });
    const p = await ctx.newPage();
    p.on('pageerror', e => errs.push(vp.name + ' pageerror: ' + e.message));

    // 記錄 iframe 被指派了幾次網址，次數多就是多餘的重載，也就是閃爍的來源
    await p.addInitScript(() => {
      window.__srcLog = [];
      const d = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'src');
      Object.defineProperty(HTMLIFrameElement.prototype, 'src', {
        get() { return d.get.call(this); },
        set(v) {
          if (this.id === 'dwFrame') {
            // 設網址當下 iframe 有沒有版面，決定瀏覽器能不能捲到 #錨點
            const b = this.getBoundingClientRect();
            window.__srcLog.push({ url: String(v), w: Math.round(b.width), h: Math.round(b.height) });
          }
          d.set.call(this, v);
        }
      });
    });

    await p.goto('http://localhost:8787/', { waitUntil: 'load' });
    await p.waitForFunction(() => window.ALL && window.ALL.length);
    await p.fill('#q', '走廊要多寬');
    await p.evaluate(() => { if (typeof ask === 'function') ask('走廊要多寬'); else render(); });
    await p.waitForTimeout(500);
    // 點下去的同一個同步回合就取狀態，這時任何載入都還沒完成
    const instant = await p.evaluate(() => {
      const a = Array.from(document.querySelectorAll('#list .card a'))
        .find(x => x.textContent.indexOf('側邊預覽') >= 0);
      a.click();
      const fr = document.getElementById('dwFrame').getBoundingClientRect();
      const ld = document.getElementById('dwLoading').getBoundingClientRect();
      return { loadingShown: !document.getElementById('dwLoading').hidden,
               covers: ld.top <= fr.top + 1 && ld.left <= fr.left + 1 &&
                       ld.bottom >= fr.bottom - 1 && ld.right >= fr.right - 1 };
    });
    // iframe 全程保有版面（否則 #錨點失效），白底改由覆蓋層擋住
    if (!instant.loadingShown) errs.push(vp.name + '：開啟當下沒有顯示載入提示');
    if (!instant.covers) errs.push(vp.name + '：載入提示沒有完全蓋住 iframe，會看到白底');
    await p.waitForTimeout(250);

    const open = await p.evaluate(() => {
      const fr = document.getElementById('dwFrame');
      const ld = document.getElementById('dwLoading');
      const btn = document.querySelector('.dw-head button');
      const r = btn.getBoundingClientRect();
      return {
        loadingShown: !ld.hidden, iframeHidden: fr.hidden,
        srcLog: window.__srcLog.slice(),
        btnRight: Math.round(r.right), btnTop: Math.round(r.top), vw: window.innerWidth,
        headW: document.querySelector('.dw-head').scrollWidth,
        headClientW: document.querySelector('.dw-head').clientWidth
      };
    });
    console.log('\n===== %s =====', vp.name);
    console.log('點擊當下：載入提示=%s　完全蓋住 iframe=%s', instant.loadingShown, instant.covers);
    console.log('250 ms 後：載入提示=%s', open.loadingShown);
    const real = open.srcLog.filter(x => x.url !== 'about:blank');
    console.log('iframe 網址指派次數=%d', open.srcLog.length);
    real.forEach(x => console.log('  設網址時版面 %d×%d　%s', x.w, x.h, x.url));
    console.log('關閉鈕 right=%d (視窗寬 %d)　標題列 %d/%d',
      open.btnRight, open.vw, open.headW, open.headClientW);

    if (open.srcLog.length !== 1) errs.push(vp.name + '：iframe 被指派 ' + open.srcLog.length + ' 次，應為 1 次');
    real.forEach(x => {
      if (!x.w || !x.h)
        errs.push(vp.name + '：設網址時 iframe 沒有版面（' + x.w + '×' + x.h + '），#錨點會失效，條文會開錯');
      const frag = x.url.split('#')[1] || '';
      if (!frag) errs.push(vp.name + '：網址沒有錨點，會停在該法規最前面：' + x.url);
    });
    if (open.btnRight > open.vw) errs.push(vp.name + '：關閉鈕超出畫面');
    if (open.headW > open.headClientW + 1) errs.push(vp.name + '：標題列內容溢出');

    // 載不動時的保險機制
    await p.evaluate(() => { clearTimeout(window.__dwTimer); document.getElementById('dwLoading').hidden = true; });
    const after = await p.evaluate(() => document.getElementById('dwLoading').hidden
                                      && !document.getElementById('dwFrame').hidden);
    if (!after) errs.push(vp.name + '：載入提示收掉後 iframe 仍未顯示');

    // 關閉後要收乾淨
    await p.evaluate(() => closeDrawer());
    await p.waitForTimeout(150);
    const closed = await p.evaluate(() => {
      const fr = document.getElementById('dwFrame');
      return { drawer: document.getElementById('drawer').hidden,
               scrim: document.getElementById('scrim').hidden,
               dataUrl: fr.getAttribute('data-url'),
               loading: document.getElementById('dwLoading').hidden,
               bodyOverflow: document.body.style.overflow };
    });
    console.log('關閉後：抽屜=%s 背景=%s data-url=%j 載入提示=%s body.overflow=%j',
      closed.drawer, closed.scrim, closed.dataUrl, closed.loading, closed.bodyOverflow);
    if (!closed.drawer || !closed.scrim) errs.push(vp.name + '：關閉後抽屜或背景仍在');
    if (closed.dataUrl) errs.push(vp.name + '：關閉後 data-url 未清除');
    if (closed.bodyOverflow) errs.push(vp.name + '：關閉後未還原頁面捲動');

    // 無障礙規範走的是另一條路徑，載入提示必須關掉
    await p.evaluate(() => {
      const id = Object.keys(BYID).find(k => k.indexOf('A11Y|') === 0);
      if (id) openDrawer(id);
    });
    await p.waitForTimeout(200);
    const a11y = await p.evaluate(() => ({
      fb: !document.getElementById('dwFallback').hidden,
      ld: !document.getElementById('dwLoading').hidden,
      fr: document.getElementById('dwFrame').hidden
    }));
    console.log('無障礙條文：全文區=%s 載入提示=%s iframe 隱藏=%s', a11y.fb, a11y.ld, a11y.fr);
    if (!a11y.fb) errs.push(vp.name + '：無障礙條文沒有顯示全文區');
    if (a11y.ld) errs.push(vp.name + '：無障礙條文仍顯示載入提示');

    await p.screenshot({ path: '/tmp/drawer_' + vp.width + '.png' });
    await ctx.close();
  }

  await b.close();
  if (errs.length) { console.log('\n✗ ' + errs.join('\n✗ ')); process.exit(1); }
  console.log('\n✓ 側邊預覽全部通過');
})();
