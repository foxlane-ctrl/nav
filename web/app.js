// 我的导航 — 前端：从 Go API (/api/bookmarks) 拉分类和链接并渲染。
// 未登录只能看；登录管理员后可加/改/删链接和分类。

var state = { categories: [], bookmarks: [], loggedIn: false };
var colors = ['#b7791f', '#0e7490', '#15803d', '#a16207', '#7e22ce', '#be185d', '#0f766e', '#4338ca'];

function $(id) { return document.getElementById(id); }

// ---------- 时钟 ----------
function tick() {
  var d = new Date();
  var p = function (n) { return String(n).padStart(2, '0'); };
  $('clock').textContent = p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  var week = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'][d.getDay()];
  $('date').textContent = d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + week;
}
tick(); setInterval(tick, 1000);

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
  state.categories = data.categories || [];
  state.bookmarks = data.bookmarks || [];
  render();
}

// ---------- 渲染 ----------
function iconColor(name) {
  var h = 0;
  for (var i = 0; i < name.length; i++) { h = (h * 31 + name.charCodeAt(i)) >>> 0; }
  return colors[h % colors.length];
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch (e) { return ''; }
}

function render() {
  // 左侧栏
  var sb = $('sidebar');
  sb.querySelectorAll('.cat').forEach(function (el) { el.remove(); });
  var total = state.bookmarks.length;
  var all = document.createElement('div');
  all.className = 'cat active';
  all.innerHTML = '全部 <span class="count">' + total + '</span>';
  all.onclick = function () { setActive(all); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  sb.appendChild(all);
  state.categories.forEach(function (c) {
    var n = state.bookmarks.filter(function (b) { return b.categoryId === c.id; }).length;
    var el = document.createElement('div');
    el.className = 'cat';
    el.innerHTML = '<span>' + esc(c.name) + '</span> <span class="count">' + n + '</span>';
    el.onclick = function () {
      setActive(el);
      var sec = document.getElementById('sec-' + c.id);
      if (sec) sec.scrollIntoView({ behavior: 'smooth' });
    };
    if (state.loggedIn) {
      var del = document.createElement('button');
      del.className = 'del-cat';
      del.textContent = '✕';
      del.title = '删除分类（需先清空链接）';
      del.onclick = async function (e) {
        e.stopPropagation();
        if (!confirm('删除分类「' + c.name + '」？分类里不能有链接。')) return;
        try { await api('/api/categories/' + c.id, 'DELETE'); await load(); }
        catch (err) { alert(err.message); }
      };
      el.appendChild(del);
    }
    sb.appendChild(el);
  });

  // 管理员工具栏
  var bar = $('adminbar');
  bar.innerHTML = '';
  if (state.loggedIn) {
    bar.appendChild(mkBtn('＋ 加链接', openAddBookmark));
    bar.appendChild(mkBtn('＋ 加分类', openAddCategory));
    var out = mkBtn('退出登录', async function () {
      await api('/api/logout', 'POST'); await load();
    });
    bar.appendChild(out);
  } else {
    bar.appendChild(mkBtn('管理员登录', openLogin));
  }

  // 分组与链接
  var wrap = $('sections');
  wrap.innerHTML = '';
  state.categories.forEach(function (c) {
    var list = state.bookmarks.filter(function (b) { return b.categoryId === c.id; });
    var sec = document.createElement('section');
    sec.id = 'sec-' + c.id;
    sec.innerHTML = '<h2>' + esc(c.name) + ' <span>' + list.length + ' 个链接</span></h2>';
    if (!list.length) {
      var p = document.createElement('p');
      p.className = 'empty';
      p.textContent = '暂未添加';
      sec.appendChild(p);
    } else {
      var grid = document.createElement('div');
      grid.className = 'grid';
      list.forEach(function (b) { grid.appendChild(tile(b)); });
      sec.appendChild(grid);
    }
    wrap.appendChild(sec);
  });
}

function setActive(el) {
  document.querySelectorAll('.cat').forEach(function (c) { c.classList.remove('active'); });
  el.classList.add('active');
}

function mkBtn(text, fn) {
  var b = document.createElement('button');
  b.textContent = text;
  b.onclick = fn;
  return b;
}

function tile(b) {
  var a = document.createElement('a');
  a.className = 'tile';
  a.href = b.url;
  a.target = '_blank';
  a.rel = 'noopener';
  var first = (b.name || '?').trim().charAt(0).toUpperCase();
  var host = hostOf(b.url);
  // 真实 favicon（Google 服务），加载失败时自动隐藏，只留首字母底色
  var fav = host ? 'https://www.google.com/s2/favicons?domain=' + encodeURIComponent(host) + '&sz=128' : '';
  a.innerHTML = '<span class="icon" style="background:' + iconColor(b.name) + '">' +
    '<span class="letter">' + esc(first) + '</span>' +
    (fav ? '<img src="' + esc(fav) + '" alt="" loading="lazy" onerror="this.style.display=\'none\'">' : '') +
    '</span>' +
    '<span class="name">' + esc(b.name) + '</span>' +
    (host ? '<span class="domain">' + esc(host) + '</span>' : '');
  if (state.loggedIn) {
    var ops = document.createElement('span');
    ops.className = 'ops';
    var edit = document.createElement('button');
    edit.textContent = '✎';
    edit.title = '编辑';
    edit.onclick = function (e) { e.preventDefault(); e.stopPropagation(); openEditBookmark(b); };
    var del = document.createElement('button');
    del.textContent = '✕';
    del.title = '删除';
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

load().catch(function (e) {
  $('sections').innerHTML = '<p class="empty">加载失败：' + esc(e.message) + '，刷新页面再试。</p>';
});
