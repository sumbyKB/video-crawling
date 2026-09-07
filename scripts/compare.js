#!/usr/bin/env node
// Compare two archived scans (schemaVersion 2 JSON produced by scan.js)
// and print a markdown "delta" section to stdout.
//
// Usage: node compare.js <old-or-new-path-1> <path-2>
// Older/newer is decided by each file's capturedAt, not argument order.
// Exit 0 on success; prints an error message to stderr and exits 1 on bad input.

const fs = require('fs');

const fmt = n => (typeof n === 'number' && Number.isFinite(n)) ? n.toLocaleString('en-US') : null;

function delta(cur, prev) {
  if (!Number.isFinite(cur) || !Number.isFinite(prev)) return { abs: null, pct: null };
  const abs = cur - prev;
  let pct = null;
  if (prev > 0) {
    const p = Math.round((abs / prev) * 1000) / 10;
    pct = (p > 0 ? '+' : '') + p + '%';
  }
  return { abs, pct };
}

function fmtDelta(d) {
  if (d.abs === null) return '—';
  const sign = d.abs > 0 ? '+' : d.abs < 0 ? '−' : '±';
  const body = (fmt(Math.abs(d.abs)) || String(Math.abs(d.abs)));
  return d.pct ? `${sign}${body} (${d.pct})` : `${sign}${body}`;
}

function load(p) {
  try {
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (!j || !Array.isArray(j.videos)) throw new Error('no videos[]');
    return j;
  } catch (e) {
    console.error(`[compare] cannot read archive ${p}: ${e.message}`);
    process.exit(1);
  }
}

function main() {
  const [, , a, b] = process.argv;
  if (!a || !b) {
    console.error('Usage: node compare.js <archive1.json> <archive2.json>');
    process.exit(1);
  }
  let older = load(a), newer = load(b);
  const ta = Date.parse(older.capturedAt || ''), tb = Date.parse(newer.capturedAt || '');
  if (!isNaN(tb) && !isNaN(ta) && tb < ta) { [older, newer] = [newer, older]; }

  const L = [];
  L.push(`### 与上次扫描相比`);
  L.push('');
  L.push(`上次：**${(older.capturedAt || '?').slice(0, 16).replace('T', ' ')}**（样本 ${older.requestedCount} 条） → 本次：**${(newer.capturedAt || '?').slice(0, 16).replace('T', ' ')}**（样本 ${newer.requestedCount} 条）`);
  if (older.requestedCount !== newer.requestedCount) {
    L.push('');
    L.push(`> ⚠️ 两次取样条数不同，逐条对齐仍有意义，但总量对比仅作参考。`);
  }

  // follower movement
  const fo = older.profileStats && older.profileStats.followerCount;
  const fn = newer.profileStats && newer.profileStats.followerCount;
  if (Number.isFinite(fn) && Number.isFinite(fo) && fn !== fo) {
    const fd = delta(fn, fo);
    L.push('');
    L.push(`**粉丝变化**：${fmt(fo)} → ${fmt(fn)}（${fd.abs >= 0 ? '+' : '−'}${fmt(Math.abs(fd.abs))}，${fd.pct || '基数过小无百分比'}）`);
  }

  const prevById = new Map(older.videos.map(v => [v.id, v]));
  const newIds = new Set(newer.videos.map(v => v.id));

  L.push('');
  L.push('| # | 视频链接 | 发布时间 | 播放量 | Δ播放 | 点赞 | Δ点赞 | 备注 |');
  L.push('|---:|---|---|---:|---:|---:|---:|---|');
  for (const v of newer.videos) {
    const p = prevById.get(v.id);
    const dp = delta(v.playCount, p && p.playCount);
    const dl = delta(v.likeCount, p && p.likeCount);
    const notes = [];
    if (!p) notes.push('🆕');
    if (v.isPinned) notes.push('📌');
    L.push(`| ${v.rank} | [${v.id.slice(-6)}](${v.url}) | ${(v.publishedAt || '').slice(5, 16)} | ${fmt(v.playCount)} | ${p ? fmtDelta(dp) : '—'} | ${fmt(v.likeCount)} | ${p ? fmtDelta(dl) : '—'} | ${notes.join(' ') || '—'} |`);
  }

  // videos present last time but gone now
  const gone = older.videos.filter(v => !newIds.has(v.id));
  if (gone.length) {
    L.push('');
    L.push(`⚠️ **上次有、本次前 ${newer.requestedCount} 条里不见了的视频**（可能被删、被移出置顶，或滑出取样窗口）：`);
    for (const g of gone) {
      L.push(`- [${g.id}](${g.url}) 上次播放 ${fmt(g.playCount)}${g.isPinned ? '（原为置顶）' : ''} ｜ ${(g.desc || '').slice(0, 30)}`);
    }
  }

  // totals
  const sum = (arr, k) => arr.reduce((s, v) => s + (Number.isFinite(v[k]) ? v[k] : 0), 0);
  const keys = ['playCount', 'likeCount', 'commentCount', 'shareCount', 'collectCount'];
  L.push('');
  L.push(`**总量对比**：` + keys.map(k => ({ playCount: '播放', likeCount: '点赞', commentCount: '评论', shareCount: '分享', collectCount: '收藏' }[k]) +
    ` ${fmt(sum(older.videos, k))} → ${fmt(sum(newer.videos, k))}`).join(' ｜ '));

  process.stdout.write(L.join('\n') + '\n');
}

main();
