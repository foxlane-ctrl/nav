// 我的导航 — 前端：从 Go API (/api/bookmarks) 拉分类和链接并渲染。
// 布局与行为仿 XiaoWork Nav（2026-11-08 从 nav.xiaoworks.com 实测）：
// 左侧分类栏（PC）/ 顶部横条（手机）、时钟、搜索、滚动模式 / 标签模式、
// 三种主题（深色 / 浅色 / 锦鲤池塘，默认池塘）、米色方块 + 下方名字。
// 图标数据见 iconmap.js（从原站公开 API 提取，含原站排序）。
// 未登录只能看；登录管理员后可加/改/删链接和分类。

var state = { categories: [], bookmarks: [], loggedIn: false };
var activeId = null;
var layout = 'scroll';
var query = '';

// 分类图标（原站 API 里的 icon 字段）
var CAT_ICONS = {
  'Daily': '📁', 'SpeedTest': '📁', '常用': '✨', 'IP&DNS': '🌐',
  'AI & 智能': '🤖', 'VPS/云服务器': '🐔', '邮箱': '📧',
  '域名': '🔗', '其他导航': '📁'
};
var ENGINES = [
  { name: 'Google', url: 'https://www.google.com/search?q={query}' },
  { name: 'Bing', url: 'https://www.bing.com/search?q={query}' },
  { name: '百度', url: 'https://www.baidu.com/s?wd={query}' }
];

function $(id) { return document.getElementById(id); }
function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function catIcon(name) { return CAT_ICONS[name] || '📁'; }

// ---------- 主题 ----------
var THEME_KEY = 'xn-theme';
function applyTheme(t) {
  if (t !== 'light' && t !== 'dark' && t !== 'pond') t = 'pond';
  document.documentElement.dataset.theme = t;
  var sel = $('theme-picker');
  if (sel) sel.value = t;
  try { localStorage.setItem(THEME_KEY, t); } catch (e) {}
  updateThemeLabels();
  pondEnabled = (t === 'pond');
}
function updateThemeLabels() {
  var small = window.matchMedia('(max-width: 700px)').matches;
  var sel = $('theme-picker');
  if (!sel) return;
  var opts = sel.options;
  opts[0].textContent = small ? '深色' : '🌙 深色';
  opts[1].textContent = small ? '浅色' : '☀️ 浅色';
  opts[2].textContent = small ? '池塘' : '🐟 锦鲤池塘';
}
window.matchMedia('(max-width: 700px)').addEventListener('change', updateThemeLabels);
$('theme-picker').addEventListener('change', function (e) { applyTheme(e.target.value); });

// ---------- 布局（滚动 / 标签） ----------
try { layout = localStorage.getItem('xn-layout') === 'tabs' ? 'tabs' : 'scroll'; } catch (e) {}
function setLayout(l) {
  layout = l;
  try { localStorage.setItem('xn-layout', l); } catch (e) {}
  $('layout-scroll').classList.toggle('is-active', l === 'scroll');
  $('layout-tabs').classList.toggle('is-active', l === 'tabs');
  $('layout-scroll').setAttribute('aria-pressed', l === 'scroll' ? 'true' : 'false');
  $('layout-tabs').setAttribute('aria-pressed', l === 'tabs' ? 'true' : 'false');
  renderSections();
}
$('layout-scroll').onclick = function () { setLayout('scroll'); };
$('layout-tabs').onclick = function () { setLayout('tabs'); };

// ---------- 左侧栏折叠 ----------
$('rail-toggle').onclick = function () {
  var shell = document.querySelector('.shell');
  var collapsed = shell.classList.toggle('is-collapsed');
  this.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
  this.title = collapsed ? '展开分类栏' : '折叠分类栏';
  try { localStorage.setItem('xn-sidebar-collapsed', collapsed ? '1' : '0'); } catch (e) {}
};
try {
  if (localStorage.getItem('xn-sidebar-collapsed') === '1') $('rail-toggle').click();
} catch (e) {}

// ---------- 时钟 ----------
function tick() {
  var d = new Date();
  $('clock-time').textContent = d.toLocaleTimeString('zh-CN', { hour12: false });
  $('clock-date').textContent = d.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });
}
tick(); setInterval(tick, 1000);

// ---------- 锦鲤池塘画布（原站是 ascii-pond 动画，这里是同效果的轻量近似） ----------
var pondEnabled = false, pondRunning = false;
(function pond() {
  var cv = $('pond-canvas'), ctx = cv.getContext('2d');
  var fish = [], W = 0, H = 0, raf = null;
  var COLORS = ['#e6a878', '#f3e2c7', '#d98758', '#e8b34b', '#f6ead6'];
  function resize() {
    W = cv.width = window.innerWidth; H = cv.height = window.innerHeight;
  }
  window.addEventListener('resize', resize);
  resize();
  function makeFish() {
    return {
      x: Math.random() * W, y: Math.random() * H,
      a: Math.random() * Math.PI * 2, s: 0.25 + Math.random() * 0.35,
      len: 26 + Math.random() * 26, wob: Math.random() * Math.PI * 2,
      c: COLORS[Math.floor(Math.random() * COLORS.length)]
    };
  }
  for (var i = 0; i < (window.innerWidth < 700 ? 3 : 5); i++) fish.push(makeFish());
  function draw() {
    if (!pondEnabled || window.matchMedia('(prefers-reduced-motion: reduce)').matches) { pondRunning = false; return; }
    pondRunning = true;
    ctx.clearRect(0, 0, W, H);
    fish.forEach(function (f) {
      f.a += (Math.random() - 0.5) * 0.02;
      f.wob += 0.08;
      f.x += Math.cos(f.a) * f.s; f.y += Math.sin(f.a) * f.s * 0.7;
      if (f.x < -60) f.x = W + 60; if (f.x > W + 60) f.x = -60;
      if (f.y < -60) f.y = H + 60; if (f.y > H + 60) f.y = -60;
      ctx.save();
      ctx.translate(f.x, f.y); ctx.rotate(f.a);
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = f.c;
      ctx.beginPath(); ctx.ellipse(0, 0, f.len / 2, f.len / 5, 0, 0, Math.PI * 2); ctx.fill();
      // 尾巴
      var tw = Math.sin(f.wob) * 6;
      ctx.beginPath(); ctx.moveTo(-f.len / 2, 0);
      ctx.lineTo(-f.len / 2 - 14, -8 + tw); ctx.lineTo(-f.len / 2 - 14, 8 + tw);
      ctx.closePath(); ctx.fill();
      ctx.restore();
    });
    raf = requestAnimationFrame(draw);
  }
  setInterval(function () {
    if (pondEnabled && !pondRunning) draw();
    if (!pondEnabled && raf) { cancelAnimationFrame(raf); raf = null; pondRunning = false; ctx.clearRect(0, 0, W, H); }
  }, 500);
})();

// ---------- API ----------
async function api(path, method, body) {
  var res = await fetch(path, {
    method: method || 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined
  });
  var data = await res.json().catch(function () { return {}; });
  if (!res.ok) throw new Error(data.error || ('请求失败：' + res.status));
  return data;
}

async function load() {
  var me = await api('/api/me');
  state.loggedIn = !!me.loggedIn;
  var data = await api('/api/bookmarks');
  state.categories = (data.categories || []).slice().sort(function (a, b) { return a.order - b.order; });
  state.bookmarks = data.bookmarks || [];
  if (!activeId && state.categories.length) activeId = state.categories[0].id;
  render();
}

// ---------- 排序与图标 ----------
function iconInfo(b) {
  var m = (typeof ICON_MAP !== 'undefined' && ICON_MAP[b.url]) || null;
  return m;
}
function sortedBookmarks(catId) {
  var list = state.bookmarks.filter(function (b) { return b.categoryId === catId; });
  list.sort(function (a, b) {
    var oa = iconInfo(a), ob = iconInfo(b);
    var ra = oa ? oa.o : 100000, rb = ob ? ob.o : 100000;
    return ra - rb;
  });
  return list;
}
function faviconOf(url) {
  try {
    var u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    return u.origin + '/favicon.ico';
  } catch (e) { return ''; }
}

// ---------- 渲染 ----------
function render() {
  renderAdminBar();
  renderRail();
  renderChipbar();
  renderTabs();
  renderSections();
}

function renderAdminBar() {
  var bar = $('adminbar');
  bar.innerHTML = '';
  if (state.loggedIn) {
    bar.appendChild(mkBtn('＋ 加链接', 'btn btn--sm', openAddBookmark));
    bar.appendChild(mkBtn('＋ 加分类', 'btn btn--sm', openAddCategory));
    bar.appendChild(mkBtn('退出', 'btn btn--sm', async function () {
      await api('/api/logout', 'POST'); await load();
    }));
  } else {
    bar.appendChild(mkBtn('登录', 'btn btn--sm', openLogin));
  }
}

function mkBtn(text, cls, fn) {
  var b = document.createElement('button');
  b.type = 'button'; b.textContent = text;
  if (cls) b.className = cls;
  b.onclick = fn;
  return b;
}

function renderRail() {
  var nav = $('rail-list');
  nav.innerHTML = '';
  state.categories.forEach(function (c) {
    var n = state.bookmarks.filter(function (b) { return b.categoryId === c.id; }).length;
    var item = document.createElement('button');
    item.type = 'button';
    item.className = 'rail__item' + (c.id === activeId ? ' is-active' : '');
    item.dataset.id = c.id;
    item.title = c.name;
    if (c.id === activeId) item.setAttribute('aria-current', 'true');
    item.innerHTML = '<span class="rail__icon">' + catIcon(c.name) + '</span>' +
      '<span class="rail__label">' + esc(c.name) + '</span>' +
      '<span class="rail__count">' + n + '</span>';
    item.onclick = function () { scrollToCategory(c.id); };
    nav.appendChild(item);
  });
}

function renderChipbar() {
  var nav = $('chipbar');
  nav.innerHTML = '';
  state.categories.forEach(function (c) {
    var pill = document.createElement('button');
    pill.type = 'button';
    pill.className = 'chipbar__item' + (c.id === activeId ? ' is-active' : '');
    pill.dataset.id = c.id;
    pill.innerHTML = '<span>' + catIcon(c.name) + '</span> ' + esc(c.name);
    pill.onclick = function () { scrollToCategory(c.id); };
    nav.appendChild(pill);
  });
}

function renderTabs() {
  var tabs = $('tabs');
  tabs.innerHTML = '';
  tabs.hidden = layout !== 'tabs';
  state.categories.forEach(function (c) {
    var t = document.createElement('button');
    t.type = 'button';
    t.className = 'tabs__item' + (c.id === activeId ? ' is-active' : '');
    t.innerHTML = '<span>' + catIcon(c.name) + '</span> ' + esc(c.name);
    t.onclick = function () { activeId = c.id; renderSections(); renderTabs(); renderRail(); renderChipbar(); };
    tabs.appendChild(t);
  });
}

function setActive(id) {
  activeId = id;
  document.querySelectorAll('.rail__item').forEach(function (el) {
    el.classList.toggle('is-active', el.dataset.id === id);
    if (el.dataset.id === id) el.setAttribute('aria-current', 'true'); else el.removeAttribute('aria-current');
  });
  document.querySelectorAll('.chipbar__item').forEach(function (el) {
    el.classList.toggle('is-active', el.dataset.id === id);
  });
  document.querySelectorAll('.tabs__item').forEach(function (el, i) {
    el.classList.toggle('is-active', state.categories[i] && state.categories[i].id === id);
  });
}

function scrollToCategory(id) {
  var sec = document.getElementById('category-' + id);
  if (!sec) return;
  setActive(id);
  if (layout === 'tabs') { renderSections(); return; }
  var top = Math.max(0, sec.getBoundingClientRect().top + window.scrollY - 24);
  window.scrollTo({ top: top, behavior: 'smooth' });
}

// 滚动时按当前分组高亮（原站：偏移 120，到底时取最后一组）
window.addEventListener('scroll', function () {
  if (layout === 'tabs' || query) return;
  var secs = Array.prototype.slice.call(document.querySelectorAll('.category[data-category-id]'));
  if (!secs.length) return;
  var tops = secs.map(function (el) { return el.getBoundingClientRect().top; });
  var atBottom = window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 4;
  var idx = -1;
  for (var i = 0; i < tops.length && tops[i] <= 120; i++) idx = i;
  if (atBottom) idx = secs.length - 1;
  if (idx >= 0) setActive(secs[idx].dataset.categoryId);
}, { passive: true });
window.addEventListener('resize', function () { updateThemeLabels(); });

function renderSections() {
  var wrap = $('sections');
  var results = $('search-results');
  wrap.innerHTML = '';
  results.innerHTML = '';
  results.hidden = true;
  if (query) {
    var hits = state.bookmarks.filter(function (b) {
      var q = query.toLowerCase();
      return b.name.toLowerCase().indexOf(q) >= 0 || b.url.toLowerCase().indexOf(q) >= 0;
    });
    var sec = document.createElement('section');
    sec.className = 'category';
    sec.innerHTML = '<div class="category__head"><h2 class="category__title">搜索结果</h2>' +
      '<span class="badge">' + hits.length + '</span></div>';
    if (hits.length) {
      var grid = document.createElement('div');
      grid.className = 'tiles';
      hits.forEach(function (b) { grid.appendChild(tile(b)); });
      sec.appendChild(grid);
    } else {
      sec.insertAdjacentHTML('beforeend', '<p class="empty">没有匹配的站点</p>');
    }
    results.appendChild(sec);
    results.hidden = false;
    return;
  }
  var cats = layout === 'tabs'
    ? state.categories.filter(function (c) { return c.id === activeId; })
    : state.categories;
  var page = $('page');
  page.classList.toggle('page--tabs', layout === 'tabs');
  cats.forEach(function (c) {
    wrap.appendChild(categorySection(c));
  });
  if (!cats.length && !state.categories.length) {
    wrap.innerHTML = '<p class="empty">还没有任何公开分类</p>';
  }
}

function categorySection(c) {
  var list = sortedBookmarks(c.id);
  var sec = document.createElement('section');
  sec.id = 'category-' + c.id;
  sec.className = 'category';
  sec.dataset.categoryId = c.id;
  var head = document.createElement('div');
  head.className = 'category__head';
  head.innerHTML = '<span class="category__icon">' + catIcon(c.name) + '</span>' +
    '<h2 class="category__title">' + esc(c.name) + '</h2>' +
    '<span class="badge">' + list.length + '</span>';
  if (state.loggedIn) {
    var del = document.createElement('button');
    del.type = 'button';
    del.className = 'sec-del';
    del.textContent = '✕';
    del.title = '删除分类（需先清空链接）';
    del.onclick = async function () {
      if (!confirm('删除分类「' + c.name + '」？分类里不能有链接。')) return;
      try { await api('/api/categories/' + c.id, 'DELETE'); await load(); }
      catch (err) { alert(err.message); }
    };
    head.appendChild(del);
  }
  sec.appendChild(head);
  if (!list.length) {
    var p = document.createElement('p');
    p.className = 'empty';
    p.textContent = '该分类暂无站点';
    sec.appendChild(p);
  } else {
    var grid = document.createElement('div');
    grid.className = 'tiles';
    list.forEach(function (b) { grid.appendChild(tile(b)); });
    sec.appendChild(grid);
  }
  return sec;
}

// 方块：图标逻辑与原站 IconImage 一致
// text → 显示前 4 个字；url/upload/auto → 图标地址，失败换源站 favicon，再失败只留首字母；
// simple → cdn.simpleicons.org；none → 首字母。
function tile(b) {
  var a = document.createElement('a');
  a.className = 'tile';
  a.href = b.url;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  a.title = b.name;
  var info = iconInfo(b);
  var iconEl = document.createElement('span');
  iconEl.className = 'tile__icon';
  if (info && info.t === 'text' && info.v) {
    var txt = document.createElement('span');
    txt.className = 'tile__text';
    txt.textContent = info.v.slice(0, 4);
    iconEl.appendChild(txt);
  } else {
    var first = (b.name || '?').trim().charAt(0).toUpperCase();
    var letter = document.createElement('span');
    letter.className = 'tile__letter';
    letter.setAttribute('aria-hidden', 'true');
    letter.textContent = first;
    iconEl.appendChild(letter);
    var candidates = [];
    if (info) {
      if (info.t === 'simple' && info.v) candidates.push('https://cdn.simpleicons.org/' + encodeURIComponent(info.v));
      else if ((info.t === 'url' || info.t === 'upload' || info.t === 'auto') && info.v) candidates.push(info.v);
    }
    if (!info) {
      // 后台新加的链接：用 Google favicon 服务
      try { candidates.push('https://www.google.com/s2/favicons?domain=' + encodeURIComponent(new URL(b.url).hostname) + '&sz=128'); } catch (e) {}
    }
    var fav = faviconOf(b.url);
    if (fav && candidates.indexOf(fav) < 0) candidates.push(fav);
    var idx = 0;
    if (candidates.length) {
      var img = document.createElement('img');
      img.className = 'tile__img';
      img.alt = b.name;
      img.loading = 'lazy';
      img.decoding = 'async';
      img.referrerPolicy = 'no-referrer';
      img.onload = function () {
        if (img.naturalWidth <= 1 || img.naturalHeight <= 1) { next(); return; }
        img.classList.add('is-loaded');
        letter.classList.add('is-covered');
      };
      img.onerror = next;
      function next() {
        idx++;
        if (idx < candidates.length) { img.src = candidates[idx]; }
        else { img.remove(); }
      }
      img.src = candidates[0];
      iconEl.appendChild(img);
    } else {
      var sr = document.createElement('span');
      sr.className = 'sr-only';
      sr.textContent = b.name + '（无可用图标）';
      iconEl.appendChild(sr);
    }
  }
  a.appendChild(iconEl);
  var label = document.createElement('span');
  label.className = 'tile__label';
  label.textContent = b.name;
  a.appendChild(label);
  if (state.loggedIn) {
    var ops = document.createElement('span');
    ops.className = 'ops';
    var edit = document.createElement('button');
    edit.type = 'button'; edit.textContent = '✎'; edit.title = '编辑';
    edit.onclick = function (e) { e.preventDefault(); e.stopPropagation(); openEditBookmark(b); };
    var del = document.createElement('button');
    del.type = 'button'; del.textContent = '✕'; del.title = '删除';
    del.onclick = async function (e) {
      e.preventDefault(); e.stopPropagation();
      if (!confirm('删除链接「' + b.name + '」？')) return;
      try { await api('/api/bookmarks/' + b.id, 'DELETE'); await load(); }
      catch (err) { alert(err.message); }
    };
    ops.appendChild(edit); ops.appendChild(del);
    a.appendChild(ops);
  }
  return a;
}

// ---------- 搜索 ----------
$('search-input').addEventListener('input', function (e) {
  query = e.target.value.trim();
  renderSections();
});
$('search-form').addEventListener('submit', function (e) {
  e.preventDefault();
  var q = $('search-input').value.trim();
  if (!q) return;
  var engine = $('search-engine').value;
  window.open(engine.replace('{query}', encodeURIComponent(q)), '_blank', 'noopener');
});

// ---------- 弹窗（登录 / 加链接 / 改链接 / 加分类） ----------
var modalMode = null, modalId = null;

function openModal(title, bodyHtml, mode, id) {
  modalMode = mode; modalId = id || null;
  $('modal-title').textContent = title;
  $('modal-body').innerHTML = bodyHtml;
  $('modal-err').textContent = '';
  $('modal').classList.add('open');
  var first = $('modal-body').querySelector('input,select');
  if (first) first.focus();
}
function closeModal() { $('modal').classList.remove('open'); }
$('modal-cancel').onclick = closeModal;
$('modal').addEventListener('click', function (e) { if (e.target === $('modal')) closeModal(); });

function openLogin() {
  openModal('管理员登录',
    '<label>用户名</label><input id="f-user" autocomplete="username">' +
    '<label>密码</label><input id="f-pass" type="password" autocomplete="current-password">',
    'login');
}
function catOptions(selected) {
  return state.categories.map(function (c) {
    return '<option value="' + c.id + '"' + (c.id === selected ? ' selected' : '') + '>' + esc(c.name) + '</option>';
  }).join('');
}
function openAddBookmark() {
  openModal('加链接',
    '<label>名字</label><input id="f-name">' +
    '<label>网址</label><input id="f-url" placeholder="https://">' +
    '<label>分类</label><select id="f-cat">' + catOptions(state.categories[0] && state.categories[0].id) + '</select>',
    'add-bookmark');
}
function openEditBookmark(b) {
  openModal('改链接',
    '<label>名字</label><input id="f-name" value="' + esc(b.name) + '">' +
    '<label>网址</label><input id="f-url" value="' + esc(b.url) + '">' +
    '<label>分类</label><select id="f-cat">' + catOptions(b.categoryId) + '</select>',
    'edit-bookmark', b.id);
}
function openAddCategory() {
  openModal('加分类', '<label>分类名</label><input id="f-name">', 'add-category');
}

$('modal-ok').onclick = async function () {
  var err = $('modal-err');
  err.textContent = '';
  try {
    if (modalMode === 'login') {
      await api('/api/login', 'POST', { username: $('f-user').value, password: $('f-pass').value });
    } else if (modalMode === 'add-bookmark') {
      await api('/api/bookmarks', 'POST', { name: $('f-name').value, url: $('f-url').value, categoryId: $('f-cat').value });
    } else if (modalMode === 'edit-bookmark') {
      await api('/api/bookmarks/' + modalId, 'PUT', { name: $('f-name').value, url: $('f-url').value, categoryId: $('f-cat').value });
    } else if (modalMode === 'add-category') {
      await api('/api/categories', 'POST', { name: $('f-name').value });
    }
    closeModal();
    await load();
  } catch (e) { err.textContent = e.message; }
};

// ---------- 启动 ----------
(function initTheme() {
  var t = 'pond';
  try {
    var s = localStorage.getItem(THEME_KEY);
    if (s === 'light' || s === 'dark' || s === 'pond') t = s;
  } catch (e) {}
  applyTheme(t);
})();
setLayout(layout);
load().catch(function (e) {
  $('sections').innerHTML = '<p class="empty">无法加载导航数据：' + esc(e.message) + '，刷新页面再试。</p>';
});
