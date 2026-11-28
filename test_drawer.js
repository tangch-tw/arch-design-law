/* 側邊預覽的回歸測試。
   最重要的一條：抽屜裡顯示的條文，必須就是使用者點的那一條。
   先前內嵌 openlawtw 時，該站會還原上次閱讀位置並蓋掉網址錨點，開出來是別條，
   這裡連續開數條逐一驗證，確保不再發生。 */
const { chromium } = require('playwright');
const errs = [];

(async () => {
  const b = await chromium.launch();

  for (const vp of [{ width: 390, height: 844, name: '手機 390' },
                    { width: 1280, height: 900, name: '桌機 1280' }]) {
    const ctx = await b.newContext({ viewport: { width: vp.width, height: vp.height } });
    const p = await ctx.newPage();
    p.on('pageerror', e => errs.push(vp.name + ' pageerror: ' + e.message));
    p.on('console', m => { if (m.type() === 'error') errs.push(vp.name + ' console: ' + m.text()); });

    await p.goto('http://localhost:8787/', { waitUntil: 'load' });
    await p.waitForFunction(() => window.ALL && window.ALL.length);

    console.log('\n===== %s =====', vp.name);

    // 連續開好幾條，過去是開第二條之後才開始錯
    const seq = await p.evaluate(() => {
      const pool = ALL.filter(r => r.id.indexOf('A11Y|') !== 0);
      const ids = [0, 9, 23, 60, 120].map(i => pool[i % pool.length].id);
      const out = [];
      ids.forEach(id => {
        openDrawer(id);
        const r = BYID[id];
        const fb = document.getElementById('dwFallback');
        out.push({
          want: r.no,
          title: document.getElementById('dwTitle').textContent,
          meta: document.getElementById('dwMeta').textContent.indexOf(r.lawName) === 0,
          textMatch: fb.innerText.indexOf(r.text.slice(0, 40)) >= 0,
          full: fb.innerText.length >= r.text.length * 0.9,
          links: fb.querySelectorAll('.dw-links a').length,
          iframes: document.querySelectorAll('#drawer iframe').length
        });
        closeDrawer();
      });
      return out;
    });
    seq.forEach(x => {
      console.log('  %s｜標題 %s 法規 %s 條文 %s 完整 %s 連結 %d',
        x.want, x.title === x.want, x.meta, x.textMatch, x.full, x.links);
      if (x.title !== x.want) errs.push(vp.name + '：' + x.want + ' 的抽屜標題是 ' + x.title);
      if (!x.meta) errs.push(vp.name + '：' + x.want + ' 的法規名稱不符');
      if (!x.textMatch) errs.push(vp.name + '：' + x.want + ' 抽屜顯示的條文與該條原文不符');
      if (!x.full) errs.push(vp.name + '：' + x.want + ' 的條文被截斷');
      if (!x.links) errs.push(vp.name + '：' + x.want + ' 沒有任何外連按鈕');
      if (x.iframes) errs.push(vp.name + '：抽屜裡仍有 iframe');
    });

    // 版面
    const lay = await p.evaluate(() => {
      const id = ALL.find(r => r.id.indexOf('A11Y|') !== 0).id;
      openDrawer(id);
      const h = document.querySelector('.dw-head');
      const btn = h.querySelector('button').getBoundingClientRect();
      return { vw: window.innerWidth, btnR: Math.round(btn.right),
               headW: h.scrollWidth, headC: h.clientWidth,
               over: document.documentElement.scrollWidth - document.documentElement.clientWidth };
    });
    console.log('  關閉鈕 right=%d/%d　標題列 %d/%d　橫向溢出 %d',
      lay.btnR, lay.vw, lay.headW, lay.headC, lay.over);
    if (lay.btnR > lay.vw) errs.push(vp.name + '：關閉鈕超出畫面');
    if (lay.headW > lay.headC + 1) errs.push(vp.name + '：標題列內容溢出');

    await p.evaluate(() => closeDrawer());
    const closed = await p.evaluate(() => ({
      drawer: document.getElementById('drawer').hidden,
      scrim: document.getElementById('scrim').hidden,
      overflow: document.body.style.overflow
    }));
    console.log('  關閉後：抽屜=%s 背景=%s body.overflow=%j',
      closed.drawer, closed.scrim, closed.overflow);
    if (!closed.drawer || !closed.scrim) errs.push(vp.name + '：關閉後抽屜或背景仍在');
    if (closed.overflow) errs.push(vp.name + '：關閉後未還原頁面捲動');

    // 無障礙規範走另一條路徑
    const a11y = await p.evaluate(() => {
      const id = Object.keys(BYID).find(k => k.indexOf('A11Y|') === 0);
      if (!id) return null;
      openDrawer(id);
      const r = BYID[id], fb = document.getElementById('dwFallback');
      const o = { want: r.no, title: document.getElementById('dwTitle').textContent,
                  textMatch: fb.innerText.indexOf(r.text.slice(0, 30)) >= 0,
                  pdfBtn: fb.innerHTML.indexOf('pdfbtn') >= 0 };
      closeDrawer();
      return o;
    });
    if (a11y) {
      console.log('  無障礙 %s　標題=%s 條文=%s PDF 按鈕=%s',
        a11y.want, a11y.title === a11y.want, a11y.textMatch, a11y.pdfBtn);
      if (a11y.title !== a11y.want || !a11y.textMatch)
        errs.push(vp.name + '：無障礙條文的抽屜內容不符');
      if (!a11y.pdfBtn) errs.push(vp.name + '：無障礙條文缺少官方 PDF 按鈕');
    }

    await ctx.close();
  }

  await b.close();
  if (errs.length) { console.log('\n✗ ' + errs.join('\n✗ ')); process.exit(1); }
  console.log('\n✓ 側邊預覽全部通過');
})();
