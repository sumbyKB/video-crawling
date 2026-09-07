#!/usr/bin/env node
// TikTok creator recent videos scanner v2
// Connects to dedicated Chrome on port 9223, intercepts /api/post/item_list,
// collects recent N videos with full stats + pinned status + profile-level metrics.
//
// Usage: node scan.js <handle-or-url> [count]
//   count defaults to 20.
// Output: JSON v2 to stdout, logs to stderr. Exit code is always 0;
// consumers detect failure by reading the "error" field.
//
// Structured error codes (see SKILL.md failure table):
//   INVALID_HANDLE               - could not parse handle from input
//   CHROME_NOT_REACHABLE         - port 9223 down / Chrome dead -> auto-launch flow
//   CREATE_TARGET_FAILED         - CDP refused tab creation
//   NAV_FAILED_OR_CAPTCHA        - page never loaded, or slider captcha detected
//   EMPTY_RESULT_LIKELY_MS_TOKEN - page loaded but zero items captured
// Success payload carries warningCode PARTIAL_COUNT when fewer than requested.

const PORT = 9223;

function fail(handle, code, detail, hint) {
  process.stdout.write(JSON.stringify({ schemaVersion: 2, handle, error: code, detail, hint }, null, 2));
  process.exit(0);
}

function normalizeHandle(raw) {
  if (!raw) return null;
  let s = String(raw).trim();
  // Accept full video/profile URLs, @handle, or bare handle
  s = s.replace(/^https?:\/\//i, '').replace(/^www\.tiktok\.com\//i, '');
  s = s.split('?')[0].split('#')[0];
  s = s.replace(/\/video\/.*$/i, '').replace(/\/+$/, '');
  s = s.replace(/^@/, '');
  s = s.split('/')[0];
  if (!/^[A-Za-z0-9._]{1,30}$/.test(s)) return null;
  return s.toLowerCase();
}

async function main() {
  const handle = normalizeHandle(process.argv[2]);
  const requestedCountRaw = parseInt(process.argv[3], 10);
  const requestedCount = Number.isFinite(requestedCountRaw) && requestedCountRaw > 0 ? Math.min(requestedCountRaw, 200) : 20;
  if (!handle) {
    console.error('Usage: node scan.js <handle> [count]');
    fail(null, 'INVALID_HANDLE', `cannot parse handle from: ${process.argv[2]}`, '输入应为 @handle、纯 handle 或任意 tiktok.com 链接');
  }

  // 1. Check Chrome reachable
  let ver;
  try {
    const resp = await fetch(`http://127.0.0.1:${PORT}/json/version`, { signal: AbortSignal.timeout(5000) });
    if (!resp.ok) throw new Error(`http ${resp.status}`);
    ver = await resp.json();
  } catch (e) {
    fail(handle, 'CHROME_NOT_REACHABLE', e.message, '专用 Chrome 未启动：让 Claude 自动执行 start-tiktok-chrome.bat 后重试');
  }

  // 2. Connect WebSocket
  const ws = new WebSocket(ver.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws connect failed')); });

  let nextId = 0;
  const pending = new Map();
  const captured = [];          // every item_list response seen
  const decodedIds = new Set(); // requestIds whose body we've already pulled

  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    else if (m.method === 'Network.responseReceived' && m.params && m.params.response) {
      const u = m.params.response.url;
      if (/\/api\/post\/item_list/.test(u)) {
        captured.push({ reqId: m.params.requestId, url: u });
        console.error(`[capture] item_list page #${captured.length}`);
      }
    }
  };

  const send = (method, params = {}, sid) => new Promise((r) => {
    const id = ++nextId;
    pending.set(id, r);
    ws.send(JSON.stringify({ id, method, params, sessionId: sid }));
    setTimeout(() => r({ timeout: true, method }), 90000);
  });

  // 3. Create background tab
  const cr = await send('Target.createTarget', { url: 'about:blank' });
  if (!cr.result || !cr.result.targetId) {
    fail(handle, 'CREATE_TARGET_FAILED', JSON.stringify(cr).slice(0, 200));
  }
  const tid = cr.result.targetId;
  const at = await send('Target.attachToTarget', { targetId: tid, flatten: true });
  const sid = at.result.sessionId;

  await send('Network.enable', { maxTotalBufferSize: 30000000 }, sid).catch(() => {});
  await send('Page.enable', {}, sid).catch(() => {});

  // Pull bodies of all captured-but-undecoded responses into `items`
  const items = [];
  async function drainBodies() {
    for (const c of captured) {
      if (decodedIds.has(c.reqId)) continue;
      decodedIds.add(c.reqId);
      try {
        const { result } = await send('Network.getResponseBody', { requestId: c.reqId }, sid);
        if (result && result.body) {
          let txt = result.body;
          if (result.base64Encoded) txt = Buffer.from(txt, 'base64').toString('utf8');
          const j = JSON.parse(txt);
          if (j.itemList) items.push(...j.itemList);
        }
      } catch (e) {}
    }
  }

  // 4. Navigate with retry until page loads
  const profileUrl = `https://www.tiktok.com/@${handle}`;
  let loaded = false;
  let sawCaptcha = false;
  for (let attempt = 1; attempt <= 3 && !loaded; attempt++) {
    await send('Page.navigate', { url: profileUrl }, sid).catch(() => {});
    for (let poll = 0; poll < 8; poll++) {
      await new Promise(r => setTimeout(r, 3000));
      const r = await send('Runtime.evaluate', {
        expression: `JSON.stringify({links: document.querySelectorAll('a[href*="/video/"]').length, bodyLen: document.body ? document.body.innerText.length : 0, captcha: /Drag the slider|slider to fit|puzzle|verify/i.test(document.body ? document.body.innerText : '')})`,
        returnByValue: true
      }, sid);
      const v = r.result && r.result.result && r.result.result.value;
      if (v) {
        const st = JSON.parse(v);
        if (st.links > 0 || (st.bodyLen > 300 && !st.captcha)) { loaded = true; break; }
        if (st.captcha) { sawCaptcha = true; console.error(`[attempt ${attempt}] captcha detected`); break; }
      }
    }
  }
  if (!loaded) {
    await send('Target.closeTarget', { targetId: tid }).catch(() => {});
    fail(handle, sawCaptcha ? 'NAV_FAILED_OR_CAPTCHA' : 'NAV_FAILED_OR_CAPTCHA',
      sawCaptcha ? 'slider captcha shown' : 'profile page did not load after retries',
      sawCaptcha ? '在专用 Chrome 中手动打开该主页完成人机验证后回来重跑' : '检查该主页能否在专用 Chrome 正常打开；msToken 过期时先刷新任意达人主页');
  }

  // 5. Profile-level metrics from the page's embedded rehydration JSON
  //    Returns {nickname, uniqueId, verified, bio, followerCount, followingCount, heartCount, videoCount}
  //    with nulls wherever absent — never throws out to caller.
  const PROFILE_EXPR = `(function(){
    function pick(obj){ return obj || null; }
    var out = {};
    try {
      var el = document.getElementById('__UNIVERSAL_DATA_FOR_REHYDRATION__') || document.getElementById('SIGI_STATE');
      if (!el) return JSON.stringify(out);
      var data = JSON.parse(el.textContent);
      var ui = null;
      try { ui = data.__DEFAULT_SCOPE__['webapp.user-detail'].userInfo; } catch(e){}
      if (!ui) { try { ui = data.UserModule.users['${handle}']; } catch(e2){} }
      if (!ui) return JSON.stringify(out);
      var user = ui.user || ui; var stats = ui.stats || {};
      out.nickname   = user.nickname ?? null;
      out.uniqueId   = user.uniqueId ?? null;
      out.verified   = !!user.verified;
      out.bio        = user.bioDescription ?? user.signature ?? null;
      out.followerCount = stats.followerCount ?? null;
      out.followingCount = stats.followingCount ?? null;
      out.heartCount = stats.heart ?? stats.heartCount ?? null;
      out.videoCount = stats.videoCount ?? null;
    } catch(e) {}
    return JSON.stringify(out);
  })()`;
  const pr = await send('Runtime.evaluate', { expression: PROFILE_EXPR, returnByValue: true }, sid);
  let profileStats = { nickname: null, uniqueId: null, verified: false, bio: null, followerCount: null, followingCount: null, heartCount: null, videoCount: null };
  try {
    const pv = pr.result && pr.result.result && pr.result.result.value;
    if (pv) profileStats = Object.assign(profileStats, JSON.parse(pv));
  } catch (e) { console.error('[warn] profile stats extraction failed:', e.message); }

  // 6. Adaptive scrolling: stop as soon as we have enough unique items,
  //    give up when nothing new arrives for 3 consecutive rounds.
  const maxRounds = Math.min(60, Math.ceil(requestedCount / 6) + 6);
  let roundsSinceProgress = 0;

  function uniqueSeen() {
    const seen = new Set();
    for (const it of items) seen.add(String(it.id));
    return seen.size;
  }

  for (let s = 0; s < maxRounds; s++) {
    if (uniqueSeen() >= requestedCount) break;
    await send('Runtime.evaluate', { expression: 'window.scrollTo(0, document.body.scrollHeight)' }, sid).catch(() => {});
    await new Promise(r => setTimeout(r, 2200));
    const before = items.length;
    await drainBodies();
    if (items.length === before) {
      roundsSinceProgress++;
      if (roundsSinceProgress >= 3 && items.length > 0) break; // reached profile bottom
      if (roundsSinceProgress >= 4) break;                       // nothing at all after several tries
    } else {
      roundsSinceProgress = 0;
    }
  }
  await drainBodies();

  // 7. Dedupe preserving API order (pins surface naturally like the in-app grid)
  const seen = new Set();
  const unique = [];
  for (const it of items) {
    if (!seen.has(it.id)) { seen.add(it.id); unique.push(it); }
  }

  if (unique.length === 0) {
    await send('Target.closeTarget', { targetId: tid }).catch(() => {});
    fail(handle, 'EMPTY_RESULT_LIKELY_MS_TOKEN', `page loaded but 0 items captured (${captured.length} api responses)`,
      'msToken 可能已过期：让用户在专用 Chrome 里刷新任意达人主页后重跑；若该主页需登录也先登录');
  }

  // 8. Map to lean video records
  const videos = unique.slice(0, requestedCount).map((it, idx) => ({
    rank: idx + 1,
    id: String(it.id),
    url: `https://www.tiktok.com/@${profileStats.uniqueId || handle}/video/${it.id}`,
    publishedAt: it.createTime ? new Date(parseInt(it.createTime) * 1000 + 8 * 3600 * 1000).toISOString().slice(0, 16).replace('T', ' ') : null,
    createTime: it.createTime != null ? String(it.createTime) : null,
    durationSec: (it.video && it.video.duration) || null,
    hashtags: Array.from(new Set((it.textExtra || []).map(h => h.hashtagName).filter(Boolean))),
    musicTitle: (it.music && it.music.title) || null,
    commerceHint: !!(it.isAd || it.commerceInfo),
    playCount: it.stats && it.stats.playCount,
    likeCount: it.stats && it.stats.diggCount,
    shareCount: it.stats && it.stats.shareCount,
    commentCount: it.stats && it.stats.commentCount,
    collectCount: it.stats && it.stats.collectCount,
    isPinned: !!it.isPinnedItem,
    desc: (it.desc || '').slice(0, 120)
  }));

  // 9. Close tab and emit v2 payload
  await send('Target.closeTarget', { targetId: tid }).catch(() => {});
  ws.close();

  const result = {
    schemaVersion: 2,
    capturedAt: new Date().toISOString(),
    source: `tiktok.com/api/post/item_list intercepted via CDP on dedicated Chrome :${PORT}`,
    requestedCount,
    handle,
    uniqueId: profileStats.uniqueId || handle,
    nickname: profileStats.nickname || handle,
    profileUrl: `https://www.tiktok.com/@${profileStats.uniqueId || handle}`,
    verified: !!profileStats.verified,
    bio: profileStats.bio,
    profileStats: {
      followerCount: profileStats.followerCount,
      followingCount: profileStats.followingCount,
      heartCount: profileStats.heartCount,
      videoCount: profileStats.videoCount
    },
    totalItems: items.length,
    unique: unique.length,
    pinnedCount: videos.filter(v => v.isPinned).length,
    warningCode: unique.length < requestedCount ? `PARTIAL_COUNT(got:${unique.length},wanted:${requestedCount})` : null,
    videos
  };
  process.stdout.write(JSON.stringify(result, null, 2));
  setTimeout(() => process.exit(0), 200);
}

main().catch(e => {
  process.stdout.write(JSON.stringify({ schemaVersion: 2, error: 'FATAL', detail: e.message }));
  process.exit(0);
});
