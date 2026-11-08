// Sean's Nav — 前端：从 Go API (/api/bookmarks) 拉分类和链接并渲染。
// 布局与行为仿 XiaoWork Nav（2026-11-08 从 nav.xiaoworks.com 实测）：
// 左侧分类栏（PC）/ 顶部横条（手机）、时钟、搜索、滚动模式 / 标签模式、
// 三个主题：锦鲤池塘（默认，像素大锦鲤）、极简（干净白底）、墨金（深墨底 + 暖金），
// 米色方块 + 下方名字。主题选择器在顶栏，存在 localStorage 的 xn-theme。
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
// 三个主题：pond（锦鲤池塘，默认）、light（极简）、inkgold（墨金）。
// 旧值 dark 映射到墨金；未知值落到 pond。锦鲤只在池塘主题下运行。
var THEME_KEY = 'xn-theme';
var THEME_COLORS = { pond: '#1a1917', light: '#f5f5f7', inkgold: '#0f0e0c' };
var THEME_LABELS = { pond: '🐟 锦鲤池塘', light: '🤍 极简', inkgold: '🌑 墨金' };
function normalizeTheme(t) {
  if (t === 'dark') t = 'inkgold';
  if (t !== 'light' && t !== 'inkgold' && t !== 'pond') t = 'pond';
  return t;
}
function applyTheme(t) {
  t = normalizeTheme(t);
  document.documentElement.dataset.theme = t;
  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', THEME_COLORS[t]);
  var sel = $('theme-picker');
  if (sel) sel.value = t;
  try { localStorage.setItem(THEME_KEY, t); } catch (e) {}
  updateThemeLabels();
  pondEnabled = (t === 'pond');
}
function updateThemeLabels() {
  var sel = $('theme-picker');
  if (!sel) return;
  var small = window.matchMedia('(max-width: 700px)').matches;
  for (var i = 0; i < sel.options.length; i++) {
    var v = sel.options[i].value;
    sel.options[i].textContent = small ? THEME_LABELS[v].replace(/^[^\s]+\s/, '') : THEME_LABELS[v];
  }
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

// ---------- 锦鲤池塘：像素大锦鲤 ----------
// 原站（nav.xiaoworks.com）实测：AsciiPondBackground，配置是
//   species: [{ type: 'koi', count: 宽屏 4 / 手机 3, young: 0 }], theme: 'dark'（原站配置，仅作参考）
//   palette: page [26,25,23], bg [26,25,33]
// 鱼本身（ascii-pond 的 koi.js）：20 节脊柱，体长 baseLength = clamp(min(宽,高)*0.5, 170, 420)px，
//   成年鱼取 0.6–1.0 倍，即手机约 120–195px、桌面约 250–420px —— 是大鱼，不是小图标；
//   由 8–12px 的字块（glyph tile）拼成，颜色：白 [236,228,218]、红 [232,96,56]、黑 [92,90,108]、
//   鳍 [214,206,198]、眼 [20,20,26]；品种 kohaku（白+红）、sanke（白+红+黑）、tancho（头顶一点红）；
//   游动是 cruise / glide / explore / rest 等心情轮换，尾巴摆动，鱼会避开标题/搜索/方块等内容区，
//   在内容下方变淡、只在空隙里清楚可见。
// 下面是自己写的同效果实现，不抄 vendor 代码：每条鱼先画在一张 36×16 的低分辨率像素画布上，
// 再以 imageSmoothingEnabled=false 放大绘制，块状像素感是刻意保留的；身体按脊柱分段错位摆动，
// 尾巴扇形摇摆；鱼在内容区下方自动变淡。只在池塘主题下运行，尊重 prefers-reduced-motion。
var pondEnabled = false, pondRunning = false;
(function pond() {
  var cv = $('pond-canvas'), ctx = cv.getContext('2d');
  var W = 0, H = 0, dpr = 1, raf = null, lastT = 0;
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  // 像素鱼：36 格长 × 16 格高，每格 1 个像素单元
  var PW = 36, PH = 16, MID = 8;
  var KOI = {
    white: '#ece4da', red: '#e86038', black: '#5c5a6c',
    fin: '#d6cec6', eye: '#14141a'
  };
  var VARIETIES = ['kohaku', 'kohaku', 'kohaku', 'sanke', 'sanke', 'tancho'];
  var zones = [], zonesAt = 0;

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    cv.style.width = W + 'px'; cv.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    collectZones();
  }
  window.addEventListener('resize', resize);
  window.addEventListener('scroll', function () { collectZones(); }, { passive: true });
  resize();

  // 内容区矩形：鱼游到这些区域下方时变淡（原站的 avoid 列表同款思路）
  function collectZones() {
    var now = Date.now();
    if (now - zonesAt < 250) return;
    zonesAt = now;
    zones = [];
    var sels = '.shell__topbar, .rail, .clock, .search, .category__head, .tiles, .tabs, .modal-wrap.open';
    document.querySelectorAll(sels).forEach(function (el) {
      var r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) zones.push(r);
    });
  }
  function dimAt(x, y) {
    for (var i = 0; i < zones.length; i++) {
      var r = zones[i];
      if (x >= r.left - 8 && x <= r.right + 8 && y >= r.top - 8 && y <= r.bottom + 8) return true;
    }
    return false;
  }

  // 确定性伪随机（同一条鱼的花纹每次打开都一样，不闪烁）
  function hash(n, s) {
    var v = Math.sin(n * 127.1 + s * 311.7) * 43758.5453;
    return v - Math.floor(v);
  }
  // 身体半宽（占体长的比例）：钝圆头、丰满肩部、收窄尾柄 —— 与原站 halfWidth 同款轮廓
  function halfWidth(s) {
    if (s < 0.12) return 0.11 * Math.pow(Math.sin((s / 0.12) * Math.PI / 2), 0.55);
    if (s < 0.30) return 0.11 + 0.025 * ((s - 0.12) / 0.18);
    var t = (s - 0.30) / 0.44;
    if (t > 1) t = 1;
    return 0.033 + 0.102 * (1 - t * t * (3 - 2 * t));
  }
  // 尾巴半宽：从尾柄扇开，末端带 V 形缺口
  function tailHalfWidth(s) {
    var t = (s - 0.70) / 0.30;
    if (t < 0) t = 0;
    return 0.03 + 0.15 * Math.pow(t, 0.8);
  }

  // 每条鱼的花纹：红斑 2–3 块（sanke 再加 1–2 块黑斑，tancho 只有头顶一点红）
  function makeMarkings(f) {
    var marks = [];
    if (f.variety === 'tancho') {
      marks.push({ s: 0.06, a: 0, rs: 0.05, ra: 0.45, c: 'red' });
      return marks;
    }
    var n = 2 + Math.floor(hash(f.id, 1) * 2);
    for (var i = 0; i < n; i++) {
      marks.push({
        s: 0.18 + hash(f.id, 10 + i) * 0.45,
        a: (hash(f.id, 20 + i) - 0.5) * 1.1,
        rs: 0.06 + hash(f.id, 30 + i) * 0.07,
        ra: 0.35 + hash(f.id, 40 + i) * 0.35,
        c: 'red'
      });
    }
    if (f.variety === 'sanke') {
      marks.push({ s: 0.45 + hash(f.id, 50) * 0.2, a: (hash(f.id, 51) - 0.5) * 1.2, rs: 0.05, ra: 0.3, c: 'black' });
      marks.push({ s: 0.15 + hash(f.id, 52) * 0.15, a: (hash(f.id, 53) - 0.5) * 1.0, rs: 0.04, ra: 0.3, c: 'black' });
    }
    return marks;
  }

  // 把一条鱼画到低分辨率像素画布上（每格 1px，返回 canvas）
  function paintSprite(f, tailSwing) {
    var c = document.createElement('canvas');
    c.width = PW; c.height = PH;
    var g = c.getContext('2d');
    var marks = f.markings;
    for (var x = 0; x < PW; x++) {
      var s = x / (PW - 1);
      var isTail = s >= 0.70;
      var hw = (isTail ? tailHalfWidth(s) : halfWidth(s)) * PW;
      // 尾巴摆动：越靠尾端偏移越大
      var wag = isTail ? Math.sin(tailSwing + (s - 0.7) * 6) * (s - 0.7) * 3.2 : Math.sin(tailSwing * 0.5 + s * 2) * 0.35;
      for (var y = 0; y < PH; y++) {
        var dy = y - MID - wag;
        var ady = Math.abs(dy);
        if (ady > hw) continue;
        // V 形缺口：尾巴末端中间镂空
        if (isTail && s > 0.92 && ady < (s - 0.92) * 22) continue;
        var across = hw > 0 ? dy / hw : 0;
        var col = 'white';
        // 腹缘和尾柄永远留白，衬托花纹
        if (!(Math.abs(across) > 0.9 || s > 0.74)) {
          for (var m = 0; m < marks.length; m++) {
            var mk = marks[m];
            var ds = (s - mk.s) / mk.rs, da = (across - mk.a) / mk.ra;
            // 粗糙边缘：花纹像手绘的一样不规则
            var wob = (hash(x * 3 + y * 7, f.id) - 0.5) * 0.7;
            if (ds * ds + da * da + wob * 0.4 < 1) { col = mk.c; break; }
          }
        }
        g.fillStyle = KOI[col];
        g.fillRect(x, y, 1, 1);
      }
    }
    // 胸鳍：身体两侧各一片，鳍色，随摆动轻微扇动
    var flap = Math.round(Math.sin(tailSwing * 1.4) * 1);
    g.fillStyle = KOI.fin;
    g.fillRect(11, MID + 4 + flap, 3, 1);
    g.fillRect(12, MID + 5 + flap, 2, 1);
    g.fillRect(11, MID - 5 - flap, 3, 1);
    g.fillRect(12, MID - 6 - flap, 2, 1);
    // 眼睛：头两侧各一颗深色像素
    g.fillStyle = KOI.eye;
    g.fillRect(3, MID - 3, 1, 1);
    g.fillRect(3, MID + 2, 1, 1);
    return c;
  }

  function baseLength() {
    return Math.max(170, Math.min(420, Math.min(W, H) * 0.5));
  }
  function makeFish(id, offscreen) {
    var L = baseLength() * (0.65 + Math.random() * 0.35);
    var f = {
      id: id,
      variety: VARIETIES[Math.floor(Math.random() * VARIETIES.length)],
      length: L,
      x: Math.random() * W * 0.8 + W * 0.1,
      y: Math.random() * H * 0.8 + H * 0.1,
      heading: Math.random() * Math.PI * 2,
      speed: 16 + Math.random() * 10,
      mood: 'cruise', moodUntil: 4 + Math.random() * 8,
      phase: Math.random() * Math.PI * 2,
      alpha: 0.9, targetAlpha: 0.9,
      sprite: null, spriteSwing: -1,
      trail: []
    };
    f.markings = makeMarkings(f);
    if (offscreen) {
      var edge = Math.floor(Math.random() * 4);
      if (edge === 0) { f.x = -L; f.y = H * (0.2 + Math.random() * 0.6); f.heading = 0; }
      else if (edge === 1) { f.x = W + L; f.y = H * (0.2 + Math.random() * 0.6); f.heading = Math.PI; }
      else if (edge === 2) { f.x = W * (0.2 + Math.random() * 0.6); f.y = -L; f.heading = Math.PI / 2; }
      else { f.x = W * (0.2 + Math.random() * 0.6); f.y = H + L; f.heading = -Math.PI / 2; }
    }
    return f;
  }

  var fish = [];
  function wantCount() { return W < 700 ? 3 : 4; }
  function seed() {
    fish = [];
    var n = wantCount();
    for (var i = 0; i < n; i++) fish.push(makeFish(i + 1, false));
  }
  seed();
  window.addEventListener('resize', function () {
    var n = wantCount();
    while (fish.length < n) fish.push(makeFish(fish.length + 1, true));
    while (fish.length > n) fish.pop();
  });

  function pickMood(f, now) {
    var r = Math.random();
    if (r < 0.45) { f.mood = 'cruise'; f.moodUntil = now + 6 + Math.random() * 12; }
    else if (r < 0.7) { f.mood = 'glide'; f.moodUntil = now + 5 + Math.random() * 9; }
    else if (r < 0.85) { f.mood = 'explore'; f.moodUntil = now + 8 + Math.random() * 12; }
    else { f.mood = 'rest'; f.moodUntil = now + 4 + Math.random() * 8; }
  }
  function moodSpeed(f) {
    return f.mood === 'rest' ? 0.15 : f.mood === 'glide' ? 0.55 : f.mood === 'explore' ? 1.25 : 1;
  }

  function step(f, dt, now) {
    if (now > f.moodUntil) pickMood(f, now);
    // 靠近边缘时温柔地转向池中央，不穿墙、不瞬移
    var margin = 140;
    var nearEdge = f.x < margin || f.x > W - margin || f.y < margin || f.y > H - margin;
    var targetHeading = f.heading + (Math.random() - 0.5) * 0.35 * dt;
    if (nearEdge) {
      var toCentre = Math.atan2(H / 2 - f.y, W / 2 - f.x);
      var dc = toCentre - f.heading;
      while (dc > Math.PI) dc -= Math.PI * 2;
      while (dc < -Math.PI) dc += Math.PI * 2;
      targetHeading = f.heading + dc * Math.min(1, dt * 1.5);
    }
    // 转向限速：大鱼不能原地掉头
    var diff = targetHeading - f.heading;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    f.heading += Math.max(-0.5 * dt, Math.min(0.5 * dt, diff));
    var v = f.speed * moodSpeed(f);
    f.x += Math.cos(f.heading) * v * dt;
    f.y += Math.sin(f.heading) * v * dt * 0.8;
    // 游出边界就从对侧缓缓游回
    if (f.x < -f.length) f.x = W + f.length * 0.5;
    if (f.x > W + f.length) f.x = -f.length * 0.5;
    if (f.y < -f.length) f.y = H + f.length * 0.5;
    if (f.y > H + f.length) f.y = -f.length * 0.5;
    // 透明度：内容区下方变淡，空隙里清楚（原站的 dim-under-content）
    collectZones();
    var under = dimAt(f.x, f.y) || dimAt(f.x + Math.cos(f.heading) * f.length * 0.4, f.y + Math.sin(f.heading) * f.length * 0.4);
    f.targetAlpha = under ? 0.30 : 0.92;
    f.alpha += (f.targetAlpha - f.alpha) * Math.min(1, dt * 2);
    // 尾迹：记录尾尖位置，画几颗淡出的像素水花
    var tx = f.x - Math.cos(f.heading) * f.length * 0.5;
    var ty = f.y - Math.sin(f.heading) * f.length * 0.5;
    f.trail.push({ x: tx, y: ty, a: 0.14 });
    if (f.trail.length > 10) f.trail.shift();
    f.trail.forEach(function (p) { p.a *= 0.94; });
  }

  function drawFish(f, now) {
    var swing = now / 1000 * (2.2 + f.speed * 0.06) + f.phase;
    // 尾巴摆动大时才重画像素精灵，平时复用，省性能
    if (!f.sprite || Math.abs(swing - f.spriteSwing) > 0.35) {
      f.sprite = paintSprite(f, swing);
      f.spriteSwing = swing;
    }
    var px = f.length / PW; // 每像素格的屏幕尺寸：大鱼 = 大像素块
    var spriteH = PH * px;
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, f.alpha));
    ctx.imageSmoothingEnabled = false;
    // 尾迹
    f.trail.forEach(function (p) {
      if (p.a <= 0.01) return;
      ctx.globalAlpha = p.a * f.alpha;
      ctx.fillStyle = '#f3e2c7';
      ctx.fillRect(p.x - 1, p.y - 1, 2, 2);
    });
    ctx.globalAlpha = Math.max(0, Math.min(1, f.alpha));
    ctx.translate(f.x, f.y);
    ctx.rotate(f.heading);
    // 身体按脊柱分 8 段错位绘制：每段上下错开一点，整条鱼像在摆动一样游
    var slices = 8, sw = PW / slices;
    for (var i = 0; i < slices; i++) {
      var t = i / (slices - 1);
      var off = Math.sin(swing + t * 2.4) * t * t * px * 2.2;
      ctx.drawImage(f.sprite, i * sw, 0, sw, PH, -f.length / 2 + i * sw * px, -spriteH / 2 + off, sw * px, spriteH);
    }
    ctx.restore();
  }

  function drawFrame(now) {
    ctx.clearRect(0, 0, W, H);
    var dt = Math.min(0.05, (now - lastT) / 1000 || 0.016);
    lastT = now;
    fish.forEach(function (f) { step(f, dt, now / 1000); });
    // 深的鱼先画（后画的在上层）
    fish.forEach(function (f) { drawFish(f, now); });
  }

  function loop(now) {
    if (!pondEnabled) { pondRunning = false; return; }
    pondRunning = true;
    drawFrame(now);
    raf = requestAnimationFrame(loop);
  }

  // 减速动效：只画一帧静态鱼，不循环
  function drawStatic() {
    ctx.clearRect(0, 0, W, H);
    var now = 1000;
    fish.forEach(function (f) { drawFish(f, now); });
  }

  setInterval(function () {
    if (!pondEnabled) {
      if (raf) { cancelAnimationFrame(raf); raf = null; }
      if (pondRunning) { pondRunning = false; ctx.clearRect(0, 0, W, H); }
      return;
    }
    if (reduced.matches) { drawStatic(); return; }
    if (!pondRunning) { lastT = performance.now(); raf = requestAnimationFrame(loop); }
  }, 400);
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
document.addEventListener('keydown', function (e) {
  if (e.key === 'Escape' && $('modal').classList.contains('open')) closeModal();
});
$('modal-body').addEventListener('keydown', function (e) {
  if (e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); $('modal-ok').click(); }
});
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
  try { var s = localStorage.getItem(THEME_KEY); if (s) t = s; } catch (e) {}
  applyTheme(t);
})();
setLayout(layout);
load().catch(function (e) {
  $('sections').innerHTML = '<p class="empty">无法加载导航数据：' + esc(e.message) + '，刷新页面再试。</p>';
});
