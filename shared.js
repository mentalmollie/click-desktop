// Общие данные для дока, всплывающих панелей и настроек

// Действия Island: открываются его горячими клавишами
const ISLAND_ACTIONS = {
  island: { label: 'Остров', icon: '<rect x="3" y="8" width="18" height="8" rx="4" class="solid"/>' },
  command: { label: 'Команда', icon: '<circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5 5"/>' },
  chat: { label: 'Чат с ИИ', icon: '<path d="M4 5.5h16v10H9l-4.5 4v-4H4z"/>' },
  voice: { label: 'Голос в текст', icon: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/>' },
  record: { label: 'Запись экрана', icon: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="3.5" class="solid"/>' },
  screenshot: { label: 'Скриншот области', icon: '<path d="M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4" /><rect x="8" y="8" width="8" height="8" rx="1.5" stroke-dasharray="2 2"/>' },
  fullshot: { label: 'Весь экран', icon: '<rect x="3" y="4.5" width="18" height="12" rx="2"/><path d="M9 20h6M12 16.5V20"/>' },
  ocr: { label: 'Текст с экрана', icon: '<path d="M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4M8.5 9h7M12 9v7"/>' },
  clipboard: { label: 'История буфера', icon: '<rect x="5" y="4.5" width="14" height="16" rx="2"/><path d="M9 4.5V3h6v1.5M8.5 10h7M8.5 14h5"/>' },
  mic: { label: 'Микрофон вкл/выкл', icon: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M4 4l16 16"/>' },
};

// Иконки погоды (цветные, для тёмного фона)
const WEATHER_ICONS = {
  sun: '<circle cx="12" cy="12" r="4.5" fill="#ffd60a"/><g stroke="#ffd60a" stroke-width="2" stroke-linecap="round"><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8"/></g>',
  moon: '<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z" fill="#e5e5ea"/>',
  partly: '<circle cx="9" cy="9" r="4" fill="#ffd60a"/><path d="M8 20h9a4 4 0 0 0 0-8 5.5 5.5 0 0 0-10.4 1.6A3.2 3.2 0 0 0 8 20z" fill="#e5e5ea"/>',
  cloud: '<path d="M7 19h10a4.5 4.5 0 0 0 .4-9A6 6 0 0 0 6 11.5 3.8 3.8 0 0 0 7 19z" fill="#d1d1d6"/>',
  rain: '<path d="M7 15h10a4 4 0 0 0 .4-8A5.5 5.5 0 0 0 6.3 8.4 3.3 3.3 0 0 0 7 15z" fill="#d1d1d6"/><path d="M8 18l-1 3M12 18l-1 3M16 18l-1 3" stroke="#64d2ff" stroke-width="2" stroke-linecap="round"/>',
  snow: '<path d="M7 14h10a4 4 0 0 0 .4-8A5.5 5.5 0 0 0 6.3 7.4 3.3 3.3 0 0 0 7 14z" fill="#d1d1d6"/><g fill="#fff"><circle cx="8" cy="18" r="1.3"/><circle cx="12" cy="20.5" r="1.3"/><circle cx="16" cy="18" r="1.3"/></g>',
  storm: '<path d="M7 14h10a4 4 0 0 0 .4-8A5.5 5.5 0 0 0 6.3 7.4 3.3 3.3 0 0 0 7 14z" fill="#aeaeb2"/><path d="M12.5 14l-3 5h3l-1.5 4 4.5-6h-3l1.5-3z" fill="#ffd60a"/>',
  fog: '<path d="M4 9h16M6 13h12M4 17h16" stroke="#d1d1d6" stroke-width="2" stroke-linecap="round"/>',
};

function weatherIcon(code, isDay = 1) {
  if (code === 0) return isDay ? WEATHER_ICONS.sun : WEATHER_ICONS.moon;
  if (code <= 2) return isDay ? WEATHER_ICONS.partly : WEATHER_ICONS.cloud;
  if (code === 3) return WEATHER_ICONS.cloud;
  if (code <= 48) return WEATHER_ICONS.fog;
  if (code <= 67 || (code >= 80 && code <= 82)) return WEATHER_ICONS.rain;
  if (code <= 77 || code === 85 || code === 86) return WEATHER_ICONS.snow;
  return WEATHER_ICONS.storm;
}

// Настройки каждого виджета: описание для окна настроек и значения по умолчанию.
// Общая для всех опция style — вид капсулы.
const CAPSULE_STYLE = { key: 'style', label: 'Капсула', type: 'seg', choices: [['glass', 'Стекло'], ['solid', 'Плотная'], ['clear', 'Без фона']] };

const WIDGET_OPTIONS = {
  start: [
    { key: 'menu', label: 'Меню', type: 'seg', choices: [['glass', 'Своё, в стиле панели'], ['windows', '«Пуск» Windows']] },
    { key: 'view', label: 'Открывать', type: 'seg', choices: [['home', 'Закреплённые'], ['all', 'Все приложения']] },
    { key: 'winKey', label: 'Клавиша Win открывает это меню', type: 'toggle' },
  ],
  system: [
    { key: 'show', label: 'Показывать', type: 'seg', choices: [['both', 'CPU и память'], ['cpu', 'CPU'], ['ram', 'Память']] },
    { key: 'view', label: 'Вид', type: 'seg', choices: [['bars', 'Полоски'], ['rings', 'Кольца'], ['numbers', 'Цифры']] },
    { key: 'color', label: 'Цвет', type: 'seg', choices: [['load', 'По нагрузке'], ['blue', 'Синий'], ['white', 'Белый']] },
    { key: 'icon', label: 'Белая плитка с иконкой', type: 'toggle' },
  ],
  openApps: [
    { key: 'size', label: 'Размер иконок', type: 'seg', choices: [['small', 'Мелкие'], ['normal', 'Обычные'], ['large', 'Крупные']] },
  ],
  island: [
    { key: 'logo', label: 'Значок Island в начале капсулы', type: 'toggle' },
  ],
  media: [
    { key: 'size', label: 'Ширина', type: 'seg', choices: [['compact', 'Узкая'], ['normal', 'Обычная'], ['wide', 'Широкая']] },
    { key: 'play', label: 'Кнопка «играть»', type: 'seg', choices: [['gray', 'Серая'], ['blue', 'Синяя'], ['white', 'Белая'], ['clear', 'Без фона']] },
    { key: 'text', label: 'Название и исполнитель', type: 'toggle' },
    { key: 'cover', label: 'Обложка', type: 'toggle' },
    { key: 'controls', label: 'Кнопки управления', type: 'toggle' },
  ],
  social: [
    { key: 'view', label: 'Показывать', type: 'seg', choices: [['one', 'Выбранный'], ['all', 'Все'], ['rotate', 'По очереди'], ['total', 'Сумму']] },
    { key: 'delta', label: 'Изменение за сутки (▲/▼)', type: 'toggle' },
  ],
  tasks: [
    { key: 'show', label: 'Показывать', type: 'seg', choices: [['next', 'Ближайшую задачу'], ['count', 'Количество']] },
    { key: 'tile', label: 'Плитка с датой', type: 'toggle' },
  ],
  disk: [
    { key: 'drive', label: 'Диск', type: 'drive' },
    { key: 'view', label: 'Вид', type: 'seg', choices: [['bar', 'Полоска'], ['ring', 'Кольцо']] },
    { key: 'value', label: 'Подпись', type: 'seg', choices: [['free', 'Свободно'], ['used', 'Занято']] },
  ],
  pomodoro: [
    { key: 'view', label: 'Вид', type: 'seg', choices: [['liquid', 'Жидкость'], ['ring', 'Кольцо']] },
  ],
  tray: [
    { key: 'size', label: 'Размер значков', type: 'seg', choices: [['small', 'Мелкие'], ['normal', 'Обычные'], ['large', 'Крупные']] },
    { key: 'pinned', label: 'Закреплённые значки рядом со стрелкой', type: 'toggle' },
  ],
  clock: [
    { key: 'format', label: 'Время', type: 'seg', choices: [['24', '24 часа'], ['12', '12 часов']] },
    { key: 'seconds', label: 'Секунды', type: 'toggle' },
    { key: 'date', label: 'День недели и дата', type: 'toggle' },
    { key: 'weather', label: 'Погода', type: 'toggle' },
  ],
};

const WIDGET_DEFAULTS = {
  start: { style: 'glass', menu: 'glass', view: 'home', winKey: true },
  system: { style: 'glass', show: 'both', view: 'bars', color: 'load', icon: true },
  openApps: { style: 'glass', size: 'normal' },
  island: { style: 'glass', logo: true },
  media: { style: 'glass', size: 'normal', play: 'gray', text: true, cover: true, controls: true },
  social: { style: 'glass', view: 'one', delta: true },
  tasks: { style: 'glass', show: 'next', tile: true },
  disk: { style: 'glass', drive: 'C:', view: 'bar', value: 'free' },
  pomodoro: { style: 'glass', view: 'liquid' },
  tray: { style: 'glass', size: 'normal', pinned: true },
  clock: { style: 'glass', format: '24', seconds: false, date: true, weather: true },
};

// Блоки панели (их можно перетаскивать и раскладывать по зонам)
// Соцсети: значок (простой узнаваемый символ), цвет, ссылка на профиль, подсказка к полю ввода
const SOCIAL = {
  telegram: { name: 'Telegram', color: '#2aabee', hint: 'имя канала или группы, например durov', url: (h) => `https://t.me/${h}`,
    icon: '<circle cx="12" cy="12" r="10" fill="#2aabee"/><path d="M6.2 11.6l9.6-3.9c.5-.2.9.1.8.7l-1.6 7.6c-.1.5-.5.7-1 .4l-2.5-1.9-1.2 1.2c-.2.2-.4.2-.5-.1l-.4-2.6 4.6-4.2-5.7 3.5-2.2-.7c-.5-.1-.5-.5.1-.8z" fill="#fff"/>' },
  youtube: { name: 'YouTube', color: '#ff0033', hint: 'название канала после @, например MrBeast', url: (h) => (/^UC[\w-]{20,}$/.test(h) ? `https://www.youtube.com/channel/${h}` : `https://www.youtube.com/@${h}`),
    icon: '<rect x="2" y="5" width="20" height="14" rx="4.5" fill="#ff0033"/><path d="M10 8.8v6.4l5.4-3.2z" fill="#fff"/>' },
  tiktok: { name: 'TikTok', color: '#fe2c55', hint: 'ник после @, например mrbeast', url: (h) => `https://www.tiktok.com/@${h}`,
    icon: '<rect x="2" y="2" width="20" height="20" rx="6" fill="#111"/><path d="M13.6 5.5h2.2c.2 1.5 1.2 2.6 2.7 2.8v2.3c-1 0-2-.3-2.8-.9v4.6a4 4 0 1 1-4-4v2.3a1.7 1.7 0 1 0 1.9 1.7z" fill="#25f4ee" transform="translate(-.6 -.4)"/><path d="M13.6 5.5h2.2c.2 1.5 1.2 2.6 2.7 2.8v2.3c-1 0-2-.3-2.8-.9v4.6a4 4 0 1 1-4-4v2.3a1.7 1.7 0 1 0 1.9 1.7z" fill="#fe2c55" transform="translate(.6 .4)"/><path d="M13.6 5.5h2.2c.2 1.5 1.2 2.6 2.7 2.8v2.3c-1 0-2-.3-2.8-.9v4.6a4 4 0 1 1-4-4v2.3a1.7 1.7 0 1 0 1.9 1.7z" fill="#fff"/>' },
  twitch: { name: 'Twitch', color: '#9146ff', hint: 'логин канала, например xqc', url: (h) => `https://www.twitch.tv/${h}`,
    icon: '<rect x="2" y="2" width="20" height="20" rx="6" fill="#9146ff"/><path d="M7.5 6h10v7l-3 3h-2.3l-1.7 1.7V16H7.5z" fill="#fff"/><path d="M11 8.7v3.2M14.2 8.7v3.2" stroke="#9146ff" stroke-width="1.3" stroke-linecap="round"/>' },
  github: { name: 'GitHub', color: '#e6edf3', hint: 'логин, например torvalds', url: (h) => `https://github.com/${h}`,
    icon: '<circle cx="12" cy="12" r="10" fill="#e6edf3"/><path d="M12 6.3a5.9 5.9 0 0 0-1.9 11.5c.3 0 .4-.1.4-.3v-1c-1.6.3-2-.8-2-.8-.3-.7-.7-.9-.7-.9-.5-.4 0-.4 0-.4.6 0 .9.6.9.6.5.9 1.4.7 1.8.5 0-.4.2-.7.4-.8-1.3-.2-2.7-.7-2.7-2.9 0-.6.2-1.2.6-1.6-.1-.2-.3-.8 0-1.6 0 0 .5-.2 1.6.6a5.6 5.6 0 0 1 2.9 0c1.1-.8 1.6-.6 1.6-.6.3.8.1 1.4 0 1.6.4.4.6 1 .6 1.6 0 2.3-1.4 2.7-2.7 2.9.2.2.4.6.4 1.1v1.6c0 .2.1.4.4.3A5.9 5.9 0 0 0 12 6.3z" fill="#0d1117"/>' },
  vk: { name: 'ВКонтакте', color: '#0077ff', hint: 'короткое имя страницы или сообщества, например durov', url: (h) => `https://vk.com/${h}`,
    icon: '<rect x="2" y="2" width="20" height="20" rx="6" fill="#0077ff"/><path d="M12.6 16.2c-4.3 0-6.8-3-6.9-7.9h2.2c.1 3.6 1.6 5.2 2.9 5.5V8.3h2v3.1c1.3-.1 2.6-1.6 3.1-3.1h2c-.3 1.9-1.7 3.3-2.7 3.9 1 .5 2.6 1.7 3.2 4h-2.2c-.5-1.5-1.6-2.6-3.4-2.8v2.8z" fill="#fff"/>' },
};

// Совсем коротко, для крупной цифры на панели: 2,4K, 30,7M
function shortCount(n) {
  if (n == null) return '—';
  const f = (v) => (v < 100 ? v.toFixed(1) : v.toFixed(0)).replace('.', ',').replace(/,0$/, '');
  if (n >= 1e9) return f(n / 1e9) + 'B';
  if (n >= 1e6) return f(n / 1e6) + 'M';
  if (n >= 1e3) return f(n / 1e3) + 'K';
  return String(n);
}

// Число подписчиков коротко: 1,2 тыс., 30,7 млн
function compactCount(n) {
  if (n == null) return '—';
  const f = (v) => v.toFixed(v < 10 ? 1 : 0).replace('.', ',').replace(/,0$/, '');
  if (n >= 1e9) return f(n / 1e9) + ' млрд';
  if (n >= 1e6) return f(n / 1e6) + ' млн';
  if (n >= 1e4) return f(n / 1e3) + ' тыс.';
  return n.toLocaleString('ru-RU');
}

const BLOCK_LABELS = {
  start: 'Пуск', pinned: 'Закреплённые приложения', social: 'Соцсети', system: 'Система', apps: 'Приложения в капсулах', openApps: 'Открытые приложения',
  island: 'Island', media: 'Музыка', tasks: 'Задачи', disk: 'Диски', pomodoro: 'Помодоро', tray: 'Скрытые значки', clock: 'Часы и погода',
};
const DEFAULT_ORDER = ['start', 'pinned', 'system', 'apps', 'openApps', 'island', 'media', 'social', 'tasks', 'disk', 'pomodoro', 'tray', 'clock'];

// Расположение значков на панели во всю ширину: в какую зону (L — слева, C — центр, R — справа) попадает блок
const LAYOUTS = [['center', 'По центру'], ['edges', 'По краям'], ['left', 'Слева'], ['right', 'Справа'], ['spread', 'Равномерно'], ['custom', 'Свой']];
function zoneOf(key, layout, custom) {
  if (layout === 'custom') return (custom && custom[key]) || 'C';
  if (layout === 'left') return 'L';
  if (layout === 'right') return 'R';
  if (layout === 'edges') return ['start', 'pinned', 'apps', 'openApps'].includes(key) ? 'L' : ['tray', 'clock'].includes(key) ? 'R' : 'C';
  return 'C';
}

function weatherText(code) {
  if (code === 0) return 'Ясно';
  if (code === 1) return 'Преимущественно ясно';
  if (code === 2) return 'Переменная облачность';
  if (code === 3) return 'Пасмурно';
  if (code <= 48) return 'Туман';
  if (code <= 57) return 'Морось';
  if (code <= 67) return 'Дождь';
  if (code <= 77) return 'Снег';
  if (code <= 82) return 'Ливень';
  if (code <= 86) return 'Снегопад';
  return 'Гроза';
}

// Главный процесс берёт отсюда значения по умолчанию
// Ассистенты: имя в падежах (acc — «спросить кого», dat — «сказать кому»), папка с кадрами, пропорции кадра,
// какая доля ширины кадра — сам персонаж (по ней ловим клики).
// Кадры лежат на холсте с запасом сверху (поднятые руки, «Z» во сне): pad — доля пустого места сверху,
// grow — во сколько раз холст выше самой фигуры (чтобы фигура на экране осталась прежнего размера).
// anim — кадры покадровой анимации в <dir>/anim/ (нарезаются tools/slice-anim.js и tools/anim-face.js)
const ANIM_FRAMES = ['stand', 'blink2', 'talk1', 'talk2', 'talk3', 'turn1', 'turn2', 'side',
  'walk1', 'walk2', 'walk3', 'walk4', 'walk5', 'walk6', 'walk7', 'walk8',
  'wave1', 'wave2', 'wave3', 'wave4', 'think1', 'think2', 'sip1', 'sip2',
  'dance1', 'dance2', 'dance3', 'dance4', 'doze1', 'doze2', 'sleep1', 'sleep2',
  // Держат в воздухе и падение (tools/slice-extra.js)
  'held1', 'held2', 'held3', 'held4', 'held5', 'held6', 'held7', 'held8',
  'fall1', 'fall2', 'fall3', 'fall4', 'fall5', 'fall6', 'fall7', 'fall8',
  // Потрясли — кружится голова
  'dizzy1', 'dizzy2', 'dizzy3', 'dizzy4', 'dizzy5', 'dizzy6', 'dizzy7', 'dizzy8',
  // Сидит, когда ничего не происходит
  'sit1', 'sit2', 'sit3', 'sit4', 'sit5', 'sit6', 'sit7', 'sit8'];
const ASSISTANTS = {
  patrick: {
    name: 'Патрик', acc: 'Патрика', dat: 'Патрику', female: false,
    dir: 'assets/patrick', ratio: 383 / 292, hitW: 0.4, pad: 48 / 292, grow: 292 / 244, anim: ANIM_FRAMES,
    desc: 'Обаятельный наблюдатель с иронией: подмечает мелочи, «читает» тебя и любит чай',
  },
  teresa: {
    name: 'Тереза', acc: 'Терезу', dat: 'Терезе', female: true,
    dir: 'assets/teresa', ratio: 261 / 293, hitW: 0.6, pad: 49 / 293, grow: 293 / 244, anim: ANIM_FRAMES,
    desc: 'Собранная и прямая: держит дела под контролем, бережёт твоё время, кофе — без сахара',
  },
};
const assistantOf = (cfg) => ASSISTANTS[cfg && cfg.assistant && cfg.assistant.persona] || ASSISTANTS.patrick;

if (typeof module !== 'undefined') module.exports = { WIDGET_DEFAULTS, ISLAND_ACTIONS, DEFAULT_ORDER, SOCIAL, ASSISTANTS, assistantOf, weatherText };
