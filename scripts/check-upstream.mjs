#!/usr/bin/env node
/*
 * 檢查上游 openlawtw 是否有新版本，並列出影響本頁的法規。
 *
 * 比對依據：
 *   本頁  index.html 內 var DATA 的 meta.catalogVersion / meta.commit / meta.snapshot
 *   上游  data/catalog.json 的 version / collected / syncStatus.outcomes[]
 *
 * 產出：
 *   upstream-report.md   給 issue 用的報告
 *   GITHUB_OUTPUT        outdated、upstream_version、local_version
 *
 * 無外部套件，Node 20 以上可直接執行。
 */

import { readFile, writeFile, appendFile } from 'node:fs/promises';
import process from 'node:process';

const UPSTREAM_REPO = 'termcavetw/openlawtw';
const UPSTREAM_BRANCH = 'main';
const RAW = `https://raw.githubusercontent.com/${UPSTREAM_REPO}/${UPSTREAM_BRANCH}`;
const LOCAL_HTML = new URL('../index.html', import.meta.url);
const REPORT = new URL('../upstream-report.md', import.meta.url);

/* ---------------------------------------------------------------- 工具 */

const verParts = (v) => String(v ?? '0').split('.').map((n) => parseInt(n, 10) || 0);

function cmpVersion(a, b) {
  const A = verParts(a);
  const B = verParts(b);
  for (let i = 0; i < Math.max(A.length, B.length); i += 1) {
    const d = (A[i] || 0) - (B[i] || 0);
    if (d !== 0) return d > 0 ? 1 : -1;
  }
  return 0;
}

async function getJson(url) {
  const res = await fetch(url, {
    headers: { 'user-agent': 'arch-design-law upstream check' },
  });
  if (!res.ok) throw new Error(`取得 ${url} 失敗，HTTP ${res.status}`);
  return res.json();
}

/* 把官方快照字樣（2026/10/30 上午 12:00:00）化為可比較的 YYYY-MM-DD */
function snapDate(s) {
  const m = String(s ?? '').match(/(\d{4})\/(\d{1,2})\/(\d{1,2})/);
  if (!m) return '';
  return `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
}

/* ---------------------------------------------------------------- 本頁 */

async function readLocal() {
  const html = await readFile(LOCAL_HTML, 'utf8');
  const m = html.match(/var DATA = (\{[\s\S]*?\});\r?\n/);
  if (!m) throw new Error('index.html 找不到 var DATA 宣告，資料結構可能已改，請檢查本腳本');
  const data = JSON.parse(m[1]);
  const lawIds = new Set();
  for (const row of [...(data.laws || []), ...(data.a11y || [])]) {
    if (row.lawId) lawIds.add(row.lawId);
  }
  return {
    meta: data.meta || {},
    lawIds,
    nLaws: (data.laws || []).length,
    nA11y: (data.a11y || []).length,
  };
}

/* ---------------------------------------------------------------- 主程序 */

async function main() {
  const local = await readLocal();
  const [catalog, pkg] = await Promise.all([
    getJson(`${RAW}/data/catalog.json`),
    getJson(`${RAW}/package.json`).catch(() => ({})),
  ]);

  const localVer = local.meta.catalogVersion || '0.0.0';
  const upVer = catalog.version || pkg.version || '0.0.0';
  const outdated = cmpVersion(upVer, localVer) > 0;

  const outcomes = Array.isArray(catalog?.syncStatus?.outcomes) ? catalog.syncStatus.outcomes : [];
  const mine = outcomes.filter((o) => local.lawIds.has(o.id));
  const byStatus = new Map();
  for (const o of mine) {
    const k = o.status || 'unknown';
    if (!byStatus.has(k)) byStatus.set(k, []);
    byStatus.get(k).push(o);
  }

  const localSnap = snapDate(local.meta.snapshot);
  const newerSnap = mine.filter((o) => {
    const s = snapDate(o?.source?.snapshot);
    return s && localSnap && s > localSnap;
  });

  /* ------------------------------------------------------------ 報告 */

  const L = [];
  L.push('## 上游版本比對');
  L.push('');
  L.push('| 項目 | 本頁 | 上游 |');
  L.push('| --- | --- | --- |');
  L.push(`| catalog 版本 | v${localVer} | v${upVer} |`);
  L.push(`| 鎖定 commit | \`${local.meta.commit || '未記錄'}\` | \`${UPSTREAM_BRANCH}\` 最新 |`);
  L.push(`| 官方批次快照 | ${local.meta.snapshot || '未記錄'} | 見下方逐部清單 |`);
  L.push(`| 上游蒐集時間 | 本頁建置 ${local.meta.built || '未記錄'} | ${catalog.collected || '未記錄'} |`);
  L.push('');
  L.push(`本頁現有條文卡 ${local.nLaws} 筆、無障礙規範分節 ${local.nA11y} 節，涵蓋 ${local.lawIds.size} 部法規。`);
  L.push('');

  if (!outdated) {
    L.push('**結論：版本相同，無須更新。**');
  } else {
    L.push(`**結論：上游已更新至 v${upVer}，本頁仍為 v${localVer}。**`);
    L.push('');

    if (newerSnap.length) {
      L.push(`### 官方快照比本頁新的法規（${newerSnap.length} 部）`);
      L.push('');
      L.push('| 法規 ID | 名稱 | 上游官方快照 | 上游同步狀態 |');
      L.push('| --- | --- | --- | --- |');
      for (const o of newerSnap.slice(0, 80)) {
        L.push(`| ${o.id} | ${o.name || ''} | ${snapDate(o?.source?.snapshot)} | ${o.status || ''} |`);
      }
      if (newerSnap.length > 80) L.push(`| … | 另有 ${newerSnap.length - 80} 部 | | |`);
      L.push('');
      L.push('這一份是**需要人工核對**的清單：本頁的條文文字可能已與官方現行版本不符。');
      L.push('');
    } else {
      L.push('本頁涵蓋的法規中，沒有官方快照日晚於本頁快照日者。差異可能只在上游的介面、附圖或函釋。');
      L.push('');
    }

    const risky = [...(byStatus.get('unavailable') || []), ...(byStatus.get('not-attempted') || [])];
    if (risky.length) {
      L.push(`### 上游未能重新取得的法規（${risky.length} 部）`);
      L.push('');
      for (const o of risky.slice(0, 40)) {
        L.push(`- ${o.id} ${o.name || ''}（${o.status}）`);
      }
      L.push('');
      L.push('這些法規上游這一輪沒有抓到新版，沿用舊資料，請勿視為已核實為現行版本。');
      L.push('');
    }

    L.push('### 上游同步狀態統計（僅計本頁涵蓋者）');
    L.push('');
    for (const [k, v] of [...byStatus.entries()].sort((a, b) => b[1].length - a[1].length)) {
      L.push(`- ${k}：${v.length} 部`);
    }
    L.push('');
    L.push('### 後續動作');
    L.push('');
    L.push('1. 查看上游更新說明：https://github.com/termcavetw/openlawtw#本版更新');
    L.push('2. 重新產生本頁 DATA 時，必須保留本頁自有的教學標記（`stages`、`comps`、`occ`、`rc`、`note`），這些欄位上游沒有。');
    L.push('3. 更新 `meta` 的 `commit`、`catalogVersion`、`snapshot`、`built` 四個欄位，頁首與「資料來源與限制」頁籤會自動顯示新日期。');
    L.push('4. 引用與授權依上游規定：程式為 MIT，法規、函釋、PDF 與圖表依各自來源權利處理。');
    L.push('');
    L.push('> 上游自述其版本異動追蹤比對的是該庫版本，不是官方即時修法通知。法規仍應以官方現行版本為準。');
  }

  L.push('');
  L.push(`<sub>由 \`scripts/check-upstream.mjs\` 於 ${new Date().toISOString()} 產生。</sub>`);

  const report = L.join('\n');
  await writeFile(REPORT, `${report}\n`, 'utf8');
  console.log(report);

  if (process.env.GITHUB_OUTPUT) {
    await appendFile(
      process.env.GITHUB_OUTPUT,
      [
        `outdated=${outdated}`,
        `upstream_version=${upVer}`,
        `local_version=${localVer}`,
        `affected=${newerSnap.length}`,
      ].join('\n') + '\n',
      'utf8',
    );
  }
}

main().catch((err) => {
  console.error(`檢查失敗：${err.message}`);
  process.exit(1);
});
