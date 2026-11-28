/* 重現手機寬度下「側邊預覽」的問題。 */
const { chromium } = require('playwright');

(async () => {
  const b = await chromium.launch();
  for (const vp of [{ width: 390, height: 844, name: '手機 390' },
                    { width: 1280, height: 900, name: '桌機 1280' }]) {
    const ctx = await b.newContext({ viewport: { width: vp.width, height: vp.height } });
    const p = await ctx.newPage();
    const errs = [];
    p.on('pageerror', e => errs.push('pageerror: ' + e.message));
    p.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });

    await p.goto('http://localhost:8787/', { waitUntil: 'load' });
    await p.waitForFunction(() => window.ALL && window.ALL.length);
    await p.fill('#q', '走廊要多寬');
    await p.evaluate(() => { if (typeof ask === 'function') ask('走廊要多寬'); else render(); });
    await p.waitForTimeout(500);

    const opened = await p.evaluate(() => {
      const a = Array.from(document.querySelectorAll('#list .card a'))
        .find(x => x.textContent.indexOf('側邊預覽') >= 0);
      if (!a) return { ok: false };
      a.click();
      return { ok: true };
    });
    await p.waitForTimeout(700);

    const r = await p.evaluate(() => {
      const d = document.getElementById('drawer');
      const head = document.querySelector('.dw-head');
      const btn = document.querySelector('.dw-head button');
      const link = document.getElementById('dwOpen');
      const fr = document.getElementById('dwFrame');
      const rect = e => { const b = e.getBoundingClientRect();
        return { l: Math.round(b.left), r: Math.round(b.right), w: Math.round(b.width) }; };
      return {
        hidden: d.hidden,
        vw: window.innerWidth,
        drawer: rect(d),
        head: Object.assign(rect(head),
          { scrollW: head.scrollWidth, clientW: head.clientWidth }),
        btn: rect(btn),
        link: Object.assign(rect(link), { text: link.textContent.trim() }),
        iframeHidden: fr.hidden,
        iframeSrc: (fr.getAttribute('src') || '').slice(0, 40),
        docOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
      };
    });

    console.log('\n===== %s =====', vp.name);
    console.log('抽屜顯示=%s　視窗寬=%d　抽屜 %d→%d (寬 %d)',
      !r.hidden, r.vw, r.drawer.l, r.drawer.r, r.drawer.w);
    console.log('標題列 scrollWidth=%d clientWidth=%d %s',
      r.head.scrollW, r.head.clientW, r.head.scrollW > r.head.clientW + 1 ? '← 內容溢出' : '');
    console.log('「%s」連結 %d→%d (寬 %d)', r.link.text, r.link.l, r.link.r, r.link.w);
    console.log('關閉鈕 %d→%d %s', r.btn.l, r.btn.r,
      r.btn.r > r.vw ? '← 已被擠出畫面右側，點不到' : '');
    console.log('iframe hidden=%s src=%s', r.iframeHidden, r.iframeSrc);
    if (errs.length) console.log('錯誤：\n  ' + errs.join('\n  '));
    await p.screenshot({ path: '/home/claude/arch-design-law/drawer_' + vp.width + '.png' });
    await ctx.close();
  }
  await b.close();
})();
