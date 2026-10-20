/** Single-page UI served at `/`. Plain HTML, CSS and JS; it only talks to `/api`. */
export const UI_HTML = String.raw`<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Maps Rank Tracker</title>
<style>
:root { --bg:#f7f7f5; --panel:#ffffff; --text:#1d1d1b; --muted:#6b6b66; --line:#e3e2dd; --accent:#1f6feb;
  --top3:#1a7f37; --top10:#9a6700; --top20:#bc4c00; --miss:#cf222e; --none:#d0d0cc; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --bg:#141413; --panel:#1d1d1b; --text:#ecebe6; --muted:#9b9a94; --line:#33322f; --accent:#4c9aff;
  --top3:#3fb950; --top10:#d29922; --top20:#f0883e; --miss:#f85149; --none:#3a3a37; } }
* { box-sizing:border-box; }
body { margin:0; background:var(--bg); color:var(--text); font:14px/1.5 -apple-system, "PingFang SC", "Noto Sans SC", "Segoe UI", sans-serif; }
header { display:flex; align-items:center; gap:16px; padding:12px 16px; border-bottom:1px solid var(--line); background:var(--panel); position:sticky; top:0; z-index:2; }
header h1 { font-size:16px; margin:0; }
header nav a { color:var(--muted); text-decoration:none; margin-right:12px; }
header nav a.on { color:var(--text); font-weight:600; }
main { max-width:1200px; margin:0 auto; padding:16px; }
.panel { background:var(--panel); border:1px solid var(--line); border-radius:8px; padding:16px; margin-bottom:16px; }
table { width:100%; border-collapse:collapse; }
th, td { text-align:left; padding:8px; border-bottom:1px solid var(--line); vertical-align:top; }
th { color:var(--muted); font-weight:500; font-size:12px; }
tr.click { cursor:pointer; } tr.click:hover { background:var(--bg); }
.num { font-variant-numeric:tabular-nums; text-align:right; }
.muted { color:var(--muted); }
.tag { display:inline-block; padding:0 6px; border-radius:4px; font-size:12px; border:1px solid var(--line); color:var(--muted); }
.rank { display:inline-block; min-width:28px; padding:1px 6px; border-radius:4px; color:#fff; text-align:center; font-weight:600; font-variant-numeric:tabular-nums; }
.r1 { background:var(--top3); } .r2 { background:var(--top10); } .r3 { background:var(--top20); } .r4 { background:var(--miss); } .r0 { background:var(--none); color:var(--muted); }
.up { color:var(--top3); } .down { color:var(--miss); }
button, select, input, textarea { font:inherit; color:var(--text); background:var(--panel); border:1px solid var(--line); border-radius:6px; padding:6px 10px; }
button { cursor:pointer; } button.primary { background:var(--accent); color:#fff; border-color:var(--accent); }
.row { display:flex; gap:12px; flex-wrap:wrap; align-items:center; }
.grid { display:grid; gap:4px; width:max-content; }
.cell { width:52px; height:52px; border-radius:6px; display:flex; align-items:center; justify-content:center; font-weight:600; color:#fff; font-variant-numeric:tabular-nums; }
.cell.center { outline:2px solid var(--text); outline-offset:1px; }
.metrics { display:grid; grid-template-columns:repeat(auto-fit, minmax(120px, 1fr)); gap:12px; }
.metric b { display:block; font-size:22px; } .metric span { color:var(--muted); font-size:12px; }
.shots { display:flex; gap:8px; overflow-x:auto; } .shots img { height:360px; border:1px solid var(--line); border-radius:6px; }
label { display:block; font-size:12px; color:var(--muted); margin:10px 0 4px; }
input, textarea { width:100%; } textarea { min-height:90px; }
.two { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
.err { color:var(--miss); } .ok { color:var(--top3); }
svg text { fill:var(--muted); font-size:11px; }
@media (max-width:720px) { .two { grid-template-columns:1fr; } .cell { width:40px; height:40px; } .hide-sm { display:none; } }
</style>
</head>
<body>
<header><h1>Maps Rank Tracker</h1><nav><a href="#/" id="nav-stores">门店</a><a href="#/new" id="nav-new">新增门店</a></nav><span class="muted" id="settings"></span></header>
<main id="app"><p class="muted">加载中…</p></main>
<script>
const app = document.getElementById('app');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const api = async (path, options = {}) => {
  const res = await fetch('/api' + path, { headers: { 'content-type': 'application/json' }, ...options });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || res.statusText);
  return body;
};
const bucket = r => r == null ? 'r4' : r <= 3 ? 'r1' : r <= 10 ? 'r2' : r <= 20 ? 'r3' : 'r4';
const rankBadge = (r, status, eligible) => eligible !== true ? '<span class="rank r0" title="' + esc(status) + '">?</span>'
  : r == null ? '<span class="rank r4" title="已确认未进入前20个自然结果">×</span>' : '<span class="rank ' + bucket(r) + '">' + r + '</span>';
const when = iso => iso ? new Date(iso).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
const change = (now, before) => {
  if (now == null || before == null || now === before) return '';
  return now < before ? '<span class="up">▲' + (before - now) + '</span>' : '<span class="down">▼' + (now - before) + '</span>';
};
let settings = null;
let routeVersion = 0, detailVersion = 0;

async function storesView(version = routeVersion, surface = 'web') {
  const stores = await api('/stores?surface=' + surface);
  if (version !== routeVersion) return;
  app.innerHTML = '<div class="panel"><div class="row" style="justify-content:space-between"><h2 style="margin:0;font-size:16px">门店 (' + stores.length + ')</h2>'
    + '<select id="summary-surface"><option value="web">网页端</option><option value="android">安卓端</option></select>'
    + '<input id="filter" placeholder="搜索门店" style="max-width:240px"></div>'
    + '<table><thead><tr><th>门店</th><th class="num">关键词</th><th class="num">上榜</th><th class="num">前三</th><th class="num">平均自然排名</th><th class="hide-sm">最近采集</th><th>状态</th></tr></thead><tbody id="rows"></tbody></table></div>';
  const render = q => {
    document.getElementById('rows').innerHTML = stores.filter(s => !q || (s.name + s.storeId).toLowerCase().includes(q)).map(s => {
      const m = s.summary || {};
      return '<tr class="click" data-id="' + esc(s.storeId) + '"><td><b>' + esc(s.name) + '</b><div class="muted">' + esc(s.storeId) + '</div></td>'
        + '<td class="num">' + (s.keywords.core.length + s.keywords.longTail.length) + '</td><td class="num">' + (m.keywords ? m.ranked : '—') + '</td><td class="num">' + (m.keywords ? m.top3 : '—') + '</td>'
        + '<td class="num">' + (m.averageOrganicRank ?? '—') + '</td><td class="hide-sm">' + when(m.lastObservedAt) + '</td><td>' + (s.active ? '<span class="tag">跟踪中</span>' : '<span class="tag">已暂停</span>') + '</td></tr>';
    }).join('') || '<tr><td colspan="7" class="muted">还没有门店，点右上角“新增门店”。</td></tr>';
    for (const tr of document.querySelectorAll('tr[data-id]')) tr.onclick = () => location.hash = '#/store/' + encodeURIComponent(tr.dataset.id) + '?surface=' + surface;
  };
  render('');
  document.getElementById('summary-surface').value = surface;
  document.getElementById('summary-surface').onchange = e => location.hash = '#/?surface=' + e.target.value;
  document.getElementById('filter').oninput = e => render(e.target.value.trim().toLowerCase());
}

async function storeView(storeId, version = routeVersion, surface = 'web') {
  const store = await api('/stores/' + encodeURIComponent(storeId));
  if (version !== routeVersion) return;
  const latest = await api('/stores/' + encodeURIComponent(storeId) + '/latest?surface=' + surface);
  if (version !== routeVersion) return;
  const today = new Date().toLocaleDateString('en-CA', { timeZone: settings?.timezone || 'America/New_York' });
  app.innerHTML = '<div class="panel"><div class="row" style="justify-content:space-between"><div><h2 style="margin:0;font-size:18px">' + esc(store.name) + '</h2>'
    + '<div class="muted">' + esc(store.storeId) + ' · ' + esc(store.placeId) + ' · 中心 ' + store.center.latitude + ', ' + store.center.longitude + '</div></div>'
    + '<div class="row"><select id="surface"><option value="web">网页端</option><option value="android">安卓端</option></select>'
    + '<a href="#/edit/' + encodeURIComponent(storeId) + '"><button>编辑</button></a>'
    + '<button id="toggle">' + (store.active ? '暂停跟踪' : '恢复跟踪') + '</button></div></div></div>'
    + '<div class="panel"><h3 style="margin:0 0 8px;font-size:14px">最新排名（店址）</h3><table><thead><tr><th>关键词</th><th>层级</th><th class="num">自然排名</th><th class="num">显示位</th><th>变化</th><th class="hide-sm">采集时间</th><th></th></tr></thead><tbody>'
    + (latest.map((r, i) => '<tr><td>' + esc(r.keyword) + '</td><td><span class="tag">' + (r.keywordTier === 'core' ? '核心' : r.keywordTier === 'longTail' ? '长尾' : '—') + '</span></td>'
      + '<td class="num">' + rankBadge(r.organicRank, r.status, r.eligible) + '</td><td class="num">' + (r.displayPosition ?? '—') + '</td><td>' + change(r.organicRank, r.previousOrganicRank) + '</td>'
      + '<td class="hide-sm muted">' + when(r.observedAt) + '</td><td><button data-trend="' + i + '">趋势</button> <button data-grid="' + i + '">网格</button> <button data-shots="' + i + '">截图</button></td></tr>').join('')
      || '<tr><td colspan="7" class="muted">还没有采集数据。下一次定时扫描后会出现在这里。</td></tr>')
    + '</tbody></table></div><div id="detail"></div>';
  document.getElementById('surface').value = surface;
  document.getElementById('surface').onchange = e => location.hash = '#/store/' + encodeURIComponent(storeId) + '?surface=' + e.target.value;
  document.getElementById('toggle').onclick = async () => {
    try {
      await api('/stores/' + encodeURIComponent(storeId) + '/active', { method: 'PUT', body: JSON.stringify({ active: !store.active }) });
      if (version === routeVersion) await route();
    } catch (e) { if (version === routeVersion) document.getElementById('detail').innerHTML = '<div class="panel err">' + esc(e.message) + '</div>'; }
  };
  for (const b of document.querySelectorAll('[data-trend]')) b.onclick = () => trendPanel(storeId, latest[b.dataset.trend], surface);
  for (const b of document.querySelectorAll('[data-grid]')) b.onclick = () => gridPanel(storeId, latest[b.dataset.grid], surface, today);
  for (const b of document.querySelectorAll('[data-shots]')) b.onclick = () => shotsPanel(latest[b.dataset.shots]);
}

async function trendPanel(storeId, row, surface) {
  const request = ++detailVersion, version = routeVersion;
  const days = 14;
  let points;
  try { points = await api('/stores/' + encodeURIComponent(storeId) + '/trend?surface=' + surface + '&days=' + days + '&keyword=' + encodeURIComponent(row.keyword)); }
  catch (e) { if (request === detailVersion && version === routeVersion) document.getElementById('detail').innerHTML = '<div class="panel err">' + esc(e.message) + '</div>'; return; }
  if (request !== detailVersion || version !== routeVersion) return;
  const w = 760, h = 220, pad = 32, maxRank = 20;
  const t0 = Date.now() - days * 86400000, t1 = Date.now();
  const x = t => pad + (new Date(t).getTime() - t0) / (t1 - t0) * (w - pad * 2);
  const y = r => pad + (r - 1) / maxRank * (h - pad * 2);
  const ranked = p => p.eligible !== false && p.status === 'ranked' && Number.isInteger(p.organicRank) && p.organicRank > 0;
  let connected = false;
  const path = points.map(p => {
    if (!ranked(p)) { connected = false; return ''; }
    const segment = (connected ? 'L' : 'M') + x(p.observedAt).toFixed(1) + ' ' + y(p.organicRank).toFixed(1);
    connected = true; return segment;
  }).join(' ');
  const dots = points.filter(ranked).map(p => '<circle cx="' + x(p.observedAt).toFixed(1) + '" cy="' + y(p.organicRank).toFixed(1) + '" r="3" fill="var(--accent)"><title>' + when(p.observedAt) + ' · ' + p.organicRank + '</title></circle>').join('');
  const gaps = points.filter(p => !ranked(p)).map(p => when(p.observedAt) + ' · ' + (p.eligible === true && ['not_found', 'ad_only'].includes(p.status) ? '已确认未进入前20个自然结果' : '不可用（' + p.status + '）'));
  const ticks = [1, 3, 10, 20].map(r => '<line x1="' + pad + '" x2="' + (w - pad) + '" y1="' + y(r) + '" y2="' + y(r) + '" stroke="var(--line)"/><text x="4" y="' + (y(r) + 4) + '">' + r + '</text>').join('');
  document.getElementById('detail').innerHTML = '<div class="panel"><h3 style="margin:0 0 8px;font-size:14px">' + esc(row.keyword) + ' · 近 ' + days + ' 天自然排名（' + points.length + ' 次采集，越靠上越好）</h3>'
    + '<svg viewBox="0 0 ' + w + ' ' + h + '" width="100%" role="img" aria-label="排名趋势">' + ticks + '<path d="' + path + '" fill="none" stroke="var(--accent)" stroke-width="2"/>' + dots + '</svg>'
    + (gaps.length ? '<p class="muted">趋势断点：' + gaps.map(esc).join('；') + '</p>' : '') + '</div>';
}

async function gridPanel(storeId, row, surface, date) {
  const request = ++detailVersion, version = routeVersion;
  let data;
  try { data = await api('/stores/' + encodeURIComponent(storeId) + '/grid?surface=' + surface + '&date=' + date + '&keyword=' + encodeURIComponent(row.keyword)); }
  catch (e) { if (request === detailVersion && version === routeVersion) document.getElementById('detail').innerHTML = '<div class="panel err">' + esc(e.message) + '</div>'; return; }
  if (request !== detailVersion || version !== routeVersion) return;
  const size = Math.round(Math.sqrt(data.grid.length));
  const m = data.metrics;
  const cells = data.cells.map(c => '<div class="cell ' + (c.observed ? bucket(c.rank) : 'r0') + (c.id === 'r0c0' ? ' center' : '') + '" title="' + esc(c.id) + ' · ' + c.distanceKm + ' km">' + (c.observed ? (c.rank ?? '×') : '?') + '</div>').join('');
  document.getElementById('detail').innerHTML = '<div class="panel"><h3 style="margin:0 0 8px;font-size:14px">' + esc(row.keyword) + ' · ' + date + ' 网格（' + size + '×' + size + '，北在上）</h3>'
    + (m.points ? '' : '<p class="muted">这一天没有可用于此网格的可靠排名记录。</p>')
    + '<div class="row" style="align-items:flex-start;gap:24px"><div class="grid" style="grid-template-columns:repeat(' + size + ',auto)">' + cells + '</div>'
    + '<div class="metrics" style="flex:1;min-width:240px">'
    + '<div class="metric"><b>' + (m.arp ?? '—') + '</b><span>ARP 出现点平均排名</span></div><div class="metric"><b>' + (m.atrp ?? '—') + '</b><span>ATRP 有效点平均（确认未出现按21计分）</span></div>'
    + '<div class="metric"><b>' + (m.solv == null ? '—' : Math.round(m.solv * 100) + '%') + '</b><span>SoLV 有效点前三占比</span></div><div class="metric"><b>' + m.found + '/' + m.points + '</b><span>出现 / 有效点</span></div>'
    + '<div class="metric"><b>' + (m.rings.inner.arp ?? '—') + '</b><span>内环 ≤1km ARP</span></div><div class="metric"><b>' + (m.rings.middle.arp ?? '—') + '</b><span>中环 ≤3km ARP</span></div><div class="metric"><b>' + (m.rings.outer.arp ?? '—') + '</b><span>外环 ARP</span></div>'
    + '</div></div></div>';
}

function shotsPanel(row) {
  detailVersion++;
  const keys = (row.screenshotKeys || []).slice(0, 8);
  const top = (row.topListings || []).map(l => '<tr><td class="num">' + l.displayPosition + '</td><td>' + (l.resultType === 'ad' ? '<span class="tag">广告</span> ' : '') + esc(l.name) + '</td><td class="num">' + (l.rating ?? '—') + '</td><td class="num">' + (l.reviewCount ?? '—') + '</td></tr>').join('');
  document.getElementById('detail').innerHTML = '<div class="panel"><h3 style="margin:0 0 8px;font-size:14px">' + esc(row.keyword) + ' · ' + when(row.observedAt) + ' 的列表与截图</h3>'
    + '<table style="margin-bottom:12px"><thead><tr><th class="num">位</th><th>商家</th><th class="num">评分</th><th class="num">评价</th></tr></thead><tbody>' + top + '</tbody></table>'
    + '<div class="shots">' + (keys.map(k => '<a href="/api/evidence?key=' + encodeURIComponent(k) + '" target="_blank"><img loading="lazy" alt="截图" src="/api/evidence?key=' + encodeURIComponent(k) + '"></a>').join('') || '<span class="muted">没有截图</span>') + '</div></div>';
}

function storeForm(store) {
  const version = routeVersion;
  const s = store || { active: true, aliases: [], keywords: { core: [], longTail: [] }, center: {} };
  const lines = a => (a || []).join('\n');
  app.innerHTML = '<div class="panel"><h2 style="margin:0;font-size:16px">' + (store ? '编辑门店' : '新增门店') + '</h2>'
    + '<div class="two"><div><label>门店 ID（字母数字和横线，创建后不能改）</label><input id="storeId" value="' + esc(s.storeId) + '"' + (store ? ' disabled' : '') + '></div>'
    + '<div><label>名称</label><input id="name" value="' + esc(s.name) + '"></div>'
    + '<div><label>Google Place ID（ChIJ 开头，变更需新增门店 ID）</label><input id="placeId" value="' + esc(s.placeId) + '"' + (store ? ' disabled' : '') + '></div>'
    + '<div><label>Merchant ID（可选）</label><input id="merchantId" value="' + esc(s.merchantId) + '"></div>'
    + '<div><label>中心纬度（创建后固定，迁址需审核迁移）</label><input id="lat" value="' + esc(s.center.latitude) + '"' + (store ? ' disabled' : '') + '></div><div><label>中心经度</label><input id="lng" value="' + esc(s.center.longitude) + '"' + (store ? ' disabled' : '') + '></div>'
    + '<div><label>网格半径 km（留空用默认 ' + (settings?.defaults?.grid?.radiusKm ?? 5) + '）</label><input id="radius" value="' + esc(s.grid?.radiusKm) + '"></div>'
    + '<div><label>网格边长 N（奇数，留空用默认 ' + (settings?.defaults?.grid?.size ?? 5) + '）</label><input id="size" value="' + esc(s.grid?.size) + '"></div></div>'
    + '<label>安卓识别别名（每行一个，建议包含英文名）</label><textarea id="aliases">' + esc(lines(s.aliases)) + '</textarea>'
    + '<div class="two"><div><label>核心关键词（每行一个，每两小时 + 网格扫描）</label><textarea id="core" style="min-height:160px">' + esc(lines(s.keywords.core)) + '</textarea></div>'
    + '<div><label>长尾关键词（每行一个，仅店址扫描）</label><textarea id="longTail" style="min-height:160px">' + esc(lines(s.keywords.longTail)) + '</textarea></div></div>'
    + '<div class="row" style="margin-top:12px"><button class="primary" id="save">保存</button><span id="msg"></span></div></div>';
  document.getElementById('save').onclick = async () => {
    const v = id => document.getElementById(id).value.trim();
    const list = id => v(id).split('\n').map(x => x.trim()).filter(Boolean);
    const body = { storeId: v('storeId'), name: v('name'), placeId: v('placeId'), aliases: list('aliases'), active: s.active,
      center: { latitude: Number(v('lat')), longitude: Number(v('lng')) }, keywords: { core: list('core'), longTail: list('longTail') } };
    if (v('merchantId')) body.merchantId = v('merchantId');
    if (s.expectedArea) body.expectedArea = s.expectedArea;
    if (v('radius') || v('size')) body.grid = { radiusKm: Number(v('radius') || settings.defaults.grid.radiusKm), size: Number(v('size') || settings.defaults.grid.size) };
    const msg = document.getElementById('msg');
    try {
      const saved = await api(store ? '/stores/' + encodeURIComponent(s.storeId) : '/stores', { method: store ? 'PUT' : 'POST', body: JSON.stringify(body) });
      if (version !== routeVersion) return;
      msg.className = 'ok'; msg.textContent = '已保存，下一次扫描生效';
      setTimeout(() => { if (version === routeVersion) location.hash = '#/store/' + encodeURIComponent(saved.storeId); }, 600);
    } catch (e) { if (version === routeVersion) { msg.className = 'err'; msg.textContent = e.message; } }
  };
}

async function route() {
  const version = ++routeVersion;
  detailVersion++;
  const hash = location.hash.replace(/^#/, '').split('?')[0] || '/';
  const surface = new URLSearchParams(location.hash.split('?')[1] || '').get('surface') === 'android' ? 'android' : 'web';
  for (const a of document.querySelectorAll('header nav a')) a.classList.toggle('on', a.getAttribute('href') === '#' + hash);
  try {
    if (!settings) { const loaded = await api('/settings'); if (version !== routeVersion) return; settings = loaded; document.getElementById('settings').textContent = '网页端每 ' + settings.surfaces.web.point.everyHours + ' 小时 · 时区 ' + settings.timezone; }
    const [, view, id] = hash.split('/');
    if (view === 'store' && id) await storeView(decodeURIComponent(id), version, surface);
    else if (view === 'edit' && id) { const store = await api('/stores/' + id); if (version === routeVersion) storeForm(store); }
    else if (view === 'new') storeForm(null);
    else await storesView(version, surface);
  } catch (e) { if (version === routeVersion) app.innerHTML = '<div class="panel err">' + esc(e.message) + '</div>'; }
}
window.addEventListener('hashchange', route);
route();
</script>
</body>
</html>`;
