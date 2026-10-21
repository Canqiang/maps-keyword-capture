import { CONNEXUP_LOGO } from './frontend-logo.js';

/** Standalone sign-in page; it never embeds credentials or data. A deep link such as /#evidence/… survives the
 * unauthenticated redirect only as the URL fragment, which the server never sees, so the page copies it into `next`. */
export function loginPage(options: { error?: boolean; next?: string } = {}): string {
  const next = options.next && /^\/[^\\/]?[^\s]*$/u.test(options.next) && !options.next.startsWith('//') ? options.next : '/';
  return String.raw`<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>登录 · Maps Rank Tracker</title>
<style>
:root{--ink:#1d1a2b;--secondary:#6b6680;--accent:#5b3fd6;--accent-ink:#fff;--line:#e4e0ee;--red:#a3241f;--red-bg:#fdecec}
*{box-sizing:border-box}html,body{margin:0;min-height:100%}
body{font:15px/1.6 "PingFang SC","Hiragino Sans GB","Microsoft YaHei",system-ui,sans-serif;color:var(--ink);background:radial-gradient(1200px 600px at 10% -10%,#efe9ff 0,transparent 60%),radial-gradient(900px 500px at 100% 100%,#e3f4ff 0,transparent 55%),#f6f5fb;display:grid;place-items:center;padding:24px}
.card{width:100%;max-width:420px;background:#fff;border:1px solid var(--line);border-radius:18px;box-shadow:0 24px 60px rgba(49,33,110,.12);padding:36px 36px 30px}
.brand{display:flex;flex-direction:column;align-items:flex-start;gap:12px;margin-bottom:26px}.brand img{height:30px}.brand b{display:block;font-size:16px;line-height:1.3}.brand span{display:block;color:var(--secondary);font-size:13px}
h1{font-size:22px;margin:0 0 6px;line-height:1.3}p.lead{margin:0 0 22px;color:var(--secondary)}
label{display:block;font-weight:600;font-size:13px;margin:0 0 6px}
input{width:100%;font:inherit;color:var(--ink);background:#fff;border:1px solid #d6d1e3;border-radius:10px;padding:11px 13px;margin-bottom:16px}
input:focus-visible{outline:3px solid #c9b8ff;outline-offset:1px;border-color:var(--accent)}
button{width:100%;font:inherit;font-weight:600;color:var(--accent-ink);background:var(--accent);border:0;border-radius:10px;padding:12px;cursor:pointer;margin-top:4px}
button:hover{background:#4a31b8}button:focus-visible{outline:3px solid #c9b8ff;outline-offset:2px}
.error{background:var(--red-bg);color:var(--red);border:1px solid #f3c7c4;border-radius:10px;padding:10px 12px;margin:0 0 18px;font-size:14px}
.foot{margin-top:22px;color:var(--secondary);font-size:12px;line-height:1.7}
</style></head><body>
<main class="card" aria-labelledby="title">
<div class="brand"><img src="${CONNEXUP_LOGO}" alt="connexup"><div><b>Maps Rank Tracker</b><span>Connexup · Maps 关键词观测 · 原始证据逐次可追溯</span></div></div>
<h1 id="title">登录工作空间</h1><p class="lead">查看门店关键词排名、历史截图与周围采集点。</p>
${options.error ? '<div class="error" role="alert">用户名或密码不正确，请重试。</div>' : ''}
<form method="post" action="/login" autocomplete="on">
<input type="hidden" name="next" value="${next.replaceAll('&', '&amp;').replaceAll('"', '&quot;')}">
<label for="username">用户名</label><input id="username" name="username" autocomplete="username" required autofocus>
<label for="password">密码</label><input id="password" name="password" type="password" autocomplete="current-password" required>
<button type="submit">登录</button>
</form>
<script>(function(){var n=document.querySelector('input[name="next"]');if(n&&n.value==='/'&&location.hash.length>1&&location.hash.indexOf('/')!==0)n.value='/'+location.hash;})();</script>
<div class="foot">登录状态保持 12 小时；服务重启后需要重新登录。</div>
</main></body></html>`;
}
