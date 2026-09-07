#!/usr/bin/env node
// Convert a scan archive (schemaVersion 2 JSON) to a BOM-prefixed UTF-8 CSV
// that opens cleanly in Excel (Chinese-safe).
//
// Usage: node to-csv.js <archive.json> [output.csv]
// Default output: same path with .json replaced by .csv

const fs = require('fs');

function esc(s) {
  if (s === null || s === undefined) return '';
  s = String(s);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function main() {
  const [, , src, outArg] = process.argv;
  if (!src) {
    console.error('Usage: node to-csv.js <archive.json> [output.csv]');
    process.exit(1);
  }
  let j;
  try {
    j = JSON.parse(fs.readFileSync(src, 'utf8'));
  } catch (e) {
    console.error(`[to-csv] cannot read ${src}: ${e.message}`);
    process.exit(1);
  }
  const videos = Array.isArray(j.videos) ? j.videos : [];

  const header = ['序号', '视频ID', '视频链接', '发布时间', '时长秒', '话题标签', '音乐', '播放量', '点赞', '评论', '分享', '收藏', '置顶', '疑似带货', '描述'];
  const rows = [header.join(',')];
  for (const v of videos) {
    rows.push([
      v.rank,
      v.id,
      v.url,
      v.publishedAt,
      v.durationSec,
      (v.hashtags || []).join(' '),
      v.musicTitle,
      v.playCount,
      v.likeCount,
      v.commentCount,
      v.shareCount,
      v.collectCount,
      v.isPinned ? '是' : '',
      v.commerceHint ? '是' : '',
      v.desc
    ].map(esc).join(','));
  }
  // totals footer
  const sum = k => videos.reduce((s, v) => s + (Number.isFinite(v[k]) ? v[k] : 0), 0);
  rows.push(['总计', '', '', '', '', '', '', sum('playCount'), sum('likeCount'), sum('commentCount'), sum('shareCount'), sum('collectCount'), j.pinnedCount != null ? `置顶${j.pinnedCount}条` : '', '', ''].map(esc).join(','));

  const out = outArg || src.replace(/\.json$/i, '.csv');
  fs.writeFileSync(out, '﻿' + rows.join('\r\n') + '\r\n', 'utf8');
  console.error(`[to-csv] wrote ${out} (${videos.length} video rows)`);
  process.exit(0);
}

main();
