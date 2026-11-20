const $ = (s) => document.querySelector(s);
// Писать в DOM, только если значение поменялось: часы, проценты и полоски обновляются по таймеру,
// и одинаковая запись всё равно заставляет панель пересчитывать и перерисовывать блок
const setText = (el, v) => { v = String(v); if (el && el.textContent !== v) el.textContent = v; };
const setStyle = (el, prop, v) => { v = String(v); if (el && el.style[prop] !== v) el.style[prop] = v; };
const dockEl = $('#dock');
let config = null;
let lastPomoKey = '';

// Окно подстраивается под размер дока. Отдельно сообщаем ширину самих блоков:
// во всю ширину панель шире содержимого, а ужимать масштаб нужно по содержимому.
let lastSize = '';
function reportSize() {
  const r = dockEl.getBoundingClientRect();
  const blocks = [...dockEl.querySelectorAll('.zone > *')].filter((el) => el.offsetWidth > 0);
  const content = blocks.reduce((s, el) => s + el.offsetWidth, 0) + 3 * blocks.length + 30;
  // Сначала передаём CSS-пиксели без округления: до целых DIP округляет главный процесс
  // после применения масштаба. Иначе на дробном масштабе возникает цикл resize → zoom → resize.
  const size = [r.width, r.height, document.body.classList.contains('full') ? content : r.width];
  const key = size.map((n) => n.toFixed(2)).join('|');
  if (key === lastSize) return;
  lastSize = key;
  dock.resize(...size);
}
const sizeObserver = new ResizeObserver(reportSize);
sizeObserver.observe(dockEl);
for (const z of ['#zoneL', '#zoneC', '#zoneR']) sizeObserver.observe($(z));

dockEl.addEventListener('contextmenu', (e) => { e.preventDefault(); dock.menu(); });
// «Пуск»: своё меню в стиле панели или системное — по настройке виджета
function openStartMenu() {
  const btn = $('#start');
  const r = btn.offsetWidth ? btn.getBoundingClientRect() : dockEl.getBoundingClientRect();
  dock.openPanel('start', Math.round(r.left + r.width / 2));
}
$('#start').addEventListener('click', () => {
  if (opt('start').menu === 'windows') return dock.key('start');
  openStartMenu();
});
dock.onOpenStart(openStartMenu);   // нажали клавишу Win

const opt = (w) => (config ? config.widgetOpts[w] : WIDGET_DEFAULTS[w]);

// ---------- Полоска у края экрана под панелью ----------
// Окно дотянуто до края экрана; нажатие в полоске под панелью отдаём значку прямо над курсором.
// Почти невидимый фон нужен, чтобы прозрачное окно вообще получало клики в этой полоске.
let edgePad = 0;
dock.onEdgePad((px) => {
  edgePad = px;
  document.documentElement.classList.toggle('edge-pad', px > 0);
});
document.addEventListener('click', (e) => {
  if (!edgePad) return;
  const r = dockEl.getBoundingClientRect();
  if (e.clientY <= r.bottom) return;
  const target = document.elementFromPoint(e.clientX, r.bottom - 10);
  if (target && dockEl.contains(target)) target.click();
});

// ---------- Плавный выезд/уезд при автоскрытии ----------
// Кадры — по requestAnimationFrame, в такт экрану. Выезд с мягким торможением, уезд с разгоном.
// Прозрачность постоянна, чтобы конец движения не выглядел как вспышка панели.
const easeOut = (k) => 1 - Math.pow(1 - k, 4);
const easeIn = (k) => k * k * k;
let slideId = 0;
dock.onSlide(({ id, from, to, show, ms }) => {
  slideId = id;
  const t0 = performance.now();
  const frame = (now) => {
    if (id !== slideId) return;   // началась новая анимация
    const k = Math.min(1, (now - t0) / ms);
    const e = show ? easeOut(k) : easeIn(k);
    dock.slidePos(id, from + (to - from) * e, k >= 1);
    if (k < 1) requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
});

// ---------- Настройки ----------

function applyConfig(cfg) {
  config = cfg;
  const w = cfg.widgets;
  for (const el of document.querySelectorAll('[data-w]')) {
    const st = opt(el.dataset.w).style;
    el.classList.toggle('st-solid', st === 'solid');
    el.classList.toggle('st-clear', st === 'clear');
  }
  for (const [id, key] of [['#startBlock', 'start'], ['#w-system', 'system'], ['#w-tasks', 'tasks'], ['#w-disk', 'disk'], ['#w-pomodoro', 'pomodoro'], ['#w-clock', 'clock'], ['#w-tray', 'tray']]) {
    $(id).classList.toggle('hidden', !w[key]);
  }
  // Прозрачность только фона: иконки и виджеты остаются непрозрачными
  const k = 1 - cfg.appearance.bgTransparency;
  document.documentElement.style.setProperty('--bg-a', k * 0.9);
  document.documentElement.style.setProperty('--bg-k', k);
  document.body.classList.toggle('no-blur', !cfg.appearance.blur);
  applyOrder();

  // Система
  $('#sysLogo').classList.toggle('hidden', !opt('system').icon);
  buildSystem();

  // Музыка
  const m = opt('media');
  const mb = $('#w-media');
  mb.classList.toggle('m-compact', m.size === 'compact');
  mb.classList.toggle('m-wide', m.size === 'wide');
  mb.classList.toggle('no-cover', !m.cover);
  mb.classList.toggle('no-text', !m.text);
  mb.classList.toggle('no-ctl', !m.controls);
  mb.classList.toggle('play-gray', m.play === 'gray');
  mb.classList.toggle('play-white', m.play === 'white');
  mb.classList.toggle('play-clear', m.play === 'clear');
  mediaAllowed = w.media;
  showMedia(lastMedia);

  // Задачи, помодоро, открытые приложения, часы
  $('#evTile').classList.toggle('hidden', !opt('tasks').tile);
  dock.todos().then(showTodos);
  $('#w-pomodoro').classList.toggle('v-ring', opt('pomodoro').view === 'ring');
  for (const s of ['small', 'large']) {
    $('#w-open').classList.toggle('sz-' + s, opt('openApps').size === s);
    $('#w-tray').classList.toggle('sz-' + s, opt('tray').size === s);
  }
  // Кнопка ассистента: лицо выбранного ассистента
  const asst = ASSISTANTS[cfg.assistant.persona] || Object.values(ASSISTANTS)[0];
  $('#assistIcon').src = asst.dir + '/icon.png';
  $('#assistBtn').title = `${asst.name} · клик — меню`;
  $('#assistBtn').classList.toggle('off', !cfg.assistant.enabled);
  $('#clockDate').classList.toggle('hidden', !opt('clock').date);
  $('#weather').classList.toggle('hidden', !opt('clock').weather);
  refreshClock();
  renderSocial();

  const pomoKey = JSON.stringify(cfg.pomodoro);
  if (pomoKey !== lastPomoKey && !pomo.running) resetPomo(pomo.mode);
  lastPomoKey = pomoKey;
  appsKey = '';
  trayKey = '';
  disksKey = '';
  refreshApps();
  refreshTray();
  refreshStats();
  refreshWeather();
  if (!w.openApps) $('#w-open').classList.add('hidden');
}

// ---------- Клики по виджетам ----------

function anchorOf(el) {
  const r = el.getBoundingClientRect();
  return Math.round(r.left + r.width / 2);
}
const openPanelAt = (mode) => (e) => dock.openPanel(mode, anchorOf(e.currentTarget));

$('#w-system').addEventListener('click', openPanelAt('system'));
$('#w-disk').addEventListener('click', openPanelAt('disks'));
$('#w-tasks').addEventListener('click', openPanelAt('todos'));
$('#clockDate').addEventListener('click', openPanelAt('calendar'));
$('#clockRight').addEventListener('click', openPanelAt('weather'));
$('#trayBtn').addEventListener('click', (e) => dock.openPanel('tray', anchorOf($('#w-tray'))));
$('#assistBtn').addEventListener('click', () => dock.assistMenu());
$('#assistBtn').addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); dock.assistMenu(); });
$('#w-media').addEventListener('click', (e) => {
  if (e.target.closest('.ctl')) return;
  openPanelAt('media')(e);
});

// ---------- Закреплённые приложения ----------

let appsKey = '';
function iconButton(icon, title, fallback) {
  const b = document.createElement('button');
  b.className = 'btn';
  b.title = title;
  if (icon) b.appendChild(Object.assign(document.createElement('img'), { src: icon }));
  else b.textContent = (fallback || '?')[0];
  return b;
}

async function refreshApps() {
  const apps = await dock.apps();
  if (drag) return;
  const key = apps.map((a) => a.name + a.capsule).join('|');
  const left = $('#leftapps'), caps = $('#capapps');
  if (key !== appsKey) {
    appsKey = key;
    left.querySelectorAll('.btn:not(.start)').forEach((b) => b.remove());
    caps.innerHTML = '';
    apps.forEach((a, i) => {
      const b = iconButton(a.icon, a.name, a.name);
      b.dataset.i = i;
      b.addEventListener('click', () => { if (!takeDragClick()) dock.launch(i); });
      // Средняя кнопка мыши — новое окно программы
      b.addEventListener('auxclick', (e) => { if (e.button === 1) dock.launch(i, true); });
      b.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); dock.appMenu(i); });
      makeDraggable(b, { type: 'pinned', index: i });
      if (a.capsule) {
        const cap = document.createElement('section');
        cap.className = 'cap app';
        cap.appendChild(b);
        caps.appendChild(cap);
      } else {
        left.appendChild(b);
      }
    });
  }
  apps.forEach((a, i) => {
    const b = document.querySelector(`.btn[data-i="${i}"]`);
    const w = pinnedWindows[i];
    if (b) {
      b.classList.toggle('running', a.running || !!w);
      b.classList.toggle('active-pin', !!(w && w.active));
    }
  });
}

// ---------- Перетаскивание иконок ----------
// Закреплённые иконки можно двигать (и между левой группой и капсулами),
// открытые приложения — перетащить к закреплённым, чтобы закрепить.
// Закреплённую иконку, утащенную вверх за пределы панели, открепляем.

let drag = null;
let dragClickBlock = false;
const takeDragClick = () => { const r = dragClickBlock; dragClickBlock = false; return r; };

function pinnedSlots(except) {
  return [...document.querySelectorAll('#leftapps .btn[data-i], #capapps .btn[data-i]')]
    .filter((b) => b !== except)
    .map((b) => {
      const r = b.getBoundingClientRect();
      return { i: +b.dataset.i, cx: r.left + r.width / 2, left: r.left, right: r.right, cap: !!b.closest('#capapps') };
    });
}

// Куда вставить: перед каким закреплённым (или в конец) и в какую группу
function dropTarget(x) {
  const slots = drag.slots;
  if (!slots.length) return { before: null, cap: true, x: $('#capapps').getBoundingClientRect().left };
  const nearest = slots.reduce((a, s) => (Math.abs(s.cx - x) < Math.abs(a.cx - x) ? s : a));
  const idx = slots.findIndex((s) => s.cx > x);
  if (idx === -1) {
    const last = slots[slots.length - 1];
    return { before: null, cap: nearest.cap, x: last.right + 2 };
  }
  return { before: slots[idx].i, cap: nearest.cap, x: slots[idx].left - 2 };
}

function makeDraggable(btn, info) {
  btn.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    drag = { btn, info, x0: e.clientX, started: false };
    btn.setPointerCapture(e.pointerId);
  });
  btn.addEventListener('pointermove', (e) => {
    if (!drag || drag.btn !== btn) return;
    const dx = e.clientX - drag.x0;
    if (!drag.started) {
      if (Math.abs(dx) < 6 && e.clientY > -10) return;
      drag.started = true;
      drag.slots = pinnedSlots(btn);
      btn.classList.add('dragging');
      const host = btn.closest('.cap');
      if (host) host.classList.add('drag-host');
    }
    btn.style.transform = `translate(${dx}px, ${Math.min(0, e.clientY - 27)}px)`;
    const unpin = info.type === 'pinned' && e.clientY < -30;
    btn.classList.toggle('unpin', unpin);
    btn.title = unpin ? 'Отпустите, чтобы открепить' : btn.title;
    const t = dropTarget(e.clientX);
    $('#dropMarker').classList.toggle('hidden', unpin);
    $('#dropMarker').style.left = t.x + 'px';
  });
  const finish = (e) => {
    if (!drag || drag.btn !== btn) return;
    const d = drag;
    drag = null;
    btn.classList.remove('dragging', 'unpin');
    btn.style.transform = '';
    $('#dropMarker').classList.add('hidden');
    document.querySelectorAll('.drag-host').forEach((h) => h.classList.remove('drag-host'));
    if (!d.started) return;
    dragClickBlock = true;
    setTimeout(() => { dragClickBlock = false; }, 50);
    d.slots = d.slots || [];
    drag = d;
    const t = dropTarget(e.clientX);
    drag = null;
    const apps = config.apps.slice();
    let item;
    if (d.info.type === 'pinned') {
      item = apps[d.info.index];
      if (e.clientY < -30) {  // утащили вверх — открепить
        apps.splice(d.info.index, 1);
        return dock.setConfig({ ...config, apps });
      }
      apps.splice(d.info.index, 1);
    } else {
      const name = d.info.exe.split('\\').pop().replace(/\.exe$/i, '');
      item = { name: name[0].toUpperCase() + name.slice(1), path: d.info.exe };
    }
    item = { ...item, capsule: t.cap };
    const beforeItem = t.before === null ? null : config.apps[t.before];
    const at = beforeItem ? apps.indexOf(beforeItem) : apps.length;
    apps.splice(at, 0, item);
    dock.setConfig({ ...config, apps });
  };
  btn.addEventListener('pointerup', finish);
  btn.addEventListener('pointercancel', finish);
}

// ---------- Перетаскивание виджетов ----------
// Виджет можно взять за любое место (кроме иконок приложений, у них своё перетаскивание)
// и переставить; порядок сохраняется в config.widgetOrder.

const BLOCKS = {
  start: '#startBlock', pinned: '#leftapps', social: '#w-social', system: '#w-system', apps: '#capapps', openApps: '#w-open', media: '#w-media',
  tasks: '#w-tasks', disk: '#w-disk', pomodoro: '#w-pomodoro', tray: '#w-tray', clock: '#w-clock',
};
let wdrag = null;
let blockNextClick = false;

const isFull = () => config && config.appearance.width === 'full';
const zoneFor = (k) => (isFull() ? zoneOf(k, config.appearance.layout, config.layoutZones) : 'C');

function applyOrder() {
  if (!config || wdrag) return;
  const layout = config.appearance.layout;
  document.body.classList.toggle('full', isFull());
  document.body.classList.toggle('spread', isFull() && layout === 'spread');
  for (const k of config.widgetOrder) {
    const el = $(BLOCKS[k]);
    if (el) $('#zone' + zoneFor(k)).appendChild(el);
  }
  reportSize();
}

// После перетаскивания отменяем клик, иначе виджет ещё и откроет своё окно
dockEl.addEventListener('click', (e) => {
  if (!blockNextClick) return;
  blockNextClick = false;
  e.stopPropagation();
  e.preventDefault();
}, true);

function widgetSlots(except) {
  return Object.entries(BLOCKS)
    .map(([key, sel]) => ({ key, el: $(sel) }))
    .filter((s) => s.el !== except && s.el.offsetWidth > 0)
    .map((s) => {
      const r = s.el.getBoundingClientRect();
      return { key: s.key, cx: r.left + r.width / 2, left: r.left, right: r.right, zone: s.el.parentElement.id.slice(4) };
    })
    .sort((a, b) => a.cx - b.cx);
}

for (const [key, sel] of Object.entries(BLOCKS)) {
  const el = $(sel);
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || drag || e.target.closest('.btn[data-i], #w-open .btn')) return;
    wdrag = { el, key, x0: e.clientX, pid: e.pointerId, started: false };
  });
}

document.addEventListener('pointermove', (e) => {
  if (!wdrag) return;
  const dx = e.clientX - wdrag.x0;
  if (!wdrag.started) {
    if (Math.abs(dx) < 8) return;
    wdrag.started = true;
    wdrag.slots = widgetSlots(wdrag.el);
    wdrag.el.setPointerCapture(wdrag.pid);
    wdrag.el.classList.add('wdragging');
  }
  wdrag.el.style.transform = `translateX(${dx}px)`;
  const s = wdrag.slots;
  const zone = pointerZone(e.clientX);
  wdrag.zone = zone;
  // Вставляем перед первым блоком той же зоны правее курсора, иначе — в конец зоны
  const next = s.find((x) => x.cx > e.clientX && x.zone === zone);
  wdrag.before = next ? next.key : null;
  const inZone = s.filter((x) => x.zone === zone);
  const m = $('#dropMarker');
  m.classList.remove('hidden');
  let mx;
  if (next) mx = next.left - 1.5;
  else if (inZone.length) mx = inZone[inZone.length - 1].right + 1.5;
  else mx = zone === 'L' ? 6 : zone === 'R' ? window.innerWidth - 6 : window.innerWidth / 2;
  m.style.left = mx + 'px';
});

// Зона под курсором: во всю ширину — по положению относительно центральной зоны
function pointerZone(x) {
  if (!isFull() || config.appearance.layout === 'spread') return 'C';
  const c = $('#zoneC').getBoundingClientRect();
  if (c.width === 0) return x < window.innerWidth / 3 ? 'L' : x > (2 * window.innerWidth) / 3 ? 'R' : 'C';
  return x < c.left - 4 ? 'L' : x > c.right + 4 ? 'R' : 'C';
}

function endWidgetDrag() {
  if (!wdrag) return;
  const d = wdrag;
  wdrag = null;
  d.el.classList.remove('wdragging');
  d.el.style.transform = '';
  $('#dropMarker').classList.add('hidden');
  if (!d.started) return;
  blockNextClick = true;
  setTimeout(() => { blockNextClick = false; }, 80);
  const next = { ...config, appearance: { ...config.appearance }, layoutZones: { ...config.layoutZones } };
  // Перенос в другую зону превращает готовую раскладку в «Свою»
  if (isFull() && d.zone !== zoneFor(d.key)) {
    if (next.appearance.layout !== 'custom') {
      for (const k of next.widgetOrder) next.layoutZones[k] = zoneFor(k);
      next.appearance.layout = 'custom';
    }
    next.layoutZones[d.key] = d.zone;
  }
  const order = next.widgetOrder.filter((k) => k !== d.key);
  let at;
  if (d.before) at = order.indexOf(d.before);
  else {
    // В конец своей зоны: после последнего блока этой зоны
    const zoneKeys = isFull() ? order.filter((k) => zoneOf(k, next.appearance.layout, next.layoutZones) === d.zone) : order;
    at = zoneKeys.length ? order.indexOf(zoneKeys[zoneKeys.length - 1]) + 1 : order.length;
  }
  order.splice(at, 0, d.key);
  next.widgetOrder = order;
  config = next;
  applyOrder();
  dock.setConfig(next);
}
document.addEventListener('pointerup', endWidgetDrag);
document.addEventListener('pointercancel', endWidgetDrag);

// ---------- Открытые приложения ----------

let pinnedWindows = [];
let openKey = '';

function showWindows(data) {
  pinnedWindows = data.pinned;
  pinnedWindows.forEach((w, i) => {
    const b = document.querySelector(`.btn[data-i="${i}"]`);
    if (!b) return;
    if (w) b.classList.add('running');
    b.classList.toggle('active-pin', !!(w && w.active));
  });
  if (drag) return;

  const box = $('#w-open');
  const show = config && config.widgets.openApps && data.open.length > 0;
  box.classList.toggle('hidden', !show);
  if (!show) return;
  const key = data.open.map((o) => o.key).join('|');
  if (key !== openKey) {
    openKey = key;
    box.innerHTML = '';
    for (const o of data.open) {
      const b = iconButton(o.icon, '', o.exe.split('\\').pop());
      b.classList.add('running');
      b.addEventListener('click', () => { if (!takeDragClick()) dock.focusWindow(o.key); });
      b.addEventListener('auxclick', (e) => { if (e.button === 1) dock.newWindow(o.key); });
      makeDraggable(b, { type: 'open', exe: o.exe });
      box.appendChild(b);
    }
  }
  data.open.forEach((o, i) => {
    const b = box.children[i];
    b.title = o.title + '\nПеретащите к закреплённым, чтобы закрепить';
    b.classList.toggle('active', o.active);
    b.classList.toggle('multi', o.count > 1);
  });
}
dock.onWindows(showWindows);

// ---------- Скрытые значки ----------

let trayKey = '';
async function refreshTray() {
  if (!config || !config.widgets.tray) return;
  const box = $('#trayPins');
  const pins = opt('tray').pinned ? config.trayPinned : [];
  const items = pins.length ? await dock.trayList().catch(() => null) : [];
  if (!items) return;
  const shown = pins.map((exe) => items.find((t) => t.exe === exe)).filter(Boolean);
  const key = JSON.stringify(shown.map((t) => [t.exe, t.name, t.icon]));
  if (key === trayKey) return;
  trayKey = key;
  box.innerHTML = '';
  for (const t of shown) {
    const b = iconButton(t.icon, t.name, t.name);
    b.addEventListener('click', () => dock.trayOpen(t.exe));
    b.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); dock.trayMenu(t.exe); });
    box.appendChild(b);
  }
}

// ---------- Соцсети ----------

let socialList = [];
let socialRot = 0;

function deltaText(d) {
  if (d == null || d === 0) return ['', ''];
  return [(d > 0 ? '▲ ' : '▼ ') + compactCount(Math.abs(d)), d > 0 ? 'up' : 'down'];
}

function socItem(svg, value, sub, subCls, title, err) {
  const el = document.createElement('span');
  el.className = 'soc' + (err ? ' err' : '');
  el.title = title;
  el.innerHTML = `<svg viewBox="0 0 24 24">${svg}</svg><span class="soc-txt"><b></b><i></i></span>`;
  el.querySelector('b').textContent = value;
  const i = el.querySelector('i');
  i.textContent = sub;
  if (subCls) i.className = subCls;
  if (!sub) i.remove();
  return el;
}

function renderSocial() {
  const box = $('#w-social');
  const o = opt('social');
  const show = config && config.widgets.social && socialList.length > 0;
  box.classList.toggle('hidden', !show);
  if (!show) return;
  box.innerHTML = '';
  if (o.view === 'total') {
    const sum = socialList.reduce((s, a) => s + (a.count || 0), 0);
    const day = socialList.reduce((s, a) => s + (a.day || 0), 0);
    const [t, c] = o.delta ? deltaText(day) : ['', ''];
    const people = '<circle cx="9" cy="8.5" r="3.2" fill="#fff"/><path d="M3.5 18.5a5.5 5.5 0 0 1 11 0z" fill="#fff"/><circle cx="16.5" cy="9.5" r="2.5" fill="#fff" opacity=".6"/><path d="M15 13.3a4.6 4.6 0 0 1 5.5 5.2h-4.3" fill="#fff" opacity=".6"/>';
    box.appendChild(socItem(people, compactCount(sum), t || 'всего', c, socialList.map((a) => `${SOCIAL[a.platform].name} @${a.handle}: ${a.count ?? '—'}`).join('\n')));
    return;
  }
  // Один выбранный аккаунт — крупно: значок-плитка, число и подпись (как на референсе)
  if (o.view === 'one') {
    const a = socialList.find((x) => x.id === config.social.selected) || socialList[0];
    const [t, c] = o.delta ? deltaText(a.day) : ['', ''];
    const el = document.createElement('span');
    el.className = 'soc-big' + (a.error && a.count == null ? ' err' : '');
    el.title = `${SOCIAL[a.platform].name} · @${a.handle}\n` +
      (a.error && a.count == null ? 'Ошибка: ' + a.error : `${(a.count ?? 0).toLocaleString('ru-RU')} подписчиков`) + '\nКлик — все соцсети';
    el.innerHTML = `<span class="soc-tile"><svg viewBox="0 0 24 24">${SOCIAL[a.platform].icon}</svg></span><span class="soc-txt"><b></b><i></i></span>`;
    el.querySelector('b').textContent = a.count == null ? '—' : (a.approx ? '≈' : '') + shortCount(a.count);
    const i = el.querySelector('i');
    i.textContent = t || 'подписчиков';
    if (c) i.className = c;
    box.appendChild(el);
    return;
  }
  const list = o.view === 'rotate' ? [socialList[socialRot % socialList.length]] : socialList;
  for (const a of list) {
    const [t, c] = o.delta ? deltaText(a.day) : ['', ''];
    const value = a.count == null ? '—' : (a.approx ? '≈' : '') + compactCount(a.count);
    const title = `${SOCIAL[a.platform].name} · @${a.handle}\n` +
      (a.error ? 'Ошибка: ' + a.error : `${(a.count ?? 0).toLocaleString('ru-RU')} подписчиков${a.approx ? ' (округлено YouTube)' : ''}`);
    box.appendChild(socItem(SOCIAL[a.platform].icon, value, t, c, title, !!a.error && a.count == null));
  }
}

dock.onSocial((list) => { socialList = list; renderSocial(); });
dock.social().then((list) => { socialList = list; renderSocial(); });
$('#w-social').addEventListener('click', openPanelAt('social'));
// «По очереди»: аккаунты сменяются каждые 5 секунд
setInterval(() => {
  if (!config || opt('social').view !== 'rotate' || socialList.length < 2) return;
  const box = $('#w-social');
  box.firstChild && box.firstChild.classList.add('fade');
  setTimeout(() => { socialRot++; renderSocial(); }, 300);
}, 5000);

// ---------- Музыка ----------

const PLAY = '<path d="M8 5.5v13l11-6.5z"/>';
const PAUSE = '<path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"/>';
let lastMedia = null;
let mediaAllowed = true;

function showMedia(m) {
  lastMedia = m;
  const box = $('#w-media');
  if (!m || !m.active || !mediaAllowed) { box.classList.add('hidden'); return; }
  box.classList.remove('hidden');
  $('#mtitle').textContent = m.title || '';
  box.title = [m.title, m.artist].filter(Boolean).join(' — ');
  $('#martist').textContent = m.artist || '';
  $('#ppicon').innerHTML = m.playing ? PAUSE : PLAY;
  if (m.thumb !== undefined) $('#cover').style.backgroundImage = m.thumb ? `url("${m.thumb}")` : '';
}

document.querySelectorAll('.ctl button').forEach((b) =>
  b.addEventListener('click', () => dock.key(b.dataset.key)));
dock.onMedia(showMedia);

// ---------- Система ----------

const GB = 1024 ** 3;
const RING = (id, label) => `<span class="mring" id="${id}"><svg viewBox="0 0 36 36"><circle class="bg" cx="18" cy="18" r="15"/><circle class="fg" cx="18" cy="18" r="15"/></svg><b></b><i>${label}</i></span>`;

function levelColor(p, mode = 'load') {
  if (mode === 'blue') return 'var(--blue)';
  if (mode === 'white') return 'var(--white)';
  return p >= 85 ? 'var(--red)' : p >= 65 ? 'var(--orange)' : 'var(--green)';
}

function buildSystem() {
  const o = opt('system');
  const metrics = o.show === 'both' ? [['cpu', 'CPU'], ['ram', 'Память']] : o.show === 'cpu' ? [['cpu', 'CPU']] : [['ram', 'Память']];
  const body = $('#sysBody');
  if (o.view === 'bars') {
    body.className = 'rows sys-body';
    body.innerHTML = metrics.map(([k, l]) =>
      `<div class="row"><span class="lbl">${l}</span><span class="track"><span class="fill" id="${k}Fill"></span></span><span class="meta" id="${k}Meta"></span><span class="pct" id="${k}Pct">0%</span></div>`).join('');
  } else if (o.view === 'rings') {
    body.className = 'sys-body';
    body.innerHTML = metrics.map(([k, l]) => RING(k + 'Ring', l === 'Память' ? 'RAM' : l)).join('');
  } else {
    body.className = 'sys-body';
    body.innerHTML = metrics.map(([k, l]) => `<span class="numpair"><i>${l === 'Память' ? 'RAM' : l}</i><b id="${k}Num">0%</b></span>`).join('');
  }
  $('#w-system').style.paddingLeft = o.icon ? '' : '14px';
}

function setMetric(k, p, meta) {
  const color = levelColor(p, opt('system').color);
  const fill = document.getElementById(k + 'Fill');
  setStyle(fill, 'width', p + '%'); setStyle(fill, 'background', color);
  setText(document.getElementById(k + 'Pct'), p + '%');
  setText(document.getElementById(k + 'Meta'), meta);
  setRing(document.getElementById(k + 'Ring'), p, color, p + '%');
  const num = document.getElementById(k + 'Num');
  if (num) { setText(num, p + '%'); setStyle(num, 'color', opt('system').color === 'load' ? color : ''); }
}

function setRing(el, p, color, text) {
  if (!el) return;
  const fg = el.querySelector('.fg');
  setStyle(fg, 'strokeDashoffset', 94.25 * (1 - p / 100));
  setStyle(fg, 'stroke', color);
  setText(el.querySelector('b'), text);
}

// ---------- Диски ----------

let disksKey = '';
function renderDisks(disks) {
  const o = opt('disk');
  const list = o.drive === 'all' ? disks : disks.filter((d) => d.name === o.drive);
  const shown = list.length ? list : disks.slice(0, 1);
  const box = $('#w-disk');
  const single = shown.length === 1;
  box.classList.toggle('single', single && o.view === 'bar');
  const key = shown.map((d) => d.name).join() + o.view + o.value;
  const body = $('#diskBody');
  if (key !== disksKey) {
    disksKey = key;
    body.innerHTML = shown.map((d) => {
      const id = d.name[0];
      if (o.view === 'ring') {
        return `<span class="dring">${RING('dr' + id, d.name)}${single ? `<span class="lbl2"><b>Диск ${d.name}</b><span id="dm${id}"></span></span>` : ''}</span>`;
      }
      if (single) {
        return `<div class="rows"><div class="row head"><span class="lbl">Диск ${d.name}</span><span class="pct" id="dp${id}"></span></div>` +
          `<div class="row"><span class="track wide"><span class="fill" id="df${id}"></span></span></div><div class="row"><span class="meta" id="dm${id}"></span></div></div>`;
      }
      return `<div class="dcol"><span class="top"><span>${d.name}</span><span id="dp${id}"></span></span>` +
        `<span class="track wide"><span class="fill" id="df${id}"></span></span><span class="meta" id="dm${id}"></span></div>`;
    }).join('');
  }
  for (const d of shown) {
    const id = d.name[0];
    const p = Math.round(100 * d.used / d.total);
    const free = Math.round((d.total - d.used) / GB), used = Math.round(d.used / GB);
    const meta = o.value === 'free'
      ? (single ? `${free} ГБ своб. из ${Math.round(d.total / GB)}` : `${free} ГБ своб.`)
      : (single ? `${used} ГБ занято из ${Math.round(d.total / GB)}` : `${used} ГБ занято`);
    const fill = document.getElementById('df' + id);
    setStyle(fill, 'width', p + '%'); setStyle(fill, 'background', levelColor(p));
    setText(document.getElementById('dp' + id), p + '%');
    setText(document.getElementById('dm' + id), meta);
    setRing(document.getElementById('dr' + id), p, levelColor(p), p + '%');
  }
}

async function refreshStats() {
  if (!config) return;
  const s = await dock.stats();
  const ram = Math.round(100 * s.ram.used / s.ram.total);
  setMetric('cpu', s.cpu, navigator.hardwareConcurrency + ' пот.');
  setMetric('ram', ram, (s.ram.used / GB).toFixed(1) + ' ГБ');
  if (s.disk && s.disk.length) renderDisks(s.disk);
}

// ---------- Погода (Open-Meteo; иконки в shared.js) ----------

let weatherKey = '';
async function refreshWeather(force) {
  const w = config && config.weather;
  if (!w) return;
  const key = JSON.stringify([w.gismeteoId || '', w.city, w.region, w.lat, w.lon]);
  if (!force && key === weatherKey) return;
  weatherKey = key;
  try {
    const result = await dock.weather();
    if (!result.ok) throw new Error(result.message);
    const d = result.data;
    if (weatherKey !== key) return;
    const c = d.current;
    $('#wicon').innerHTML = weatherIcon(c.weather_code, c.is_day);
    $('#wtemp').textContent = `${Math.round(c.temperature_2m)}°`;
    $('#weather').title = w.city + ' · Данные ' + d.source;
  } catch (e) {
    if (weatherKey !== key) return;
    weatherKey = '';
    $('#wicon').innerHTML = '';
    $('#weather').title = e.message;
    $('#wtemp').textContent = '—';
  }
}

// ---------- Часы ----------

const MONTHS = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const DOW = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
const DOW_SHORT = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];

function refreshClock() {
  const now = new Date();
  const c = opt('clock');
  const t = { hour: '2-digit', minute: '2-digit', hour12: c.format === '12' };
  if (c.seconds) t.second = '2-digit';
  setText($('#time'), now.toLocaleTimeString(c.format === '12' ? 'en-US' : 'ru-RU', t));
  setText($('#dow'), DOW[now.getDay()]);
  setText($('#date'), `${now.getDate()} ${MONTHS[now.getMonth()]}`);
  setText($('#evDow'), DOW_SHORT[now.getDay()]);
  setText($('#evDay'), now.getDate());
}

// ---------- Задачи ----------

function plural(n, one, few, many) {
  const a = n % 10, b = n % 100;
  if (a === 1 && b !== 11) return one;
  if (a >= 2 && a <= 4 && (b < 12 || b > 14)) return few;
  return many;
}

function showTodos(list) {
  const left = list.filter((t) => !t.done);
  const count = `${left.length} ${plural(left.length, 'задача', 'задачи', 'задач')}`;
  $('#w-tasks').title = left.length ? left.map((t) => '• ' + t.text).join('\n') : 'Задачи';
  if (opt('tasks').show === 'count') {
    $('#evTitle').textContent = left.length ? count : 'Задач нет';
    $('#evSub').textContent = left.length ? left[0].text : 'нажмите, чтобы добавить';
    return;
  }
  $('#evTitle').textContent = left.length ? left[0].text : 'Задач нет';
  $('#evSub').textContent = left.length > 1
    ? `и ещё ${left.length - 1} ${plural(left.length - 1, 'задача', 'задачи', 'задач')}`
    : left.length ? 'последняя на сегодня' : 'нажмите, чтобы добавить';
}
dock.onTodos(showTodos);

// ---------- Помодоро ----------

const pomo = { mode: 'work', left: 25 * 60, running: false, endsAt: 0 };
const minutesOf = (mode) => (config ? config.pomodoro[mode] : mode === 'work' ? 25 : 5);
const PLAY_S = '<path d="M7 4v16l13-8z"/>';
const PAUSE_S = '<path d="M6 4h4.5v16H6zM13.5 4H18v16h-4.5z"/>';

function resetPomo(mode) {
  pomo.mode = mode;
  pomo.left = minutesOf(mode) * 60;
  renderPomo();
}

function renderPomo() {
  const total = minutesOf(pomo.mode) * 60;
  const el = $('#w-pomodoro');
  const started = pomo.running || pomo.left < total;
  el.classList.toggle('running', pomo.running);
  el.classList.toggle('work', started && pomo.mode === 'work');
  el.classList.toggle('break', started && pomo.mode === 'break');
  $('#water').style.height = (started ? 12 + 76 * (pomo.left / total) : 77) + '%';
  $('#pomoRing').style.strokeDashoffset = 94.25 * (1 - pomo.left / total);
  $('#pomoNum').textContent = Math.ceil(pomo.left / 60);
  $('#pomoIcon').innerHTML = pomo.running ? PAUSE_S : PLAY_S;
  const m = Math.floor(pomo.left / 60), s = pomo.left % 60;
  el.title = `${pomo.mode === 'work' ? 'Фокус' : 'Перерыв'} · ${m}:${String(s).padStart(2, '0')}\n` +
    'Клик — старт/пауза · правый клик — сброс';
}

function beep() {
  const ctx = new AudioContext();
  [0, 0.25, 0.5].forEach((t) => {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.value = 880;
    g.gain.setValueAtTime(0.15, ctx.currentTime + t);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + t + 0.2);
    o.connect(g).connect(ctx.destination);
    o.start(ctx.currentTime + t);
    o.stop(ctx.currentTime + t + 0.2);
  });
}

function pomoTick() {
  if (!pomo.running) return;
  pomo.left = Math.max(0, Math.round((pomo.endsAt - Date.now()) / 1000));
  if (pomo.left === 0) {
    const finished = pomo.mode;
    pomo.running = false;
    resetPomo(finished === 'work' ? 'break' : 'work');
    beep();
    const el = $('#w-pomodoro');
    el.classList.remove('ding'); void el.offsetWidth; el.classList.add('ding');
    dock.notify('Помодоро', finished === 'work'
      ? `Фокус окончен — перерыв ${minutesOf('break')} мин`
      : 'Перерыв окончен — пора работать');
  }
  renderPomo();
}

$('#w-pomodoro').addEventListener('click', () => {
  pomo.running = !pomo.running;
  if (pomo.running) pomo.endsAt = Date.now() + pomo.left * 1000;
  renderPomo();
});
// Патрик попросил запустить фокус («помодоро»)
dock.onPomodoroStart(() => {
  if (pomo.running) return;
  pomo.running = true;
  pomo.endsAt = Date.now() + pomo.left * 1000;
  renderPomo();
});
$('#w-pomodoro').addEventListener('contextmenu', (e) => {
  e.preventDefault();
  e.stopPropagation();
  pomo.running = false;
  resetPomo('work');
});

// ---------- Старт ----------

dock.onConfig(applyConfig);
dock.config().then((cfg) => {
  applyConfig(cfg);
  dock.media().then(showMedia);
});
renderPomo();
setInterval(refreshApps, 4000);
setInterval(() => refreshTray().catch(() => {}), 5000);
dock.onTrayUpdated(() => refreshTray().catch(() => {}));
setInterval(refreshStats, 2000);
setInterval(() => refreshWeather(true), 15 * 60 * 1000);
setInterval(refreshClock, 1000);
setInterval(pomoTick, 500);
