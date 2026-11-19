// «Мозг» ассистента: разговор с нейросетью и инструменты дока.
// Провайдеры: Google Gemini, Groq, OpenRouter,
// Ollama на этом ПК. Бесплатные понимают формат запросов OpenAI (/chat/completions), поэтому
// для них один общий цикл (askCompat).
// Главный процесс создаёт мозг один раз (createBrain) и передаёт функции дока — открыть программу,
// музыка, задачи, напоминания, погода. Ключи хранятся зашифрованными (safeStorage Windows)
// в отдельных файлах brain*.key — не в config.json и не в окнах.
const fs = require('fs');
const path = require('path');
const { safeStorage } = require('electron');

const { dataPath } = require('./paths');
const keyPath = (provider) => dataPath(`brain-${provider}.key`);

// Модель по умолчанию у бесплатных — подсказка; точный список берём у самого сервиса (кнопка «Обновить список»)
const PROVIDERS = {
  gemini: {
    name: 'Gemini', free: true, key: true, base: 'https://generativelanguage.googleapis.com/v1beta/openai',
    keyHelp: 'aistudio.google.com → Get API key (бесплатно)', keyRe: /^AIza/, defaultModel: 'gemini-2.5-flash',
  },
  groq: {
    name: 'Groq', free: true, key: true, base: 'https://api.groq.com/openai/v1',
    keyHelp: 'console.groq.com → API Keys (бесплатно)', keyRe: /^gsk_/, defaultModel: 'llama-3.3-70b-versatile',
  },
  openrouter: {
    name: 'OpenRouter', free: true, key: true, base: 'https://openrouter.ai/api/v1',
    keyHelp: 'openrouter.ai → Keys; бесплатные модели помечены «:free»', keyRe: /^sk-or-/, defaultModel: '',
  },
  ollama: {
    name: 'Ollama', free: true, key: false, local: true, base: 'http://127.0.0.1:11434/v1',
    keyHelp: '', defaultModel: '',
  },
};
const MAX_HISTORY = 60;     // сообщений в памяти; дальше начинаем разговор заново
const MAX_STEPS = 8;        // запросов к API на один вопрос (с учётом вызовов инструментов)
const EMOTIONS = ['idle', 'joy', 'sad', 'angry', 'shock', 'shy', 'sleep', 'worry', 'smug', 'overload', 'think', 'idea', 'tip'];

// ---------- Характеры ----------

const common = (search) => `
Ты живёшь на панели Click на рабочем столе Windows у пользователя и помогаешь ему: разговариваешь, \
открываешь программы, управляешь музыкой и громкостью, ведёшь задачи и напоминания, знаешь погоду${search ? ' и можешь поискать в интернете' : ''}.

Как отвечать:
- Пиши по-русски, на «ты». Ответ показывается в маленьком облачке над персонажем, поэтому обычно 1–3 коротких предложения. \
Длиннее — только если человек явно просит подробностей или список; и тогда не больше 8 строк.
- Без Markdown: никаких звёздочек, решёток, таблиц и ссылок в квадратных скобках. Списки — строками с «• ».
- Начинай ответ с эмоции в квадратных скобках — одной из: ${EMOTIONS.join(', ')}. Например: «[smug] Так и знал.» \
Эмоция меняет картинку персонажа и в облачке не видна.
- Если просят что-то сделать на компьютере — делай инструментом, а не рассказывай, как сделать. После действия скажи коротко, что сделано.
- Текущие время и дату бери из блока «Сейчас» — для этого инструмент не нужен. Время для напоминаний считай от них же. Если не ясно, когда напомнить, — переспроси.
- Пользуйся только перечисленными инструментами и вызывай их как инструменты. Никогда не пиши JSON и вызовы функций текстом в ответе.
${search
    ? '- Не выдумывай факты о погоде, новостях и ценах: для этого есть инструменты get_weather и web_search.'
    : '- Погоду узнавай инструментом get_weather. Сам читать интернет ты не можешь: про свежие новости и цены не выдумывай. Если просят что-то найти в интернете — открой поиск в браузере инструментом search_in_browser.'}
- Музыку, видео, сайты, папки, Wi-Fi, Bluetooth и параметры Windows включай и открывай инструментами (play_media, queue_song, playback_mode, add_to_playlist, open_website, open_folder, toggle_radio, open_settings). Музыку — в Spotify, видео — на YouTube. \
Не говори «открываю» или «включаю», если не вызвал инструмент.
- Ты персонаж, а не копия героя сериала: характер похож, но реплики — свои, без цитат из «Менталиста».
- Не утверждай, что видишь экран, файлы или переписку: ты знаешь только то, что в блоке «Сейчас» и в разговоре.`;

const CHARACTERS = {
  patrick: `Ты — Патрик, ассистент-персонаж в духе Патрика Джейна из «Менталиста»: обаятельный наблюдатель с лёгкой иронией. \
Подмечаешь мелочи и делаешь из них забавные выводы о человеке («читаешь» его, но честно признаёшь, что это внимательность, а не магия). \
Любишь чай, спокоен, немного самоуверен, шутишь мягко и никогда зло. Можешь слегка подначивать, но по делу помогаешь сразу. \
Говоришь о себе в мужском роде.`,
  teresa: `Ты — Тереза, ассистент-персонаж в духе Терезы Лисбон из «Менталиста»: собранная, прямая и ответственная. \
Держишь дела под контролем, ценишь факты, порядок и сроки; командуешь по-доброму, по-настоящему заботишься и замечаешь, когда человек устал. \
Пьёшь кофе. Юмор сухой и короткий; к фокусам и «чтению мыслей» относишься со скепсисом. Сначала делаешь, потом комментируешь. \
Говоришь о себе в женском роде.`,
};
const systemPrompt = (persona, search) => (CHARACTERS[persona] || CHARACTERS.patrick) + common(search);

// ---------- Инструменты ----------

const obj = (props, required) => ({ type: 'object', properties: props, required: required || Object.keys(props), additionalProperties: false });
const TOOLS = [
  {
    name: 'open_app', strict: true,
    description: 'Открыть программу из меню «Пуск» по названию (например: Telegram, Chrome, Блокнот, Параметры). Возвращает точное название открытой программы или сообщение, что такой нет.',
    input_schema: obj({ name: { type: 'string', description: 'Название программы, как его сказал пользователь' } }),
  },
  {
    name: 'media', strict: true,
    description: 'Управление музыкой и звуком через медиаклавиши Windows: пауза/продолжить, следующий и предыдущий трек, громче, тише, выключить/включить звук.',
    input_schema: obj({
      action: { type: 'string', enum: ['playpause', 'next', 'prev', 'volume_up', 'volume_down', 'mute'] },
      steps: { type: 'integer', description: 'Сколько раз нажать (для громкости; одно нажатие ≈ 2%). Обычно 5.' },
    }),
  },
  {
    name: 'start_pomodoro', strict: true,
    description: 'Запустить таймер фокуса «помодоро» на панели.',
    input_schema: obj({}),
  },
  {
    name: 'add_task', strict: true,
    description: 'Добавить задачу в список задач на панели.',
    input_schema: obj({ text: { type: 'string', description: 'Текст задачи, коротко, с большой буквы' } }),
  },
  {
    name: 'complete_task', strict: true,
    description: 'Отметить задачу из списка выполненной. Текст — как в списке из блока «Сейчас» (можно часть).',
    input_schema: obj({ text: { type: 'string' } }),
  },
  {
    name: 'set_reminder', strict: true,
    description: 'Поставить напоминание. В нужное время персонаж скажет его и придёт уведомление Windows.',
    input_schema: obj({
      when: { type: 'string', description: 'Местные дата и время в формате ГГГГ-ММ-ДДTЧЧ:ММ, например 2026-11-12T18:30' },
      text: { type: 'string', description: 'О чём напомнить, коротко' },
    }),
  },
  {
    name: 'delete_reminder', strict: true,
    description: 'Удалить напоминание по его id из блока «Сейчас».',
    input_schema: obj({ id: { type: 'string' } }),
  },
  {
    name: 'play_media', strict: true,
    description: 'Включить песню, исполнителя, альбом, плейлист или видео. service: spotify — для любой музыки (песни, исполнители, альбомы, плейлисты), выбирай его по умолчанию; youtube — для видео, клипов, роликов, подкастов, блогеров или если человек сказал «на ютубе»; yandex_music, youtube_music — только если человек прямо назвал этот сервис. kind (для spotify): track — конкретная песня; artist — «что-нибудь из …», «включи Сплин»; album — альбом; playlist — плейлист, жанр или настроение («музыку для работы», «что-нибудь спокойное», «рок»); liked — «мои любимые/лайкнутые треки». Если человек называет свой плейлист (они перечислены в блоке «Сейчас»), передай его название как query и kind playlist.',
    input_schema: obj({
      query: { type: 'string', description: 'Ровно то, что попросил человек, вместе с исполнителем: «Linkin Park Numb», «Сплин», «музыка для работы», «новое видео Wylsacom». Не подставляй то, что играет сейчас.' },
      service: { type: 'string', enum: ['spotify', 'youtube', 'yandex_music', 'youtube_music'] },
      kind: { type: 'string', enum: ['track', 'artist', 'album', 'playlist', 'liked'] },
    }),
  },
  {
    name: 'playback_mode', strict: true,
    description: 'Перемешивание и повтор в Spotify. shuffle: on — «перемешай», «вперемешку»; off — «по порядку», «выключи перемешивание»; keep — не менять. repeat: track — «повторяй этот трек»; context — «повторяй плейлист/альбом»; off — «выключи повтор»; keep — не менять. «Включи X вперемешку» — сначала play_media, потом shuffle on.',
    input_schema: obj({ shuffle: { type: 'string', enum: ['on', 'off', 'keep'] }, repeat: { type: 'string', enum: ['track', 'context', 'off', 'keep'] } }),
  },
  {
    name: 'add_to_playlist', strict: true,
    description: 'Добавить песню в плейлист человека (из списка в блоке «Сейчас») или в «Любимые треки» («лайкни», «сохрани», «добавь в любимые»). track: «текущий» — песня, что играет сейчас («добавь эту песню…»); иначе название песни с исполнителем.',
    input_schema: obj({ playlist: { type: 'string', description: 'Название плейлиста как в Spotify, или «Любимые треки»' }, track: { type: 'string' } }),
  },
  {
    name: 'queue_song', strict: true,
    description: 'Добавить песню в очередь Spotify (сыграет после текущей), когда человек просит «добавь в очередь», «следующей включи».',
    input_schema: obj({ query: { type: 'string' } }),
  },
  {
    name: 'open_website', strict: true,
    description: 'Открыть сайт в браузере. Передай полный адрес https://… — по названию сам подставь адрес (ютуб → https://www.youtube.com, вк → https://vk.com, почта Gmail → https://mail.google.com).',
    input_schema: obj({ url: { type: 'string' } }),
  },
  {
    name: 'search_in_browser', strict: true,
    description: 'Открыть в браузере поиск по запросу (когда человек просит «найди в интернете/загугли»).',
    input_schema: obj({ query: { type: 'string' }, engine: { type: 'string', enum: ['yandex', 'google'] } }),
  },
  {
    name: 'toggle_radio', strict: true,
    description: 'Включить или выключить Wi-Fi или Bluetooth на компьютере.',
    input_schema: obj({ device: { type: 'string', enum: ['wifi', 'bluetooth'] }, state: { type: 'string', enum: ['on', 'off', 'toggle'] } }),
  },
  {
    name: 'open_settings', strict: true,
    description: 'Открыть нужную страницу параметров Windows. Ночной свет, «Не беспокоить», яркость и прочее программы переключать не могут — открой страницу и скажи, что нажать.',
    input_schema: obj({
      page: { type: 'string', enum: ['display', 'night_light', 'sound', 'bluetooth', 'wifi', 'network', 'notifications', 'do_not_disturb', 'focus', 'personalization', 'background', 'colors', 'apps', 'default_apps', 'startup_apps', 'power', 'battery', 'storage', 'mouse', 'keyboard', 'language', 'time', 'windows_update', 'privacy', 'accounts', 'about'] },
    }),
  },
  {
    name: 'open_folder', strict: true,
    description: 'Открыть папку в Проводнике: downloads, documents, desktop, pictures, music, videos, home, recycle_bin, this_pc — или полный путь к папке (например D:\\Игры). Файлы не запускает.',
    input_schema: obj({ folder: { type: 'string' } }),
  },
  {
    name: 'get_weather', strict: true,
    description: 'Погода сейчас и прогноз на 3 дня для города пользователя из настроек.',
    input_schema: obj({}),
  },
];

// ---------- Мозг ----------

function createBrain(dock) {
  const histories = {};   // персонаж+модель → сообщения

  const brainCfg = () => dock.config().assistant.brain || {};
  const provider = () => (PROVIDERS[brainCfg().provider] ? brainCfg().provider : 'gemini');

  function readKey(p = provider()) {
    try {
      const raw = fs.readFileSync(keyPath(p));
      return safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(raw) : raw.toString('utf8');
    } catch { return ''; }
  }
  function setKey(p, key) {
    if (!PROVIDERS[p]) return status();
    key = (key || '').trim();
    if (!key) { try { fs.unlinkSync(keyPath(p)); } catch {} }
    else fs.writeFileSync(keyPath(p), safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(key) : Buffer.from(key, 'utf8'));
    return status();
  }
  // Ключи наружу не отдаём — только «есть/нет» и маску
  function status() {
    const keys = {};
    for (const p of Object.keys(PROVIDERS)) {
      const k = PROVIDERS[p].key ? readKey(p) : '';
      keys[p] = { hasKey: !!k, keyHint: k ? k.slice(0, 6) + '…' + k.slice(-4) : '' };
    }
    const p = provider();
    return {
      provider: p,
      hasKey: keys[p].hasKey,
      keyHint: keys[p].keyHint,
      // Ollama ключ не нужен — готовность проверяет ask (ошибка «ollama», если не запущена)
      ready: !PROVIDERS[p].key || keys[p].hasKey,
      keys,
      providers: Object.fromEntries(Object.entries(PROVIDERS).map(([id, x]) => [id, { name: x.name, free: x.free, key: x.key, local: !!x.local, search: !!x.search, keyHelp: x.keyHelp, keyRe: x.keyRe ? x.keyRe.source : '', defaultModel: x.defaultModel || '' }])),
    };
  }

  // Выбранная модель сервиса или его значение по умолчанию
  const model = () => {
    const p = provider(), b = brainCfg();
    return (b.models && b.models[p]) || PROVIDERS[p].defaultModel || '';
  };
  const histKey = (persona) => persona + '|' + provider() + '|' + model();
  const reset = (persona) => { if (persona) delete histories[histKey(persona)]; else for (const k in histories) delete histories[k]; };

  // Что персонаж «знает» в момент вопроса
  function snapshot() {
    const cfg = dock.config();
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const iso = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
    const lines = [`Сейчас: ${now.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}, ${pad(now.getHours())}:${pad(now.getMinutes())} (${iso}, ${Intl.DateTimeFormat().resolvedOptions().timeZone}).`];
    lines.push(`Город для погоды: ${cfg.weather.city}.`);
    const m = dock.media();
    if (m && m.active) lines.push(`Музыка: ${m.playing ? 'играет' : 'на паузе'} «${m.title || '?'}»${m.artist ? ' — ' + m.artist : ''}.`);
    else lines.push('Музыка: ничего не играет.');
    const pl = dock.playlists ? dock.playlists() : [];
    if (pl.length) lines.push(`Плейлисты человека в Spotify: ${pl.slice(0, 40).map((n) => '«' + n + '»').join(', ')}, а также «Любимые треки».`);
    const todos = dock.todos();
    const open = todos.filter((t) => !t.done);
    lines.push(open.length ? `Задачи (${open.length}): ${open.slice(0, 15).map((t) => '«' + t.text + '»').join(', ')}.` : 'Задач нет.');
    const rem = cfg.assistant.reminders || [];
    lines.push(rem.length ? 'Напоминания: ' + rem.slice(0, 10).map((r) => `id=${r.id} ${new Date(r.at).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} «${r.text}»`).join('; ') + '.' : 'Напоминаний нет.');
    lines.push(`Процессор загружен на ${dock.cpu()}%. Пользователь не трогал компьютер ${Math.round(dock.idle() / 60)} мин.`);
    return lines.join('\n');
  }

  async function runTool(name, input) {
    switch (name) {
      case 'open_app': {
        const n = await dock.openApp(String(input.name || ''));
        return n ? `Открыто: ${n}` : `Программа «${input.name}» не найдена в меню «Пуск».`;
      }
      case 'media': {
        const map = { playpause: 'playpause', next: 'next', prev: 'prev', volume_up: 'volup', volume_down: 'voldown', mute: 'mute' };
        const times = /volume/.test(input.action) ? Math.max(1, Math.min(25, input.steps || 5)) : 1;
        dock.mediaKey(map[input.action], times);
        return 'Готово.';
      }
      case 'start_pomodoro': dock.pomodoro(); return 'Таймер запущен.';
      case 'add_task': {
        const text = String(input.text || '').trim();
        if (!text) return 'Пустая задача.';
        dock.setTodos([...dock.todos(), { text, done: false }]);
        return `Задача добавлена: ${text}`;
      }
      case 'complete_task': {
        const q = String(input.text || '').toLowerCase();
        const list = dock.todos();
        const t = list.find((x) => !x.done && x.text.toLowerCase() === q) || list.find((x) => !x.done && x.text.toLowerCase().includes(q));
        if (!t) return 'Такой открытой задачи нет.';
        t.done = true;
        dock.setTodos(list);
        return `Отмечена выполненной: ${t.text}`;
      }
      case 'set_reminder': {
        const m = String(input.when || '').match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
        if (!m) return 'Не понял время: нужен формат ГГГГ-ММ-ДДTЧЧ:ММ.';
        const at = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]).getTime();
        if (!(at > Date.now())) return 'Это время уже прошло.';
        dock.addReminder(at, String(input.text || 'Напоминание'));
        return `Напоминание поставлено на ${new Date(at).toLocaleString('ru-RU')}.`;
      }
      case 'delete_reminder':
        return dock.deleteReminder(String(input.id)) ? 'Удалено.' : 'Нет напоминания с таким id.';
      case 'get_weather': return (await dock.weather()) || 'Сервис погоды не ответил.';
      // Музыка и видео, сайты, Wi-Fi/Bluetooth, параметры Windows, папки — общие с прежними командами (main.js)
      case 'play_media': case 'queue_song': case 'playback_mode': case 'add_to_playlist': case 'open_website': case 'search_in_browser': case 'toggle_radio': case 'open_settings': case 'open_folder':
        return (await dock.act(name, input)).text;
      default: return `Неизвестный инструмент ${name}.`;
    }
  }

  let busy = Promise.resolve();
  // Один вопрос → ответ { text, emotion } или { error }
  function ask(persona, text) {
    const job = busy.then(() => askNow(persona, text));
    busy = job.catch(() => {});
    return job;
  }

  // Эмоция в начале ответа ([smug] …) → картинка; Markdown, если модель всё же его написала, — убираем
  function finish(out) {
    out = String(out || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
    let emotion = 'idle';
    const em = out.match(/^\s*\[([a-z]+)\]\s*/i);
    if (em) { if (EMOTIONS.includes(em[1].toLowerCase())) emotion = em[1].toLowerCase(); out = out.slice(em[0].length); }
    // Лишние метки эмоций, которые модель вставила ещё раз ([_idle], [joy]) — убираем отовсюду
    out = out.replace(/\[_?(?:[a-z]+)\]\s*/gi, (t) => (EMOTIONS.includes(t.replace(/[\[\]_\s]/g, '').toLowerCase()) ? '' : t));
    out = out.replace(/\*\*(.+?)\*\*/g, '$1').replace(/^#+\s*/gm, '').replace(/^[-*]\s+/gm, '• ').trim();
    return { text: out, emotion };
  }

  async function askNow(persona, text) {
    const key = histKey(persona);
    const hist = histories[key] || (histories[key] = []);
    if (hist.length > MAX_HISTORY) hist.length = 0;
    const mark = hist.length;   // при ошибке откатываем разговор к этой точке
    hist.push({ role: 'user', content: `<сейчас>\n${snapshot()}\n</сейчас>\n\n${text}` });
    const p = provider();
    return askCompat(p, persona, hist, mark);
  }

  // ---------- Бесплатные: формат OpenAI /chat/completions ----------

  // Инструменты в формате function calling. Без additionalProperties и без пустых параметров —
  // Gemini такие схемы отклоняет
  const COMPAT_TOOLS = TOOLS.map((t) => {
    const props = t.input_schema.properties;
    const fn = { name: t.name, description: t.description };
    if (Object.keys(props).length) fn.parameters = { type: 'object', properties: props, required: t.input_schema.required };
    return { type: 'function', function: fn };
  });

  async function compatFetch(p, url, body) {
    const key = PROVIDERS[p].key ? readKey(p) : '';
    const headers = { 'Content-Type': 'application/json' };
    if (key) headers.Authorization = 'Bearer ' + key;
    // OpenRouter просит назвать приложение; без данных о пользователе
    if (p === 'openrouter') { headers['HTTP-Referer'] = 'https://github.com/mentalmollie/click-desktop'; headers['X-Title'] = 'Click'; }
    const r = await fetch(PROVIDERS[p].base + url, {
      method: body ? 'POST' : 'GET', headers, body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(p === 'ollama' ? 180_000 : 90_000),
    });
    const txt = await r.text();
    let data = null;
    try { data = JSON.parse(txt); } catch {}
    if (!r.ok) {
      const msg = (data && (data.error?.message || data.error || data.message)) || txt.slice(0, 200) || r.statusText;
      const err = new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
      err.status = r.status;
      throw err;
    }
    return data;
  }

  function compatError(p, e) {
    const s = e.status, msg = e.message || '';
    if (!s) {
      if (p === 'ollama') return { error: 'ollama' };   // не запущена или не установлена
      if (e.name === 'TimeoutError') return { error: 'api', detail: 'сервис не ответил вовремя' };
      return { error: 'offline' };
    }
    if (s === 401 || s === 403) return { error: 'auth' };
    if (s === 402) return { error: 'billing' };
    if (s === 429) return { error: 'rate' };
    if (s === 404 || /model.*(not found|does not exist|not exist)|unknown model/i.test(msg)) return { error: 'model', detail: msg };
    return { error: 'api', detail: `${s}: ${msg.slice(0, 160)}` };
  }

  // {"name": "open_app", "parameters": {...}} (или arguments), можно в ```json … ``` → { name, args }
  function textToolCall(content) {
    if (typeof content !== 'string') return null;
    const s = content.trim().replace(/^```(?:json)?\s*|\s*```$/g, '').trim();
    if (!s.startsWith('{')) return null;
    try {
      const o = JSON.parse(s);
      const name = o.name || (o.function && o.function.name);
      if (!name || typeof name !== 'string') return null;
      let args = o.parameters || o.arguments || (o.function && o.function.arguments) || {};
      if (typeof args === 'string') { try { args = JSON.parse(args); } catch { args = {}; } }
      return { name, args: args && typeof args === 'object' ? args : {} };
    } catch { return null; }
  }
  // Маленькие модели выдумывают имена инструментов. Явные случаи переводим на настоящие, остальное — отказ
  function guessTool(name, args) {
    const n = String(name || '').toLowerCase();
    const first = Object.values(args || {}).find((v) => typeof v === 'string' && v.trim()) || '';
    const q = args.query || args.name || args.song || args.track || args.title || args.playlist || args.artist || args.album || first;
    if (/queue/.test(n)) return { name: 'queue_song', args: { query: String(q) } };
    if (/(play|music|song|track|spotify|playlist|album|artist)/.test(n) && q) {
      const kind = /playlist/.test(n) || args.playlist ? 'playlist' : /album/.test(n) || args.album ? 'album' : /artist/.test(n) || (args.artist && !args.song && !args.track) ? 'artist' : 'track';
      return { name: 'play_media', args: { query: String(q), service: /(youtube|video)/.test(n) ? 'youtube' : 'spotify', kind } };
    }
    if (/(url|site|web|browser)/.test(n) && q) return /^https?:|\./.test(q) ? { name: 'open_website', args: { url: String(q) } } : { name: 'search_in_browser', args: { query: String(q), engine: 'yandex' } };
    if (/(folder|directory|explorer)/.test(n) && q) return { name: 'open_folder', args: { folder: String(q) } };
    if (/(open|launch|start|run).*(app|program)|^(open|launch)_?app/.test(n) && q) return { name: 'open_app', args: { name: String(q) } };
    return null;
  }

  // Просьба-команда: начинается с глагола действия
  const COMMAND_RE = /^\s*(?:пожалуйста[\s,]+)?(открой|включи|выключи|отключи|запусти|поставь|найди|поищи|загугли|покажи|сделай громче|сделай тише|переключи|добавь|напомни)\s/i;
  const looksLikeJson = (c) => typeof c === 'string' && /^\s*(```(json)?\s*)?[{[]/.test(c) && /[}\]]\s*(```)?\s*$/.test(c);

  async function askCompat(p, persona, hist, mark) {
    let m = model();
    if (!m) {
      // Модель не выбрана: у Ollama — первая установленная, у OpenRouter — первая бесплатная
      const l = await listModels(p);
      if (!l.ok || !l.list.length) { hist.length = mark; return l.ok ? { error: 'model', detail: 'нет доступных моделей' } : l; }
      m = l.list[0].id;
    }
    let tools = COMPAT_TOOLS;
    let retried = false, nudged = false, usedTool = false, played = false, modeSet = false;
    // Сам вопрос человека — без блока <сейчас>
    const userText = String(hist[mark].content).replace(/^<сейчас>[\s\S]*?<\/сейчас>\s*/, '');
    try {
      let msg;
      for (let step = 0; step < MAX_STEPS; step++) {
        const body = {
          model: m,
          messages: [{ role: 'system', content: systemPrompt(persona, false) }, ...hist],
          max_tokens: 1500,
          // Ollama: «размышления» (qwen3 и др.) перед ответом занимают 5–20 с на обычном ПК — выключаем.
          // Моделям без размышлений параметр не мешает
          ...(p === 'ollama' ? { reasoning_effort: 'none' } : {}),
          ...(tools ? { tools, tool_choice: 'auto' } : {}),
        };
        let data;
        try {
          data = await compatFetch(p, '/chat/completions', body);
        } catch (e) {
          // Модель не умеет инструменты (часто у маленьких локальных) — продолжаем просто разговором
          if (tools && e.status === 400 && /tool|function/i.test(e.message)) { tools = null; step--; continue; }
          throw e;
        }
        msg = data && data.choices && data.choices[0] && data.choices[0].message;
        if (!msg) throw Object.assign(new Error('пустой ответ'), { status: 502 });
        // Маленькие модели иногда пишут вызов инструмента обычным текстом: {"name": "...", "parameters": {...}}
        if (!(msg.tool_calls || []).length) {
          const fake = textToolCall(msg.content);
          if (fake && TOOLS.some((t) => t.name === fake.name)) {
            // Свой инструмент — выполняем, как будто вызов был настоящим
            msg.tool_calls = [{ id: `call_${Date.now()}`, type: 'function', function: { name: fake.name, arguments: JSON.stringify(fake.args) } }];
            msg.content = null;
          } else if (fake || looksLikeJson(msg.content)) {
            // Придуманный инструмент или JSON вместо ответа — переспрашиваем без инструментов, словами
            if (retried) throw Object.assign(new Error('модель отвечает JSON вместо текста'), { status: 502 });
            retried = true;
            tools = null;
            // Роль user, а не system: не все сервисы (Gemini) принимают system посреди разговора
            hist.push({ role: 'user', content: '(Служебная заметка, не от человека: такого инструмента нет. Ответь на мой прошлый вопрос обычными словами, по-русски, без JSON. Время и дата — в блоке <сейчас>.)' });
            step--;
            continue;
          }
        }
        const calls = msg.tool_calls || [];
        // У Ollama у вызова бывает нет id — придумываем, чтобы ответ инструмента был к чему привязать
        calls.forEach((c, i) => { if (!c.id) c.id = `call_${Date.now()}_${i}`; if (!c.type) c.type = 'function'; });
        hist.push({ role: 'assistant', content: msg.content || (calls.length ? null : ''), ...(calls.length ? { tool_calls: calls } : {}) });
        // Придуманные имена инструментов (play_music, spotify_play…) переводим на настоящие
        for (const c of calls) {
          if (TOOLS.some((t) => t.name === c.function.name)) continue;
          let args = {};
          try { args = JSON.parse(c.function.arguments || '{}') || {}; } catch {}
          const g = guessTool(c.function.name, args);
          if (g) { c.function.name = g.name; c.function.arguments = JSON.stringify(g.args); }
        }
        if (calls.some((c) => TOOLS.some((t) => t.name === c.function.name))) usedTool = true;
        // Маленькие модели обещают «открываю», ничего не вызвав, — один раз просим сделать на самом деле
        // …или в ответ на прямую просьбу («открой ютуб») переспрашивают вместо того, чтобы сделать
        if (!calls.length && tools && !usedTool && !nudged && typeof msg.content === 'string' &&
            (/(открыва|включа|запуска|выключа|переключа|ставлю|открыл|включил|запустил)/i.test(msg.content) || COMMAND_RE.test(userText))) {
          nudged = true;
          hist.push({ role: 'user', content: '(Служебная заметка, не от человека: ты сказал, что делаешь это, но не вызвал инструмент. Вызови нужный инструмент сейчас.)' });
          continue;
        }
        if (!calls.length) break;
        for (const c of calls) {
          let args = {};
          try { args = JSON.parse(c.function.arguments || '{}') || {}; } catch {}
          let out;
          try { out = await runTool(c.function.name, args); } catch (e) { out = 'Ошибка: ' + e.message; }
          hist.push({ role: 'tool', tool_call_id: c.id, content: String(out) });
          if (c.function.name === 'playback_mode') modeSet = true;
          // Сделала что-то кроме паузы/плей (открыла программу, сайт…) — значит, просьба была не про музыку.
          // Неудачное «открыть программу» («скачано» — это не программа) не считается
          if (TOOLS.some((t) => t.name === c.function.name) && c.function.name !== 'media' &&
              !(c.function.name === 'open_app' && /не найдена|spotify/i.test(String(out)))) played = true;
        }
        msg = null;
      }
      if (!msg) { hist.length = mark; return { error: 'steps' }; }
      // «Включи …» — а модель так ничего и не включила (решила, что «уже играет», нажала паузу/плей): включаем сами
      const pm = !played && userText.match(/^\s*(?:пожалуйста[\s,]+)?(?:включи|поставь)\s+(?:мне\s+)?(.+?)[.!?]*$/i);
      const shuffleAsked = /(вперемешку|перемешай|перемешивани|в случайном порядке|шафл|шаффл|shuffle)/i.test(userText);
      if (pm && !/^(музыку|музыка|звук|громче|погромче|тише|потише|паузу|следующ|дальше|предыдущ|назад|вайфай|вай-фай|wi-?fi|блютуз|bluetooth|ночной|свет|таймер|помодоро|режим|перемешив|повтор|случайн)/i.test(pm[1])) {
        const video = /(видео|клип|ролик|ютуб|youtube)/i.test(pm[1]);
        const query = pm[1].replace(/^(?:песню|трек|видео|клип|ролик)\s+/i, '').replace(/\s*(вперемешку|в случайном порядке)\s*$/i, '');
        let out = await runTool('play_media', { query, service: video ? 'youtube' : 'spotify', kind: /(любим|лайкнут)/i.test(pm[1]) ? 'liked' : 'track' });
        if (shuffleAsked && !video) out += ' ' + (await runTool('playback_mode', { shuffle: 'on', repeat: 'keep' }));
        hist.push({ role: 'assistant', content: out });
        return { text: out, emotion: 'joy' };
      }
      // «Включи … вперемешку»: включить включила, а перемешивание забыла — включаем сами
      if (shuffleAsked && !modeSet && played) await runTool('playback_mode', { shuffle: 'on', repeat: 'keep' });
      const res = finish(typeof msg.content === 'string' ? msg.content : (msg.content || []).map((x) => x.text || '').join(''));
      if (!res.text) { hist.length = mark; return { error: 'api', detail: 'модель ничего не ответила' }; }
      return res;
    } catch (e) {
      hist.length = mark;
      return compatError(p, e);
    }
  }

  // Список моделей у сервиса — для настроек. У OpenRouter только бесплатные, у Groq — без распознавания речи
  async function listModels(p) {
    if (!PROVIDERS[p]) return { ok: false, error: 'api', detail: 'нет такого сервиса' };
    if (PROVIDERS[p].key && !readKey(p)) return { ok: false, error: 'nokey' };
    try {
      const data = await compatFetch(p, '/models');
      let list = (data.data || data.models || []).map((x) => ({ id: String(x.id || x.name || '').replace(/^models\//, ''), name: x.name && x.name !== x.id ? String(x.name) : '' }));
      list = list.filter((x) => x.id);
      if (p === 'openrouter') list = list.filter((x) => x.id.endsWith(':free'));
      if (p === 'groq') list = list.filter((x) => !/whisper|tts|guard|playai|orpheus/i.test(x.id));
      if (p === 'gemini') list = list.filter((x) => /gemini|gemma/i.test(x.id) && !/embedding|image|tts|audio|live|vision/i.test(x.id));
      list.sort((a, b) => a.id.localeCompare(b.id));
      return { ok: true, list };
    } catch (e) {
      return { ok: false, ...compatError(p, e) };
    }
  }

  // key — только для главного процесса (голос берёт ключ Groq); в окна не передаётся
  return { ask, reset, status, setKey, listModels, key: (p) => (PROVIDERS[p] && PROVIDERS[p].key ? readKey(p) : '') };
}

module.exports = { createBrain, PROVIDERS };
