#!/usr/bin/env node
/*
 * 與上游 openlawtw 核對本頁條文是否仍為現行內容。
 *
 * 判準說明（重要）：
 *   上游 data/catalog.json 的 status「updated」與 source.snapshot（官方 XML 批次日）
 *   只代表上游重新抓取過官方批次，不代表條文文字有變動。上游的條文檔以內容定址
 *   （檔名即內容雜湊），內容沒變就不會改檔，檔內的 snapshot 與 retrieved 會保留
 *   首次觀測的日期。因此唯一可靠的判準是逐條比對條文文字。
 *
 * 流程：
 *   1. 讀本頁 index.html 的 var DATA，取得 meta 與全部條文卡
 *   2. 取上游 data/manifest.json，依 lawId 取回各該法規的 schema v2 JSON
 *   3. 逐條以正規化後的文字比對，並檢查官方 modified 日期與條號增刪
 *   4. 有差異則產生報告供開 issue；完全相同則更新 meta.verified 的核對日
 *
 * 產出：
 *   upstream-report.md        報告
 *   GITHUB_OUTPUT             changed、verified_bumped、upstream_version 等
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
const TODAY = new Date().toISOString().slice(0, 10);

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
  const res = await fetch(url, { headers: { 'user-agent': 'arch-design-law upstream check' } });
  if (!res.ok) throw new Error(`取得 ${url} 失敗，HTTP ${res.status}`);
  return res.json();
}

/* 條文文字正規化：統一換行、全形空白與行首行尾空白後再比對，
   避免只因排版空白差異就誤判為修法。 */
function normText(s) {
  return String(s ?? '')
    .normalize('NFC')
    .replace(/\r\n/g, '\n')
    .replace(/　/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .split('\n')
    .map((l) => l.trim())
    .join('\n')
    .trim();
}

/* 條號正規化：去掉所有空白，「第 164-1 條」與「第164-1條」視為同一條 */
const normNo = (n) => String(n ?? '').replace(/\s+/g, '');

/* ---------------------------------------------------------------- 本頁 */

const DATA_RE = /var DATA = (\{[\s\S]*?\});\r?\n/;

async function readLocal() {
  const html = await readFile(LOCAL_HTML, 'utf8');
  const m = html.match(DATA_RE);
  if (!m) throw new Error('index.html 找不到 var DATA 宣告，資料結構可能已改，請檢查本腳本');
  const data = JSON.parse(m[1]);
  const rows = data.laws || [];
  const byLaw = new Map();
  for (const r of rows) {
    if (!r.lawId) continue;
    if (!byLaw.has(r.lawId)) byLaw.set(r.lawId, []);
    byLaw.get(r.lawId).push(r);
  }
  return { html, meta: data.meta || {}, byLaw, nLaws: rows.length, nA11y: (data.a11y || []).length };
}

/* ---------------------------------------------------------------- 主程序 */

async function main() {
  const local = await readLocal();
  const [catalog, manifest] = await Promise.all([
    getJson(`${RAW}/data/catalog.json`).catch(() => ({})),
    getJson(`${RAW}/data/manifest.json`),
  ]);

  const localVer = local.meta.catalogVersion || '0.0.0';
  const upVer = catalog.version || '0.0.0';
  const newerCatalog = cmpVersion(upVer, localVer) > 0;

  const upLaws = manifest.laws || {};
  const changed = [];   // 條文文字有差異
  const added = [];     // 上游有、本頁無的條號
  const dropped = [];   // 本頁有、上游已無的條號
  const notFound = [];  // 上游 manifest 查無此法規
  const modifiedDates = [];
  let compared = 0;

  for (const [lawId, rows] of [...local.byLaw.entries()].sort()) {
    const entry = upLaws[lawId];
    if (!entry) {
      notFound.push({ lawId, name: rows[0]?.lawName || '', n: rows.length });
      continue;
    }
    let law;
    try {
      law = await getJson(`${RAW}${entry.url}`);
    } catch (err) {
      notFound.push({ lawId, name: rows[0]?.lawName || '', n: rows.length, err: err.message });
      continue;
    }

    const upByNo = new Map();
    for (const a of law.articles || []) upByNo.set(normNo(a.no), a);

    modifiedDates.push({
      lawId,
      name: law.name || rows[0]?.lawName || '',
      modified: law.modified || '',
      mine: rows.length,
      upstream: (law.articles || []).length,
    });

    const seen = new Set();
    for (const r of rows) {
      compared += 1;
      const key = normNo(r.no);
      seen.add(key);
      const a = upByNo.get(key);
      if (!a) {
        dropped.push({ lawId, name: law.name, no: r.no });
        continue;
      }
      if (normText(a.text) !== normText(r.text)) {
        changed.push({
          lawId,
          name: law.name,
          no: r.no,
          mineLen: normText(r.text).length,
          upLen: normText(a.text).length,
          stages: (r.stages || []).join(' '),
        });
      }
    }
    for (const [key, a] of upByNo) {
      if (!seen.has(key)) added.push({ lawId, name: law.name, no: a.no });
    }
  }

  const needsWork = changed.length > 0 || dropped.length > 0 || notFound.length > 0;

  /* ------------------------------------------------------------ 報告 */

  const L = [];
  L.push('## 條文核對結果');
  L.push('');
  L.push(`核對日：${TODAY}　上游 ${UPSTREAM_REPO}@${UPSTREAM_BRANCH}，catalog v${upVer}（本頁記錄 v${localVer}）`);
  L.push('');
  L.push(`本頁條文卡 ${local.nLaws} 筆、無障礙規範分節 ${local.nA11y} 節，涵蓋 ${local.byLaw.size} 部法規，本次逐條比對 ${compared} 筆。`);
  L.push('');
  L.push(`《建築物無障礙設施設計規範》的 ${local.nA11y} 節不納入本比對，其來源為國土管理署官方 PDF，須另以 \`meta.a11yRetrieved\` 的取得日人工核對。`);
  L.push('');
  L.push('| 檢查項目 | 筆數 |');
  L.push('| --- | --- |');
  L.push(`| 條文文字有差異 | ${changed.length} |`);
  L.push(`| 本頁有、上游已無的條號 | ${dropped.length} |`);
  L.push(`| 上游有、本頁未收錄的條號 | ${added.length} |`);
  L.push(`| 上游查無此法規 | ${notFound.length} |`);
  L.push('');

  if (changed.length) {
    L.push(`### 條文文字有差異（${changed.length} 條，需要人工處理）`);
    L.push('');
    L.push('| 法規 | 條號 | 本頁字數 | 上游字數 | 設計階段 |');
    L.push('| --- | --- | --- | --- | --- |');
    for (const c of changed.slice(0, 120)) {
      L.push(`| ${c.name} | ${c.no} | ${c.mineLen} | ${c.upLen} | ${c.stages} |`);
    }
    if (changed.length > 120) L.push(`| … | 另有 ${changed.length - 120} 條 | | | |`);
    L.push('');
    L.push('更新這些條文時必須保留本頁自有的教學標記（`stages`、`comps`、`occ`、`rc`、`note`），上游沒有這些欄位。');
    L.push('');
  }

  if (dropped.length) {
    L.push(`### 本頁有、上游已無的條號（${dropped.length} 條）`);
    L.push('');
    for (const d of dropped.slice(0, 40)) L.push(`- ${d.name} ${d.no}`);
    L.push('');
    L.push('可能是條號刪除或上游收錄調整，須回官方核對後再決定是否撤下卡片。');
    L.push('');
  }

  if (notFound.length) {
    L.push(`### 上游查無此法規（${notFound.length} 部）`);
    L.push('');
    for (const n of notFound) L.push(`- ${n.lawId} ${n.name}（本頁 ${n.n} 條）${n.err ? `：${n.err}` : ''}`);
    L.push('');
  }

  if (added.length) {
    L.push(`### 上游有、本頁未收錄的條號（${added.length} 條，僅供參考）`);
    L.push('');
    L.push('本頁是依設計課工作階段篩選收錄，未收錄不等於缺漏。需要時再評估是否納入並補上教學標記。');
    L.push('');
    const byName = new Map();
    for (const a of added) byName.set(a.name, (byName.get(a.name) || 0) + 1);
    for (const [name, n] of [...byName.entries()].sort((x, y) => y[1] - x[1])) {
      L.push(`- ${name}：${n} 條`);
    }
    L.push('');
  }

  L.push('### 各法規官方修正日');
  L.push('');
  L.push('| 法規 | 官方 modified | 本頁收錄 | 上游條數 |');
  L.push('| --- | --- | --- | --- |');
  for (const m of modifiedDates) {
    L.push(`| ${m.name} | ${m.modified || '未記錄'} | ${m.mine} | ${m.upstream} |`);
  }
  L.push('');

  if (!needsWork) {
    L.push('**結論：條文全部與上游現行內容一致，無須更新。**');
    if (newerCatalog) {
      L.push('');
      L.push(`上游 catalog 已由 v${localVer} 進到 v${upVer}，但差異在介面、附圖或函釋，不在本頁引用的條文文字。`);
    }
  } else {
    L.push('**結論：有需要人工處理的項目，見上方清單。**');
  }

  L.push('');
  L.push('> 上游自述其版本異動追蹤比對的是該庫版本，不是官方即時修法通知。本核對亦同：它證明本頁與上游一致，不等於已向官方確認為現行版本。');
  L.push('');
  L.push(`<sub>由 \`scripts/check-upstream.mjs\` 於 ${new Date().toISOString()} 產生。</sub>`);

  const report = L.join('\n');
  await writeFile(REPORT, `${report}\n`, 'utf8');
  console.log(report);

  /* ------------------------------------------------ 無差異時更新核對日 */

  let bumped = false;
  if (!needsWork) {
    const before = local.meta.verified || '';
    if (before !== TODAY) {
      const hits = local.html.match(/"verified":"\d{4}-\d{2}-\d{2}"/g) || [];
      if (hits.length === 1) {
        await writeFile(
          LOCAL_HTML,
          local.html.replace(/"verified":"\d{4}-\d{2}-\d{2}"/, `"verified":"${TODAY}"`),
          'utf8',
        );
        bumped = true;
        console.log(`\n已將 meta.verified 由 ${before || '未設定'} 更新為 ${TODAY}`);
      } else {
        console.log(`\nmeta.verified 欄位出現 ${hits.length} 次，為避免誤改未更新，請人工檢查`);
      }
    }
  }

  if (process.env.GITHUB_OUTPUT) {
    await appendFile(
      process.env.GITHUB_OUTPUT,
      [
        `changed=${needsWork}`,
        `n_changed=${changed.length}`,
        `verified_bumped=${bumped}`,
        `verified_date=${TODAY}`,
        `upstream_version=${upVer}`,
        `local_version=${localVer}`,
      ].join('\n') + '\n',
      'utf8',
    );
  }
}

main().catch((err) => {
  console.error(`核對失敗：${err.message}`);
  process.exit(1);
});
