// Adds the PWA wiring (manifest, icons, service worker, offline badge,
// "needs internet" states) to index.html and the four info pages.
// Safe to re-run: every insertion is skipped if its marker is present.
// Usage: node scripts/apply-pwa.js   (from the repo root)
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');

const HEAD_TAGS = `<!-- PWA -->
<link rel="manifest" href="/manifest.webmanifest" />
<meta name="theme-color" content="#faf5ec" media="(prefers-color-scheme: light)" />
<meta name="theme-color" content="#14110c" media="(prefers-color-scheme: dark)" />
<link rel="icon" href="/icons/icon.svg" type="image/svg+xml" />
<link rel="icon" href="/icons/favicon-32.png" sizes="32x32" type="image/png" />
<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
<meta name="mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-status-bar-style" content="black" />
<meta name="apple-mobile-web-app-title" content="Offline AI" />
`;

const CSS = `<style>
  /* ---- PWA: offline badge + needs-internet states ---- */
  .disclosure-bar .bar-right{display:flex;flex-wrap:wrap;align-items:center;gap:6px 12px;justify-content:flex-end;margin-left:auto}
  .pwa-badge{display:inline-flex;align-items:center;gap:6px;font-family:system-ui,sans-serif;font-size:11.5px;font-weight:700;letter-spacing:.02em;border-radius:999px;padding:3px 10px;border:1px solid var(--line-strong);color:var(--muted);background:var(--surface);white-space:nowrap}
  .pwa-badge[data-state="ready"]{color:var(--teal);background:var(--teal-soft);border-color:var(--teal)}
  .pwa-badge[data-state="offline"]{color:var(--rust);background:var(--rust-soft);border-color:var(--rust)}
  .pwa-update{font:inherit;font-weight:700;color:var(--amber);background:none;border:1.5px solid var(--amber);border-radius:999px;padding:4px 12px;min-height:44px;cursor:pointer}
  .pwa-update:hover{background:var(--amber);color:#fff}
  /* Off-site links (stores, makers, GitHub) need the internet */
  body.is-offline a[href^="http"]{opacity:.55;cursor:not-allowed}
  body.is-offline .aff-note::after{content:" · needs internet";color:var(--rust)}
  .net-toast{position:fixed;left:50%;bottom:calc(84px + env(safe-area-inset-bottom,0px));transform:translateX(-50%);z-index:200;max-width:min(92vw,440px);background:var(--ink);color:var(--bg);border-radius:14px;padding:12px 16px;font-size:14px;line-height:1.45;box-shadow:var(--shadow)}
  .net-toast strong{color:var(--amber-bright)}
</style>
`;

const BAR_BADGE = `<p class="bar-right"><span class="pwa-badge" id="pwaBadge" role="status" aria-live="polite" hidden></span><span class="updated">`;

const PAGE_SCRIPT = `<script>
/* PWA: register the service worker, show the offline badge, and give
   anything that needs the internet a clear "needs internet" state. */
(function(){
  var badge = document.getElementById('pwaBadge');
  var saved = false;

  function showBadge(state, text){
    if (!badge) return;
    badge.hidden = false;
    badge.setAttribute('data-state', state);
    badge.textContent = text;
  }
  function syncNetwork(){
    var offline = navigator.onLine === false;
    document.body.classList.toggle('is-offline', offline);
    if (offline) showBadge('offline', saved ? "You're offline · guide still works" : "You're offline");
    else if (saved) showBadge('ready', 'Available offline ✓');
    else if (badge && badge.getAttribute('data-state') === 'offline') badge.hidden = true;
  }

  var toast, toastTimer;
  function showToast(host){
    if (!toast){
      toast = document.createElement('div');
      toast.className = 'net-toast';
      toast.setAttribute('role', 'status');
      toast.setAttribute('aria-live', 'polite');
      document.body.appendChild(toast);
    }
    toast.innerHTML = '';
    var s = document.createElement('strong'); s.textContent = 'Needs internet. ';
    toast.appendChild(s);
    toast.appendChild(document.createTextNode(host + ' is a website, so it needs a connection. Everything else in this guide works offline. Use "Copy the list" now and open the store when you are back online.'));
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function(){ toast.hidden = true; }, 6000);
  }

  // Off-site links: stop the dead click and explain instead.
  document.addEventListener('click', function(e){
    if (navigator.onLine !== false) return;
    var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!a) return;
    var u;
    try { u = new URL(a.getAttribute('href'), location.href); } catch(err){ return; }
    if (!/^https?:$/.test(u.protocol) || u.origin === location.origin) return;
    e.preventDefault();
    e.stopPropagation();
    showToast(u.hostname.replace(/^www\\./, ''));
  }, true);

  window.addEventListener('online', syncNetwork);
  window.addEventListener('offline', syncNetwork);
  syncNetwork();

  var secure = location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  if (!('serviceWorker' in navigator) || !secure) return;

  function checkSaved(){
    navigator.serviceWorker.ready.then(function(reg){
      if (!reg.active) return;
      var ch = new MessageChannel();
      ch.port1.onmessage = function(ev){
        if (ev.data && ev.data.ready){ saved = true; syncNetwork(); }
      };
      reg.active.postMessage({ type: 'STATUS' }, [ch.port2]);
    });
  }

  function showUpdate(){
    if (document.getElementById('pwaUpdate') || !badge) return;
    var b = document.createElement('button');
    b.type = 'button';
    b.id = 'pwaUpdate';
    b.className = 'pwa-update';
    b.textContent = 'New version ready · Reload';
    b.addEventListener('click', function(){ location.reload(); });
    badge.parentNode.insertBefore(b, badge);
  }

  navigator.serviceWorker.addEventListener('message', function(e){
    var d = e.data || {};
    if (d.type === 'OFFLINE_READY') checkSaved();
    if (d.type === 'UPDATED') showUpdate();
  });

  window.addEventListener('load', function(){
    navigator.serviceWorker.register('/sw.js').then(function(reg){
      if (reg.installing && !navigator.serviceWorker.controller) showBadge('saving', 'Saving for offline…');
    }).catch(function(){ /* no badge if registration fails */ });
    checkSaved();
  });
})();
</script>
`;

const INFO_SCRIPT = `<script>
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
  window.addEventListener('load', function(){ navigator.serviceWorker.register('/sw.js').catch(function(){}); });
}
</script>
`;

function patch(file, steps) {
  const p = path.join(root, file);
  let s = fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
  for (const [label, marker, find, replace] of steps) {
    if (s.includes(marker)) { console.log(file, label, 'already present'); continue; }
    const n = s.split(find).length - 1;
    if (n !== 1) throw new Error(file + ' ' + label + ': expected 1 match for anchor, got ' + n);
    s = s.replace(find, () => replace);
    console.log(file, label, 'added');
  }
  fs.writeFileSync(p, s);
}

patch('index.html', [
  ['favicon', 'href="/icons/icon.svg"', '<link rel="icon" href="data:," />\n', ''],
  ['head tags', 'rel="manifest"', '</head>', HEAD_TAGS + CSS + '</head>'],
  ['badge', 'id="pwaBadge"', '<p class="updated">', BAR_BADGE],
  ['badge close', 'November 21, 2026</time></span></p>', 'November 21, 2026</time></p>\n  </div>\n</div>', 'November 21, 2026</time></span></p>\n  </div>\n</div>'],
  ['script', "register('/sw.js').then", '</body>', PAGE_SCRIPT + '</body>']
]);

for (const f of ['about.html', 'contact.html', 'privacy.html', 'affiliate-disclosure.html']) {
  patch(f, [
    ['favicon', 'href="/icons/icon.svg"', '<link rel="icon" href="data:," />\n', ''],
    ['head tags', 'rel="manifest"', '</head>', HEAD_TAGS + '</head>'],
    ['script', "register('/sw.js')", '</body>', INFO_SCRIPT + '</body>']
  ]);
}
