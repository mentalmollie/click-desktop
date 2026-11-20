const {
  app, BrowserWindow, ipcMain, screen, Tray, Menu, shell, nativeImage, nativeTheme, Notification, dialog, powerMonitor, session,
} = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { dataPath } = require('./paths');   // первым: папка данных (настройки, ключи) — см. paths.js
const { spawn, execFile, execFileSync } = require('child_process');
const { helperProc } = require('./helpers');   // помощники PowerShell — в одном процессе host.ps1
const { WIDGET_DEFAULTS, DEFAULT_ORDER, ASSISTANTS, assistantOf, weatherText } = require('./shared.js');
const { createBrain } = require('./brain.js');
const { createVoice } = require('./voice.js');
const { createSpotify } = require('./spotify.js');
const { createUpdater } = require('./updates.js');
const { createUpdateScheduler } = require('./update-scheduler.js');
const updateChannel = require('./update-channel.json');
const { createWeather } = require('./weather.js');
const { createAssistantJobs, formatDuration } = require('./assistant-jobs.js');
const MusicServices = require('./music-service.js');
const { createYandexMusic, isYandexMusicUrl, findYandexMusicExecutable, createNativeOpener } = require('./yandex-music.js');
const { createTrayManager } = require('./tray-manager.js');
const { createFileDrop } = require('./file-drop.js');
const bundledNotes = require('./release-notes.json');

const CONFIG_PATH = dataPath('config.json');
const TODOS_PATH = dataPath('todos.json');
const PANEL_SIZE = { calendar: [300, 340], todos: [330, 410], media: [360, 300], weather: [340, 500], system: [360, 500], disks: [360, 300], start: [620, 660], social: [340, 240], tray: [340, 420],
};
const TASKBAR_PAUSE = path.join(process.env.TEMP || os.tmpdir(), 'glassdock-taskbar.pause');

const DEFAULTS = {
  updates: { autoCheck: true },
  weather: { city: 'Москва', lat: 55.75, lon: 37.62 },
  widgets: {
    start: true, social: true, system: true, openApps: true, media: true, tasks: true, pomodoro: true, disk: true, tray: true, clock: true,
  },
  widgetOpts: WIDGET_DEFAULTS,
  trayPinned: [],
  pomodoro: { work: 25, break: 5 },
  // bgTransparency — прозрачность только фона панели (иконки и виджеты не затрагивает)
  // width: 'auto' — по содержимому, 'full' — от края до края; layout — расположение значков во всю ширину
  appearance: {
    scale: 1.1, bgTransparency: 0.8, blur: true, position: 'bottom', margin: 10, alwaysOnTop: true, width: 'auto', layout: 'center',
    autoHide: false, autoHideDelay: 700,
  },
  // Ассистент: pos — место на панели (0 — левый край, 1 — правый), talk — разговорчивость
  // mode: 'sit' — сидит на панели, 'walk' — гуляет по нижнему краю экрана
  assistant: { enabled: true, persona: 'patrick', brain: { enabled: true, provider: 'gemini', models: {} },
    voice: { enabled: false, engine: 'groq', model: 'small', sensitivity: 0.5, device: '' },
    // Звук печати ответа в облачке: typewriter | blip | off (typesound.js)
    typeSound: 'typewriter', typeVolume: 0.4, mode: 'sit', pos: 0.88, size: 'm', talk: 'normal', musicService: 'spotify', muteUntil: 0, reminders: [] },
  widgetOrder: DEFAULT_ORDER,
  layoutZones: {},
  panelSizes: {},
  system: { hideTaskbar: true, reserveSpace: true },
};

let win = null;
let panel = null;
let settingsWin = null;
let panelMode = null;
let panelHiddenAt = 0;
let panelMenuOpen = false;
let tray = null;
let mediaProc = null;
let keysProc = null;
let lastMedia = null;
let config = null;

const updates = createUpdater({
  currentVersion: app.getVersion(), ...updateChannel,
  directory: path.join(app.getPath('userData'), 'updates'),
  onChange: (state) => { if (alive(settingsWin)) settingsWin.webContents.send('updates:status', state); },
  launch: (installer) => new Promise((resolve, reject) => {
    const installDir = app.isPackaged ? path.dirname(process.execPath) : path.join(process.env.LOCALAPPDATA, 'Programs', 'Click');
    const child = spawn(installer, ['/update-dir', installDir], { detached: true, stdio: 'ignore' });
    child.once('error', reject);
    child.once('spawn', () => { child.unref(); resolve(); setTimeout(() => app.quit(), 250); });
  }),
});

const updateScheduler = createUpdateScheduler({ check: () => {
  if (['downloading', 'installing'].includes(updates.status().phase)) return;
  return updates.check();
} });

// ---------- Конфиг ----------

function detectApps() {
  const env = process.env;
  const candidates = [
    ['Проводник', 'C:\\Windows\\explorer.exe'],
    ['Chrome', 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'],
    ['Chrome', path.join(env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe')],
    ['Edge', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'],
    ['Yandex', path.join(env.LOCALAPPDATA || '', 'Yandex\\YandexBrowser\\Application\\browser.exe')],
    ['Firefox', 'C:\\Program Files\\Mozilla Firefox\\firefox.exe'],
    ['VS Code', path.join(env.LOCALAPPDATA || '', 'Programs\\Microsoft VS Code\\Code.exe')],
    ['Telegram', path.join(env.APPDATA || '', 'Telegram Desktop\\Telegram.exe')],
    ['Discord', path.join(env.LOCALAPPDATA || '', 'Discord\\Update.exe')],
    ['Spotify', path.join(env.APPDATA || '', 'Spotify\\Spotify.exe')],
    ['Steam', 'C:\\Program Files (x86)\\Steam\\steam.exe'],
    ['Блокнот', 'C:\\Windows\\System32\\notepad.exe'],
  ];
  const seen = new Set();
  const apps = [];
  for (const [name, p] of candidates) {
    if (seen.has(name) || !fs.existsSync(p)) continue;
    seen.add(name);
    const a = { name, path: p };
    if (name === 'Discord') {
      a.args = ['--processStart', 'Discord.exe'];
      a.process = 'discord.exe';
      a.icon = path.join(path.dirname(p), 'app.ico');
    }
    apps.push(a);
  }
  return apps;
}

function loadConfig() {
  let file = {};
  try { file = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch {}
  const cfg = {
    updates: { autoCheck: file.updates?.autoCheck !== false },
    weather: { ...DEFAULTS.weather, ...file.weather },
    widgets: { ...DEFAULTS.widgets, ...file.widgets },
    pomodoro: { ...DEFAULTS.pomodoro, ...file.pomodoro },
    appearance: { ...DEFAULTS.appearance, ...file.appearance },
    system: { ...DEFAULTS.system, ...file.system },
    widgetOpts: Object.fromEntries(Object.entries(WIDGET_DEFAULTS).map(([k, v]) => [k, { ...v, ...(file.widgetOpts && file.widgetOpts[k]) }])),
    trayPinned: file.trayPinned || [],
    assistant: { ...DEFAULTS.assistant, ...file.assistant, brain: { ...DEFAULTS.assistant.brain, ...(file.assistant || {}).brain },
      voice: { ...DEFAULTS.assistant.voice, ...(file.assistant || {}).voice } },
    // Соцсети: аккаунты и необязательные ключи (YouTube — для точного числа, ВКонтакте — обязателен)
    social: { accounts: [], ytKey: '', vkToken: '', ...file.social },
    // Spotify: Client ID приложения пользователя (не секрет); токены входа — отдельно, в spotify.key
    spotify: { clientId: '', ...file.spotify },
    startPinned: file.startPinned,  // старый формат; переносится в startLayout
    startLayout: file.startLayout,  // undefined — заполним при первой загрузке списка приложений
    startLocked: !!file.startLocked,
    apps: file.apps || detectApps(),
  };
  removeLegacyIntegrations(cfg);
  // Первые три приложения — без капсулы, как в левой группе референса
  cfg.apps.forEach((a, i) => { if (a.capsule === undefined) a.capsule = i >= 3; });
  // Старые настройки: затемнение tint превращаем в прозрачность фона, прозрачность всего окна больше не используется
  const ap = file.appearance || {};
  if (ap.tint !== undefined && ap.bgTransparency === undefined) cfg.appearance.bgTransparency = Math.max(0, 1 - ap.tint / 0.9);
  delete cfg.appearance.tint;
  delete cfg.appearance.opacity;
  // Порядок виджетов: сохранённый плюс новые в конце; группа «Пуск и приложения» по умолчанию первая
  const order = (file.widgetOrder || []).filter((k) => DEFAULT_ORDER.includes(k));
  if (order.length && !order.includes('pinned')) order.unshift('pinned');
  // «Пуск» стал отдельным блоком: ставим его туда, где раньше была общая группа
  if (!order.includes('start')) {
    order.splice(Math.max(order.indexOf('pinned'), 0), 0, 'start');
    const z = file.layoutZones || {};
    if (z.pinned) z.start = z.pinned;
  }
  // Новые блоки встают рядом со своим соседом по умолчанию, а не в самый конец
  if (order.length) {
    for (const k of DEFAULT_ORDER) {
      if (order.includes(k)) continue;
      const prev = DEFAULT_ORDER.slice(0, DEFAULT_ORDER.indexOf(k)).reverse().find((p) => order.includes(p));
      order.splice(prev ? order.indexOf(prev) + 1 : 0, 0, k);
    }
  }
  cfg.widgetOrder = [...order, ...DEFAULT_ORDER.filter((k) => !order.includes(k))];
  cfg.layoutZones = file.layoutZones || {};
  cfg.panelSizes = file.panelSizes || {};
  removeLegacyIntegrations(cfg);
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf8');
  return cfg;
}

function removeLegacyIntegrations(cfg) {
  delete cfg.assistant.speak;
  if (cfg.assistant.voice) delete cfg.assistant.voice.spokenReplies;
  cfg.assistant.musicService = MusicServices.selected(cfg);
  delete cfg.island;
  delete cfg.widgets.island;
  delete cfg.widgetOpts.island;
  if (cfg.layoutZones) delete cfg.layoutZones.island;
  if (cfg.widgetOrder) cfg.widgetOrder = cfg.widgetOrder.filter((id) => id !== 'island');
  const b = cfg.assistant.brain;
  if (!['gemini', 'groq', 'openrouter', 'ollama'].includes(b.provider)) b.provider = 'gemini';
  delete b.model;
  if (b.models) delete b.models.anthropic;
}

const weather = createWeather({ config: () => config.weather });

let socialKey = '';
const socialKeyOf = (cfg) => JSON.stringify([cfg.social.accounts, cfg.social.ytKey, cfg.social.vkToken]);
function saveConfig(cfg) {
  removeLegacyIntegrations(cfg);
  config = cfg;
  updateScheduler.setEnabled(config.updates?.autoCheck !== false);
  // Добавили или изменили аккаунт соцсети — сразу узнаём число подписчиков
  const sk = socialKeyOf(cfg);
  if (sk !== socialKey) setTimeout(refreshSocial, 300);
  socialKey = sk;
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf8');
  applyAppearance();
  applyTaskbar();
  applyWinKey();
  applyAppbar();
  pushWindows();
  for (const w of [win, panel, settingsWin, assistWin]) if (alive(w)) w.webContents.send('config', cfg);
  applyAssistant();
}

// ---------- Окно дока ----------

let dockSize = [900, 54, 900];

// width/height — размер панели, content — ширина самих значков (для панели во всю ширину они различаются)
function placeWindow(width, height, content = width) {
  if (![width, height, content].every((n) => Number.isFinite(n) && n > 0)) return;
  dockSize = [width, height, content];
  if (!alive(win)) return;
  const display = screen.getPrimaryDisplay();
  // При автоскрытии привязываемся к краю экрана. Рабочая область Windows
  // может сдвигаться на пару пикселей при появлении системной панели задач.
  const workArea = autoHideOn() ? display.bounds : display.workArea;
  const margin = config.appearance.margin;
  const full = config.appearance.width === 'full';
  const avail = workArea.width - (full ? 2 * margin : 16);
  // Если значки не помещаются по ширине — уменьшаем масштаб, чтобы влезли в экран
  const scale = Math.min(config.appearance.scale, avail / content);
  if (Math.abs(win.webContents.getZoomFactor() - scale) > 0.001) win.webContents.setZoomFactor(scale);
  const w = full ? Math.round(avail) : Math.ceil(width * scale), h = Math.ceil(height * scale);
  const x = Math.round(workArea.x + (workArea.width - w) / 2);
  const top = config.appearance.position === 'top';
  // Если под док зарезервирована полоса экрана, ставим док внутрь неё:
  // рабочая область теперь заканчивается над доком, и считать от неё нельзя
  let y;
  if (appbarRect) y = top ? appbarRect.top + margin : appbarRect.bottom - h - margin;
  else y = top ? workArea.y + margin : workArea.y + workArea.height - h - margin;
  // Щель между панелью и нижним краем экрана: курсор «упирают» в край и жмут там — клик уходил на рабочий стол.
  // В прозрачном режиме дотягиваем окно до самого края; нажатие в этой полоске панель засчитает значку над ним.
  // (С размытием так нельзя: стекло окна стало бы видно и под панелью.)
  const pad = !config.appearance.blur && !top ? margin : 0;
  const previousTarget = dockTarget;
  dockTarget = { x, y, width: w, height: h + pad };
  if (alive(win)) win.webContents.send('dock:edgePad', pad);
  // Спрятанный автоскрытием док остаётся за краем экрана, пока к нему не подведут курсор
  const current = win.getBounds();
  const target = anim ? { ...dockTarget, y: anim.y } : autoHideOn() && !dockShown ? hiddenBounds() : dockTarget;
  // Не трогаем нативное окно при неизменном размере: setBounds может менять порядок окон.
  if (Object.keys(target).some((k) => target[k] !== current[k])) win.setBounds(target);
  placeAssistant();
  if (anim && previousTarget && Object.keys(dockTarget).some((k) => dockTarget[k] !== previousTarget[k])) slideDock(dockShown);
  raiseAssistant();
  updateAppbar(h);
}

// ---------- Автоматическое скрытие панели ----------
// Док уезжает за край экрана, когда курсор уходит с него, и выезжает, когда курсор упирается в этот край.
// Положение курсора спрашиваем у системы раз в 80 мс — так работает над любыми окнами.

let dockTarget = null;   // где док стоит, когда показан
let dockShown = true;
let anim = null;
let dockSlideId = 0;
let hideAt = 0;

const autoHideOn = () => !!(config && config.appearance.autoHide);
let fileDragUntil = 0;

function hiddenBounds() {
  const db = screen.getPrimaryDisplay().bounds;
  const t = dockTarget;
  const y = config.appearance.position === 'top' ? db.y - t.height : db.y + db.height;
  return { ...t, y };
}

// Плавный выезд/уезд. Кадры считает сама панель через requestAnimationFrame (в такт обновлению экрана)
// и присылает сюда положение — таймеры главного процесса в Windows срабатывают неровно и дают рывки.
function slideDock(show) {
  if (!dockTarget || !alive(win)) return;
  const from = anim ? anim.y : win.getBounds().y;
  dockShown = show;
  const to = show ? dockTarget.y : hiddenBounds().y;
  if (show) { win.showInactive(); raiseAssistant(); }
  const id = ++dockSlideId;
  anim = { id, from, to, y: from, until: Date.now() + 600 };
  win.webContents.send('dock:slide', { id, from, to, show, ms: show ? 280 : 240 });
}

ipcMain.on('dock:pos', (e, id, y, last) => {
  // Кадр прежнего скрытия может прийти уже после начала появления (или пересоздания окна).
  // Он не должен двигать панель назад или завершать новую анимацию.
  if (!alive(win) || e.sender !== win.webContents || !anim || id !== anim.id || !dockTarget || !Number.isFinite(y)) return;
  const next = last ? anim.to : Math.round(Math.max(Math.min(anim.from, anim.to), Math.min(y, Math.max(anim.from, anim.to)))) | 0;
  if ((anim.to >= anim.from && next < anim.y) || (anim.to < anim.from && next > anim.y)) return;
  if (next !== anim.y) win.setPosition(dockTarget.x, next);
  anim.y = next;
  placeAssistant(next);
  if (last) anim = null;
});

function showDock() { if (!dockShown) slideDock(true); hideAt = 0; }

// Окно существует и не уничтожено (при выходе и при пересоздании окон таймеры ещё могут сработать)
const alive = (w) => !!w && !w.isDestroyed();

function autoHideTick() {
  if (app.isQuitting || !alive(win)) return;
  // Анимация «зависла» (окно было скрыто, кадры не шли) — просто ставим док в конечное положение
  if (anim && Date.now() > anim.until) {
    win.setBounds(dockShown ? dockTarget : hiddenBounds());
    anim = null;
    placeAssistant();
    raiseAssistant();
  }
  if (!autoHideOn() || !dockTarget) {
    if (!dockShown) slideDock(true);
    return;
  }
  const c = screen.getCursorScreenPoint();
  const db = screen.getPrimaryDisplay().bounds;
  const t = dockTarget;
  const top = config.appearance.position === 'top';
  const inSpan = c.x >= t.x - 40 && c.x <= t.x + t.width + 40;
  // Курсор упёрся в край экрана напротив дока — показываем
  const atEdge = inSpan && (top ? c.y <= db.y + 1 : c.y >= db.y + db.height - 2);
  // Курсор над доком (с небольшим запасом) или у края — не прячем
  const overDock = c.x >= t.x - 8 && c.x <= t.x + t.width + 8 &&
    (top ? c.y <= t.y + t.height + 8 : c.y >= t.y - 8);
  // Пока открыто всплывающее окно или меню — док не прячется
  const keep = (alive(panel) && panel.isVisible()) || panelMenuOpen || Date.now() < fileDragUntil;
  if (!dockShown) {
    if (atEdge) showDock();
    return;
  }
  if (overDock || keep) { hideAt = 0; return; }
  if (!hideAt) hideAt = Date.now() + (config.appearance.autoHideDelay || 700);
  else if (Date.now() >= hideAt) { hideAt = 0; slideDock(false); }
}
setInterval(autoHideTick, 80);

// ---------- Окна не заходят на док ----------
// appbar.ps1 регистрирует док как «панель приложения» Windows (как панель задач):
// система вычитает его полосу из рабочей области, и развёрнутые окна заканчиваются над доком.

let appbarProc = null;
let appbarRect = null;   // выданная системой полоса, в DIP
let appbarSent = '';

function applyAppbar() {
  // При автоскрытии место под док не резервируем — как у панели задач Windows с автоскрытием
  const want = config.system.reserveSpace && !config.appearance.autoHide;
  if (want && !appbarProc) {
    appbarProc = helperProc('appbar');
    appbarProc.stdout.setEncoding('utf8');
    let buf = '';
    appbarProc.stdout.on('data', (chunk) => {
      buf += chunk;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        const m = line.match(/pos (-?\d+) (-?\d+) (-?\d+) (-?\d+)/);
        if (m) {
          const s = screen.getPrimaryDisplay().scaleFactor;
          appbarRect = { left: +m[1] / s, top: +m[2] / s, right: +m[3] / s, bottom: +m[4] / s };
          // Chromium после смены рабочей области сам двигает окно внутрь неё — ставим док на место ещё раз
          if (win) { placeWindow(...dockSize); setTimeout(() => placeWindow(...dockSize), 400); setTimeout(() => placeWindow(...dockSize), 1200); }
        }
      }
    });
    appbarProc.on('exit', () => { appbarProc = null; appbarRect = null; appbarSent = ''; });
    appbarSent = '';
    if (win) placeWindow(...dockSize);
  } else if (!want && appbarProc) {
    appbarProc.stdin.end();   // помощник снимет резерв и завершится
    appbarProc = null;
    appbarRect = null;
    appbarSent = '';
    if (win) setTimeout(() => placeWindow(...dockSize), 300);
  }
}

// Толщина полосы — высота дока плюс отступы сверху и снизу, в настоящих пикселях экрана
function updateAppbar(hDip) {
  if (!appbarProc) return;
  const s = screen.getPrimaryDisplay().scaleFactor;
  const cmd = `${config.appearance.position === 'top' ? 1 : 3} ${Math.round((hDip + 2 * config.appearance.margin) * s)}`;
  if (cmd === appbarSent) return;
  appbarSent = cmd;
  appbarProc.stdin.write(cmd + '\n');
}

let windowsBlur = null;

function applyAppearance() {
  const a = config.appearance;
  // Прозрачное окно и окно с размытием создаются по-разному — при переключении пересоздаём
  if (windowsBlur !== null && windowsBlur !== a.blur) return recreateWindows();
  for (const w of [win, panel]) {
    if (!alive(w)) continue;
    w.webContents.setZoomFactor(a.scale);
    w.setAlwaysOnTop(a.alwaysOnTop, 'screen-saver');
  }
  if (win) placeWindow(...dockSize);
  // Всплывающее окно — в том же масштабе, что и панель (она могла ужаться под ширину экрана)
  if (win && alive(panel)) panel.webContents.setZoomFactor(win.webContents.getZoomFactor());
  raiseAssistant();
}

function recreateWindows() {
  const old = [win, panel];
  anim = null;
  createWindow();
  panel = null;          // всплывающее окно создастся заново при открытии
  panelReady = null;
  for (const w of old) if (alive(w)) w.destroy();
}

// С размытием — акриловое стекло Windows; без него — полностью прозрачное окно, фон рисует CSS
function glassWindow(opts) {
  windowsBlur = config.appearance.blur;
  return new BrowserWindow({
    frame: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    skipTaskbar: true,
    show: false,
    backgroundColor: '#00000000',
    ...(windowsBlur ? { backgroundMaterial: 'acrylic' } : { transparent: true }),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, zoomMode: 'isolated' },
    ...opts,
  });
}

function createWindow() {
  // Док не забирает фокус: так клик по иконке знает, какое окно было активным.
  // Не через focusable:false — у такого окна Chromium «съедает» нажатие мыши
  // (MA_NOACTIVATEANDEAT), и кнопки получают только отпускание. Вместо этого — стиль WS_EX_NOACTIVATE.
  win = glassWindow({ width: 900, height: 54 });
  win.on('show', () => { noActivate(win); raiseAssistant(); });
  win.on('focus', raiseAssistant);
  // Иначе за краем экрана Chromium притормаживает кадры, и выезд начинается рывком
  win.webContents.setBackgroundThrottling(false);
  win.loadFile('index.html');
  win.webContents.on('did-finish-load', applyAppearance);
  win.once('ready-to-show', () => win.showInactive());
}

// Всплывающая панель над доком (Пуск, календарь, задачи…). Создаётся при первом открытии и выгружается,
// если 5 минут пролежала скрытой (~50 МБ памяти); первое открытие после этого — на ~0,3 с дольше.
const PANEL_UNLOAD = 5 * 60e3;
let panelReady = null;
let panelUnloadTimer = null;

function createPanel() {
  const p = glassWindow({ width: 300, height: 340 });
  panel = p;
  panelReady = new Promise((res) => p.webContents.once('did-finish-load', res));
  p.loadFile('panel.html');
  p.webContents.on('did-finish-load', applyAppearance);
  p.on('blur', () => {
    if (panelMenuOpen) return;  // контекстное меню значка не должно закрывать панель
    p.hide();
    panelHiddenAt = Date.now();
  });
  p.on('show', () => clearTimeout(panelUnloadTimer));
  p.on('hide', () => {
    clearTimeout(panelUnloadTimer);
    panelUnloadTimer = setTimeout(() => {
      if (panel === p && alive(p) && !p.isVisible()) { panel = null; panelReady = null; p.destroy(); }
    }, PANEL_UNLOAD);
  });
  p.on('closed', () => { if (panel === p) { panel = null; panelReady = null; } });
}
async function ensurePanel() {
  if (!alive(panel)) createPanel();
  await panelReady;
  return panel;
}
const panelShown = () => alive(panel) && panel.isVisible();
function hidePanel() { if (alive(panel)) panel.hide(); }

async function openPanel(mode, anchorX) {
  if (panelShown() && panelMode === mode) return panel.hide();
  await ensurePanel();
  // Клик по тому же виджету сначала снимает фокус с панели (и прячет её) — не открываем заново
  if (panelMode === mode && Date.now() - panelHiddenAt < 300) return;
  panelMode = mode;
  const scale = win.webContents.getZoomFactor();
  panel.webContents.setZoomFactor(scale);
  const [cw, ch] = config.panelSizes[mode] || PANEL_SIZE[mode];
  const w = Math.round(cw * scale), h = Math.round(ch * scale);
  // Считаем от показанного положения дока: при автоскрытии он мог быть за краем экрана
  showDock();
  const d = dockTarget || win.getBounds();
  const wa = screen.getPrimaryDisplay().workArea;
  const x = Math.min(Math.max(Math.round(d.x + anchorX * scale - w / 2), wa.x + 8), wa.x + wa.width - w - 8);
  const y = config.appearance.position === 'top' ? d.y + d.height + 8 : d.y - h - 8;
  panel.setBounds({ x, y, width: w, height: h });
  panel.webContents.send('mode', mode);
  panel.show();
  panel.focus();
  // Фокус ставим сами: при клике право у нас есть, а по клавише Win его выдаёт перехватчик (winkey.ps1).
  // Помощника для фокуса на свои окна не используем: после этого док переставал получать нажатия мыши.
}

// ---------- Окно настроек ----------

function openSettings() {
  if (settingsWin) {
    if (settingsWin.isMinimized()) settingsWin.restore();
    settingsWin.show();
    settingsWin.focus();
    return;
  }
  settingsWin = new BrowserWindow({
    width: 900,
    height: 720,
    minWidth: 760,
    minHeight: 520,
    title: 'Click — настройки',
    icon: appImage || undefined,
    show: false,
    backgroundColor: '#1b1c1f',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#151618', symbolColor: '#c9cacf', height: 32 },
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true },
  });
  settingsWin.loadFile('settings.html');
  settingsWin.once('ready-to-show', () => settingsWin.show());
  settingsWin.on('closed', () => { settingsWin = null; });
}

// ---------- Задачи ----------

function readTodos() {
  try {
    return JSON.parse(fs.readFileSync(TODOS_PATH, 'utf8'));
  } catch {
    return [];
  }
}

function writeTodos(list) {
  fs.writeFileSync(TODOS_PATH, JSON.stringify(list, null, 2), 'utf8');
  for (const w of [win, panel, assistWin]) if (alive(w)) w.webContents.send('todos', list);
}

// ---------- Системные данные ----------

let prevCpu = os.cpus();
function cpuUsage() {
  const cur = os.cpus();
  let idle = 0, total = 0;
  cur.forEach((c, i) => {
    const p = prevCpu[i].times, t = c.times;
    total += (t.user + t.nice + t.sys + t.idle + t.irq) - (p.user + p.nice + p.sys + p.idle + p.irq);
    idle += t.idle - p.idle;
  });
  prevCpu = cur;
  return total ? Math.round(100 * (1 - idle / total)) : 0;
}

// Все подключённые диски с буквами (быстро, без PowerShell)
function diskUsage() {
  const disks = [];
  for (let c = 67; c <= 90; c++) {  // C..Z
    const name = String.fromCharCode(c) + ':';
    try {
      const s = fs.statfsSync(name + '\\');
      const total = s.blocks * s.bsize;
      if (total > 0) disks.push({ name, total, used: total - s.bavail * s.bsize });
    } catch {}
  }
  return disks;
}

// Загрузка каждого ядра — для всплывающего окна системы
let prevCores = os.cpus();
function coreUsage() {
  const cur = os.cpus();
  const res = cur.map((c, i) => {
    const p = prevCores[i].times, t = c.times;
    const total = (t.user + t.nice + t.sys + t.idle + t.irq) - (p.user + p.nice + p.sys + p.idle + p.irq);
    return total ? Math.round(100 * (1 - (t.idle - p.idle) / total)) : 0;
  });
  prevCores = cur;
  return res;
}

// tasklist пишет в OEM-кодировке консоли (866), иначе русские имена процессов превращаются в кракозябры
function tasklist(cb) {
  execFile('tasklist', ['/fo', 'csv', '/nh'], { windowsHide: true, maxBuffer: 8 * 1024 * 1024, encoding: 'buffer' },
    (err, out) => cb(err, err ? '' : new TextDecoder('ibm866').decode(out)));
}

// Самые «тяжёлые» по памяти процессы, одинаковые имена складываем
function topProcesses() {
  return new Promise((resolve) => {
    tasklist((err, out) => {
      if (err) return resolve([]);
      const sum = new Map();
      for (const line of out.split(/\r?\n/)) {
        const m = line.match(/^"([^"]+)","\d+","[^"]*","\d+","([^"]+)"/);
        if (!m) continue;
        const kb = parseInt(m[2].replace(/\D/g, ''), 10) || 0;
        sum.set(m[1], (sum.get(m[1]) || 0) + kb);
      }
      resolve([...sum].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([name, kb]) => ({ name, mem: kb * 1024 })));
    });
  });
}

function runScript(file) {
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, file)],
      { windowsHide: true, maxBuffer: 16 * 1024 * 1024 }, (err, out) => {
        try { resolve(JSON.parse(out)); } catch { resolve([]); }
      });
  });
}

// ---------- Своё меню «Пуск» ----------
// Список приложений (Get-StartApps) собирается секунды — держим его и иконки в кэше на диске
// и обновляем в фоне, чтобы меню открывалось сразу.

const START_CACHE = dataPath('start-cache.json');
const START_ICONS = dataPath('start-icons.json');
const readJson = (f, def) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return def; } };
// Служебные ярлыки, которые в меню только мешают
const START_JUNK = /uninstall|деинсталл|удал(ить|ение)|readme|documentation|документац|\bhelp\b|справк|website|веб-сайт|license|лиценз|release notes/i;

let startApps = readJson(START_CACHE, []);
let startIcons = readJson(START_ICONS, {});
let startLoadedAt = 0;
let startLoading = null;

function refreshStartApps() {
  if (startLoading) return startLoading;
  startLoading = (async () => {
    const seen = new Set();
    const list = (await runScript('start.ps1'))
      .filter((a) => a.name && a.id && !START_JUNK.test(a.name))
      .filter((a) => { const k = a.name + '|' + a.id; if (seen.has(k)) return false; seen.add(k); return true; })
      .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
    if (list.length) {
      startApps = list;
      fs.writeFileSync(START_CACHE, JSON.stringify(list), 'utf8');
    }
    startLoadedAt = Date.now();
    seedStartPinned();
    await fetchStartIcons();
    if (alive(panel)) panel.webContents.send('start:updated');
    startLoading = null;
  })();
  return startLoading;
}

function fetchStartIcons() {
  const missing = startApps.map((a) => a.id).filter((id) => !(id in startIcons));
  if (!missing.length) return Promise.resolve();
  return new Promise((resolve) => {
    const p = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'starticons.ps1')], { windowsHide: true });
    let out = '';
    p.stdout.setEncoding('utf8');
    p.stdout.on('data', (d) => { out += d; });
    p.on('exit', () => {
      try {
        const got = JSON.parse(out);
        for (const id of missing) startIcons[id] = got[id] || null;  // null — не искать иконку повторно
        fs.writeFileSync(START_ICONS, JSON.stringify(startIcons), 'utf8');
      } catch {}
      resolve();
    });
    p.stdin.end(missing.join('\n'));
  });
}

// Раскладка «Пуска»: страницы (вкладки) → группы → приложения.
// При первом запуске — одна страница с группой «Закреплённые»: то, что есть на панели, плюс самое нужное.
function seedStartPinned() {
  if (config.startLayout) return;
  let pinned = config.startPinned;
  if (!pinned) {
    if (!startApps.length) return;
    const want = [...config.apps.map((a) => a.name.toLowerCase()), 'проводник', 'параметры', 'калькулятор', 'блокнот', 'microsoft store', 'фотографии', 'paint'];
    pinned = [];
    for (const w of want) {
      const a = startApps.find((x) => x.name.toLowerCase() === w) || startApps.find((x) => x.name.toLowerCase().startsWith(w));
      if (a && !pinned.includes(a.id)) pinned.push(a.id);
    }
    pinned = pinned.slice(0, 18);
  }
  config.startLayout = { pages: [{ name: 'Главная', groups: [{ name: 'Закреплённые', apps: pinned }] }] };
  delete config.startPinned;
  saveConfig(config);
}

// Контекстное меню, которое описывает всплывающее окно: пункты с id возвращаются ему командой.
// Так вся логика редактирования «Пуска» живёт в panel.js, а здесь только нативное меню.
function buildCtx(items, send) {
  return items.map((it) => {
    if (it.type === 'separator') return { type: 'separator' };
    const m = { label: it.label, enabled: it.enabled !== false };
    if (it.type === 'checkbox') { m.type = 'checkbox'; m.checked = !!it.checked; }
    if (it.submenu) m.submenu = buildCtx(it.submenu, send);
    else if (it.id) m.click = () => send(it.id);
    return m;
  });
}

function startPinToDock(id) {
  const a = startApps.find((x) => x.id === id);
  if (!a) return;
  let target = null;
  if (a.lnk) { try { target = shell.readShortcutLink(a.lnk).target; } catch {} }
  const exe = target && /\.exe$/i.test(target) && fs.existsSync(target) ? target : null;
  config.apps.push({ name: a.name, path: exe || `shell:AppsFolder\\${id}`, capsule: true });
  saveConfig(config);
}

function startReveal(id) {
  const a = startApps.find((x) => x.id === id);
  if (!a) return;
  let target = null;
  if (a.lnk) { try { target = shell.readShortcutLink(a.lnk).target; } catch {} }
  if (target || a.lnk) shell.showItemInFolder(target || a.lnk);
}

// Импорт закреплённых из «Пуска» Windows. Export-StartLayout отдаёт их по порядку:
// приложения из Store — по AppID, обычные — ярлыком .lnk. Сопоставляем с нашим списком приложений.
const KNOWN_FOLDERS = {
  '{6D809377-6AF0-444B-8957-A3773F02200E}': process.env.ProgramW6432 || 'C:\\Program Files',
  '{7C5A40EF-A0FB-4BFC-874A-C0F2E0B9FA8E}': process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)',
  '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}': (process.env.WINDIR || 'C:\\Windows') + '\\System32',
  '{F38BF404-1D43-42F2-9305-67DE0B28FC23}': process.env.WINDIR || 'C:\\Windows',
  '{F1B32785-6FBA-4FCF-9D55-7B8E7F157091}': process.env.LOCALAPPDATA || '',
  '{3EB685DB-65F9-4CF6-A03A-E3EF65729F3D}': process.env.APPDATA || '',
};
const expandKnown = (s) => Object.entries(KNOWN_FOLDERS).reduce((acc, [g, p]) => acc.replace(g, p), s);

async function importWindowsStart() {
  const file = path.join(os.tmpdir(), 'glassdock-startlayout.json');
  try { fs.unlinkSync(file); } catch {}
  await new Promise((r) => execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Export-StartLayout -Path '${file}'`], { windowsHide: true }, () => r()));
  const list = readJson(file, {}).pinnedList || [];
  if (!startApps.length) await refreshStartApps();
  const ids = [], missing = [];
  for (const it of list) {
    let app = null;
    if (it.packagedAppId) {
      app = startApps.find((a) => a.id.toLowerCase() === it.packagedAppId.toLowerCase());
    } else if (it.desktopAppLink) {
      const lnk = it.desktopAppLink.replace(/%([^%]+)%/g, (_, v) => process.env[v] || '');
      const base = path.basename(lnk, '.lnk');
      app = startApps.find((a) => a.lnk && a.lnk.toLowerCase() === lnk.toLowerCase()) ||
        startApps.find((a) => a.name.toLowerCase() === base.toLowerCase());
      if (!app) {
        // По цели ярлыка: у обычных программ AppID — это путь к exe (иногда с GUID папки вместо пути)
        try {
          const target = shell.readShortcutLink(lnk).target.toLowerCase();
          app = startApps.find((a) => expandKnown(a.id).toLowerCase() === target);
        } catch {}
      }
      if (!app && /file explorer/i.test(base)) app = startApps.find((a) => a.id === 'Microsoft.Windows.Explorer');
    }
    if (app) { if (!ids.includes(app.id)) ids.push(app.id); } else {
      missing.push(it.packagedAppId ? it.packagedAppId.split('_')[0] : path.basename(it.desktopAppLink || '', '.lnk'));
    }
  }
  return { ids, missing, total: list.length };
}

// «Обновить значки»: забываем кэш иконок и собираем заново
async function refreshStartIcons() {
  startIcons = {};
  await fetchStartIcons();
  if (alive(panel)) panel.webContents.send('start:updated');
}

function startLaunch(id) {
  hidePanel();
  spawn('explorer.exe', [`shell:AppsFolder\\${id}`], { detached: true, stdio: 'ignore' }).unref();
}

function startPower(what) {
  hidePanel();
  const run = (cmd, args) => spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  if (what === 'lock') run('rundll32.exe', ['user32.dll,LockWorkStation']);
  if (what === 'sleep') run('powershell.exe', ['-NoProfile', '-Command', "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Application]::SetSuspendState('Suspend', $false, $false)"]);
  if (what === 'restart') run('shutdown.exe', ['/r', '/t', '0']);
  if (what === 'shutdown') run('shutdown.exe', ['/s', '/t', '0']);
  if (what === 'signout') run('shutdown.exe', ['/l']);
}

// ---------- Соцсети: число подписчиков ----------
// Берём с публичных страниц, без входа в аккаунт. История — по дням, для изменения за сутки и неделю.

const SOCIAL_PATH = dataPath('social.json');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
let socialData = readJson(SOCIAL_PATH, {});
let socialLoading = null;

async function getText(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.text();
}

// «30.7M» → 30 700 000
function parseAbbr(s) {
  const m = String(s).replace(/,/g, '').match(/([\d.]+)\s*([KMB])?/i);
  if (!m) return null;
  return Math.round(parseFloat(m[1]) * ({ K: 1e3, M: 1e6, B: 1e9 }[(m[2] || '').toUpperCase()] || 1));
}

const cleanHandle = (h) => String(h).trim().replace(/^https?:\/\/[^/]+\//, '').replace(/^@/, '').replace(/[/?#].*$/, '');

async function fetchFollowers(acc) {
  const h = cleanHandle(acc.handle);
  const s = config.social;
  switch (acc.platform) {
    case 'telegram': {
      const html = await getText(`https://t.me/${h}`);
      const m = html.match(/tgme_page_extra">([^<]+)</);
      if (!m || !/subscriber|member/.test(m[1])) throw new Error('канал не найден');
      return { count: parseInt(m[1].replace(/\D/g, ''), 10) };
    }
    case 'youtube': {
      if (s.ytKey) {
        const q = /^UC[\w-]{20,}$/.test(h) ? `id=${h}` : `forHandle=@${h}`;
        const d = JSON.parse(await getText(`https://www.googleapis.com/youtube/v3/channels?part=statistics&${q}&key=${encodeURIComponent(s.ytKey)}`));
        const st = d.items && d.items[0] && d.items[0].statistics;
        if (st) return { count: +st.subscriberCount };
      }
      const html = await getText(/^UC[\w-]{20,}$/.test(h) ? `https://www.youtube.com/channel/${h}` : `https://www.youtube.com/@${h}`);
      const m = html.match(/"subscriberCountText":\{[^}]*?"simpleText":"([^"]+)"/) || html.match(/([\d.,]+[KMB]?) subscribers/);
      if (!m) throw new Error('канал не найден');
      // YouTube показывает число округлённым — помечаем как примерное
      return { count: parseAbbr(m[1]), approx: true };
    }
    case 'tiktok': {
      const html = await getText(`https://www.tiktok.com/@${h}`);
      const m = html.match(/"followerCount":(\d+)/);
      if (!m) throw new Error('профиль не найден');
      return { count: +m[1] };
    }
    case 'twitch': {
      const t = (await getText(`https://decapi.me/twitch/followcount/${h}`)).trim();
      if (!/^\d+$/.test(t)) throw new Error(t.slice(0, 60) || 'канал не найден');
      return { count: +t };
    }
    case 'github': {
      const d = JSON.parse(await getText(`https://api.github.com/users/${h}`));
      if (d.followers == null) throw new Error('пользователь не найден');
      return { count: d.followers };
    }
    case 'vk': {
      if (!s.vkToken) throw new Error('нужен токен ВКонтакте в настройках');
      const base = `https://api.vk.com/method/%M%&v=5.199&access_token=${encodeURIComponent(s.vkToken)}`;
      const u = JSON.parse(await getText(base.replace('%M%', `users.get?user_ids=${h}&fields=followers_count`)));
      if (u.response && u.response[0] && u.response[0].followers_count != null) return { count: u.response[0].followers_count };
      const g = JSON.parse(await getText(base.replace('%M%', `groups.getById?group_id=${h}&fields=members_count`)));
      const grp = g.response && (g.response.groups || g.response)[0];
      if (grp && grp.members_count != null) return { count: grp.members_count };
      throw new Error((u.error || g.error || {}).error_msg || 'страница не найдена');
    }
  }
  throw new Error('неизвестная соцсеть');
}

const today = () => new Date().toISOString().slice(0, 10);

function refreshSocial() {
  if (socialLoading) return socialLoading;
  socialLoading = (async () => {
    for (const acc of config.social.accounts) {
      const rec = socialData[acc.id] || { history: [] };
      try {
        const r = await fetchFollowers(acc);
        rec.count = r.count;
        rec.approx = !!r.approx;
        rec.error = null;
        rec.at = Date.now();
        // Одна точка на день — последняя за этот день
        const d = today();
        rec.history = rec.history.filter((x) => x.d !== d).concat({ d, c: r.count }).slice(-90);
      } catch (e) {
        rec.error = e.message;
      }
      socialData[acc.id] = rec;
    }
    fs.writeFileSync(SOCIAL_PATH, JSON.stringify(socialData), 'utf8');
    socialLoading = null;
    pushSocial();
  })();
  return socialLoading;
}

// Изменение: сейчас минус последняя точка не позже, чем days дней назад
function socialDelta(rec, days) {
  if (!rec || rec.count == null || !rec.history) return null;
  const since = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
  const old = [...rec.history].reverse().find((x) => x.d <= since);
  return old ? rec.count - old.c : null;
}

function socialView() {
  const sel = config.social.accounts.some((a) => a.id === config.social.selected) ? config.social.selected : (config.social.accounts[0] || {}).id;
  return config.social.accounts.map((acc) => {
    const rec = socialData[acc.id] || {};
    return {
      ...acc, selected: acc.id === sel, handle: cleanHandle(acc.handle), count: rec.count ?? null, approx: !!rec.approx, error: rec.error || null, at: rec.at || null,
      day: socialDelta(rec, 1), week: socialDelta(rec, 7), history: (rec.history || []).slice(-30),
    };
  });
}

function pushSocial() {
  for (const w of [win, panel, settingsWin, assistWin]) if (alive(w)) w.webContents.send('social', socialView());
}

// ---------- Ассистент Патрик ----------
// Отдельное прозрачное окно поверх всех: Патрик сидит на верхнем краю панели.
// Прозрачные места окна пропускают клики насквозь — ловим мышь только над Патриком и его облачком.

const ASSIST_W = 360, ASSIST_H = 320;
const ASSIST_SINK = 10;   // насколько ноги «сидят» на панели
const ASSIST_EDGE_GAP = 4; // запас от края: ноги не уходят под экран даже при округлении DPI
let assistWin = null;
const assistOn = () => !!(config && config.assistant.enabled);

function createAssistant() {
  assistWin = new BrowserWindow({
    width: ASSIST_W, height: ASSIST_H, frame: false, transparent: true, resizable: false, hasShadow: false,
    skipTaskbar: true, alwaysOnTop: true, show: false, backgroundColor: '#00000000',
    // Неактивируемое, как панель (стиль WS_EX_NOACTIVATE, см. createWindow). Фокус для строки
    // вопроса включаем сами (assist:focus) и потом выключаем.
    // autoplayPolicy: звук микрофона обрабатываем без клика пользователя по окну
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, zoomMode: 'isolated', backgroundThrottling: false, autoplayPolicy: 'no-user-gesture-required' },
  });
  assistWin.setAlwaysOnTop(true, 'screen-saver');
  // Без forward: эта опция ставит глобальный перехватчик мыши, и из-за него панель теряла нажатия.
  // Где курсор — над Патриком или нет — проверяем сами в assistHitTick.
  assistWin.setIgnoreMouseEvents(true);
  assistWin.loadFile('assistant.html');
  assistWin.once('ready-to-show', () => applyAssistant());
  assistWin.on('show', () => noActivate(assistWin));
  // Ушёл фокус — сворачиваем строку ввода и снова делаем окно неактивируемым
  assistWin.on('blur', () => {
    if (!alive(assistWin)) return;
    assistWin.webContents.send('assist:blur');
    noActivate(assistWin);
  });
}

const walking = () => config.assistant.mode === 'walk';
let walkX = null;   // в режиме прогулки — где сейчас окно Патрика (левый край)

// Оба окна alwaysOnTop, но это не задаёт их порядок друг относительно друга.
// Поднимаем персонажа без фокуса, в том числе при наведении на панель.
function raiseAssistant() {
  if (alive(assistWin) && assistWin.isVisible()) assistWin.moveTop();
}

// Границы прогулки: Патрик (центр окна) не уходит дальше 40 px от краёв экрана
function walkBounds() {
  const db = screen.getPrimaryDisplay().bounds;
  const width = alive(assistWin) ? assistWin.getBounds().width : ASSIST_W;
  return { min: db.x + 40 - width / 2, max: db.x + db.width - 40 - width / 2 };
}

// Летит (его подбросили мышкой) — окно двигает физика из окна ассистента, обычное место не ставим
let assistFlying = false;
let assistFlightId = 0;
let assistFlight = null;

// Размер берём у реального окна: после смены DPI он может отличаться от исходных 360 × 320.
function assistLimits() {
  const db = screen.getPrimaryDisplay().bounds;
  const b = assistWin.getBounds();
  return {
    width: b.width, height: b.height,
    minX: db.x - b.width / 2 + 40, maxX: db.x + db.width - b.width / 2 - 40,
    minY: db.y - b.height + 150, maxY: db.y + db.height - b.height - ASSIST_EDGE_GAP,
  };
}

// Следует за панелью до края экрана; в полёте обновляет поверхность приземления.
function placeAssistant(dockY) {
  if (assistFlying) { syncAssistFlight(); return; }
  const p = assistPos(dockY);
  if (p) assistWin.setPosition(p.x, p.y);
}

// Где должно стоять окно ассистента сейчас: { x, y } или null
function assistPos(dockY) {
  if (!alive(assistWin) || !dockTarget) return null;
  const t = dockTarget;
  const limits = assistLimits();
  const top = config.appearance.position === 'top';
  const y0 = dockY ?? (anim ? anim.y : autoHideOn() && !dockShown ? hiddenBounds().y : t.y);
  let x;
  if (walking()) {
    const b = walkBounds();
    if (walkX === null) walkX = Math.round(t.x + t.width * config.assistant.pos - limits.width / 2);
    walkX = Math.max(b.min, Math.min(walkX, b.max));
    x = walkX;
  } else {
    x = Math.round(t.x + t.width * config.assistant.pos - limits.width / 2);
    x = Math.max(limits.minX, Math.min(x, limits.maxX));
  }
  const surfaceY = top ? y0 + t.height - ASSIST_SINK : y0 - limits.height + ASSIST_SINK;
  const y = Math.max(limits.minY, Math.min(surfaceY, limits.maxY));
  // Не число (NaN) — окно не двигаем: setPosition на нём роняет главный процесс
  if (!Number.isFinite(x) || !Number.isFinite(y)) { if (walking()) walkX = null; return null; }
  // «| 0» превращает -0 (Math.round(-0.3)) в 0: -0 Electron не считает целым и падает
  return { x: Math.round(x) | 0, y: Math.round(y) | 0 };
}

// Шаг прогулки: Патрик сам считает, куда идти, и присылает новое место
ipcMain.on('assist:walk', (_e, x) => {
  if (!walking() || !Number.isFinite(x)) return;
  walkX = x;
  placeAssistant();
});
ipcMain.handle('assist:walkBounds', () => ({ ...walkBounds(), x: walkX }));

function applyAssistant() {
  if (!alive(assistWin)) return;
  if (!assistOn()) { assistWin.hide(); return; }
  placeAssistant();
  if (!assistWin.isVisible()) assistWin.showInactive();
  raiseAssistant();
}

// Окно Патрика ловит мышь только над ним самим и его облачком. Прямоугольники присылает окно Патрика
// (в координатах окна), а положение курсора раз в 50 мс берём у системы.
let assistRects = [];
let assistHold = false;   // перетаскивают или открыта строка вопроса — мышь не отпускаем
let assistCatch = false;
let assistOverDock = false;
ipcMain.on('assist:hit', (_e, rects, hold) => { assistRects = rects; assistHold = hold; });
function assistHitTick() {
  if (app.isQuitting || !alive(assistWin) || !assistWin.isVisible()) return;
  const c = screen.getCursorScreenPoint();
  const d = alive(win) && win.isVisible() ? win.getBounds() : null;
  const overDock = !!d && c.x >= d.x && c.x < d.x + d.width && c.y >= d.y && c.y < d.y + d.height;
  if (overDock && !assistOverDock) raiseAssistant();
  assistOverDock = overDock;
  const b = assistWin.getBounds();
  const over = assistRects.some((r) => c.x >= b.x + r.x && c.x <= b.x + r.x + r.w && c.y >= b.y + r.y && c.y <= b.y + r.y + r.h);
  const want = over || assistHold;
  if (want !== assistCatch) {
    assistCatch = want;
    assistWin.setIgnoreMouseEvents(!want);
  }
}
setInterval(assistHitTick, 50);
// Клик по Патрику — это ввод в наше приложение, так что фокус можно взять самим, без помощника
ipcMain.on('assist:focus', () => {
  if (!alive(assistWin)) return;
  assistWin.setFocusable(true);
  assistWin.focus();
});
ipcMain.on('assist:unfocus', () => noActivate(assistWin));
// Подбрасывание мышкой. Окно ассистента считает полёт само и присылает новые места окна.
//   flyStart → положение, границы и номер полёта; поверхность обновляется во время автоскрытия;
//   flyMove  → поставить окно (x, y);
//   flyEnd   → приземлился в x: это его новое место (на панели — доля ширины, на прогулке — точка дорожки)
function assistFlightBounds() {
  const limits = assistLimits();
  const rest = assistPos();
  return { minX: limits.minX, maxX: limits.maxX, minY: limits.minY, ground: Math.min(rest ? rest.y : limits.maxY, limits.maxY) };
}

function clampAssistFlight(x, y, limits) {
  return {
    x: Math.round(Math.max(limits.minX, Math.min(x, limits.maxX))) | 0,
    y: Math.floor(Math.max(limits.minY, Math.min(y, limits.ground))) | 0,
  };
}

function syncAssistFlight() {
  if (!assistFlight || !alive(assistWin)) return null;
  const limits = assistFlightBounds();
  const key = JSON.stringify(limits);
  if (key !== assistFlight.boundsKey) {
    assistFlight.boundsKey = key;
    assistWin.webContents.send('assist:ground', { id: assistFlight.id, ...limits });
  }
  const b = assistWin.getBounds();
  const p = clampAssistFlight(b.x, b.y, limits);
  if (p.x !== b.x || p.y !== b.y) assistWin.setPosition(p.x, p.y);
  return limits;
}

ipcMain.handle('assist:flyStart', (e, grab) => {
  if (!alive(assistWin) || e.sender !== assistWin.webContents) return null;
  assistFlying = true;
  assistFlight = { id: ++assistFlightId, boundsKey: '' };
  syncAssistFlight();
  const b = assistWin.getBounds();
  // Фиксируем точку внутри окна с pointerdown, до задержки IPC и порога перетаскивания.
  // Перемещение считаем в DIP по системному курсору, без screenX/screenY движущегося окна.
  const c = screen.getCursorScreenPoint();
  const zoom = assistWin.webContents.getZoomFactor();
  assistFlight.held = true;
  assistFlight.grab = grab && Number.isFinite(grab.x) && Number.isFinite(grab.y)
    ? { x: Math.max(0, Math.min(b.width, grab.x * zoom)), y: Math.max(0, Math.min(b.height, grab.y * zoom)) }
    : { x: c.x - b.x, y: c.y - b.y };
  return moveHeldAssistant();
});
function moveHeldAssistant() {
  const limits = syncAssistFlight();
  const c = screen.getCursorScreenPoint();
  const g = assistFlight.grab;
  const p = clampAssistFlight(c.x - g.x, c.y - g.y, limits);
  const b = assistWin.getBounds();
  const last = assistFlight.heldPosition;
  const unchanged = last && last.x === p.x && last.y === p.y;
  if ((!unchanged || Math.abs(p.x - b.x) > 1 || Math.abs(p.y - b.y) > 1) && (p.x !== b.x || p.y !== b.y)) assistWin.setPosition(p.x, p.y);
  assistFlight.heldPosition = p;
  return { id: assistFlight.id, ...p, ...limits };
}

ipcMain.handle('assist:holdMove', (e, id) => {
  if (!alive(assistWin) || e.sender !== assistWin.webContents || !assistFlight || id !== assistFlight.id || !assistFlight.held) return null;
  return moveHeldAssistant();
});
ipcMain.handle('assist:flyRelease', (e, id) => {
  if (!alive(assistWin) || e.sender !== assistWin.webContents || !assistFlight || id !== assistFlight.id || !assistFlight.held) return null;
  const p = moveHeldAssistant();
  assistFlight.held = false;
  return p;
});
ipcMain.on('assist:flyMove', (e, id, x, y) => {
  if (!assistFlying || !assistFlight || assistFlight.held || id !== assistFlight.id || !alive(assistWin) || e.sender !== assistWin.webContents || !Number.isFinite(x) || !Number.isFinite(y)) return;
  const limits = syncAssistFlight();
  const p = clampAssistFlight(x, y, limits);
  assistWin.setPosition(p.x, p.y);
});
ipcMain.on('assist:flyEnd', (e, id, x) => {
  if (!alive(assistWin) || e.sender !== assistWin.webContents || !assistFlight || id !== assistFlight.id) return;
  assistFlying = false;
  assistFlight = null;
  if (!dockTarget || !Number.isFinite(x)) return placeAssistant();
  if (walking()) {
    const b = walkBounds();
    walkX = Math.max(b.min, Math.min(x, b.max));
  } else {
    config.assistant.pos = Math.max(0, Math.min(1, (x + assistWin.getBounds().width / 2 - dockTarget.x) / dockTarget.width));
    saveConfig(config);
  }
  placeAssistant();
});

// Перетаскивание Патрика вдоль панели: сдвиг в пикселях → новое место (доля ширины панели)
let assistDragFrom = null;
ipcMain.on('assist:drag', (_e, phase, dx) => {
  if (!dockTarget) return;
  // На прогулке перетаскивание просто переносит его в другое место дорожки
  if (walking()) {
    if (phase === 'start') assistDragFrom = walkX;
    if (assistDragFrom === null) return;
    walkX = assistDragFrom + dx;
    placeAssistant();
    if (phase === 'end') assistDragFrom = null;
    return;
  }
  if (phase === 'start') assistDragFrom = config.assistant.pos;
  if (assistDragFrom === null) return;
  const pos = Math.max(0, Math.min(1, assistDragFrom + dx / dockTarget.width));
  config.assistant.pos = pos;
  placeAssistant();
  if (phase === 'end') { assistDragFrom = null; saveConfig(config); }
});
// Меню ассистента — по кнопке ассистента на панели
ipcMain.on('assist:menu', () => {
  const a = config.assistant;
  const muted = a.muteUntil > Date.now();
  const p = assistantOf(config);
  const send = (c) => { if (alive(assistWin)) assistWin.webContents.send('assist:cmd', c); };
  if (!a.enabled) {
    Menu.buildFromTemplate([
      { label: `Показать ${p.acc}`, click: () => { a.enabled = true; saveConfig(config); } },
      { type: 'separator' },
      ...Object.entries(ASSISTANTS).map(([id, x]) => ({
        label: x.name, type: 'radio', checked: x === p, click: () => { a.persona = id; saveConfig(config); },
      })),
      { type: 'separator' },
      { label: 'Настройки ассистента…', click: () => { openSettings(); setTimeout(() => settingsWin && settingsWin.webContents.send('goto', 'assistant'), 700); } },
    ]).popup({ window: win });
    return;
  }
  Menu.buildFromTemplate([
    { label: 'Спросить…', click: () => send('?ask') },
    { type: 'separator' },
    ...Object.entries(ASSISTANTS).map(([id, x]) => ({
      label: x.name, type: 'radio', checked: x === p, click: () => { a.persona = id; saveConfig(config); },
    })),
    { type: 'separator' },
    { label: 'Сидит на панели', type: 'radio', checked: !walking(), click: () => { a.mode = 'sit'; saveConfig(config); } },
    { label: 'Гуляет по экрану', type: 'radio', checked: walking(), click: () => { a.mode = 'walk'; walkX = null; saveConfig(config); } },
    { type: 'separator' },
    { label: 'Сводка дня', click: () => send('сводка') },
    { label: 'Мои напоминания', click: () => send('напоминания') },
    { label: muted ? 'Снова показывать реплики' : 'Скрыть реплики на час', click: () => { a.muteUntil = muted ? 0 : Date.now() + 3600e3; saveConfig(config); } },
    { label: `Слушать имя «${p.name}»`, type: 'checkbox', checked: !!a.voice.enabled, click: (i) => { a.voice.enabled = i.checked; saveConfig(config); } },
    { type: 'separator' },
    { label: 'Настройки ассистента…', click: () => { openSettings(); setTimeout(() => settingsWin && settingsWin.webContents.send('goto', 'assistant'), 700); } },
    { label: `Спрятать ${p.acc}`, click: () => { a.enabled = false; saveConfig(config); } },
  ]).popup({ window: win });
});

// Сколько секунд пользователь ничего не трогал — чтобы Патрик засыпал
setInterval(() => { if (alive(assistWin) && assistOn()) assistWin.webContents.send('assist:idle', powerMonitor.getSystemIdleTime()); }, 5000);

// Напоминания и произвольные таймеры: проверяем раз в секунду.
setInterval(() => {
  if (!config || !config.assistant.reminders.length) return;
  const now = Date.now();
  const due = config.assistant.reminders.filter((r) => r.at <= now);
  if (!due.length) return;
  config.assistant.reminders = config.assistant.reminders.filter((r) => r.at > now);
  saveConfig(config);
  for (const r of due) {
    if (Notification.isSupported()) new Notification({ title: r.kind === 'timer' ? 'Таймер завершён' : `${assistantOf(config).name} напоминает`, body: r.text }).show();
    if (alive(assistWin)) assistWin.webContents.send('assist:event', { type: r.kind === 'timer' ? 'timer' : 'reminder', text: r.text });
  }
}, 1000);

ipcMain.handle('assist:remind', (_e, at, text) => {
  config.assistant.reminders.push({ id: Date.now().toString(36), at, text });
  config.assistant.reminders.sort((a, b) => a.at - b.at);
  saveConfig(config);
  return config.assistant.reminders;
});
ipcMain.on('assist:remindDel', (_e, id) => {
  config.assistant.reminders = config.assistant.reminders.filter((r) => r.id !== id);
  saveConfig(config);
});

// «Открой Telegram»: ищем среди приложений «Пуска» по названию
ipcMain.handle('assist:open', (_e, query) => openAppByName(query));
async function openAppByName(query) {
  if (!startApps.length) await refreshStartApps();
  const q = query.toLowerCase().trim();
  const app2 = startApps.find((a) => a.name.toLowerCase() === q) ||
    startApps.find((a) => a.name.toLowerCase().startsWith(q)) ||
    startApps.find((a) => a.name.toLowerCase().split(/[\s\-_.]+/).some((w) => w.startsWith(q))) ||
    startApps.find((a) => a.name.toLowerCase().includes(q));
  if (!app2) return null;
  spawn('explorer.exe', [`shell:AppsFolder\\${app2.id}`], { detached: true, stdio: 'ignore' }).unref();
  return app2.name;
}
// Громкость и музыка — медиаклавишами
const ASSIST_KEYS = { volup: 0xAF, voldown: 0xAE, mute: 0xAD, playpause: 0xB3, next: 0xB0, prev: 0xB1 };
ipcMain.on('assist:key', (_e, name, times = 1) => {
  if (!ASSIST_KEYS[name]) return;
  if (process.env.GLASSDOCK_DRYRUN) { actLog.push({ open: `key:${name}x${times}` }); return; }
  for (let i = 0; i < times; i++) sendKey(ASSIST_KEYS[name]);
});
ipcMain.on('assist:pomodoro', () => win && win.webContents.send('pomodoro:start'));

// ---------- Действия ассистента: музыка и видео, сайты, Wi-Fi/Bluetooth, параметры, папки ----------
// Общие для «мозга» (инструменты) и прежних команд без нейросети. Возвращают { ok, text } — text читает модель.

const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

// YouTube часто доступен только через VPN-клиент (xray/Happ, Clash, Hiddify…), а браузер ходит через его
// локальный прокси. Пробуем напрямую, потом через типичные локальные прокси; удачный путь запоминаем.
const NET_ROUTES = ['direct://', 'http://127.0.0.1:10809', 'socks5://127.0.0.1:10808', 'http://127.0.0.1:7890', 'http://127.0.0.1:2080', 'socks5://127.0.0.1:2080', 'http://127.0.0.1:12334'];
const netRoute = {};   // сайт → удачный путь (напрямую или через какой прокси)
const netSessions = {};
async function routeSession(route) {
  if (!netSessions[route]) {
    const ses = session.fromPartition('glassdock-net:' + route);   // без persist: — ничего не хранится на диске
    await ses.setProxy(route === 'direct://' ? { mode: 'direct' } : { proxyRules: route });
    netSessions[route] = ses;
  }
  return netSessions[route];
}
// fetch, который сам находит дорогу: напрямую или через локальный прокси VPN-клиента.
// Ответ сервера (любой код) считается «дошли»; сеть не отвечает — пробуем следующий путь
// Spotify в России не работает: команды плееру с российского адреса он молча игнорирует, хотя отвечает «ок».
// Поэтому для его адресов сначала пробуем прокси VPN-клиента (как и сам Spotify), потом напрямую
const PREFER_PROXY = /(^|\.)spotify\.com$/;
async function netFetch(url, opts = {}) {
  const host = new URL(url).hostname;
  const known = netRoute[host];
  const order = PREFER_PROXY.test(host) ? [...NET_ROUTES.slice(1), NET_ROUTES[0]] : NET_ROUTES;
  const routes = known ? [known, ...order.filter((x) => x !== known)] : order;
  let lastErr;
  for (const route of routes) {
    try {
      const ses = await routeSession(route);
      const r = await ses.fetch(url, { ...opts, headers: { 'User-Agent': BROWSER_UA, 'Accept-Language': 'ru-RU,ru;q=0.9', ...(opts.headers || {}) }, signal: AbortSignal.timeout(route === known ? 15000 : 4000) });
      netRoute[host] = route;
      return r;
    } catch (e) { lastErr = e; }
  }
  delete netRoute[host];
  throw lastErr || new Error('нет связи');
}
async function ytFetch(url) {
  try { const r = await netFetch(url); return r.ok ? await r.text() : ''; } catch { return ''; }
}

// Первое обычное видео из поиска YouTube (без ключа API: из данных страницы результатов)
async function youtubeFirst(q) {
  try {
    const html = await ytFetch('https://www.youtube.com/results?hl=ru&search_query=' + encodeURIComponent(q));
    const m = html.match(/"videoRenderer":\{"videoId":"([\w-]{11})"[\s\S]{0,4000}?"title":\{"runs":\[\{"text":"((?:[^"\\]|\\.)*)"/);
    if (m) { let title = m[2]; try { title = JSON.parse('"' + m[2] + '"'); } catch {} return { id: m[1], title }; }
  } catch {}
  return null;
}

const SETTINGS_PAGES = {
  display: 'display', night_light: 'nightlight', sound: 'sound', bluetooth: 'bluetooth', wifi: 'network-wifi', network: 'network-status',
  notifications: 'notifications', do_not_disturb: 'notifications', focus: 'focus', personalization: 'personalization',
  background: 'personalization-background', colors: 'colors', apps: 'appsfeatures', default_apps: 'defaultapps', startup_apps: 'startupapps',
  power: 'powersleep', battery: 'batterysaver', storage: 'storagesense', mouse: 'mousetouchpad', keyboard: 'typing',
  language: 'regionlanguage', time: 'dateandtime', windows_update: 'windowsupdate', privacy: 'privacy', accounts: 'yourinfo', about: 'about',
};
const FOLDERS = {
  downloads: 'downloads', загрузки: 'downloads', documents: 'documents', документы: 'documents', desktop: 'desktop', 'рабочий стол': 'desktop',
  pictures: 'pictures', изображения: 'pictures', картинки: 'pictures', фото: 'pictures', music: 'music', музыка: 'music',
  videos: 'videos', видео: 'videos', home: 'home', 'домашняя папка': 'home',
};
const SHELL_FOLDERS = { recycle_bin: 'shell:RecycleBinFolder', корзина: 'shell:RecycleBinFolder', this_pc: 'shell:MyComputerFolder', 'этот компьютер': 'shell:MyComputerFolder', 'мой компьютер': 'shell:MyComputerFolder' };

function runRadio(kind, state) {
  return new Promise((res) => execFile('powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'radio.ps1'), '-Kind', kind, '-State', state],
    { windowsHide: true, timeout: 20_000, encoding: 'utf8' },
    (e, out) => { try { res(JSON.parse(String(out).trim().split(/\r?\n/).pop())); } catch { res({ ok: false, error: e ? e.message : 'нет ответа' }); } }));
}

// GLASSDOCK_DRYRUN=1 — для проверок: действия не выполняются, а записываются в actLog
const DRY = !!process.env.GLASSDOCK_DRYRUN;
const actLog = [];
const openNativeYandexMusic = createNativeOpener({ spawn });
const yandexMusic = createYandexMusic({
  available: () => DRY || !!findYandexMusicExecutable(),
  openExternal: async (uri) => { if (DRY) actLog.push({ open: uri }); else await openNativeYandexMusic(uri); },
});
ipcMain.handle('music:yandex:status', () => yandexMusic.status());
const assistantJobs = createAssistantJobs({
  getReminders: () => config.assistant.reminders || [],
  saveReminders: (list) => { config.assistant.reminders = list; saveConfig(config); },
  confirmShutdown: async (seconds) => {
    if (DRY) { actLog.push({ confirmShutdown: seconds }); return false; }
    const r = await dialog.showMessageBox({ type: 'question', title: 'Выключение компьютера',
      message: seconds ? `Выключить компьютер через ${formatDuration(seconds)}?` : 'Выключить компьютер сейчас?',
      detail: 'Сохрани открытые документы. Для отмены можно сказать «отмени выключение» или нажать отмену в настройках ассистента. При выходе из Click отложенное выключение отменится.',
      buttons: [seconds ? 'Запланировать выключение' : 'Выключить', 'Отмена'], defaultId: 1, cancelId: 1, noLink: true });
    return r.response === 0;
  },
  shutdown: () => new Promise((resolve, reject) => {
    if (DRY) { actLog.push({ shutdown: true }); resolve(); return; }
    execFile(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'shutdown.exe'), ['/s', '/t', '0'], { windowsHide: true }, (error) => error ? reject(error) : resolve());
  }),
  notify: (text) => {
    if (Notification.isSupported()) new Notification({ title: 'Click — выключение компьютера', body: text }).show();
    if (alive(assistWin)) assistWin.webContents.send('assist:event', { type: 'reminder', text });
  },
});
setInterval(() => { if (app.isReady() && !app.isQuitting) assistantJobs.tick().catch(() => {}); }, 1000);
ipcMain.handle('assist:jobs', () => assistantJobs.status());
async function assistAct(name, a = {}) {
  const r = await assistActNow(name, a);
  if (DRY) { actLog.push({ name, a, r }); if (actLog.length > 50) actLog.shift(); }
  return r;
}
ipcMain.handle('assist:actLog', () => (DRY ? actLog : null));
async function assistActNow(name, a = {}) {
  const open = (url) => { if (DRY) actLog.push({ open: url }); else shell.openExternal(url); };
  switch (name) {
    case 'open_music': {
      if ((a.service || MusicServices.selected(config)) === 'yandex_music') return yandexMusic.open();
      open('spotify:');
      return { ok: true, text: 'Открыто приложение Spotify.' };
    }
    case 'start_timer': case 'list_timers': case 'cancel_timer': case 'schedule_shutdown': case 'cancel_shutdown': case 'shutdown_status':
      return assistantJobs.act(name, a);
    case 'open_weather': {
      if (DRY) actLog.push({ open: 'panel:weather' });
      else if (panelShown() && panelMode === 'weather') panel.focus();
      else await openPanel('weather', win.getBounds().width / win.webContents.getZoomFactor() * 0.8);
      return { ok: true, text: `${assistantOf(config).female ? 'Открыла' : 'Открыл'} прогноз погоды.` };
    }
    case 'search_youtube': {
      const query = String(a.query || '').trim().slice(0, 300);
      if (!query) return { ok: false, text: 'Что найти на YouTube?' };
      open('https://www.youtube.com/results?search_query=' + encodeURIComponent(query));
      return { ok: true, text: `Открыт поиск на YouTube: «${query}».` };
    }
    case 'play_media': {
      const q = String(a.query || '').trim();
      if (!q) return { ok: false, text: 'Не сказано, что включить.' };
      const svc = ['spotify', 'yandex_music', 'youtube', 'youtube_music'].includes(a.service) ? a.service : MusicServices.selected(config);
      if (svc === 'yandex_music') return yandexMusic.open(q);
      if (svc === 'spotify') {
        const sp = spotify.status();
        if (sp.ready) {
          if (DRY) {
            const it = await spotify.pick(q, a.kind || 'track').catch(() => null);
            actLog.push({ open: `spotify:play:${a.kind || 'track'}:${q} → ${it ? `${it.type}${it.mine ? ' (своё)' : ''}: ${it.title}` : 'не найдено'}` });
            return { ok: true, text: `Играет в Spotify: ${it ? it.title : q}.` };
          }
          const r = await spotify.play(q, a.kind || 'track');
          if (r.ok) return { ok: true, text: `Играет в Spotify: ${r.title}.`, title: r.title };
          if (r.error === 'notfound') return { ok: false, text: `В Spotify не нашлось «${q}».` };
          if (r.error === 'premium') return { ok: false, text: `Открыто в Spotify: ${r.title}. Включать сам Spotify разрешает только с Premium — нажми Play.` };
          if (r.error === 'nodevice') return { ok: false, text: `Spotify не запустился вовремя — открыто: ${r.title}, нажми Play.` };
          if (r.error === 'notready') return { ok: false, text: 'Spotify не запустился или в нём не выполнен вход.' };
          return { ok: false, text: 'Spotify не ответил: ' + (r.detail || r.error) };
        }
        // Вход не настроен — хотя бы поиск в приложении Spotify
        open('spotify:search:' + encodeURIComponent(q));
        return { ok: true, text: `Открыт поиск «${q}» в Spotify. Чтобы музыка включалась сразу, нужно войти в Spotify в настройках ассистента.` };
      }
      if (svc === 'youtube') {
        const v = await youtubeFirst(q);
        if (v) { open(`https://www.youtube.com/watch?v=${v.id}`); return { ok: true, text: `Открыто видео на YouTube: «${v.title}».`, title: v.title }; }
        open('https://www.youtube.com/results?search_query=' + encodeURIComponent(q));
        return { ok: true, text: 'Не удалось выбрать видео — открыт поиск на YouTube.' };
      }
      open('https://music.youtube.com/search?q=' + encodeURIComponent(q));
      return { ok: true, text: `Открыт поиск «${q}» в YouTube Music. Нажми Play у нужного трека.` };
    }
    case 'queue_song': {
      if ((a.service || MusicServices.selected(config)) === 'yandex_music') return { ok: false, text: 'Открой меню нужного трека в Яндекс Музыке и выбери «Добавить в очередь».' };
      const q = String(a.query || '').trim();
      if (!q) return { ok: false, text: 'Не сказано, что добавить.' };
      if (!spotify.status().ready) return { ok: false, text: 'Для очереди нужно войти в Spotify в настройках ассистента.' };
      if (DRY) { actLog.push({ open: 'spotify:queue:' + q }); return { ok: true, text: `В очереди Spotify: ${q}.` }; }
      const r = await spotify.queue(q);
      if (r.ok) return { ok: true, text: `В очереди Spotify: ${r.title}.` };
      if (r.error === 'notfound') return { ok: false, text: `В Spotify не нашлось «${q}».` };
      if (r.error === 'premium') return { ok: false, text: 'Очередь Spotify разрешает менять только с Premium.' };
      if (r.error === 'notready') return { ok: false, text: 'Spotify не запустился или в нём не выполнен вход.' };
      return { ok: false, text: 'Spotify не ответил: ' + (r.detail || r.error) };
    }
    case 'playback_mode': {
      if ((a.service || MusicServices.selected(config)) === 'yandex_music') return { ok: false, text: 'Перемешивание и повтор можно включить кнопками плеера Яндекс Музыки.' };
      const sh = ['on', 'off'].includes(a.shuffle) ? a.shuffle : null;
      const rp = ['off', 'context', 'track'].includes(a.repeat) ? a.repeat : null;
      if (!sh && !rp) return { ok: false, text: 'Нечего менять.' };
      if (DRY) { actLog.push({ open: `spotify:mode shuffle=${sh || '-'} repeat=${rp || '-'}` }); return { ok: true, text: 'Готово.' }; }
      const r = await spotify.mode(sh, rp);
      if (r.ok) return { ok: true, text: 'Spotify: ' + r.done.join(', ') + '.' };
      if (r.error === 'nocli') return { ok: false, text: 'Перемешивание и повтор работают с приложением Spotify на этом ПК — его нужно обновить.' };
      if (r.error === 'notready') return { ok: false, text: 'Spotify не запустился или в нём не выполнен вход.' };
      return { ok: false, text: 'Spotify не ответил: ' + (r.detail || r.error) };
    }
    case 'add_to_playlist': {
      if ((a.service || MusicServices.selected(config)) === 'yandex_music') return { ok: false, text: 'Открой меню трека в Яндекс Музыке, чтобы добавить его в свою коллекцию или плейлист.' };
      if (DRY) {
        const pl = await spotify.myPlaylist(String(a.playlist || '')).catch(() => null);
        actLog.push({ open: `spotify:add «${a.track || 'текущий'}» → ${pl ? pl.title : 'плейлист не найден'}` });
        return pl ? { ok: true, text: `Добавлено в «${pl.title}».` } : { ok: false, text: `Плейлиста «${a.playlist}» нет.` };
      }
      const r = await spotify.addToPlaylist(a.playlist, a.track);
      if (r.ok) return { ok: true, text: `Добавлено: ${r.track} → «${r.playlist}».` };
      const why = {
        noplaylist: `У тебя нет плейлиста «${a.playlist}».`,
        nothingplaying: 'Сейчас ничего не играет — не знаю, что добавить.',
        notfound: `Песня «${a.track}» не нашлась.`,
        notmine: `«${r.playlist}» — чужой плейлист (от Spotify или другого человека), в него добавлять нельзя.`,
        nocli: 'Добавление работает с приложением Spotify на этом ПК — его нужно обновить.',
        notready: 'Spotify не запустился или в нём не выполнен вход.',
      }[r.error];
      return { ok: false, text: why || 'Spotify не ответил: ' + (r.detail || r.error) };
    }
    case 'open_website': {
      let u = String(a.url || '').trim();
      if (!/^https?:\/\//i.test(u)) u = /^[\w-]+(\.[\w-]+)+(\/.*)?$/.test(u) ? 'https://' + u : '';
      if (!u) return { ok: false, text: 'Нужен адрес сайта.' };
      try { new URL(u); } catch { return { ok: false, text: 'Неправильный адрес.' }; }
      if (isYandexMusicUrl(u)) return yandexMusic.openLink(u);
      open(u);
      return { ok: true, text: `Открыт сайт ${new URL(u).hostname}.` };
    }
    case 'search_in_browser': {
      const q = String(a.query || '').trim();
      if (!q) return { ok: false, text: 'Пустой запрос.' };
      open((a.engine === 'google' ? 'https://www.google.com/search?q=' : 'https://yandex.ru/search/?text=') + encodeURIComponent(q));
      return { ok: true, text: `Открыт поиск: ${q}.` };
    }
    case 'toggle_radio': {
      const kind = a.device === 'bluetooth' ? 'bluetooth' : 'wifi';
      const label = kind === 'wifi' ? 'Wi-Fi' : 'Bluetooth';
      const r = await runRadio(kind, DRY ? 'status' : ['on', 'off', 'toggle'].includes(a.state) ? a.state : 'toggle');
      if (r.ok) return { ok: true, text: `${label} ${r.radios.every((x) => x.state === 'On') ? 'включён' : 'выключен'}.` };
      if (r.error === 'none') return { ok: false, text: `На этом компьютере нет ${label}-адаптера${kind === 'wifi' ? ' (похоже, интернет по кабелю)' : ''}.` };
      if (r.error === 'denied') { open(`ms-settings:${kind === 'wifi' ? 'network-wifi' : 'bluetooth'}`); return { ok: false, text: `Windows не дала переключить ${label} — открыты параметры, переключи там.` }; }
      return { ok: false, text: `Не получилось переключить ${label}: ${r.error}` };
    }
    case 'open_settings': {
      const page = SETTINGS_PAGES[a.page];
      if (!page) return { ok: false, text: 'Нет такой страницы параметров.' };
      open('ms-settings:' + page);
      return { ok: true, text: 'Открыты параметры Windows.' };
    }
    case 'open_folder': {
      const f = String(a.folder || '').trim();
      const key = f.toLowerCase();
      if (SHELL_FOLDERS[key]) {
        if (DRY) actLog.push({ open: SHELL_FOLDERS[key] }); else spawn('explorer.exe', [SHELL_FOLDERS[key]], { detached: true, stdio: 'ignore' }).unref();
        return { ok: true, text: 'Открыто.' };
      }
      let p = FOLDERS[key] ? (FOLDERS[key] === 'home' ? os.homedir() : app.getPath(FOLDERS[key])) : f.replace(/^["']|["']$/g, '');
      if (p.startsWith('~')) p = path.join(os.homedir(), p.slice(1));
      // Только папки: файлы и программы так не запускаем
      try { if (!fs.statSync(p).isDirectory()) return { ok: false, text: 'Это не папка — файлы я не открываю.' }; } catch { return { ok: false, text: `Папки «${f}» нет.` }; }
      const err = DRY ? (actLog.push({ open: p }), '') : await shell.openPath(p);
      return err ? { ok: false, text: 'Не открылась: ' + err } : { ok: true, text: `Открыта папка ${path.basename(p) || p}.` };
    }
  }
  return { ok: false, text: 'Не умею.' };
}
ipcMain.handle('assist:act', (_e, name, args) => assistAct(name, args));

// Spotify: вход через браузер (PKCE), поиск и включение. Client ID — в config.spotify, токены — в spotify.key
const spotify = createSpotify({ config: () => config, netFetch });
ipcMain.handle('spotify:status', () => spotify.status());
ipcMain.handle('spotify:login', () => spotify.startLogin());
ipcMain.handle('spotify:logout', () => spotify.logout());
ipcMain.handle('spotify:player', () => spotify.player());
// Библиотеку (плейлисты пользователя) подгружаем заранее — чтобы «мозг» сразу знал названия
setTimeout(() => spotify.library().catch(() => {}), 8000);

// ---------- «Мозг» ассистента ----------

const brain = createBrain({
  config: () => config,
  media: () => lastMedia,
  todos: () => readTodos(),
  setTodos: (list) => writeTodos(list),
  cpu: () => cpuUsage(),
  idle: () => powerMonitor.getSystemIdleTime(),
  openApp: async (q) => {
    if (!DRY) return openAppByName(q);
    // Проверки: ищем, но не запускаем
    if (!startApps.length) await refreshStartApps();
    const s = q.toLowerCase().trim();
    const hit = startApps.find((a) => a.name.toLowerCase() === s) || startApps.find((a) => a.name.toLowerCase().startsWith(s)) || startApps.find((a) => a.name.toLowerCase().includes(s));
    actLog.push({ open: `app:${q} → ${hit ? hit.name : 'нет'}` });
    return hit ? hit.name : null;
  },
  act: (name, input) => assistAct(name, input),
  playlists: () => MusicServices.selected(config) === 'spotify' ? spotify.playlistNames() : [],
  mediaKey: (name, times) => { if (DRY) { actLog.push({ open: `key:${name}x${times}` }); return; } for (let i = 0; i < times; i++) sendKey(ASSIST_KEYS[name]); },
  pomodoro: () => alive(win) && win.webContents.send('pomodoro:start'),
  addReminder: (at, text) => {
    config.assistant.reminders.push({ id: Date.now().toString(36), at, text });
    config.assistant.reminders.sort((a, b) => a.at - b.at);
    saveConfig(config);
  },
  deleteReminder: (id) => {
    const n = config.assistant.reminders.length;
    config.assistant.reminders = config.assistant.reminders.filter((r) => r.id !== id);
    saveConfig(config);
    return config.assistant.reminders.length < n;
  },
  weather: async () => {
    try {
      const d = await weather.get(), c = d.current;
      const days = d.daily.time.slice(0, 3).map((t, i) => `${t}: ${Math.round(d.daily.temperature_2m_min[i])}…${Math.round(d.daily.temperature_2m_max[i])}°, ${weatherText(d.daily.weather_code[i])}`);
      return `${config.weather.city} сейчас: ${Math.round(c.temperature_2m)}°, ${c.description || weatherText(c.weather_code)}. Данные ${d.source}.\n` + days.join('\n');
    } catch (e) { return e.message; }
  },
});
const brainOn = () => config.assistant.brain.enabled;
ipcMain.handle('brain:ask', (_e, text) => brain.ask(config.assistant.persona || 'patrick', text));
ipcMain.handle('brain:status', () => ({ ...brain.status(), enabled: brainOn() }));
ipcMain.handle('brain:setKey', (_e, provider, key) => brain.setKey(provider, key));
ipcMain.handle('brain:models', (_e, provider) => brain.listModels(provider));
ipcMain.on('brain:reset', () => brain.reset());

// ---------- Голос: распознавание фраз ----------

const voice = createVoice({ groqKey: () => brain.key('groq'), config: () => config });
const sendVoiceStatus = (s) => { for (const w of [settingsWin, assistWin]) if (alive(w)) w.webContents.send('voice:status', s); };
ipcMain.handle('voice:transcribe', (_e, wav) => voice.transcribe(Buffer.from(wav)));
ipcMain.handle('voice:status', () => voice.status());
ipcMain.handle('voice:install', (_e, model) => voice.install(model, sendVoiceStatus));
ipcMain.handle('voice:remove', () => voice.remove());

// ---------- Клавиша Win открывает наш «Пуск» ----------

let winkeyProc = null;

function applyWinKey() {
  const o = config.widgetOpts.start;
  const want = config.widgets.start && o.menu === 'glass' && o.winKey;
  if (want && !winkeyProc) {
    winkeyProc = helperProc('winkey');
    winkeyProc.stdout.setEncoding('utf8');
    winkeyProc.stdout.on('data', (d) => { if (d.includes('start')) toggleStartFromKey(); });
    winkeyProc.on('exit', () => { winkeyProc = null; });
  } else if (!want && winkeyProc) {
    winkeyProc.kill();
    winkeyProc = null;
  }
}

function toggleStartFromKey() {
  if (panelShown() && panelMode === 'start') return panel.hide();
  // Где кнопка «Пуск» на панели, знает только сама панель
  win.webContents.send('open-start');
}


// ---------- Источники музыки и видео ----------

const MEDIA_PREF = path.join(process.env.TEMP || os.tmpdir(), 'glassdock-media.pref');
let mediactlProc = null;

function mediaCtl(cmd, source) {
  if (!mediactlProc) {
    mediactlProc = helperProc('mediactl');
    mediactlProc.on('exit', () => { mediactlProc = null; });
  }
  mediactlProc.stdin.write(`${cmd} ${source}\n`);
}

// Иконка источника: из списка «Пуска» по AppID, иначе по exe открытого окна
async function mediaIcon(source) {
  if (startIcons[source]) return startIcons[source];
  const name = source.toLowerCase();
  const g = windowGroups().find((x) => path.basename(x.exe).toLowerCase() === name ||
    path.basename(x.exe, '.exe').toLowerCase() === name.replace(/\.exe$/, ''));
  if (g) return appIcon(g.exe);
  const s = startApps.find((a) => a.id.toLowerCase().includes(name.replace(/\.exe$/, '')));
  return s ? startIcons[s.id] || null : null;
}

function mediaName(source) {
  const s = startApps.find((a) => a.id === source);
  if (s) return s.name;
  return source.replace(/\.exe$/i, '').replace(/^.*[.!]/, '') || source;
}

// ---------- Скрытые значки (трей) ----------

function trayScript(file, args = []) {
  return new Promise((resolve, reject) => execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, file), ...args],
    { windowsHide: true, timeout: 20000, maxBuffer: 16 * 1024 * 1024, encoding: 'utf8' }, (error, out) => {
      if (error) { reject(error); return; }
      try { resolve(JSON.parse(out)); } catch { reject(new Error('Не удалось прочитать данные скрытых значков.')); }
    }));
}
const trayManager = createTrayManager({
  ownExecutable: process.execPath,
  readItems: () => trayScript('tray.ps1'),
  endTask: (exe) => trayScript('tray-end-task.ps1', ['-ExePath', exe, '-OwnerProcessId', String(process.pid)]),
  onUpdated: (items) => { for (const w of [win, panel]) if (alive(w)) w.webContents.send('tray:updated', items); },
});
const loadTray = (force) => trayManager.list(force === true);
async function trayEndTask(exe) {
  const send = (result) => { for (const w of [win, panel]) if (alive(w)) w.webContents.send('tray:result', result); };
  send({ ok: true, text: 'Завершаю задачу…' });
  const result = await trayManager.close(exe);
  send(result);
  if (!result.ok && Notification.isSupported()) new Notification({ title: 'Click — скрытые значки', body: result.text }).show();
}

function trayOpen(exe) {
  const g = windowGroups().find((x) => x.exe.toLowerCase() === exe.toLowerCase());
  if (g) return focusGroup(g);
  // У большинства программ из трея повторный запуск просто показывает их окно
  shell.openPath(exe);
}

function trayMenu(exe, from) {
  const item = trayManager.current().find((t) => t.exe.toLowerCase() === String(exe).toLowerCase());
  if (!item) return;
  exe = item.exe;
  const pinned = config.trayPinned.includes(exe);
  Menu.buildFromTemplate([
    { label: 'Открыть', click: () => trayOpen(exe) },
    {
      label: pinned ? 'Открепить от панели' : 'Закрепить на панели',
      click: () => {
        config.trayPinned = pinned ? config.trayPinned.filter((x) => x !== exe) : [...config.trayPinned, exe];
        saveConfig(config);
      },
    },
    { label: 'Папка программы', click: () => shell.showItemInFolder(exe) },
    { type: 'separator' },
    { label: 'Завершить задачу', click: () => trayEndTask(exe) },
  ]).popup({ window: from, callback: () => { panelMenuOpen = false; } });
  panelMenuOpen = from === panel;
}

// Настоящий трей Windows: на 20 секунд перестаём прятать панель задач и открываем область уведомлений
function showSystemTray() {
  fs.writeFileSync(TASKBAR_PAUSE, String(Date.now()));
  hidePanel();
  setTimeout(() => sendCmd('combo 91,66'), 300);   // Win+B — фокус на трей
  setTimeout(() => sendCmd('13'), 900);            // Enter — раскрыть скрытые значки
}

// Какие программы запущены — для точек под закреплёнными значками. tasklist — отдельный процесс,
// поэтому зовём его не чаще раза в 15 с; а то, что видно по открытым окнам (windows.ps1), — сразу
let procCache = { at: 0, names: new Set(), busy: null };
async function runningNow() {
  if (Date.now() - procCache.at > 15000) {
    if (!procCache.busy) procCache.busy = runningProcesses().then((n) => { procCache = { at: Date.now(), names: n, busy: null }; });
    if (!procCache.at) await procCache.busy;   // самый первый раз — дождаться
  }
  const names = new Set(procCache.names);
  for (const w of winState.list) if (w.e) names.add(path.basename(w.e).toLowerCase());
  return names;
}

function runningProcesses() {
  return new Promise((resolve) => {
    tasklist((err, out) => {
      if (err) return resolve(new Set());
      const names = new Set();
      for (const line of out.split(/\r?\n/)) {
        const m = line.match(/^"([^"]+)"/);
        if (m) names.add(m[1].toLowerCase());
      }
      resolve(names);
    });
  });
}

function extractIcon(p) {
  const script = 'Add-Type -AssemblyName System.Drawing; $ms = New-Object IO.MemoryStream; ' +
    `[Drawing.Icon]::ExtractAssociatedIcon('${p.replace(/'/g, "''")}').ToBitmap().Save($ms, [Drawing.Imaging.ImageFormat]::Png); ` +
    '[Convert]::ToBase64String($ms.ToArray())';
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true }, (err, out) => {
      resolve(!err && out.trim() ? 'data:image/png;base64,' + out.trim() : null);
    });
  });
}

const iconCache = new Map();
async function appIcon(p) {
  if (iconCache.has(p)) return iconCache.get(p);
  let url = null;
  try {
    if (/\.(ico|png)$/i.test(p)) url = nativeImage.createFromPath(p).resize({ width: 64, height: 64 }).toDataURL();
    else url = (await app.getFileIcon(p, { size: 'large' })).toDataURL();
  } catch {}
  // У некоторых программ (например, некоторые Electron-приложения) getFileIcon отдаёт стандартную заглушку — достаём иконку через .NET
  if ((!url || url.length < 1000) && /\.exe$/i.test(p)) url = (await extractIcon(p)) || url;
  iconCache.set(p, url);
  return url;
}

// ---------- Медиа (через PowerShell и Windows SMTC) ----------

// Музыка или видео — ассистент под музыку танцует, а при видео просто сидит и смотрит.
// 1) что сообщает сам плеер (Music/Video); 2) программа: музыкальные плееры / видеоплееры;
// 3) браузер: по заголовку окна с этой вкладкой — музыкальный сайт или нет. Браузер без музыкального
//    сайта считаем видео (YouTube, кино, стримы): лучше лишний раз не танцевать.
const MUSIC_APPS = /spotify|yandex\.?music|яндекс.?музык|applemusic|itunes|aimp|foobar|musicbee|winamp|deezer|tidal|zunemusic|groove|soundcloud|vkmusic|boom/i;
const VIDEO_APPS = /vlc|mpc-?hc|mpc-?be|potplayer|kmplayer|zunevideo|movies|mpv|plex|netflix|kinopoisk|iina|smplayer|wmplayer/i;
const BROWSERS = /chrome|msedge|edge|firefox|opera|yandex|browser|brave|vivaldi|arc/i;
const MUSIC_SITES = /youtube music|music\.youtube|яндекс[ .]?музык|music\.yandex|soundcloud|spotify|deezer|vk музык|музыка вконтакте|vk\.com\/audio|zvuk|звук|apple music|bandcamp|last\.fm|радио|radio/i;
// (браузеры сообщают «Music» даже для роликов YouTube — для них тип от плеера не учитываем)
function mediaKind(m) {
  const src = String(m.source || '');
  if (/^video$/i.test(m.ptype || '')) return 'video';
  if (MUSIC_APPS.test(src)) return 'music';
  if (VIDEO_APPS.test(src)) return 'video';
  if (!BROWSERS.test(src) && /^music$/i.test(m.ptype || '')) return 'music';
  if (BROWSERS.test(src)) {
    const exe = src.toLowerCase().replace(/\.exe$/, '');
    const wins = winState.list.filter((w) => path.basename(w.e || '', '.exe').toLowerCase().includes(exe) || exe.includes(path.basename(w.e || '', '.exe').toLowerCase()));
    const title = String(m.title || '').toLowerCase();
    // Окно с этой вкладкой (заголовок вкладки обычно содержит название ролика/трека)
    const tab = wins.find((w) => title && w.t.toLowerCase().includes(title.slice(0, 30)));
    if (tab) return MUSIC_SITES.test(tab.t) ? 'music' : 'video';
    return wins.some((w) => MUSIC_SITES.test(w.t)) ? 'music' : 'video';
  }
  return 'music';   // неизвестная программа без видео — скорее всего, плеер
}

function startMediaWatcher() {
  mediaProc = helperProc('media');
  let buf = '';
  mediaProc.stdout.setEncoding('utf8');
  mediaProc.stdout.on('data', (chunk) => {
    buf += chunk;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      try {
        const data = JSON.parse(line);
        // Обложку присылаем только при смене трека
        if (data.thumb === undefined && lastMedia && lastMedia.title === data.title) data.thumb = lastMedia.thumb;
        if (data.active) data.kind = mediaKind(data);
        lastMedia = data;
        for (const w of [win, panel, assistWin]) if (alive(w)) w.webContents.send('media', data);
      } catch {}
    }
  });
  mediaProc.on('exit', () => {
    mediaProc = null;
    if (!app.isQuitting) setTimeout(startMediaWatcher, 3000);
  });
}

// keys.ps1 выполняет команды: клавиши, сочетания, переключение окон. Ответы (для showtitle) — по строке.
const keyReplies = [];

function startKeySender() {
  keysProc = helperProc('keys');
  keysProc.stdout.setEncoding('utf8');
  keysProc.stdout.on('data', (chunk) => {
    for (const line of chunk.split(/\r?\n/)) if (line.trim() && keyReplies.length) keyReplies.shift()(line.trim());
  });
  keysProc.on('exit', () => { keysProc = null; });
}

function sendCmd(cmd) {
  if (!keysProc) startKeySender();
  keysProc.stdin.write(cmd + '\n');
}

function askCmd(cmd) {
  return new Promise((resolve) => {
    keyReplies.push(resolve);
    sendCmd(cmd);
  });
}

const sendKey = (vk) => sendCmd(String(vk));

function hwndOf(w) {
  const b = w.getNativeWindowHandle();
  return b.length >= 8 ? b.readBigUInt64LE(0).toString() : String(b.readUInt32LE(0));
}
function noActivate(w) {
  if (alive(w)) sendCmd('noactivate ' + hwndOf(w));
}

const KEYS = { playpause: 0xB3, next: 0xB0, prev: 0xB1, start: 0x5B };

const KEY_NAMES = { Ctrl: 17, Alt: 18, Shift: 16, Win: 91, Space: 32, Enter: 13, Tab: 9, Esc: 27 };
function comboToVks(combo) {
  return combo.split('+').map((k) => {
    k = k.trim();
    if (KEY_NAMES[k]) return KEY_NAMES[k];
    if (/^F\d{1,2}$/.test(k)) return 111 + Number(k.slice(1));
    if (k.length === 1) return k.toUpperCase().charCodeAt(0);
    return null;
  }).filter(Boolean);
}

// ---------- Открытые окна ----------

let winProc = null;
let winState = { fg: 0, list: [] };
let lastFg = 0;
let groupOrder = [];

function startWindowWatcher() {
  winProc = helperProc('windows');
  let buf = '';
  winProc.stdout.setEncoding('utf8');
  winProc.stdout.on('data', (chunk) => {
    buf += chunk;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      try {
        winState = JSON.parse(line);
        winState.list = winState.list || [];
        const own = ownPids();
        const fgWin = winState.list.find((w) => w.h === winState.fg);
        if (fgWin && !own.has(fgWin.p)) lastFg = fgWin.h;
        pushWindows();
      } catch {}
    }
  });
  winProc.on('exit', () => {
    winProc = null;
    if (!app.isQuitting) setTimeout(startWindowWatcher, 3000);
  });
}

function ownPids() {
  return new Set(app.getAppMetrics().map((m) => m.pid));
}

// Окна, сгруппированные по программе, в порядке появления (как на панели задач)
function windowGroups() {
  const own = ownPids();
  const groups = new Map();
  for (const w of winState.list) {
    if (own.has(w.p) || !w.e) continue;
    const key = w.e.toLowerCase();
    if (!groups.has(key)) groups.set(key, { exe: w.e, wins: [] });
    groups.get(key).wins.push(w);
  }
  groupOrder = groupOrder.filter((k) => groups.has(k));
  for (const k of groups.keys()) if (!groupOrder.includes(k)) groupOrder.push(k);
  return groupOrder.map((k) => groups.get(k));
}

const pinnedKey = (a) => (a.process || path.basename(a.path)).toLowerCase();
const WINDOWS_DIR = (process.env.WINDIR || 'C:\\Windows').toLowerCase() + '\\';

// Окно относится к закреплённой программе, если совпадает exe или оно запущено из её папки
// (например, окна Steam принадлежат steamwebhelper.exe из подпапки Steam). Системную папку не считаем.
function belongsTo(g, a) {
  if (path.basename(g.exe).toLowerCase() === pinnedKey(a)) return true;
  const dir = path.dirname(a.path).toLowerCase() + '\\';
  return !dir.startsWith(WINDOWS_DIR) && g.exe.toLowerCase().startsWith(dir);
}
const groupFor = (groups, a) => groups.find((g) => belongsTo(g, a));

async function pushWindows() {
  if (!alive(win)) return;
  const groups = windowGroups();
  const open = await Promise.all(groups
    .filter((g) => !config.apps.some((a) => belongsTo(g, a)))
    .map(async (g) => ({
      key: g.exe.toLowerCase(),
      exe: g.exe,
      title: g.wins.map((w) => w.t).join('\n'),
      count: g.wins.length,
      active: g.wins.some((w) => w.h === lastFg),
      icon: await appIcon(g.exe),
    })));
  const pinnedOpen = config.apps.map((a) => {
    const g = groupFor(groups, a);
    return g ? { count: g.wins.length, active: g.wins.some((w) => w.h === lastFg) } : null;
  });
  win.webContents.send('windows', { open, pinned: pinnedOpen });
}

// Клик по программе: переключиться на её окно, по активному — свернуть, при нескольких окнах — листать
function focusGroup(g) {
  const wins = g.wins;
  const cur = wins.find((w) => w.h === lastFg && !w.m);
  if (cur && wins.length === 1) return sendCmd('minimize ' + cur.h);
  const next = cur ? wins[(wins.indexOf(cur) + 1) % wins.length] : wins[0];
  sendCmd('activate ' + next.h);
}

// ---------- Панель задач Windows ----------

let taskbarPid = null;

const TASKBAR_ARGS = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'taskbar.ps1')];

// taskbar.ps1 прячет панель, пока жив процесс дока, и сам возвращает её, если док упадёт.
// Запускаем через Start-Process: обычные дочерние процессы Electron держит в задании Windows
// и убивает вместе с собой, а так скрипт выходит из задания и переживает падение дока.
function applyTaskbar() {
  const want = config.system.hideTaskbar;
  if (want && !taskbarPid) {
    // Start-Process в PowerShell 5.1 склеивает аргументы без кавычек — путь с пробелами берём в "" сами
    const args = [...TASKBAR_ARGS, '-ParentPid', String(process.pid)]
      .map((a) => (a.includes(' ') ? `"${a}"` : a))
      .map((a) => `'${a.replace(/'/g, "''")}'`).join(',');
    const out = execFileSync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command',
      `(Start-Process powershell.exe -WindowStyle Hidden -PassThru -ArgumentList ${args}).Id`,
    ], { windowsHide: true, encoding: 'utf8' });
    taskbarPid = parseInt(out, 10) || null;
  } else if (!want && taskbarPid) {
    restoreTaskbar();
  }
}

function restoreTaskbar() {
  if (!taskbarPid) return;
  try { process.kill(taskbarPid); } catch {}
  taskbarPid = null;
  execFileSync('powershell.exe', [...TASKBAR_ARGS, '-Restore'], { windowsHide: true });
}

// ---------- Автозапуск ----------

// Собранная программа (Click.exe) запускается сама; из исходников — electron.exe с папкой кода
const LAUNCH_ARGS = app.isPackaged ? [] : [__dirname];

function autostartEnabled() {
  return app.getLoginItemSettings({ path: process.execPath, args: LAUNCH_ARGS }).openAtLogin;
}

function setAutostart(on) {
  app.setLoginItemSettings({ openAtLogin: on, path: process.execPath, args: LAUNCH_ARGS });
}

// Запись автозапуска в реестре (HKCU\…\Run): старое имя GlassDock и запуск из исходников
// переводим на текущий способ запуска — иначе при входе в Windows стартовали бы две копии
const RUN_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
function runValue(name) {
  try { return execFileSync('reg', ['query', RUN_KEY, '/v', name], { encoding: 'utf8', windowsHide: true }); } catch { return null; }
}
function migrateAutostart() {
  try {
    let want = false;
    if (runValue('GlassDock')) {
      execFileSync('reg', ['delete', RUN_KEY, '/v', 'GlassDock', '/f'], { windowsHide: true });
      want = true;
    }
    const cur = runValue('Click');
    if (cur && !cur.toLowerCase().includes(process.execPath.toLowerCase())) want = true;
    if (want) setAutostart(true);
  } catch {}
}

// ---------- Меню ----------

function buildMenu() {
  return Menu.buildFromTemplate([
    { label: 'Click', enabled: false },
    { type: 'separator' },
    { label: 'Настройки…', click: openSettings },
    { label: 'Обновления…', click: () => {
      openSettings();
      const show = () => { if (alive(settingsWin)) settingsWin.webContents.send('goto', 'updates'); };
      if (settingsWin.webContents.isLoading()) settingsWin.webContents.once('did-finish-load', show);
      else show();
    } },
    { label: 'Перезагрузить док', click: () => { iconCache.clear(); win.reload(); } },
    {
      label: 'Автоматически скрывать панель', type: 'checkbox', checked: autoHideOn(),
      click: (i) => { config.appearance.autoHide = i.checked; saveConfig(config); },
    },
    { label: 'Запускать вместе с Windows', type: 'checkbox', checked: autostartEnabled(), click: (i) => setAutostart(i.checked) },
    { type: 'separator' },
    { label: 'Выход', click: () => app.quit() },
  ]);
}

let appImage = null;

async function createTray() {
  appImage = nativeImage.createFromPath(path.join(__dirname, 'assets', 'app.ico'));
  if (appImage.isEmpty()) appImage = await app.getFileIcon(process.execPath, { size: 'normal' });
  tray = new Tray(appImage);
  tray.setToolTip('Click');
  tray.on('click', openSettings);
  tray.on('right-click', () => tray.popUpContextMenu(buildMenu()));
}

// ---------- IPC ----------

ipcMain.on('resize', (_e, w, h, content) => placeWindow(w, h, content));
const fileDrop = createFileDrop({
  resolveTarget: (target) => {
    if (!target || typeof target.key !== 'string') return null;
    const groups = windowGroups();
    if (target.kind === 'pinned') {
      const a = config.apps.find(a => a.path.toLowerCase() === target.key.toLowerCase());
      if (!a) return null;
      const g = groupFor(groups, a);
      return { path: a.path, args: a.args, window: g && (g.wins.find(w => w.h === lastFg) || g.wins[0])?.h };
    }
    if (target.kind === 'open') {
      const g = groups.find(g => g.exe.toLowerCase() === target.key.toLowerCase());
      if (g) return { path: g.exe, window: (g.wins.find(w => w.h === lastFg) || g.wins[0])?.h };
    }
    if (target.kind === 'tray' && config.trayPinned.some(exe => exe.toLowerCase() === target.key.toLowerCase())) {
      const item = trayManager.current().find(t => t.exe.toLowerCase() === target.key.toLowerCase());
      const g = groups.find(g => g.exe.toLowerCase() === target.key.toLowerCase());
      if (item) return { path: item.exe, window: g && (g.wins.find(w => w.h === lastFg) || g.wins[0])?.h };
    }
    return null;
  },
  stat: filename => fs.promises.stat(filename),
  activate: hwnd => { hidePanel(); sendCmd('activate-drop ' + hwnd); },
  launch: (exe, args) => new Promise((resolve, reject) => {
    const child = spawn(exe, args, { detached: true, stdio: 'ignore', shell: false });
    child.once('error', reject);
    child.once('spawn', () => { child.unref(); resolve(); });
  }),
});
ipcMain.on('dock:file-drag', (e, active) => {
  if (!alive(win) || e.sender !== win.webContents) return;
  fileDragUntil = active === true ? Date.now() + 1600 : 0;
  if (active === true) showDock();
});
ipcMain.handle('dock:file-hover', (e, target) => {
  if (!alive(win) || e.sender !== win.webContents) return { ok: false };
  return fileDrop.hover(target);
});
ipcMain.handle('dock:drop-files', async (e, target, files) => {
  if (!alive(win) || e.sender !== win.webContents) return { ok: false };
  const result = await fileDrop.drop(target, files);
  if (!result.ok && alive(win)) dialog.showMessageBox(win, { type: 'info', title: 'Передача файлов', message: 'Не удалось передать файлы приложению', detail: result.message, buttons: ['Понятно'] });
  return result;
});
ipcMain.on('launch', (_e, i, forceNew) => {
  const a = config.apps[i];
  if (!a) return;
  // Уже открыто — переключаемся на окно, а не запускаем вторую копию
  const g = !forceNew && groupFor(windowGroups(), a);
  if (g) return focusGroup(g);
  // Приложения из Store и прочие без exe закреплены как shell:AppsFolder\<AppID>
  if (a.path.startsWith('shell:')) return spawn('explorer.exe', [a.path], { detached: true, stdio: 'ignore' }).unref();
  if (a.args && a.args.length) spawn(a.path, a.args, { detached: true, stdio: 'ignore' }).unref();
  else shell.openPath(a.path);
});
// Правый клик по закреплённой иконке
ipcMain.on('app:menu', (_e, i) => {
  const a = config.apps[i];
  if (!a) return;
  const move = (fn) => { fn(config.apps); saveConfig(config); };
  Menu.buildFromTemplate([
    { label: a.name, enabled: false },
    { type: 'separator' },
    { label: 'Открыть', click: () => ipcMain.emit('launch', null, i) },
    { label: 'Новое окно', click: () => ipcMain.emit('launch', null, i, true) },
    { label: a.capsule ? 'Убрать из капсулы (к «Пуску»)' : 'Поместить в капсулу', click: () => move((l) => { l[i].capsule = !l[i].capsule; }) },
    { label: 'Сдвинуть влево', enabled: i > 0, click: () => move((l) => l.splice(i - 1, 0, l.splice(i, 1)[0])) },
    { label: 'Сдвинуть вправо', enabled: i < config.apps.length - 1, click: () => move((l) => l.splice(i + 1, 0, l.splice(i, 1)[0])) },
    { label: 'Папка программы', click: () => shell.showItemInFolder(a.path) },
    { type: 'separator' },
    { label: 'Открепить от панели', click: () => move((l) => l.splice(i, 1)) },
  ]).popup({ window: win });
});
ipcMain.on('window:focus', (_e, key) => {
  const g = windowGroups().find((x) => x.exe.toLowerCase() === key);
  if (g) focusGroup(g);
});
ipcMain.on('window:new', (_e, key) => shell.openPath(key));
ipcMain.on('open', (_e, what) => {
  hidePanel();
  if (what === 'taskmgr') shell.openPath('C:\\Windows\\System32\\Taskmgr.exe');
  else if (/^[A-Z]:$/.test(what)) shell.openPath(what + '\\');
});
ipcMain.on('media:open', () => {
  if (lastMedia && lastMedia.source) spawn('explorer.exe', [`shell:AppsFolder\\${lastMedia.source}`], { detached: true, stdio: 'ignore' }).unref();
});
ipcMain.handle('app:version', () => app.getVersion());
ipcMain.handle('updates:status', () => updates.status());
for (const method of ['check', 'download', 'install']) ipcMain.handle('updates:' + method, (e) => {
  if (!alive(settingsWin) || e.sender !== settingsWin.webContents) throw new Error('Откройте обновления в настройках Click.');
  return updates[method]();
});
ipcMain.on('updates:cancel', (e) => { if (alive(settingsWin) && e.sender === settingsWin.webContents) updates.cancel(); });
ipcMain.on('updates:website', () => shell.openExternal(updateChannel.websiteUrl));
ipcMain.on('updates:github', () => shell.openExternal(updateChannel.githubUrl));
ipcMain.on('updates:releases', () => shell.openExternal(updateChannel.githubUrl + '/releases'));
ipcMain.handle('updates:preferences', () => ({ autoCheck: config.updates?.autoCheck !== false }));
ipcMain.handle('updates:setAutoCheck', (e, value) => {
  if (!alive(settingsWin) || e.sender !== settingsWin.webContents || typeof value !== 'boolean') throw new Error('Откройте обновления в настройках Click.');
  config.updates = { autoCheck: value };
  saveConfig(config);
  return { autoCheck: value };
});
ipcMain.handle('updates:history', async () => {
  const local = { version: app.getVersion(), notes: bundledNotes.notes, date: null };
  try {
    const remote = await updates.history();
    return { releases: remote.some((r) => r.version === local.version) ? remote : [local, ...remote], offline: false };
  } catch { return { releases: [local], offline: true }; }
});
ipcMain.handle('weather:get', async (_e, force) => { try { return { ok: true, data: await weather.get(force === true) }; } catch (e) { return { ok: false, message: e.message }; } });
ipcMain.handle('weather:status', () => weather.status());
ipcMain.handle('weather:search', async (e, query) => {
  if (!alive(settingsWin) || e.sender !== settingsWin.webContents) throw new Error('Откройте настройки погоды.');
  try { return { ok: true, items: await weather.search(query) }; } catch (error) { return { ok: false, message: error.message }; }
});
ipcMain.on('weather:website', () => shell.openExternal('https://open-meteo.com/'));
ipcMain.handle('sysinfo', async () => ({
  model: os.cpus()[0].model.trim(),
  cores: coreUsage(),
  ram: { total: os.totalmem(), used: os.totalmem() - os.freemem() },
  uptime: os.uptime(),
  os: `${os.version()} · сборка ${os.release()}`,
  top: await topProcesses(),
}));
ipcMain.handle('disks:info', () => runScript('drives.ps1'));
ipcMain.handle('start:data', async () => {
  if (!startApps.length) await refreshStartApps();
  else if (Date.now() - startLoadedAt > 10 * 60 * 1000) refreshStartApps();  // обновим в фоне
  return {
    apps: startApps.map((a) => ({ name: a.name, id: a.id })),
    icons: startIcons,
    layout: config.startLayout || { pages: [{ name: 'Главная', groups: [{ name: 'Закреплённые', apps: [] }] }] },
    locked: !!config.startLocked,
    user: os.userInfo().username,
  };
});
ipcMain.on('start:launch', (_e, id) => startLaunch(id));
ipcMain.on('ctx:menu', (e, items) => {
  const from = BrowserWindow.fromWebContents(e.sender);
  Menu.buildFromTemplate(buildCtx(items, (id) => e.sender.send('ctx:cmd', id)))
    .popup({ window: from, callback: () => { panelMenuOpen = false; } });
  panelMenuOpen = from === panel;
});
ipcMain.on('start:layout', (_e, layout, locked) => {
  config.startLayout = layout;
  config.startLocked = locked;
  saveConfig(config);
});
ipcMain.on('start:pinDock', (_e, id) => startPinToDock(id));
ipcMain.on('start:reveal', (_e, id) => startReveal(id));
ipcMain.on('start:refreshIcons', refreshStartIcons);
ipcMain.handle('start:importWindows', () => importWindowsStart());
ipcMain.handle('social:get', () => socialView());
// Какой аккаунт показывать на панели
ipcMain.on('social:select', (_e, id) => {
  config.social.selected = id;
  if (config.widgetOpts.social.view !== 'one') config.widgetOpts.social.view = 'one';
  saveConfig(config);
  pushSocial();
});
ipcMain.handle('social:refresh', async () => { await refreshSocial(); return socialView(); });
ipcMain.on('social:open', (_e, url) => { if (/^https:\/\//.test(url)) { hidePanel(); shell.openExternal(url); } });
ipcMain.on('settings:page', (_e, page) => { openSettings(); setTimeout(() => settingsWin && settingsWin.webContents.send('goto', page), 600); });
ipcMain.on('start:power', (_e, what) => startPower(what));
ipcMain.on('start:open', (_e, what) => {
  hidePanel();
  if (what === 'explorer') spawn('explorer.exe', [], { detached: true, stdio: 'ignore' }).unref();
  if (what === 'settings') shell.openExternal('ms-settings:');
  if (what === 'search') sendCmd('combo 91,83');  // Win+S — поиск Windows
  if (what === 'windows') sendCmd('91');          // настоящий «Пуск» Windows
});
ipcMain.on('power:menu', () => {
  Menu.buildFromTemplate([
    { label: 'Заблокировать', click: () => startPower('lock') },
    { label: 'Спящий режим', click: () => startPower('sleep') },
    { label: 'Выйти из системы', click: () => startPower('signout') },
    { type: 'separator' },
    { label: 'Перезагрузка', click: () => startPower('restart') },
    { label: 'Завершение работы', click: () => startPower('shutdown') },
  ]).popup({ window: panel, callback: () => { panelMenuOpen = false; } });
  panelMenuOpen = true;
});
ipcMain.handle('disks', () => diskUsage());
ipcMain.handle('tray:list', (_e, force) => loadTray(force));
ipcMain.on('tray:open', (_e, exe) => trayOpen(exe));
ipcMain.on('tray:menu', (e, exe) => trayMenu(exe, BrowserWindow.fromWebContents(e.sender)));
ipcMain.on('tray:system', showSystemTray);
ipcMain.on('quick', (_e, what) => {
  hidePanel();
  if (what === 'quicksettings') sendCmd('combo 91,65');   // Win+A
  if (what === 'notifications') sendCmd('combo 91,78');   // Win+N
});
ipcMain.handle('dock:preview', async () => (win ? (await win.webContents.capturePage()).toDataURL() : null));
ipcMain.on('key', (_e, name) => {
  // Если на панели выбран не системный «текущий» источник — управляем им напрямую, иначе медиаклавишами
  const m = lastMedia;
  if (['playpause', 'next', 'prev'].includes(name) && m && m.source && m.current && m.source !== m.current) {
    return mediaCtl(name, m.source);
  }
  if (KEYS[name]) sendKey(KEYS[name]);
});
ipcMain.on('media:ctl', (_e, cmd, source) => mediaCtl(cmd, source));
ipcMain.on('media:select', (_e, source) => fs.writeFileSync(MEDIA_PREF, source || '', 'utf8'));
ipcMain.handle('media:sources', async () => {
  const list = (lastMedia && lastMedia.sessions) || [];
  return Promise.all(list.map(async (s) => ({ ...s, name: mediaName(s.source), icon: await mediaIcon(s.source) })));
});
ipcMain.on('menu', () => buildMenu().popup({ window: win }));
ipcMain.on('settings:open', openSettings);
ipcMain.handle('config', () => config);
ipcMain.on('config:set', (_e, cfg) => saveConfig(cfg));
// Диски меняются медленно — опрашиваем раз в 30 с, а не на каждый запрос панели (раз в 2 с)
let diskCache = { at: 0, list: [] };
ipcMain.handle('stats', () => {
  if (Date.now() - diskCache.at > 30000) diskCache = { at: Date.now(), list: diskUsage() };
  return {
    cpu: cpuUsage(),
    ram: { total: os.totalmem(), used: os.totalmem() - os.freemem() },
    disk: diskCache.list,
  };
});
ipcMain.handle('apps', async () => {
  const running = await runningNow();
  return Promise.all(config.apps.map(async (a) => ({
    name: a.name,
    dropKey: a.path,
    capsule: a.capsule,
    icon: a.path.startsWith('shell:AppsFolder\\') ? startIcons[a.path.slice(17)] || null : await appIcon(a.icon || a.path),
    running: running.has((a.process || path.basename(a.path)).toLowerCase()),
  })));
});
ipcMain.handle('icon', (_e, p) => appIcon(p));
ipcMain.handle('media', () => lastMedia);
let lastAnchor = 0;
ipcMain.on('panel', (_e, mode, anchorX) => { lastAnchor = anchorX; openPanel(mode, anchorX); });
ipcMain.on('panel:close', () => hidePanel());

// Изменение размера всплывающего окна: окно без рамки, поэтому тянем за свои «ручки» по краям.
// Позицию курсора берём у системы — так не мешает масштаб страницы.
let panelResize = null;
const PANEL_MIN = [260, 220];
ipcMain.on('panel:rs-start', (_e, dir) => {
  if (!alive(panel)) return;
  panelResize = { dir, p: screen.getCursorScreenPoint(), b: panel.getBounds() };
});
ipcMain.on('panel:rs-move', () => {
  if (!panelResize || !alive(panel)) return;
  const { dir, p, b } = panelResize;
  const c = screen.getCursorScreenPoint();
  const z = win.webContents.getZoomFactor();
  const minW = PANEL_MIN[0] * z, minH = PANEL_MIN[1] * z;
  let { x, y, width, height } = b;
  if (dir.includes('l')) { const nw = Math.max(minW, width - (c.x - p.x)); x += width - nw; width = nw; }
  if (dir.includes('r')) width = Math.max(minW, width + (c.x - p.x));
  if (dir.includes('t')) { const nh = Math.max(minH, height - (c.y - p.y)); y += height - nh; height = nh; }
  if (dir.includes('b')) height = Math.max(minH, height + (c.y - p.y));
  panel.setBounds({ x: Math.round(x) | 0, y: Math.round(y) | 0, width: Math.round(width), height: Math.round(height) });
});
ipcMain.on('panel:rs-end', () => {
  if (!panelResize || !alive(panel)) return;
  panelResize = null;
  const b = panel.getBounds(), z = win.webContents.getZoomFactor();
  config.panelSizes = { ...config.panelSizes, [panelMode]: [Math.round(b.width / z), Math.round(b.height / z)] };
  saveConfig(config);
});
// Окно просит другую высоту (плеер раскрывает текст песни): растём от панели, край у панели не двигается
ipcMain.on('panel:height', (_e, cssH) => {
  if (!cssH || !panelShown()) return;
  const b = panel.getBounds(), z = win.webContents.getZoomFactor();
  const h = Math.round(cssH * z);
  const y = config.appearance.position === 'top' ? b.y : b.y + b.height - h;
  panel.setBounds({ x: b.x, y, width: b.width, height: h });
});
// Двойной клик по ручке — вернуть стандартный размер
ipcMain.on('panel:rs-reset', () => {
  const sizes = { ...config.panelSizes };
  delete sizes[panelMode];
  config.panelSizes = sizes;
  saveConfig(config);
  const mode = panelMode;
  hidePanel();
  panelMode = null;
  openPanel(mode, lastAnchor);
});
ipcMain.handle('todos:get', () => readTodos());
ipcMain.on('todos:set', (_e, list) => writeTodos(list));
ipcMain.on('notify', (_e, title, body) => {
  if (Notification.isSupported()) new Notification({ title, body }).show();
  // Патрик тоже реагирует (помодоро и прочие уведомления дока)
  if (alive(assistWin)) assistWin.webContents.send('assist:event', { type: title === 'Помодоро' ? 'pomodoro' : 'notify', text: body });
});
ipcMain.handle('apps:pick', async () => {
  const r = await dialog.showOpenDialog(settingsWin, {
    title: 'Выберите программу или ярлык',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Программы и ярлыки', extensions: ['exe', 'lnk', 'url', 'bat', 'cmd'] }, { name: 'Все файлы', extensions: ['*'] }],
  });
  if (r.canceled) return [];
  return r.filePaths.map((p) => {
    const name = path.basename(p).replace(/\.[^.]+$/, '');
    if (p.toLowerCase().endsWith('.lnk')) {
      try {
        const l = shell.readShortcutLink(p);
        const a = { name, path: l.target || p, capsule: true };
        if (l.args) a.args = l.args.match(/"[^"]*"|\S+/g).map((s) => s.replace(/^"|"$/g, ''));
        if (l.icon && /\.(ico|exe)$/i.test(l.icon)) a.icon = l.icon;
        return a;
      } catch {}
    }
    return { name, path: p, capsule: true };
  });
});
ipcMain.handle('apps:detect', () => detectApps());
ipcMain.handle('autostart:get', () => autostartEnabled());
ipcMain.on('autostart:set', (_e, on) => setAutostart(on));
ipcMain.on('app:restart', () => { app.relaunch({ args: LAUNCH_ARGS }); app.exit(0); });
ipcMain.on('app:quit', () => app.quit());
ipcMain.on('app:folder', () => shell.openPath(__dirname));

// ---------- Старт ----------

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  // «--settings» открывает настройки, «--page=social» — сразу на нужной странице
  const openFromArgs = (argv) => {
    if (!argv.includes('--settings')) return;
    openSettings();
    const page = (argv.find((a) => a.startsWith('--page=')) || '').slice(7);
    if (page) setTimeout(() => settingsWin && settingsWin.webContents.send('goto', page), 900);
  };
  app.on('second-instance', (_e, argv) => openFromArgs(argv));
  app.whenReady().then(() => {
    nativeTheme.themeSource = 'dark';
    app.setAppUserModelId('Click');
    migrateAutostart();
    config = loadConfig();
    updateScheduler.setEnabled(config.updates.autoCheck);
    powerMonitor.on('resume', () => updateScheduler.resume());
    socialKey = socialKeyOf(config);
    // Микрофон — только нашим окнам (страницы с диска) и только звук
    const ours = (u) => String(u || '').startsWith('file://');
    session.defaultSession.setPermissionRequestHandler((wc, perm, cb, details) =>
      cb(perm === 'media' && ours(details.requestingUrl || wc.getURL()) && !(details.mediaTypes || []).includes('video')));
    session.defaultSession.setPermissionCheckHandler((wc, perm, origin) => perm === 'media' && ours(origin || (wc && wc.getURL())));
    createWindow();
    // Всплывающее окно (Пуск, календарь…) — при первом открытии, см. ensurePanel
    createAssistant();
    startMediaWatcher();
    startKeySender();
    startWindowWatcher();
    applyTaskbar();
    applyWinKey();
    applyAppbar();
    seedStartPinned();
    createTray().catch(() => {});
    openFromArgs(process.argv);
    // Список для меню «Пуск» собираем заранее, в фоне
    setTimeout(refreshStartApps, 4000);
    // Подписчики: при старте и каждые 30 минут
    setTimeout(refreshSocial, 6000);
    setInterval(refreshSocial, 30 * 60 * 1000);
    screen.on('display-metrics-changed', () => {
      placeWindow(...dockSize);
      setTimeout(() => placeWindow(...dockSize), 400);
    });
  });
  // Закрытие окна настроек не должно завершать док
  app.on('window-all-closed', () => {});
  app.on('before-quit', (e) => {
    assistantJobs.stop();
    updateScheduler.stop();
    updates.cancel();
    // Сразу: таймеры дока перестают трогать окна, которые вот-вот закроются
    app.isQuitting = true;
    // Сначала даём помощнику снять резерв места под док, иначе окна так и не будут заходить вниз экрана
    if (appbarProc) {
      e.preventDefault();
      const p = appbarProc;
      appbarProc = null;
      const done = () => app.quit();
      p.once('exit', done);
      setTimeout(done, 1500);
      p.stdin.end();
      return;
    }
    app.isQuitting = true;
    voice.stop();
    if (mediaProc) mediaProc.kill();
    if (keysProc) keysProc.kill();
    if (winProc) winProc.kill();
    if (winkeyProc) winkeyProc.kill();
    if (mediactlProc) mediactlProc.kill();
    restoreTaskbar();
  });
}
