const $ = (s) => document.querySelector(s);

document.addEventListener('keydown', (e) => { if (e.key === 'Escape') dock.closePanel(); });

// Изменение размера окна за края: координаты считает главный процесс по курсору
document.querySelectorAll('.grip').forEach((g) => {
  g.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    g.setPointerCapture(e.pointerId);
    dock.resizeStart(g.dataset.dir);
    let raf = 0;
    const move = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; dock.resizeMove(); }); };
    const up = () => {
      g.removeEventListener('pointermove', move);
      g.removeEventListener('pointerup', up);
      dock.resizeMove();
      dock.resizeEnd();
      onPanelResized();
    };
    g.addEventListener('pointermove', move);
    g.addEventListener('pointerup', up);
  });
  g.addEventListener('dblclick', () => dock.resizeReset());
});

// Под новый размер перестраиваем то, что считается в JS (погода по часам, процессы)
let resizeTimer = null;
function onPanelResized() {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (panelMode === 'weather') loadWeather();
    if (panelMode === 'system') loadSystem();
  }, 150);
}
window.addEventListener('resize', onPanelResized);

const applyTint = (cfg) => {
  document.documentElement.style.setProperty('--bg-a', (1 - cfg.appearance.bgTransparency) * 0.9);
  document.body.classList.toggle('no-blur', !cfg.appearance.blur);
  const size = cfg.widgetOpts.tray.size;
  document.body.classList.toggle('tray-small', size === 'small');
  document.body.classList.toggle('tray-large', size === 'large');
};
dock.config().then(applyTint);
dock.onConfig(applyTint);

dock.onPanelMode((mode) => {
  for (const id of ['calendar', 'todos', 'media', 'weather', 'system', 'disks', 'tray', 'start', 'social']) $('#' + id).classList.toggle('hidden', mode !== id);
  panelMode = mode;
  if (mode === 'social') dock.social().then(renderSocialPanel);
  if (mode === 'start') openStart();
  if (mode === 'system') loadSystem();
  if (mode === 'disks') loadDisks();
  if (mode === 'tray') loadTray(false);
  if (mode === 'calendar') { shown = new Date(); shown.setDate(1); renderCalendar(); }
  if (mode === 'todos') setTimeout(() => $('#newtodo').focus(), 50);
  if (mode === 'media') {
    dock.media().then(showMedia);
    // Каждый раз открываем плеер компактным: текст и источники — по кнопкам
    mediaTab = null;
    for (const id of ['#lyrics', '#sources']) $(id).classList.add('hidden');
    for (const id of ['#pLyricsBtn', '#pSourcesBtn']) $(id).classList.remove('on');
    setTimeout(() => { mediaBaseHeight = window.innerHeight; }, 80);
  }
  if (mode === 'weather') loadWeather();
});

let panelMode = null;
const GB = 1024 ** 3;
const levelColor = (p) => (p >= 85 ? 'var(--red)' : p >= 65 ? 'var(--orange)' : 'var(--green)');
function setFill(el, p) { el.style.width = p + '%'; el.style.background = levelColor(p); }

// ---------- Система ----------

async function loadSystem() {
  const s = await dock.sysinfo();
  if (panelMode !== 'system') return;
  const cpu = Math.round(s.cores.reduce((a, b) => a + b, 0) / s.cores.length);
  const ram = Math.round(100 * s.ram.used / s.ram.total);
  $('#sysModel').textContent = `${s.model} · ${s.cores.length} потоков`;
  $('#sysCpu').textContent = cpu + '%';
  setFill($('#sysCpuBar'), cpu);
  $('#sysRam').textContent = ram + '%';
  setFill($('#sysRamBar'), ram);
  $('#sysRamSub').textContent = `${(s.ram.used / GB).toFixed(1)} из ${(s.ram.total / GB).toFixed(1)} ГБ`;
  const cores = $('#sysCores');
  if (cores.children.length !== s.cores.length) cores.innerHTML = s.cores.map(() => '<span><i></i></span>').join('');
  s.cores.forEach((p, i) => {
    const bar = cores.children[i].firstChild;
    bar.style.height = Math.max(p, 3) + '%';
    bar.style.background = levelColor(p);
    cores.children[i].title = `Поток ${i + 1}: ${p}%`;
  });
  $('#sysProcs').innerHTML = '';
  for (const p of s.top) {
    const row = document.createElement('div');
    row.className = 'pr';
    row.append(Object.assign(document.createElement('span'), { textContent: p.name.replace(/\.exe$/i, '') }),
      Object.assign(document.createElement('span'), { textContent: p.mem >= GB ? (p.mem / GB).toFixed(1) + ' ГБ' : Math.round(p.mem / 1048576) + ' МБ' }));
    $('#sysProcs').appendChild(row);
  }
  const h = Math.floor(s.uptime / 3600), m = Math.floor((s.uptime % 3600) / 60);
  $('#sysFoot').textContent = `Работает без перезагрузки: ${Math.floor(h / 24)} д ${h % 24} ч ${m} мин · ${s.os}`;
}
setInterval(() => { if (panelMode === 'system' && !$('#system').classList.contains('hidden')) loadSystem(); }, 1500);
$('#sysTaskmgr').addEventListener('click', () => dock.open('taskmgr'));

// ---------- Диски ----------

const DRIVE_TYPES = { Fixed: 'Локальный диск', Removable: 'Съёмный диск', Network: 'Сетевой диск', CDRom: 'Оптический диск', Ram: 'RAM-диск' };
const DRIVE_ICON = '<svg viewBox="0 0 24 24"><rect x="3" y="6" width="18" height="12" rx="3"/><circle cx="16.5" cy="12" r="1.2" fill="#d1d1d6"/><path d="M6.5 12h5"/></svg>';

async function loadDisks() {
  const list = await dock.disksInfo();
  const box = $('#diskList');
  box.innerHTML = '';
  for (const d of list) {
    const used = d.total - d.free;
    const p = Math.round(100 * used / d.total);
    const item = document.createElement('div');
    item.className = 'disk-item';
    item.innerHTML = `${DRIVE_ICON}<span class="dn"></span><button class="link">Открыть</button><span class="track wide"><span class="fill"></span></span><span class="dd"></span>`;
    item.querySelector('.dn').textContent = `${d.label || DRIVE_TYPES[d.type] || 'Диск'} (${d.name})`;
    item.querySelector('.dd').textContent = `${Math.round(d.free / GB)} ГБ свободно из ${Math.round(d.total / GB)} ГБ · занято ${p}% · ${d.fs}`;
    setFill(item.querySelector('.fill'), p);
    item.querySelector('.link').addEventListener('click', () => dock.open(d.name));
    box.appendChild(item);
  }
  if (!list.length) box.innerHTML = '<div class="l-msg">Диски не найдены</div>';
}

// ---------- Скрытые значки ----------

async function loadTray(force) {
  const [items, cfg] = await Promise.all([dock.trayList(force), dock.config()]);
  const grid = $('#trayGrid');
  grid.innerHTML = '';
  for (const t of items) {
    const b = document.createElement('button');
    b.title = t.name + '\n' + t.exe;
    if (t.icon) b.appendChild(Object.assign(document.createElement('img'), { src: t.icon }));
    b.appendChild(Object.assign(document.createElement('span'), { textContent: t.name }));
    if (cfg.trayPinned.includes(t.exe)) b.appendChild(Object.assign(document.createElement('i'), { className: 'pin-dot' }));
    b.addEventListener('click', () => { dock.trayOpen(t.exe); dock.closePanel(); });
    b.addEventListener('contextmenu', (e) => { e.preventDefault(); dock.trayMenu(t.exe); });
    grid.appendChild(b);
  }
  if (!items.length) grid.innerHTML = '<div class="l-msg">Значков нет</div>';
  grid.scrollTop = 0;
}
$('#trayRefresh').addEventListener('click', () => loadTray(true));
dock.onConfig(() => { if (panelMode === 'tray') loadTray(false); });
document.querySelectorAll('.quick button').forEach((b) => b.addEventListener('click', () => {
  const q = b.dataset.q;
  if (q === 'systemtray') dock.systemTray();
  else if (q === 'settings') { dock.closePanel(); dock.openSettings(); }
  else dock.quick(q);
}));

// ---------- Соцсети ----------

function renderSocialPanel(list) {
  const box = $('#socList');
  box.innerHTML = '';
  if (!list.length) {
    box.innerHTML = '<div class="l-msg">Аккаунтов пока нет — добавьте их в настройках</div>';
    return;
  }
  for (const a of list) {
    const p = SOCIAL[a.platform];
    const card = document.createElement('div');
    card.className = 'soc-card' + (a.selected ? ' sel' : '');
    card.title = a.selected ? 'Показывается на панели' : 'Клик — показывать на панели';
    const num = a.count == null ? '—' : (a.approx ? '≈ ' : '') + a.count.toLocaleString('ru-RU');
    // Только соцсеть: значок, название, ник и число
    card.innerHTML = `<span class="soc-tile"><svg viewBox="0 0 24 24">${p.icon}</svg></span><span class="soc-txt2"><span class="soc-num"></span><span class="soc-name"><b></b> · @<span></span></span></span>`;
    card.querySelector('.soc-name b').textContent = a.label || p.name;
    card.querySelector('.soc-name span').textContent = a.handle;
    card.querySelector('.soc-num').textContent = num;
    if (a.error && a.count == null) card.title = 'Не удалось обновить: ' + a.error;
    // Отметка «на панели» и кнопка открыть профиль
    const side = document.createElement('div');
    side.className = 'soc-side';
    if (a.selected) side.appendChild(Object.assign(document.createElement('span'), { className: 'soc-on', textContent: 'На панели' }));
    const open = Object.assign(document.createElement('button'), { className: 'ibtn', title: 'Открыть профиль' });
    open.innerHTML = '<svg viewBox="0 0 24 24"><path d="M14 4h6v6M20 4l-8.5 8.5M18 14v4.5A1.5 1.5 0 0 1 16.5 20h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10"/></svg>';
    open.addEventListener('click', (e) => { e.stopPropagation(); dock.socialOpen(p.url(a.handle)); });
    side.appendChild(open);
    card.appendChild(side);
    card.addEventListener('click', () => dock.socialSelect(a.id));
    box.appendChild(card);
  }
  // Окно ровно по карточкам, без пустого места снизу
  requestAnimationFrame(() => {
    const last = box.lastElementChild;
    if (last) dock.panelHeight(Math.min(last.offsetTop + last.offsetHeight + 14, 600));
  });
}

dock.onSocial((list) => { if (panelMode === 'social') renderSocialPanel(list); });

// ---------- Меню «Пуск» ----------

// layout: { pages: [{ name, groups: [{ name, apps: [AppID] }] }] }; locked — «Зафиксировать меню»
let start = { apps: [], icons: {}, layout: { pages: [] }, locked: false, user: '' };
let startView = 'home';
let page = 0;
let results = [];
let selected = 0;

// Цвет плитки-буквы для приложений без иконки — стабильный по названию
const TILE_COLORS = [['#5e5ce6', '#bf5af2'], ['#0a84ff', '#64d2ff'], ['#30d158', '#66d4cf'], ['#ff9f0a', '#ff375f'], ['#ff453a', '#ff9f0a'], ['#bf5af2', '#ff375f']];
function iconEl(app) {
  const src = start.icons[app.id];
  if (src) return Object.assign(document.createElement('img'), { className: 's-ico', src, draggable: false });
  let h = 0;
  for (const ch of app.name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const [a, b] = TILE_COLORS[h % TILE_COLORS.length];
  const el = Object.assign(document.createElement('span'), { className: 's-letter', textContent: app.name.trim()[0].toUpperCase() });
  el.style.background = `linear-gradient(135deg, ${a}, ${b})`;
  return el;
}

function appButton(app, cls) {
  const b = document.createElement('button');
  b.className = cls;
  b.title = app.name;
  b.appendChild(iconEl(app));
  b.appendChild(Object.assign(document.createElement('span'), { textContent: app.name }));
  b.addEventListener('click', () => { if (!renaming) dock.startLaunch(app.id); });
  b.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); tileMenu(app); });
  return b;
}

// ---------- Контекстные меню «Пуска» ----------
// Меню рисует главный процесс (нативное), а пункты с run выполняются здесь по возвращённому id.

let ctxActions = {};
function showCtx(items) {
  ctxActions = {};
  let n = 0;
  const walk = (list) => list.map((it) => {
    const copy = { ...it };
    if (it.run) { copy.id = 'c' + (n++); ctxActions[copy.id] = it.run; delete copy.run; }
    if (it.submenu) copy.submenu = walk(it.submenu);
    return copy;
  });
  dock.ctxMenu(walk(items));
}
dock.onCtxCmd((id) => { if (ctxActions[id]) ctxActions[id](); });

const pages = () => start.layout.pages;
const curGroups = () => pages()[page].groups;
const findApp = (id) => start.apps.find((a) => a.id === id);

function saveLayout() {
  dock.startLayout(start.layout, start.locked);
  renderHome();
}

// Где лежит приложение: [страница, группа] или null
function locate(id) {
  for (let p = 0; p < pages().length; p++) {
    const g = pages()[p].groups.findIndex((x) => x.apps.includes(id));
    if (g >= 0) return [p, g];
  }
  return null;
}

// Подменю «во все группы всех страниц»
function groupTargets(run) {
  const items = [];
  pages().forEach((pg, p) => pg.groups.forEach((g, gi) => {
    items.push({ label: pages().length > 1 ? `${pg.name} › ${g.name}` : g.name, run: () => run(p, gi) });
  }));
  return items.length ? items : [{ label: 'Групп пока нет', enabled: false }];
}

function moveApp(id, p, gi, beforeId) {
  for (const pg of pages()) for (const g of pg.groups) g.apps = g.apps.filter((x) => x !== id);
  const list = pages()[p].groups[gi].apps;
  const at = beforeId ? list.indexOf(beforeId) : -1;
  list.splice(at >= 0 ? at : list.length, 0, id);
  saveLayout();
}

function tileMenu(app) {
  const where = locate(app.id);
  const edit = !start.locked;
  const items = [{ label: app.name, enabled: false }, { type: 'separator' }, { label: 'Открыть', run: () => dock.startLaunch(app.id) }];
  if (where) {
    items.push({ label: 'Переместить в группу', enabled: edit, submenu: groupTargets((p, gi) => moveApp(app.id, p, gi)) });
    items.push({ label: 'Убрать из группы', enabled: edit, run: () => { const g = pages()[where[0]].groups[where[1]]; g.apps = g.apps.filter((x) => x !== app.id); saveLayout(); } });
  } else {
    items.push({ label: 'Добавить в группу', enabled: edit, submenu: groupTargets((p, gi) => moveApp(app.id, p, gi)) });
  }
  items.push({ type: 'separator' },
    { label: 'Закрепить на панели', run: () => dock.startPinDock(app.id) },
    { label: 'Расположение файла', run: () => dock.startReveal(app.id) });
  showCtx(items);
}

// Меню пустого места — как на скриншоте: создать, удалить, зафиксировать, обновить значки
function backgroundMenu() {
  const edit = !start.locked;
  const groups = curGroups();
  showCtx([
    { label: 'Создать', enabled: edit, submenu: [
      { label: 'Группа', run: addGroup },
      { label: 'Страница', run: addPage },
    ] },
    { label: 'Удалить', enabled: edit, submenu: [
      ...groups.map((g, gi) => ({ label: `Группа «${g.name}»`, run: () => { groups.splice(gi, 1); saveLayout(); } })),
      ...(pages().length > 1 ? [{ type: 'separator' }, { label: `Страница «${pages()[page].name}»`, run: deletePage }] : []),
      ...(!groups.length && pages().length < 2 ? [{ label: 'Нечего удалять', enabled: false }] : []),
    ] },
    { label: 'Переименовать', enabled: edit, submenu: [
      ...groups.map((g, gi) => ({ label: `Группа «${g.name}»`, run: () => renameGroup(gi) })),
      { label: `Страница «${pages()[page].name}»`, run: () => renamePage(page) },
    ] },
    { type: 'separator' },
    { label: 'Импортировать из «Пуска» Windows', enabled: edit, run: importWindows },
    { type: 'separator' },
    { label: 'Зафиксировать меню', type: 'checkbox', checked: start.locked, run: () => { start.locked = !start.locked; saveLayout(); } },
    { label: 'Обновить значки', run: () => dock.startRefreshIcons() },
  ]);
}

// Закреплённые из «Пуска» Windows — отдельной группой «Пуск Windows» на текущей странице.
// Повторный импорт обновляет эту же группу, а не создаёт новую.
const WIN_GROUP = 'Пуск Windows';
async function importWindows() {
  const r = await dock.startImportWindows();
  if (!r.ids.length) return;
  let g = curGroups().find((x) => x.name === WIN_GROUP);
  if (!g) { g = { name: WIN_GROUP, apps: [] }; curGroups().push(g); }
  g.apps = r.ids;
  saveLayout();
  return r;
}

function groupMenu(gi) {
  const groups = curGroups();
  const edit = !start.locked;
  showCtx([
    { label: groups[gi].name, enabled: false },
    { type: 'separator' },
    { label: 'Переименовать', enabled: edit, run: () => renameGroup(gi) },
    { label: 'Выше', enabled: edit && gi > 0, run: () => { groups.splice(gi - 1, 0, groups.splice(gi, 1)[0]); saveLayout(); } },
    { label: 'Ниже', enabled: edit && gi < groups.length - 1, run: () => { groups.splice(gi + 1, 0, groups.splice(gi, 1)[0]); saveLayout(); } },
    { label: 'Перенести на страницу', enabled: edit && pages().length > 1, submenu: pages().map((pg, p) => ({
      label: pg.name, enabled: p !== page, run: () => { pages()[p].groups.push(groups.splice(gi, 1)[0]); saveLayout(); },
    })) },
    { type: 'separator' },
    { label: 'Удалить группу', enabled: edit, run: () => { groups.splice(gi, 1); saveLayout(); } },
  ]);
}

function pageMenu(p) {
  const edit = !start.locked;
  showCtx([
    { label: pages()[p].name, enabled: false },
    { type: 'separator' },
    { label: 'Переименовать', enabled: edit, run: () => renamePage(p) },
    { label: 'Левее', enabled: edit && p > 0, run: () => { pages().splice(p - 1, 0, pages().splice(p, 1)[0]); page = p - 1; saveLayout(); } },
    { label: 'Правее', enabled: edit && p < pages().length - 1, run: () => { pages().splice(p + 1, 0, pages().splice(p, 1)[0]); page = p + 1; saveLayout(); } },
    { type: 'separator' },
    { label: 'Удалить страницу', enabled: edit && pages().length > 1, run: () => { page = p; deletePage(); } },
  ]);
}

function addGroup() {
  curGroups().push({ name: 'Новая группа', apps: [] });
  saveLayout();
  renameGroup(curGroups().length - 1);
}

function addPage() {
  pages().push({ name: 'Страница ' + (pages().length + 1), groups: [{ name: 'Новая группа', apps: [] }] });
  page = pages().length - 1;
  saveLayout();
  renamePage(page);
}

function deletePage() {
  if (pages().length < 2) return;
  pages().splice(page, 1);
  page = Math.max(0, page - 1);
  saveLayout();
}

// Переименование прямо на месте: вместо заголовка — поле ввода
let renaming = false;
function inlineEdit(el, value, done) {
  renaming = true;
  const input = Object.assign(document.createElement('input'), { className: 's-rename', value });
  el.replaceWith(input);
  input.focus();
  input.select();
  let finished = false;
  const finish = (ok) => {
    if (finished) return;
    finished = true;
    renaming = false;
    if (ok && input.value.trim()) done(input.value.trim());
    else renderHome();
  };
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') finish(true);
    if (e.key === 'Escape') finish(false);
  });
  input.addEventListener('blur', () => finish(true));
}
function renameGroup(gi) {
  const el = document.querySelectorAll('.s-group-name')[gi];
  if (el) inlineEdit(el, curGroups()[gi].name, (v) => { curGroups()[gi].name = v; saveLayout(); });
}
function renamePage(p) {
  const el = document.querySelectorAll('.s-tab')[p];
  if (el) inlineEdit(el, pages()[p].name, (v) => { pages()[p].name = v; saveLayout(); });
}

async function openStart() {
  const cfg = await dock.config();
  start = await dock.startData();
  $('#sUser').textContent = start.user;
  $('#sAvatar').textContent = (start.user || '?')[0].toUpperCase();
  $('#sQuery').value = '';
  showStartView(cfg.widgetOpts.start.view === 'all' ? 'all' : 'home');
  setTimeout(() => $('#sQuery').focus(), 30);
}

function showStartView(view) {
  startView = view;
  const searching = $('#sQuery').value.trim() !== '';
  $('#sHome').classList.toggle('hidden', searching || view !== 'home');
  $('#sAllView').classList.toggle('hidden', searching || view !== 'all');
  $('#sResults').classList.toggle('hidden', !searching);
  if (searching) renderResults();
  else if (view === 'home') renderHome();
  else renderAll();
  $('#sScroll').scrollTop = 0;
  requestAnimationFrame(() => { $('#sScroll').scrollTop = 0; });
}

// Главная: вкладки-страницы и группы с плитками. Плитки перетаскиваются внутри группы и между группами.
let tileDrag = null;
function renderHome() {
  if (renaming || !pages().length) return;
  page = Math.min(page, pages().length - 1);

  const tabs = $('#sTabs');
  tabs.innerHTML = '';
  if (pages().length > 1) {
    pages().forEach((pg, p) => {
      const t = Object.assign(document.createElement('button'), { className: 's-tab' + (p === page ? ' on' : ''), textContent: pg.name });
      t.addEventListener('click', () => { page = p; renderHome(); });
      t.addEventListener('dblclick', () => { if (!start.locked) renamePage(p); });
      t.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); pageMenu(p); });
      // Плитку можно бросить на вкладку — она уйдёт в первую группу той страницы
      t.addEventListener('dragover', (e) => { if (tileDrag) { e.preventDefault(); t.classList.add('over'); } });
      t.addEventListener('dragleave', () => t.classList.remove('over'));
      t.addEventListener('drop', (e) => {
        e.preventDefault();
        if (!pages()[p].groups.length) pages()[p].groups.push({ name: 'Новая группа', apps: [] });
        moveApp(tileDrag, p, 0);
      });
      tabs.appendChild(t);
    });
  } else {
    tabs.appendChild(Object.assign(document.createElement('span'), { className: 's-tab-title', textContent: pages()[0].name }));
    tabs.lastChild.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); pageMenu(0); });
  }

  const box = $('#sGroups');
  box.innerHTML = '';
  curGroups().forEach((g, gi) => {
    const sec = document.createElement('div');
    sec.className = 's-group';
    const head = document.createElement('div');
    head.className = 's-group-head';
    head.appendChild(Object.assign(document.createElement('span'), { className: 's-group-name', textContent: g.name }));
    head.addEventListener('dblclick', () => { if (!start.locked) renameGroup(gi); });
    head.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); groupMenu(gi); });
    const grid = document.createElement('div');
    grid.className = 's-grid';
    const apps = g.apps.map(findApp).filter(Boolean);
    for (const app of apps) {
      const b = appButton(app, 's-tile');
      b.draggable = !start.locked;
      b.addEventListener('dragstart', () => { tileDrag = app.id; b.classList.add('dragging'); });
      b.addEventListener('dragend', () => { tileDrag = null; b.classList.remove('dragging'); });
      b.addEventListener('dragover', (e) => { if (tileDrag && tileDrag !== app.id) { e.preventDefault(); e.stopPropagation(); b.classList.add('drop-before'); } });
      b.addEventListener('dragleave', () => b.classList.remove('drop-before'));
      b.addEventListener('drop', (e) => { e.preventDefault(); e.stopPropagation(); moveApp(tileDrag, page, gi, app.id); });
      grid.appendChild(b);
    }
    if (!apps.length) {
      grid.appendChild(Object.assign(document.createElement('div'), {
        className: 's-drop', textContent: start.locked ? 'Пусто' : 'Перетащите сюда плитки или добавьте из «Все приложения» (правый клик → «Добавить в группу»)',
      }));
    }
    // Бросили на группу, мимо плиток — в конец группы
    sec.addEventListener('dragover', (e) => { if (tileDrag) { e.preventDefault(); sec.classList.add('over'); } });
    sec.addEventListener('dragleave', (e) => { if (!sec.contains(e.relatedTarget)) sec.classList.remove('over'); });
    sec.addEventListener('drop', (e) => { e.preventDefault(); moveApp(tileDrag, page, gi); });
    sec.append(head, grid);
    box.appendChild(sec);
  });
  if (!curGroups().length) {
    box.appendChild(Object.assign(document.createElement('div'), { className: 's-empty', textContent: 'На этой странице нет групп' }));
  }
  $('#sHintLine').classList.toggle('hidden', start.locked);
}

// Правый клик по пустому месту «Пуска»
$('#sScroll').addEventListener('contextmenu', (e) => {
  if (startView !== 'home' || $('#sQuery').value.trim()) return;
  e.preventDefault();
  backgroundMenu();
});

// Все приложения — по алфавиту, с буквами-разделителями
function renderAll() {
  const box = $('#sList');
  box.innerHTML = '';
  let letter = '';
  for (const app of start.apps) {
    const ch = app.name.trim()[0].toUpperCase();
    const l = /[A-ZА-ЯЁ]/.test(ch) ? ch : '#';
    if (l !== letter) {
      letter = l;
      box.appendChild(Object.assign(document.createElement('div'), { className: 's-letter-head', textContent: l }));
    }
    box.appendChild(appButton(app, 's-row'));
  }
}

// Поиск: сначала совпадения с начала названия или слова, потом остальные
function renderResults() {
  const q = $('#sQuery').value.trim().toLowerCase();
  const score = (n) => {
    n = n.toLowerCase();
    if (n.startsWith(q)) return 0;
    if (n.split(/[\s\-_.]+/).some((w) => w.startsWith(q))) return 1;
    return n.includes(q) ? 2 : 9;
  };
  results = start.apps.map((a) => [score(a.name), a]).filter(([s]) => s < 9).sort((x, y) => x[0] - y[0]).map(([, a]) => a).slice(0, 40);
  selected = 0;
  const box = $('#sResults');
  box.innerHTML = '';
  results.forEach((app, i) => {
    const b = appButton(app, 's-row' + (i === 0 ? ' sel' : ''));
    if (i === 0) b.appendChild(Object.assign(document.createElement('span'), { className: 's-hint', textContent: 'Enter' }));
    box.appendChild(b);
  });
  // Ничего не нашли — предлагаем поиск Windows
  const win = document.createElement('button');
  win.className = 's-row';
  win.innerHTML = '<span class="s-letter" style="background:linear-gradient(135deg,#3a3a3c,#636366)">⌕</span>';
  win.appendChild(Object.assign(document.createElement('span'), { textContent: `Искать «${$('#sQuery').value.trim()}» в Windows` }));
  win.addEventListener('click', () => dock.startOpen('search'));
  box.appendChild(win);
}

$('#sQuery').addEventListener('input', () => showStartView(startView));
$('#sQuery').addEventListener('keydown', (e) => {
  const rows = [...$('#sResults').querySelectorAll('.s-row')];
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    if (!rows.length) return;
    e.preventDefault();
    rows[selected].classList.remove('sel');
    selected = (selected + (e.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length;
    rows[selected].classList.add('sel');
    rows[selected].scrollIntoView({ block: 'nearest' });
  }
  if (e.key === 'Enter' && rows[selected]) rows[selected].click();
});
$('#sAll').addEventListener('click', () => showStartView('all'));
$('#sBack').addEventListener('click', () => showStartView('home'));
$('#sPower').addEventListener('click', () => dock.powerMenu());
document.querySelectorAll('.s-actions [data-open]').forEach((b) => b.addEventListener('click', () => dock.startOpen(b.dataset.open)));
// Печать в любом месте меню попадает в поиск
document.addEventListener('keydown', (e) => {
  if (panelMode !== 'start' || e.target.tagName === 'INPUT' || e.ctrlKey || e.altKey || e.key.length !== 1) return;
  $('#sQuery').focus();
});
dock.onStartUpdated(async () => {
  if (panelMode !== 'start' || renaming) return;
  start = await dock.startData();
  showStartView(startView);
});

// ---------- Плеер и текст песни ----------

const PLAY = '<path d="M8 5.5v13l11-6.5z"/>';
const PAUSE = '<path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"/>';
let media = null;
let lyricsFor = '';
let synced = null;   // [{t: секунды, text}] или null

const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

function showMedia(m) {
  media = m;
  if (!m || !m.active) {
    $('#pTitle').textContent = 'Ничего не играет';
    $('#pArtist').textContent = '';
    $('#lyrics').innerHTML = '';
    return;
  }
  $('#pTitle').textContent = m.title;
  $('#pArtist').textContent = m.artist || '';
  $('#pPP').innerHTML = m.playing ? PAUSE : PLAY;
  if (m.thumb !== undefined) $('#pCover').style.backgroundImage = m.thumb ? `url("${m.thumb}")` : '';
  $('#pProgress').classList.toggle('hidden', !m.dur);
  const key = `${m.artist}|${m.title}`;
  if (key !== lyricsFor) loadLyrics(m, key);
}

// Текущая позиция: плеер сообщает её изредка, досчитываем по времени
function position() {
  if (!media || !media.dur) return 0;
  const p = media.pos + (media.playing ? (Date.now() - media.posAt) / 1000 : 0);
  return Math.min(Math.max(p, 0), media.dur);
}

// Тексты — из той же открытой базы LRCLIB, которой пользуется Island
async function loadLyrics(m, key) {
  lyricsFor = key;
  synced = null;
  const box = $('#lyrics');
  box.className = 'lyrics';
  box.innerHTML = '<div class="l-msg">Ищу текст песни…</div>';
  try {
    const q = new URLSearchParams({ artist_name: m.artist || '', track_name: m.title });
    if (m.dur) q.set('duration', Math.round(m.dur));
    let r = await fetch('https://lrclib.net/api/get?' + q);
    let d = r.ok ? await r.json() : null;
    if (!d) {
      const s = await (await fetch('https://lrclib.net/api/search?' + new URLSearchParams({ q: `${m.artist || ''} ${m.title}` }))).json();
      d = s.find((x) => x.syncedLyrics) || s[0];
    }
    if (lyricsFor !== key) return;
    if (!d || (!d.syncedLyrics && !d.plainLyrics)) {
      box.innerHTML = `<div class="l-msg">${d && d.instrumental ? 'Инструментальная композиция' : 'Текст не найден'}</div>`;
      return;
    }
    box.innerHTML = '';
    if (d.syncedLyrics) {
      synced = d.syncedLyrics.split('\n').map((l) => {
        const mm = l.match(/^\[(\d+):(\d+(?:\.\d+)?)\]\s*(.*)$/);
        return mm ? { t: +mm[1] * 60 + +mm[2], text: mm[3] || '♪' } : null;
      }).filter(Boolean);
      for (const l of synced) box.appendChild(Object.assign(document.createElement('div'), { className: 'line', textContent: l.text }));
    } else {
      box.classList.add('plain');
      for (const l of d.plainLyrics.split('\n')) box.appendChild(Object.assign(document.createElement('div'), { className: 'line', textContent: l || ' ' }));
    }
  } catch {
    if (lyricsFor === key) box.innerHTML = '<div class="l-msg">Нет связи с сервером текстов</div>';
  }
}

let nowLine = -1;
setInterval(() => {
  if (!media || !media.dur || $('#media').classList.contains('hidden')) return;
  const p = position();
  $('#pFill').style.width = (100 * p / media.dur) + '%';
  $('#pPos').textContent = fmt(p);
  $('#pDur').textContent = fmt(media.dur);
  if (!synced) return;
  let i = synced.findIndex((l) => l.t > p) - 1;
  if (i === -2) i = synced.length - 1;
  if (i === nowLine) return;
  nowLine = i;
  const lines = $('#lyrics').children;
  for (let k = 0; k < lines.length; k++) lines[k].classList.toggle('now', k === i);
  if (lines[i]) $('#lyrics').scrollTop = lines[i].offsetTop - $('#lyrics').offsetTop - 80;
}, 300);

document.querySelectorAll('.p-ctl button').forEach((b) => b.addEventListener('click', () => dock.key(b.dataset.key)));
$('#pOpen').addEventListener('click', () => { dock.openPlayer(); dock.closePanel(); });
dock.onMedia((m) => {
  if ($('#media').classList.contains('hidden')) { media = m; return; }
  showMedia(m);
  if (mediaTab === 'sources') renderSources();
});

// Текст песни и список источников скрыты, пока их не откроют кнопками.
// Окно при этом вырастает вверх, а при закрытии возвращается к прежней высоте.
let mediaTab = null;
let mediaBaseHeight = 0;
function setMediaTab(tab) {
  mediaTab = mediaTab === tab ? null : tab;
  $('#lyrics').classList.toggle('hidden', mediaTab !== 'lyrics');
  $('#sources').classList.toggle('hidden', mediaTab !== 'sources');
  $('#pLyricsBtn').classList.toggle('on', mediaTab === 'lyrics');
  $('#pSourcesBtn').classList.toggle('on', mediaTab === 'sources');
  if (mediaTab && window.innerHeight < 500) dock.panelHeight(520);
  if (!mediaTab) dock.panelHeight(mediaBaseHeight);
  if (mediaTab === 'sources') renderSources();
  if (mediaTab === 'lyrics') nowLine = -1;
}
$('#pLyricsBtn').addEventListener('click', () => setMediaTab('lyrics'));
$('#pSourcesBtn').addEventListener('click', () => setMediaTab('sources'));

const SMALL_PLAY = '<svg viewBox="0 0 24 24"><path d="M8 5.5v13l11-6.5z"/></svg>';
const SMALL_PAUSE = '<svg viewBox="0 0 24 24"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"/></svg>';

async function renderSources() {
  const list = await dock.mediaSources();
  const box = $('#sources');
  box.innerHTML = '';
  if (!list.length) { box.innerHTML = '<div class="l-msg">Сейчас ничего не играет</div>'; return; }
  for (const s of list) {
    const row = document.createElement('div');
    row.className = 'src' + (media && media.source === s.source ? ' sel' : '');
    row.title = 'Показывать на панели';
    const ico = s.icon
      ? Object.assign(document.createElement('img'), { src: s.icon })
      : Object.assign(document.createElement('span'), { className: 'src-ico', textContent: s.name[0] });
    const txt = document.createElement('div');
    txt.className = 'src-txt';
    txt.append(Object.assign(document.createElement('div'), { className: 'src-name', textContent: s.name }),
      Object.assign(document.createElement('div'), { className: 'src-sub', textContent: [s.title, s.artist].filter(Boolean).join(' — ') || 'Нет данных' }));
    row.append(ico, txt);
    if (s.playing) row.insertAdjacentHTML('beforeend', '<span class="eq"><i></i><i></i><i></i></span>');
    const pp = Object.assign(document.createElement('button'), { className: 'ibtn', title: s.playing ? 'Пауза' : 'Играть', innerHTML: s.playing ? SMALL_PAUSE : SMALL_PLAY });
    pp.addEventListener('click', (e) => { e.stopPropagation(); dock.mediaCtl('playpause', s.source); });
    row.appendChild(pp);
    // Клик по строке — этот источник показывается на панели и в плеере
    row.addEventListener('click', () => { dock.mediaSelect(s.source); });
    box.appendChild(row);
  }
}

// ---------- Погода ----------

const DOW_SHORT = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];

async function loadWeather() {
  const { weather: w } = await dock.config();
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${w.lat}&longitude=${w.lon}&timezone=auto&forecast_days=7` +
      '&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code,is_day' +
      '&hourly=temperature_2m,weather_code,is_day&daily=weather_code,temperature_2m_max,temperature_2m_min';
    const d = await (await fetch(url)).json();
    const c = d.current;
    $('#wNowIcon').innerHTML = weatherIcon(c.weather_code, c.is_day);
    $('#wNowTemp').textContent = `${Math.round(c.temperature_2m)}°`;
    $('#wNowDesc').textContent = `${weatherText(c.weather_code)} · ${w.city}`;
    $('#wMeta').innerHTML = '';
    for (const t of [`Ощущается как ${Math.round(c.apparent_temperature)}°`, `Ветер ${Math.round(c.wind_speed_10m / 3.6)} м/с`, `Влажность ${c.relative_humidity_2m}%`]) {
      $('#wMeta').appendChild(Object.assign(document.createElement('span'), { textContent: t }));
    }

    const start = d.hourly.time.findIndex((t) => new Date(t) > new Date()) - 1;
    $('#wHours').innerHTML = '';
    // Часов показываем столько, сколько помещается по ширине окна
    const hours = Math.max(3, Math.min(24, Math.floor($('#wHours').clientWidth / 50)));
    for (let k = Math.max(start, 0); k < Math.max(start, 0) + hours; k++) {
      const h = document.createElement('div');
      h.className = 'h';
      h.innerHTML = `<span>${k === start ? 'Сейчас' : d.hourly.time[k].slice(11, 16)}</span><svg viewBox="0 0 24 24">${weatherIcon(d.hourly.weather_code[k], d.hourly.is_day[k])}</svg><span>${Math.round(d.hourly.temperature_2m[k])}°</span>`;
      $('#wHours').appendChild(h);
    }

    const lo = Math.min(...d.daily.temperature_2m_min), hi = Math.max(...d.daily.temperature_2m_max);
    $('#wDays').innerHTML = '';
    d.daily.time.forEach((t, k) => {
      const min = d.daily.temperature_2m_min[k], max = d.daily.temperature_2m_max[k];
      const row = document.createElement('div');
      row.className = 'd';
      const left = (100 * (min - lo)) / (hi - lo || 1), right = 100 - (100 * (max - lo)) / (hi - lo || 1);
      row.innerHTML = `<span>${k === 0 ? 'Сегодня' : DOW_SHORT[new Date(t).getDay()]}</span><svg viewBox="0 0 24 24">${weatherIcon(d.daily.weather_code[k])}</svg>` +
        `<span class="range-bar"><span class="min">${Math.round(min)}°</span><span class="bar"><i style="left:${left}%;right:${right}%"></i></span><span>${Math.round(max)}°</span></span>`;
      $('#wDays').appendChild(row);
    });
  } catch {
    $('#wNowDesc').textContent = 'Нет связи с сервером погоды';
  }
}

// ---------- Календарь ----------

let shown = new Date();
shown.setDate(1);

function renderCalendar() {
  const today = new Date();
  const y = shown.getFullYear(), m = shown.getMonth();
  $('#month').textContent = shown.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' }).replace(' г.', '');

  // Сетка 6x7, неделя с понедельника
  const offset = (new Date(y, m, 1).getDay() + 6) % 7;
  const start = new Date(y, m, 1 - offset);
  const box = $('#days');
  box.innerHTML = '';
  for (let i = 0; i < 42; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    const el = document.createElement('span');
    el.textContent = d.getDate();
    if (d.getMonth() !== m) el.classList.add('other');
    if (i % 7 >= 5) el.classList.add('weekend');
    if (d.toDateString() === today.toDateString()) el.classList.add('today');
    box.appendChild(el);
  }

  const dayOfYear = Math.floor((today - new Date(today.getFullYear(), 0, 0)) / 864e5);
  const yearDays = new Date(today.getFullYear(), 1, 29).getMonth() === 1 ? 366 : 365;
  $('#today').textContent =
    today.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' }) +
    ` · день ${dayOfYear} из ${yearDays}`;
}

$('#prev').addEventListener('click', () => { shown.setMonth(shown.getMonth() - 1); renderCalendar(); });
$('#next').addEventListener('click', () => { shown.setMonth(shown.getMonth() + 1); renderCalendar(); });
$('#month').addEventListener('click', () => { shown = new Date(); shown.setDate(1); renderCalendar(); });

// ---------- Задачи ----------

let todos = [];

function renderTodos() {
  const list = $('#list');
  list.innerHTML = '';
  todos.forEach((t, i) => {
    const li = document.createElement('li');
    li.classList.toggle('done', t.done);
    const check = document.createElement('button');
    check.className = 'check';
    check.textContent = t.done ? '✓' : '';
    check.addEventListener('click', () => { todos[i].done = !todos[i].done; dock.setTodos(todos); });
    const text = document.createElement('span');
    text.className = 'text';
    text.textContent = t.text;
    const del = document.createElement('button');
    del.className = 'del';
    del.textContent = '×';
    del.title = 'Удалить';
    del.addEventListener('click', () => { todos.splice(i, 1); dock.setTodos(todos); });
    li.append(check, text, del);
    list.appendChild(li);
  });
  $('#empty').classList.toggle('hidden', todos.length > 0);
}

$('#add').addEventListener('submit', (e) => {
  e.preventDefault();
  const text = $('#newtodo').value.trim();
  if (!text) return;
  todos.push({ text, done: false });
  $('#newtodo').value = '';
  dock.setTodos(todos);
});

$('#clear').addEventListener('click', () => {
  todos = todos.filter((t) => !t.done);
  dock.setTodos(todos);
});

dock.onTodos((list) => { todos = list; renderTodos(); });
dock.todos().then((list) => { todos = list; renderTodos(); });
