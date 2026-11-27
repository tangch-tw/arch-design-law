// 以 Chromium 把 icon.svg 輸出成各尺寸 PNG。
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const DIR = __dirname;
const SIZES = [180, 192, 512, 1024];

(async () => {
  const b = await chromium.launch();
  const svg = fs.readFileSync(path.join(DIR, 'icon.svg'), 'utf8');
  for (const s of SIZES) {
    const p = await b.newPage({ viewport: { width: s, height: s }, deviceScaleFactor: 1 });
    await p.setContent(
      `<!doctype html><meta charset="utf-8">
       <style>html,body{margin:0;padding:0;width:${s}px;height:${s}px;overflow:hidden}
       svg{display:block;width:${s}px;height:${s}px}</style>${svg}`,
      { waitUntil: 'load' });
    await p.waitForTimeout(150);
    await p.screenshot({ path: path.join(DIR, `icon-${s}.png`), omitBackground: false });
    await p.close();
    console.log('icon-' + s + '.png');
  }
  await b.close();
})();
