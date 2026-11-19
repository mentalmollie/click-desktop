const $ = (s) => document.querySelector(s);
let cfg = null;

function save() {
  dock.setConfig(cfg);
  refreshPreview();
}

// ---------- Навигация ----------

document.querySelectorAll('#nav button').forEach((b) => b.addEventListener('click', () => {
  document.querySelectorAll('#nav button').forEach((x) => x.classList.toggle('active', x === b));
  document.querySelectorAll('.page').forEach((p) => p.classList.toggle('hidden', p.id !== 'page-' + b.dataset.page));
  $('main').scrollTop = 0;
  if (b.dataset.page === 'island') refreshIslandState();
  refreshPreview();
}));

function switchEl(checked, onChange) {
  const label = document.createElement('label');
  label.className = 'switch';
  label.innerHTML = '<input type="checkbox"><span></span>';
  const input = label.querySelector('input');
  input.checked = checked;
  input.addEventListener('change', () => onChange(input.checked));
  return label;
}

// ---------- Живое превью панели ----------

let previewTimer = null;
function refreshPreview() {
  clearTimeout(previewTimer);
  // Даём доку перестроиться, потом снимаем его
  previewTimer = setTimeout(async () => {
    const url = await dock.preview();
    if (url) document.querySelectorAll('#preview, .preview-img').forEach((img) => { img.src = url; });
  }, 450);
}

// ---------- Панель (внешний вид) ----------

function renderLook() {
  const a = cfg.appearance;
  $('#scale').value = a.scale;
  $('#scaleVal').textContent = Math.round(a.scale * 100) + '%';
  $('#bgTransparency').value = a.bgTransparency;
  $('#bgTransparencyVal').textContent = Math.round(a.bgTransparency * 100) + '%';
  $('#blur').checked = a.blur;
  $('#margin').value = a.margin;
  $('#marginVal').textContent = a.margin + ' px';
  $('#onTop').checked = a.alwaysOnTop;
  $('#autoHide').checked = !!a.autoHide;
  $('#autoHideDelayRow').classList.toggle('hidden', !a.autoHide);
  document.querySelectorAll('#autoHideDelay button').forEach((b) => b.classList.toggle('on', +b.dataset.v === (a.autoHideDelay || 700)));
  document.querySelectorAll('#position button').forEach((b) => b.classList.toggle('on', b.dataset.v === a.position));
  document.querySelectorAll('#widthMode button').forEach((b) => b.classList.toggle('on', b.dataset.v === a.width));
  renderLayout();
}

// ---------- Расположение значков ----------

function renderLayout() {
  const a = cfg.appearance;
  const box = $('#layoutChips');
  box.innerHTML = '';
  for (const [v, label] of LAYOUTS) {
    const chip = Object.assign(document.createElement('button'), { className: 'chip', textContent: label });
    chip.classList.toggle('off', !(a.width === 'full' && a.layout === v));
    chip.addEventListener('click', () => {
      // Своё расположение начинаем с того, что пользователь видит сейчас
      if (v === 'custom' && a.layout !== 'custom') {
        for (const k of cfg.widgetOrder) cfg.layoutZones[k] = zoneOf(k, a.width === 'full' ? a.layout : 'center', cfg.layoutZones);
      }
      a.layout = v;
      a.width = 'full';
      save();
      renderLook();
    });
    box.appendChild(chip);
  }
  renderZoneEditor();
}

let zoneDrag = null;

function renderZoneEditor() {
  const a = cfg.appearance;
  $('#layoutEditor').classList.toggle('disabled', !(a.width === 'full' && a.layout === 'custom'));
  for (const col of document.querySelectorAll('.zone-col')) col.querySelector('.zone-items').innerHTML = '';
  for (const k of cfg.widgetOrder) {
    const zone = zoneOf(k, 'custom', cfg.layoutZones);
    const item = Object.assign(document.createElement('div'), { className: 'zone-item', textContent: BLOCK_LABELS[k], draggable: true });
    if (cfg.widgets[k] === false) { item.classList.add('off'); item.title = 'Виджет выключен'; }
    item.dataset.key = k;
    item.addEventListener('dragstart', (e) => { zoneDrag = k; item.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; });
    item.addEventListener('dragend', () => { zoneDrag = null; item.classList.remove('dragging'); });
    document.querySelector(`.zone-col[data-zone="${zone}"] .zone-items`).appendChild(item);
  }
}

for (const col of document.querySelectorAll('.zone-col')) {
  col.addEventListener('dragover', (e) => {
    if (!zoneDrag) return;
    e.preventDefault();
    col.classList.add('over');
    document.querySelectorAll('.zone-item.drop-before').forEach((x) => x.classList.remove('drop-before'));
    const before = [...col.querySelectorAll('.zone-item')].find((x) => x.dataset.key !== zoneDrag && e.clientY < x.getBoundingClientRect().top + x.offsetHeight / 2);
    if (before) before.classList.add('drop-before');
  });
  col.addEventListener('dragleave', (e) => { if (!col.contains(e.relatedTarget)) col.classList.remove('over'); });
  col.addEventListener('drop', (e) => {
    e.preventDefault();
    col.classList.remove('over');
    const before = col.querySelector('.zone-item.drop-before');
    if (before) before.classList.remove('drop-before');
    const key = zoneDrag;
    if (!key) return;
    cfg.layoutZones[key] = col.dataset.zone;
    const order = cfg.widgetOrder.filter((k) => k !== key);
    if (before) order.splice(order.indexOf(before.dataset.key), 0, key);
    else {
      const inZone = order.filter((k) => zoneOf(k, 'custom', cfg.layoutZones) === col.dataset.zone);
      order.splice(inZone.length ? order.indexOf(inZone[inZone.length - 1]) + 1 : order.length, 0, key);
    }
    cfg.widgetOrder = order;
    save();
    renderZoneEditor();
  });
}

document.querySelectorAll('#widthMode button').forEach((b) => b.addEventListener('click', () => {
  cfg.appearance.width = b.dataset.v;
  save();
  renderLook();
}));

let lookTimer = null;
$('#blur').addEventListener('change', (e) => { cfg.appearance.blur = e.target.checked; save(); });
for (const key of ['scale', 'bgTransparency', 'margin']) {
  $('#' + key).addEventListener('input', (e) => {
    cfg.appearance[key] = +e.target.value;
    renderLook();
    clearTimeout(lookTimer);
    lookTimer = setTimeout(save, 120);
  });
}
$('#onTop').addEventListener('change', (e) => { cfg.appearance.alwaysOnTop = e.target.checked; save(); });
$('#autoHide').addEventListener('change', (e) => { cfg.appearance.autoHide = e.target.checked; save(); renderLook(); });
document.querySelectorAll('#autoHideDelay button').forEach((b) => b.addEventListener('click', () => {
  cfg.appearance.autoHideDelay = +b.dataset.v;
  save();
  renderLook();
}));
document.querySelectorAll('#position button').forEach((b) => b.addEventListener('click', () => {
  cfg.appearance.position = b.dataset.v;
  renderLook();
  save();
}));

// ---------- Закреплённые приложения ----------

let dragFrom = null;

async function renderApps() {
  const box = $('#appList');
  box.innerHTML = '';
  if (!cfg.apps.length) {
    box.innerHTML = '<div class="app-row"><span class="desc">Пока пусто — добавьте приложение кнопкой ниже</span></div>';
    return;
  }
  for (const [i, a] of cfg.apps.entries()) {
    const row = document.createElement('div');
    row.className = 'app-row';
    row.draggable = true;

    const grip = Object.assign(document.createElement('span'), { className: 'grip', textContent: '⋮⋮' });
    const icon = await dock.icon(a.icon || a.path);
    const img = icon
      ? Object.assign(document.createElement('img'), { src: icon })
      : Object.assign(document.createElement('span'), { className: 'noicon', textContent: (a.name || '?')[0] });

    const info = document.createElement('div');
    info.className = 'app-info';
    const name = Object.assign(document.createElement('input'), { value: a.name, title: 'Название (подсказка при наведении)' });
    name.addEventListener('change', () => { a.name = name.value.trim() || a.name; save(); });
    name.addEventListener('mousedown', () => { row.draggable = false; });
    name.addEventListener('blur', () => { row.draggable = true; });
    const p = Object.assign(document.createElement('div'), { className: 'path', textContent: a.path + (a.args ? ' ' + a.args.join(' ') : '') });
    p.title = p.textContent;
    info.append(name, p);

    const capToggle = document.createElement('div');
    capToggle.className = 'cap-toggle';
    capToggle.append('В капсуле', switchEl(a.capsule, (v) => { a.capsule = v; save(); }));

    const del = Object.assign(document.createElement('button'), { className: 'icon-btn', textContent: '✕', title: 'Убрать с панели' });
    del.addEventListener('click', () => { cfg.apps.splice(i, 1); save(); renderApps(); });

    row.append(grip, img, info, capToggle, del);

    row.addEventListener('dragstart', (e) => { dragFrom = i; row.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; });
    row.addEventListener('dragend', () => row.classList.remove('dragging'));
    row.addEventListener('dragover', (e) => {
      e.preventDefault();
      const after = e.offsetY > row.offsetHeight / 2;
      row.classList.toggle('drop-after', after);
      row.classList.toggle('drop-before', !after);
    });
    row.addEventListener('dragleave', () => row.classList.remove('drop-after', 'drop-before'));
    row.addEventListener('drop', (e) => {
      e.preventDefault();
      const after = row.classList.contains('drop-after');
      row.classList.remove('drop-after', 'drop-before');
      if (dragFrom === null || dragFrom === i) return;
      const [moved] = cfg.apps.splice(dragFrom, 1);
      let to = i + (after ? 1 : 0);
      if (dragFrom < to) to--;
      cfg.apps.splice(to, 0, moved);
      dragFrom = null;
      save();
      renderApps();
    });
    box.appendChild(row);
  }
}

$('#addApp').addEventListener('click', async () => {
  const picked = await dock.pickApps();
  if (!picked.length) return;
  cfg.apps.push(...picked);
  save();
  renderApps();
});

$('#detectApps').addEventListener('click', async () => {
  const found = await dock.detectApps();
  const have = new Set(cfg.apps.map((a) => a.path.toLowerCase()));
  const added = found.filter((a) => !have.has(a.path.toLowerCase()));
  added.forEach((a) => { a.capsule = true; });
  cfg.apps.push(...added);
  save();
  renderApps();
  $('#detectApps').textContent = added.length ? `Добавлено: ${added.length}` : 'Новых не найдено';
  setTimeout(() => { $('#detectApps').textContent = 'Найти установленные'; }, 2500);
});

// Переключатели виджетов, которые стоят на других страницах (открытые приложения, Island)
document.querySelectorAll('input[data-widget]').forEach((input) => input.addEventListener('change', () => {
  cfg.widgets[input.dataset.widget] = input.checked;
  save();
  renderWidgets();
}));

// ---------- Виджеты ----------

const WIDGETS = [
  ['start', 'Пуск', '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>', 'Клик — меню с поиском, закреплёнными и всеми приложениями'],
  ['system', 'Система', '<rect x="6" y="6" width="12" height="12" rx="2.5"/><path d="M9 2.5v3M15 2.5v3M9 18.5v3M15 18.5v3M2.5 9h3M2.5 15h3M18.5 9h3M18.5 15h3"/>', 'Клик — окно с процессором, ядрами, памятью и процессами'],
  ['openApps', 'Открытые приложения', '<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M3 9h18"/>', 'Клик — переключиться на окно, по активному — свернуть'],
  ['island', 'Island', '<rect x="3" y="8" width="18" height="8" rx="4" class="solid"/>', 'Кнопки функций острова'],
  ['media', 'Музыка', '<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>', 'Клик — плеер с текстом песни'],
  ['social', 'Соцсети', '<circle cx="9" cy="8.5" r="3.2"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0M16 5.8a3 3 0 0 1 0 5.6M17.5 14.2a5 5 0 0 1 3 4.8"/>', 'Подписчики; клик — подробности с графиком'],
  ['tasks', 'Задачи', '<path d="M4 6l2 2 3-3M4 13l2 2 3-3M12 7h8M12 14h8"/>', 'Клик — список задач'],
  ['disk', 'Диски', '<ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6"/>', 'Клик — окно со всеми дисками'],
  ['pomodoro', 'Помодоро', '<circle cx="12" cy="13" r="7.5"/><path d="M12 9.5V13l2.5 2M9.5 3h5"/>', 'Клик — старт/пауза, правый клик — сброс'],
  ['tray', 'Скрытые значки', '<path d="M6.5 14.5 12 9l5.5 5.5"/>', 'Стрелка — значки трея, звук, сеть и уведомления'],
  ['clock', 'Часы и погода', '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>', 'Дата — календарь, время и погода — прогноз'],
];

let disksList = [];
const openCards = new Set();

function optionRow(w, o) {
  const row = document.createElement('div');
  row.className = 'row';
  row.innerHTML = '<div class="txt"><div class="name"></div></div>';
  row.querySelector('.name').textContent = o.label;
  const val = cfg.widgetOpts[w][o.key];
  const set = (v) => { cfg.widgetOpts[w][o.key] = v; save(); renderWidgets(); };
  if (o.type === 'toggle') {
    row.appendChild(switchEl(val, set));
  } else {
    const choices = o.type === 'drive'
      ? [['all', 'Все'], ...disksList.map((d) => [d.name, d.name])]
      : o.choices;
    const seg = document.createElement('div');
    seg.className = 'segmented';
    for (const [v, label] of choices) {
      const b = Object.assign(document.createElement('button'), { textContent: label });
      b.classList.toggle('on', v === val);
      b.addEventListener('click', () => set(v));
      seg.appendChild(b);
    }
    row.appendChild(seg);
  }
  return row;
}

function renderWidgets() {
  const box = $('#widgetChips');
  box.innerHTML = '';
  const cards = $('#widgetCards');
  cards.innerHTML = '';
  for (const [key, label, icon, desc] of WIDGETS) {
    const chip = document.createElement('button');
    chip.className = 'chip' + (cfg.widgets[key] ? '' : ' off');
    chip.innerHTML = `<svg viewBox="0 0 24 24">${icon}</svg>`;
    chip.append(label);
    chip.addEventListener('click', () => {
      cfg.widgets[key] = !cfg.widgets[key];
      save();
      renderWidgets();
    });
    box.appendChild(chip);

    // Карточка с настройками виджета
    const card = document.createElement('div');
    card.className = 'wcard' + (openCards.has(key) ? ' open' : '') + (cfg.widgets[key] ? '' : ' off');
    const head = document.createElement('div');
    head.className = 'wcard-head';
    head.innerHTML = `<span class="wicon"><svg viewBox="0 0 24 24">${icon}</svg></span><div class="txt"><div class="name"></div><div class="desc"></div></div>`;
    head.querySelector('.name').textContent = label;
    head.querySelector('.desc').textContent = desc;
    const sw = switchEl(cfg.widgets[key], (v) => { cfg.widgets[key] = v; save(); renderWidgets(); });
    sw.addEventListener('click', (e) => e.stopPropagation());
    head.append(sw);
    head.insertAdjacentHTML('beforeend', '<svg class="chev" viewBox="0 0 24 24"><path d="M6 9.5l6 6 6-6"/></svg>');
    head.addEventListener('click', () => {
      if (openCards.has(key)) openCards.delete(key); else openCards.add(key);
      card.classList.toggle('open');
    });
    const body = document.createElement('div');
    body.className = 'wcard-body';
    for (const o of [CAPSULE_STYLE, ...(WIDGET_OPTIONS[key] || [])]) body.appendChild(optionRow(key, o));
    card.append(head, body);
    cards.appendChild(card);
  }
  document.querySelectorAll('input[data-widget]').forEach((input) => { input.checked = cfg.widgets[input.dataset.widget]; });
}

$('#resetOrder').addEventListener('click', () => {
  cfg.widgetOrder = DEFAULT_ORDER.slice();
  save();
  renderLook();
});

// ---------- Island ----------

async function refreshIslandState() {
  const st = await dock.islandStatus();
  if (st.icon) $('#islandIcon').src = st.icon;
  $('#islandState').innerHTML = '';
  const dot = Object.assign(document.createElement('span'), { className: 'dot' + (st.running ? ' on' : '') });
  $('#islandState').append(dot, !st.installed ? 'Не найден: ' + cfg.island.path : st.running ? 'Запущен' : 'Не запущен');
  $('#islandLaunch').classList.toggle('hidden', !st.installed || st.running);
  $('#islandSettings').classList.toggle('hidden', !st.installed);
}
$('#islandLaunch').addEventListener('click', () => { dock.islandLaunch(); setTimeout(refreshIslandState, 2500); });
$('#islandSettings').addEventListener('click', () => dock.islandSettings());

function renderIsland() {
  const box = $('#islandChips');
  box.innerHTML = '';
  for (const [id, act] of Object.entries(ISLAND_ACTIONS)) {
    const on = cfg.island.actions.includes(id);
    const chip = document.createElement('button');
    chip.className = 'chip' + (on ? '' : ' off');
    chip.innerHTML = `<svg viewBox="0 0 24 24">${act.icon}</svg>`;
    chip.append(act.label);
    chip.addEventListener('click', () => {
      // Порядок кнопок — как в каталоге
      const set = new Set(cfg.island.actions);
      if (on) set.delete(id); else set.add(id);
      cfg.island.actions = Object.keys(ISLAND_ACTIONS).filter((k) => set.has(k));
      save();
      renderIsland();
    });
    box.appendChild(chip);
  }
  renderHotkeys();
}

const DEFAULT_HOTKEYS = {
  island: 'Ctrl+Alt+I', command: 'Alt+Space', chat: 'Ctrl+Alt+A', voice: 'Ctrl+Alt+D', record: 'Ctrl+Alt+R',
  screenshot: 'Ctrl+Alt+S', fullshot: 'Ctrl+Alt+Shift+S', ocr: 'Ctrl+Alt+O', clipboard: 'Ctrl+Alt+V', mic: 'Ctrl+Alt+M',
};
let recording = null;

function keysHtml(combo) {
  return combo.split('+').map((k) => `<kbd>${k === 'Shift' ? '⇧' : k}</kbd>`).join('');
}

function renderHotkeys() {
  const box = $('#hotkeys');
  box.innerHTML = '';
  for (const [id, act] of Object.entries(ISLAND_ACTIONS)) {
    const row = document.createElement('div');
    row.className = 'hk-row';
    row.appendChild(Object.assign(document.createElement('div'), { className: 'name', textContent: act.label }));
    const keys = document.createElement('button');
    keys.className = 'keys';
    keys.innerHTML = keysHtml(cfg.island.hotkeys[id]);
    keys.addEventListener('click', () => {
      if (recording) renderHotkeys();
      recording = { id, el: keys };
      keys.classList.add('rec');
      keys.textContent = 'Нажмите сочетание…';
    });
    row.appendChild(keys);
    box.appendChild(row);
  }
}

// Запись сочетания: модификаторы + одна клавиша; Esc — отмена, Backspace — стандартное
document.addEventListener('keydown', (e) => {
  if (!recording) return;
  e.preventDefault();
  const { id } = recording;
  if (e.key === 'Escape') { recording = null; return renderHotkeys(); }
  if (e.key === 'Backspace') {
    cfg.island.hotkeys[id] = DEFAULT_HOTKEYS[id];
    recording = null;
    save();
    return renderHotkeys();
  }
  if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return;
  let key = null;
  if (/^Key[A-Z]$/.test(e.code)) key = e.code.slice(3);
  else if (/^Digit\d$/.test(e.code)) key = e.code.slice(5);
  else if (/^F\d{1,2}$/.test(e.code)) key = e.code;
  else if (e.code === 'Space') key = 'Space';
  if (!key) return;
  const parts = [];
  if (e.ctrlKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  if (e.metaKey) parts.push('Win');
  parts.push(key);
  cfg.island.hotkeys[id] = parts.join('+');
  recording = null;
  save();
  renderHotkeys();
});

// ---------- Ассистент ----------

function renderAssistant() {
  const a = cfg.assistant;
  const p = assistantOf(cfg);
  renderBrain();
  renderVoice();
  renderSpotify();
  renderTypeSound();
  document.querySelectorAll('#asPersona button').forEach((b) => {
    b.classList.toggle('on', ASSISTANTS[b.dataset.v] === p);
    b.querySelector('span').textContent = ASSISTANTS[b.dataset.v].desc;
  });
  $('#asImg').src = p.dir + '/tip.png';
  $('#asName').textContent = p.name;
  $('#asHint').textContent = `Сидит на панели, следит за происходящим и помогает. Нажмите на ${p.female ? 'неё' : 'него'}, чтобы спросить; правый клик — меню; перетащите, чтобы пересадить`;
  $('#asEnabled').checked = a.enabled;
  $('#asSpeak').checked = a.speak;
  document.querySelectorAll('#asSize button').forEach((b) => b.classList.toggle('on', b.dataset.v === a.size));
  document.querySelectorAll('#asMode button').forEach((b) => b.classList.toggle('on', b.dataset.v === (a.mode || 'sit')));
  document.querySelectorAll('#asTalk button').forEach((b) => b.classList.toggle('on', b.dataset.v === a.talk));
  const box = $('#asReminders');
  box.innerHTML = '';
  if (!a.reminders.length) box.innerHTML = `<div class="app-row"><span class="desc">Пока нет. Скажите ${p.dat}: «напомни через 10 минут позвонить маме»</span></div>`;
  for (const r of a.reminders) {
    const row = document.createElement('div');
    row.className = 'app-row';
    const d = new Date(r.at);
    const when = d.toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    const info = document.createElement('div');
    info.className = 'app-info';
    info.append(Object.assign(document.createElement('div'), { className: 'name', textContent: r.text }),
      Object.assign(document.createElement('div'), { className: 'path', textContent: when }));
    const del = Object.assign(document.createElement('button'), { className: 'icon-btn', textContent: '✕', title: 'Удалить' });
    del.addEventListener('click', () => { a.reminders = a.reminders.filter((x) => x.id !== r.id); save(); renderAssistant(); });
    row.append(info, del);
    box.appendChild(row);
  }
}
// «Мозг»: сам ключ в окно настроек не возвращается — только маска вида sk-ant-…ab12
let brStatus = null;
const KEY_PREFIX = { anthropic: 'sk-ant-', gemini: 'AIza', groq: 'gsk_', openrouter: 'sk-or-' };
const BR_ERRORS = {
  nokey: 'Сначала сохраните ключ',
  auth: 'Ключ не подошёл',
  rate: 'Слишком много запросов, попробуйте через минуту',
  offline: 'Нет связи с сервисом',
  ollama: 'Ollama не запущена. Установите её с ollama.com и скачайте модель, например: ollama pull qwen3',
};
const brCfg = () => (cfg.assistant.brain = { enabled: true, provider: 'anthropic', model: 'claude-opus-5-5', models: {}, ...cfg.assistant.brain });

async function renderBrain() {
  const b = brCfg();
  $('#brEnabled').checked = b.enabled;
  const s = brStatus = await dock.brainStatus();
  const p = s.provider, info = s.providers[p];

  // Плитки сервисов
  const box = $('#brProvider');
  if (!box.children.length) {
    for (const [id, x] of Object.entries(s.providers)) {
      const btn = document.createElement('button');
      btn.dataset.v = id;
      btn.innerHTML = `<b></b><small class="${x.free ? 'free' : ''}">${x.local ? 'на этом ПК' : x.free ? 'бесплатно' : 'платно'}</small>`;
      btn.querySelector('b').textContent = x.name;
      btn.addEventListener('click', () => { brCfg().provider = id; save(); renderBrain(); });
      box.appendChild(btn);
    }
  }
  box.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x.dataset.v === p));

  // Ключ выбранного сервиса
  $('#brKeyRow').classList.toggle('hidden', !info.key);
  $('#brKeyName').textContent = `Ключ ${info.name}`;
  const st = $('#brKeyState');
  st.classList.remove('key-bad');
  st.classList.toggle('key-ok', s.hasKey || s.envKey);
  if (s.hasKey) st.textContent = `Ключ сохранён: ${s.keyHint}. Хранится зашифрованным только на этом компьютере`;
  else if (s.envKey) st.textContent = 'Используется ключ из переменной ANTHROPIC_API_KEY';
  else st.textContent = `Где взять: ${info.keyHelp}. Хранится зашифрованным только на этом компьютере`;
  $('#brKeyDel').classList.toggle('hidden', !s.hasKey);
  $('#brKey').placeholder = s.hasKey ? 'Новый ключ…' : (KEY_PREFIX[p] || '') + '…';

  // Модель: у Claude — три кнопки, у остальных — список с сервиса
  const claude = p === 'anthropic';
  $('#brModel').classList.toggle('hidden', !claude);
  $('#brModelPick').classList.toggle('hidden', claude);
  if (claude) {
    $('#brModelDesc').textContent = 'Opus умнее и лучше держит характер, Sonnet быстрее, Haiku дешевле всех. Оплата — за каждый ответ по тарифам Anthropic';
    document.querySelectorAll('#brModel button').forEach((x) => x.classList.toggle('on', x.dataset.v === b.model));
  } else {
    const cur = (b.models || {})[p] || info.defaultModel || '';
    $('#brModelDesc').textContent = p === 'ollama'
      ? 'Модели, скачанные в Ollama. Для разговора и команд подойдут, например, qwen3 или llama3.1'
      : p === 'openrouter' ? 'Только бесплатные модели (:free)' : 'Список берётся у сервиса. Если модели нет в списке — нажмите «Обновить список»';
    // Список с сервиса подгружаем один раз за открытие настроек, дальше — кнопкой
    if (modelCache[p]) fillModels(modelCache[p], cur);
    else {
      fillModels(cur ? [{ id: cur, name: '' }] : [], cur);
      if (s.ready) loadModels();
    }
  }
}
const modelCache = {};

function fillModels(list, cur) {
  const sel = $('#brModelSel');
  sel.innerHTML = '';
  if (cur && !list.some((x) => x.id === cur)) list = [{ id: cur, name: '' }, ...list];
  if (!list.length) sel.append(Object.assign(document.createElement('option'), { value: '', textContent: 'Модель будет выбрана сама' }));
  for (const m of list) sel.append(Object.assign(document.createElement('option'), { value: m.id, textContent: m.id }));
  sel.value = cur || (list[0] ? list[0].id : '');
}

async function loadModels() {
  const p = brStatus.provider;
  const btn = $('#brModelLoad');
  btn.textContent = 'Загружаю…';
  const r = await dock.brainModels(p);
  btn.textContent = 'Обновить список';
  if (brStatus.provider !== p) return;
  const cur = (brCfg().models || {})[p] || brStatus.providers[p].defaultModel || '';
  if (r.ok) {
    modelCache[p] = r.list;
    fillModels(r.list, cur);
    if (!r.list.length) $('#brModelDesc').textContent = p === 'ollama' ? 'В Ollama нет скачанных моделей. Выполните в терминале: ollama pull qwen3' : 'Сервис не вернул ни одной модели';
  } else {
    $('#brModelDesc').textContent = BR_ERRORS[r.error] || ('Не удалось получить список: ' + (r.detail || r.error));
  }
}

$('#brModelSel').addEventListener('change', (e) => {
  const b = brCfg();
  b.models = { ...b.models, [brStatus.provider]: e.target.value };
  save();
});
$('#brModelLoad').addEventListener('click', loadModels);
$('#brEnabled').addEventListener('change', (e) => { brCfg().enabled = e.target.checked; save(); });
document.querySelectorAll('#brModel button').forEach((x) => x.addEventListener('click', () => {
  brCfg().model = x.dataset.v;
  save();
  renderBrain();
}));
$('#brKeySave').addEventListener('click', async () => {
  const k = $('#brKey').value.trim();
  if (!k) return;
  const p = brStatus.provider, re = brStatus.providers[p].keyRe;
  if (re && !new RegExp(re).test(k)) {
    const st = $('#brKeyState');
    st.classList.remove('key-ok'); st.classList.add('key-bad');
    st.textContent = `Это не похоже на ключ ${brStatus.providers[p].name}: он начинается с ${KEY_PREFIX[p]}`;
    setTimeout(renderBrain, 3000);
    return;
  }
  $('#brKey').value = '';
  await dock.brainSetKey(p, k);
  delete modelCache[p];
  renderBrain();
});
$('#brKey').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#brKeySave').click(); });
$('#brKeyDel').addEventListener('click', async () => { await dock.brainSetKey(brStatus.provider, ''); renderBrain(); });
$('#brReset').addEventListener('click', () => {
  dock.brainReset();
  const b = $('#brReset');
  b.textContent = 'Забыто';
  setTimeout(() => { b.textContent = 'Забыть разговор'; }, 1500);
});

// ---------- Spotify ----------

async function renderSpotify() {
  const s = await dock.spotifyStatus();
  $('#spRedirect').textContent = s.redirect;
  if (document.activeElement !== $('#spClient')) $('#spClient').value = s.clientId;
  const st = $('#spState');
  st.classList.remove('key-bad');
  st.classList.toggle('key-ok', s.loggedIn);
  if (s.cli) {
    // Есть spotify_cli из самого Spotify — включаем прямо в приложении, вход через браузер не нужен
    st.classList.add('key-ok');
    st.textContent = 'Подключено напрямую через приложение Spotify на этом ПК — вход не нужен. Скажите «включи Numb», «включи что-нибудь из Сплина», «включи альбом Meteora», «добавь в очередь …»';
    $('#spLogin').classList.add('hidden');
    $('#spLogout').classList.toggle('hidden', !s.loggedIn);
    $('#spSetup').classList.add('hidden');
    return;
  }
  if (s.loggedIn) {
    st.textContent = `Подключено${s.user ? ': ' + s.user : ''}. Скажите «включи Numb», «включи что-нибудь из Сплина», «добавь в очередь …»` +
      (s.premium === false ? '. Без Premium Spotify не даёт включать музыку программам — ассистент будет открывать найденное' : '');
  } else if (s.logging) st.textContent = 'Подтвердите вход в открывшемся браузере…';
  else if (!s.clientId) st.textContent = 'Ассистент находит песню, исполнителя, альбом или плейлист и сразу включает в вашем Spotify (нужен Premium). Сначала — настройка ниже';
  else st.textContent = 'Client ID сохранён. Нажмите «Войти в Spotify»';
  $('#spLogin').classList.toggle('hidden', s.loggedIn);
  $('#spLogin').disabled = !s.clientId || s.logging;
  $('#spLogout').classList.toggle('hidden', !s.loggedIn);
  $('#spSetup').classList.toggle('hidden', s.loggedIn);
}
$('#spDash').addEventListener('click', (e) => { e.preventDefault(); dock.socialOpen('https://developer.spotify.com/dashboard'); });
$('#spCopy').addEventListener('click', () => {
  navigator.clipboard.writeText($('#spRedirect').textContent);
  $('#spCopy').textContent = 'Скопировано';
  setTimeout(() => { $('#spCopy').textContent = 'Копировать'; }, 1500);
});
$('#spSave').addEventListener('click', () => {
  const id = $('#spClient').value.trim();
  if (id && !/^[0-9a-f]{32}$/i.test(id)) {
    const st = $('#spState');
    st.classList.remove('key-ok'); st.classList.add('key-bad');
    st.textContent = 'Client ID — это 32 символа из цифр и букв a–f. Скопируйте его со страницы приложения';
    return;
  }
  cfg.spotify = { ...cfg.spotify, clientId: id };
  save();
  setTimeout(renderSpotify, 150);
});
$('#spClient').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#spSave').click(); });
$('#spLogin').addEventListener('click', async () => {
  $('#spLogin').disabled = true;
  $('#spState').textContent = 'Подтвердите вход в открывшемся браузере…';
  const r = await dock.spotifyLogin();
  await renderSpotify();
  if (!r.ok && r.error !== 'restarted') {
    const st = $('#spState');
    st.classList.add('key-bad');
    st.textContent = {
      timeout: 'Вход не подтверждён за 5 минут. Нажмите «Войти в Spotify» ещё раз',
      access_denied: 'Вход отменён',
      port: 'Порт 8971 занят другой программой — закройте её и попробуйте снова',
      token: 'Spotify не принял вход: ' + (r.detail || '') + '. Проверьте Client ID и Redirect URI в приложении',
      noclient: 'Сначала сохраните Client ID',
    }[r.error] || ('Не получилось войти: ' + (r.detail || r.error));
  }
});
$('#spLogout').addEventListener('click', async () => { await dock.spotifyLogout(); renderSpotify(); });

// ---------- Голос ----------

const vcCfg = () => (cfg.assistant.voice = { enabled: false, engine: 'groq', model: 'small', sensitivity: 0.5, ...cfg.assistant.voice });
let vcStatus = null;

async function renderVoice(s) {
  const v = vcCfg();
  const p = assistantOf(cfg);
  s = vcStatus = s || await dock.voiceStatus();
  $('#vcName').textContent = `Слушать имя «${p.name}»`;
  $('#vcDesc').textContent = `Скажите имя и команду: «${p.name}, открой Telegram». Одно имя — и следующая фраза будет командой. Когда ${p.female ? 'её' : 'его'} зовут, над головой загорается красная точка`;
  $('#vcEnabled').checked = v.enabled;
  $('#vcSens').value = v.sensitivity;
  if (!micsListed) { micsListed = true; renderMics(); }
  document.querySelectorAll('#vcEngine button').forEach((b) => b.classList.toggle('on', b.dataset.v === v.engine));
  document.querySelectorAll('#vcModel button').forEach((b) => b.classList.toggle('on', b.dataset.v === v.model));
  const local = v.engine === 'local';
  $('#vcGroqRow').classList.toggle('hidden', local);
  $('#vcLocalRow').classList.toggle('hidden', !local);

  const g = $('#vcGroqState');
  g.classList.toggle('key-ok', s.groqKey);
  g.textContent = s.groqKey ? 'Ключ Groq сохранён (общий с «мозгом» Groq)' : 'Бесплатно: console.groq.com → API Keys. Хранится зашифрованным только на этом компьютере';
  $('#vcGroqKey').placeholder = s.groqKey ? 'Новый ключ…' : 'gsk_…';

  const st = $('#vcLocalState'), inst = $('#vcInstall');
  const m = s.models[v.model];
  const ready = s.localBin && s.localModels[v.model];
  st.classList.toggle('key-ok', ready);
  st.classList.remove('key-bad');
  if (s.installing) {
    st.textContent = (s.installing.stage === 'program' ? 'Скачиваю программу whisper.cpp' : `Скачиваю модель (${m.size})`) + (s.installing.pct ? `: ${s.installing.pct}%` : '…');
  } else if (ready) st.textContent = `Готов: модель ${v.model === 'small' ? '«точная»' : '«быстрая»'}, работает без интернета`;
  else st.textContent = `Нужно скачать: программа whisper.cpp (~9 МБ, GitHub) и модель ${m.size} (Hugging Face). Один раз`;
  inst.classList.toggle('hidden', !!ready);
  inst.disabled = !!s.installing;
  inst.textContent = s.installing ? 'Скачиваю…' : 'Скачать';
  $('#vcRemove').classList.toggle('hidden', !(s.localBin || Object.values(s.localModels).some(Boolean)) || !!s.installing);
}
dock.onVoiceStatus((s) => renderVoice(s));

// Список микрофонов: названия Windows отдаёт только после разрешения на микрофон — просим его на миг
async function renderMics() {
  const sel = $('#vcDevice');
  let list = [];
  try {
    let devs = await navigator.mediaDevices.enumerateDevices();
    if (devs.some((d) => d.kind === 'audioinput' && !d.label)) {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      s.getTracks().forEach((t) => t.stop());
      devs = await navigator.mediaDevices.enumerateDevices();
    }
    list = devs.filter((d) => d.kind === 'audioinput' && d.deviceId !== 'default' && d.deviceId !== 'communications');
  } catch {}
  sel.innerHTML = '';
  sel.append(Object.assign(document.createElement('option'), { value: '', textContent: 'Как в Windows (по умолчанию)' }));
  // Храним название, а не id: id микрофона у каждого окна свой
  for (const d of list) sel.append(Object.assign(document.createElement('option'), { value: d.label, textContent: d.label || 'Микрофон' }));
  sel.value = list.some((d) => d.label === vcCfg().device) ? vcCfg().device : '';
}
let micsListed = false;
$('#vcDevice').addEventListener('change', (e) => { vcCfg().device = e.target.value; save(); });

$('#vcEnabled').addEventListener('change', (e) => { vcCfg().enabled = e.target.checked; save(); });
$('#vcSens').addEventListener('change', (e) => { vcCfg().sensitivity = +e.target.value; save(); });
document.querySelectorAll('#vcEngine button').forEach((b) => b.addEventListener('click', () => { vcCfg().engine = b.dataset.v; save(); renderVoice(); }));
document.querySelectorAll('#vcModel button').forEach((b) => b.addEventListener('click', () => { vcCfg().model = b.dataset.v; save(); renderVoice(); }));
$('#vcGroqSave').addEventListener('click', async () => {
  const k = $('#vcGroqKey').value.trim();
  if (!k) return;
  if (!/^gsk_/.test(k)) {
    const g = $('#vcGroqState');
    g.classList.remove('key-ok'); g.classList.add('key-bad');
    g.textContent = 'Это не похоже на ключ Groq: он начинается с gsk_';
    setTimeout(() => { g.classList.remove('key-bad'); renderVoice(); }, 3000);
    return;
  }
  $('#vcGroqKey').value = '';
  await dock.brainSetKey('groq', k);
  renderVoice();
  renderBrain();
});
$('#vcGroqKey').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#vcGroqSave').click(); });
$('#vcInstall').addEventListener('click', async () => {
  const r = await dock.voiceInstall(vcCfg().model);
  await renderVoice();
  if (r.error) {
    const st = $('#vcLocalState');
    st.classList.add('key-bad');
    st.textContent = r.error === 'busy' ? 'Уже скачиваю' : 'Не получилось скачать: ' + (r.detail || r.error);
  }
});
$('#vcRemove').addEventListener('click', async () => { renderVoice(await dock.voiceRemove()); });

// Звук печати: выбор варианта сразу играет образец
function renderTypeSound() {
  const a = cfg.assistant, kind = a.typeSound || 'typewriter';
  document.querySelectorAll('#asTypeSound button').forEach((b) => b.classList.toggle('on', b.dataset.v === kind));
  $('#asTypeVol').value = a.typeVolume ?? 0.4;
  $('#asTypeVolRow').classList.toggle('hidden', kind === 'off');
}
const typeSample = () => {
  const a = cfg.assistant;
  TypeSound.play(1300, { kind: a.typeSound || 'typewriter', volume: a.typeVolume ?? 0.4, pitch: assistantOf(cfg).female ? 'high' : 'low' });
};
document.querySelectorAll('#asTypeSound button').forEach((b) => b.addEventListener('click', () => {
  cfg.assistant.typeSound = b.dataset.v;
  save();
  renderTypeSound();
  typeSample();
}));
$('#asTypeVol').addEventListener('change', (e) => { cfg.assistant.typeVolume = +e.target.value; save(); typeSample(); });

$('#asEnabled').addEventListener('change', (e) => { cfg.assistant.enabled = e.target.checked; save(); });
$('#asSpeak').addEventListener('change', (e) => { cfg.assistant.speak = e.target.checked; save(); });
for (const [id, key] of [['#asSize', 'size'], ['#asTalk', 'talk'], ['#asMode', 'mode'], ['#asPersona', 'persona']]) {
  document.querySelectorAll(id + ' button').forEach((b) => b.addEventListener('click', () => { cfg.assistant[key] = b.dataset.v; save(); renderAssistant(); }));
}

// ---------- Соцсети ----------

let socPlatform = 'telegram';
let socView = [];
let socDrag = null;

function renderSocialSettings() {
  // Выбор соцсети для нового аккаунта
  const chips = $('#socPlatforms');
  chips.innerHTML = '';
  for (const [k, p] of Object.entries(SOCIAL)) {
    const c = document.createElement('button');
    c.type = 'button';
    c.className = 'chip' + (k === socPlatform ? ' sel' : '');
    c.innerHTML = `<span class="brand-ico"><svg viewBox="0 0 24 24">${p.icon}</svg></span>`;
    c.append(p.name);
    c.addEventListener('click', () => { socPlatform = k; renderSocialSettings(); });
    chips.appendChild(c);
  }
  $('#socHint').textContent = 'Например: ' + SOCIAL[socPlatform].hint;

  // Список аккаунтов
  const box = $('#socAccounts');
  box.innerHTML = '';
  const accounts = cfg.social.accounts;
  if (!accounts.length) box.innerHTML = '<div class="app-row"><span class="desc">Пока пусто — выберите соцсеть и добавьте аккаунт ниже</span></div>';
  accounts.forEach((acc, i) => {
    const v = socView.find((x) => x.id === acc.id) || {};
    const row = document.createElement('div');
    row.className = 'app-row soc-row';
    row.draggable = true;
    row.innerHTML = `<span class="grip">⋮⋮</span><svg viewBox="0 0 24 24">${SOCIAL[acc.platform].icon}</svg>`;
    const info = document.createElement('div');
    info.className = 'app-info';
    const label = Object.assign(document.createElement('input'), { value: acc.label || SOCIAL[acc.platform].name, title: 'Подпись' });
    label.addEventListener('change', () => { acc.label = label.value.trim(); save(); });
    label.addEventListener('mousedown', () => { row.draggable = false; });
    label.addEventListener('blur', () => { row.draggable = true; });
    info.append(label, Object.assign(document.createElement('div'), { className: 'path', textContent: '@' + (v.handle || acc.handle) }));
    const count = Object.assign(document.createElement('span'), { className: 'soc-count' });
    if (v.error && v.count == null) { count.classList.add('err'); count.textContent = v.error; }
    else count.textContent = v.count == null ? 'загружаю…' : (v.approx ? '≈ ' : '') + v.count.toLocaleString('ru-RU');
    const del = Object.assign(document.createElement('button'), { className: 'icon-btn', textContent: '✕', title: 'Удалить' });
    del.addEventListener('click', () => { cfg.social.accounts.splice(i, 1); save(); renderSocialSettings(); });
    row.append(info, count, del);
    row.addEventListener('dragstart', () => { socDrag = i; row.classList.add('dragging'); });
    row.addEventListener('dragend', () => row.classList.remove('dragging'));
    row.addEventListener('dragover', (e) => { e.preventDefault(); row.classList.add('drop-before'); });
    row.addEventListener('dragleave', () => row.classList.remove('drop-before'));
    row.addEventListener('drop', (e) => {
      e.preventDefault();
      if (socDrag === null || socDrag === i) return;
      const [m] = accounts.splice(socDrag, 1);
      accounts.splice(i, 0, m);
      socDrag = null;
      save();
      renderSocialSettings();
    });
    box.appendChild(row);
  });
  $('#ytKey').value = cfg.social.ytKey || '';
  $('#vkToken').value = cfg.social.vkToken || '';
}

$('#socAdd').addEventListener('submit', (e) => {
  e.preventDefault();
  // Принимаем и ник, и ссылку на профиль
  const raw = $('#socHandle').value.trim();
  const handle = raw.replace(/^https?:\/\/[^/]+\//, '').replace(/^@/, '').replace(/[/?#].*$/, '');
  if (!handle) return;
  cfg.social.accounts.push({ id: Date.now().toString(36), platform: socPlatform, handle });
  $('#socHandle').value = '';
  save();
  renderSocialSettings();
});
$('#ytKey').addEventListener('change', (e) => { cfg.social.ytKey = e.target.value.trim(); save(); });
$('#vkToken').addEventListener('change', (e) => { cfg.social.vkToken = e.target.value.trim(); save(); });
dock.onSocial((list) => { socView = list; if (cfg) renderSocialSettings(); });
dock.onGoto((page) => { const b = document.querySelector(`#nav [data-page="${page}"]`); if (b) b.click(); });

// ---------- Погода ----------

function renderCity() {
  const w = cfg.weather;
  $('#curCity').textContent = `${w.city} · ${(+w.lat).toFixed(2)}, ${(+w.lon).toFixed(2)}`;
}

$('#citySearch').addEventListener('submit', async (e) => {
  e.preventDefault();
  const q = $('#cityInput').value.trim();
  const box = $('#cityResults');
  if (!q) return;
  box.classList.remove('hidden');
  box.innerHTML = '<div class="city"><span class="desc">Ищу…</span></div>';
  try {
    const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=8&language=ru&format=json`;
    const d = await (await fetch(url)).json();
    box.innerHTML = '';
    if (!d.results || !d.results.length) {
      box.innerHTML = '<div class="city"><span class="desc">Ничего не найдено</span></div>';
      return;
    }
    for (const r of d.results) {
      const b = document.createElement('button');
      b.className = 'city';
      b.innerHTML = '<div><div class="name"></div><div class="desc"></div></div><span class="pick">Выбрать</span>';
      b.querySelector('.name').textContent = r.name;
      b.querySelector('.desc').textContent = [r.admin1, r.country].filter(Boolean).join(', ');
      b.addEventListener('click', () => {
        cfg.weather = { city: r.name, lat: r.latitude, lon: r.longitude };
        save();
        renderCity();
        box.classList.add('hidden');
        $('#cityInput').value = '';
      });
      box.appendChild(b);
    }
  } catch {
    box.innerHTML = '<div class="city"><span class="desc">Нет соединения с сервером погоды</span></div>';
  }
});

// ---------- Помодоро ----------

function renderPomodoro() {
  document.querySelectorAll('.stepper').forEach((st) => {
    st.querySelector('span').textContent = cfg.pomodoro[st.dataset.key] + ' мин';
  });
}
document.querySelectorAll('.stepper').forEach((st) => {
  const [minus, plus] = st.querySelectorAll('button');
  const step = (d) => {
    cfg.pomodoro[st.dataset.key] = Math.min(120, Math.max(1, cfg.pomodoro[st.dataset.key] + d));
    renderPomodoro();
    save();
  };
  minus.addEventListener('click', () => step(-1));
  plus.addEventListener('click', () => step(1));
});

// ---------- Система ----------

dock.autostart().then((on) => { $('#autostart').checked = on; });
$('#autostart').addEventListener('change', (e) => dock.setAutostart(e.target.checked));
$('#hideTaskbar').addEventListener('change', (e) => { cfg.system.hideTaskbar = e.target.checked; save(); });
$('#reserveSpace').addEventListener('change', (e) => { cfg.system.reserveSpace = e.target.checked; save(); });
$('#restart').addEventListener('click', () => dock.restart());
$('#folder').addEventListener('click', () => dock.openFolder());
$('#quit').addEventListener('click', () => dock.quit());

// ---------- Старт ----------

dock.version().then((v) => { $('#version').textContent = 'Версия ' + v; });
// Конфиг может поменяться из дока (перетаскивание иконок, закрепление значков) — подхватываем
dock.onConfig((c) => {
  if (!cfg) return;
  const appsChanged = JSON.stringify(c.apps) !== JSON.stringify(cfg.apps);
  const layoutChanged = JSON.stringify([c.widgetOrder, c.layoutZones, c.appearance.layout, c.appearance.width]) !==
    JSON.stringify([cfg.widgetOrder, cfg.layoutZones, cfg.appearance.layout, cfg.appearance.width]);
  const remChanged = JSON.stringify(c.assistant.reminders) !== JSON.stringify(cfg.assistant.reminders);
  const modeChanged = c.assistant.mode !== cfg.assistant.mode;
  cfg = c;
  if (appsChanged) renderApps();
  // Режим могли переключить из меню Патрика
  if (remChanged || modeChanged) renderAssistant();
  if (layoutChanged && !zoneDrag) renderLayout();
});

dock.config().then(async (c) => {
  cfg = c;
  disksList = await dock.disks();
  renderLook();
  renderApps();
  renderWidgets();
  renderIsland();
  renderCity();
  renderPomodoro();
  socView = await dock.social();
  renderSocialSettings();
  renderAssistant();
  $('#hideTaskbar').checked = cfg.system.hideTaskbar;
  $('#reserveSpace').checked = cfg.system.reserveSpace;
  refreshPreview();
});
