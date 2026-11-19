// Ассистент на панели — Патрик или Тереза (выбирается в настройках).
// Патрик: обаятельный наблюдатель с иронией, любит чай, «читает» людей по мелочам.
// Тереза: собранная и прямая, держит дела под контролем, пьёт кофе, ирония сухая, заботится всерьёз.
// Все реплики свои, не цитаты из сериала.
const $ = (s) => document.querySelector(s);
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const SIZES = { s: 92, m: 120, l: 150 };

let cfg = null;
let media = null;
let todos = [];
let social = [];
let cpu = 0;
let idleSec = 0;
let emotion = null;        // временная эмоция { name, until, cls }
let lastFrame = '';
let dizzyUntil = 0;        // до какого времени кружится голова (потрясли мышкой)

// ---------- Реплики ----------

const PATRICK = {
  idle: [
    'Ты сейчас подумал о чае. Не отрицай.',
    'Я наблюдаю. Это у меня профессиональное.',
    'Знаешь, что выдаёт человека? Как он закрывает вкладки.',
    'Расслабься. Я читаю людей, а не твои файлы.',
    'Улыбнись. Я же вижу, что хочется.',
    'Иногда лучший план — сделать вид, что плана нет.',
    'Ты слишком серьёзный. Это подозрительно.',
    'Спорим, ты сейчас откроешь браузер «на минутку»?',
    'Чай остывает быстрее, чем решаются загадки.',
    'Люди предсказуемы. Кроме тебя. Почти.',
  ],
  click: ['Эй, я думаю.', 'Щекотно.', 'Да-да, я весь внимание.', 'Спокойно, я не исчезну.', 'Ещё раз — и я угадаю твой пароль. Шучу. Наверное.'],
  angry: ['Всё, я обиделся. На целых пять секунд.', 'Хватит тыкать! Я тебе не кнопка.', 'Ты проверяешь моё терпение. Оно бесконечное. Почти.'],
  musicStart: [
    'О, {artist}. Это многое о тебе говорит.',
    'Под такую музыку хорошо раскрывать загадки.',
    '«{title}»… Хороший выбор. Я бы тоже такое включил.',
    'Музыка. Наконец-то хоть что-то с ритмом в этой комнате.',
  ],
  overload: ['Твой компьютер нервничает. Я это чувствую.', 'Тсс… процессор сейчас закипит.', 'Кто-то тут явно перегружен. И это не я.'],
  followersUp: ['+{n} в {net}. Люди тянутся к обаянию — я же говорил.', '{net}: +{n}. Неплохо, совсем неплохо.'],
  followersDown: ['{net}: минус {n}. Не все ценят гениев.', 'Минус {n} в {net}. Переживут. А мы — тем более.'],
  taskAdded: ['Записал: «{t}». Мозг может отдохнуть — я помню.', '«{t}» — в списке. Я прослежу.'],
  taskDone: ['Готово. Я знал, что ты справишься.', 'Одной задачей меньше. Чаю в награду?'],
  pomodoroWork: ['Время перерыва. Чашку чая?', 'Фокус окончен. Встань, потянись — я присмотрю.'],
  pomodoroBreak: ['Перерыв окончен. Вернёмся к делу.', 'Отдохнули — и хватит. За работу, детектив.'],
  wake: ['С возвращением. Я ничего не трогал. Почти.', 'О, ты вернулся. Я как раз заскучал.'],
  morning: ['Доброе утро. Дай угадаю: кофе? Зря, чай лучше.'],
  night: ['Уже ночь. Даже менталисты иногда спят.'],
  hello: ['Привет. Я тебя ждал — догадался, что ты напишешь.', 'Здравствуй. По глазам вижу — день будет интересным.'],
  thanks: ['Всегда пожалуйста. Обаяние бесплатное.', 'Не за что. Запишу в долг — чаем отдашь.'],
  who: ['Я Патрик. Наблюдаю, подмечаю, напоминаю. И немного читаю мысли — исключительно для твоей пользы.'],
  jokes: [
    'Экстрасенсов не бывает. Бывают внимательные люди. И я.',
    'Говорят, я всё угадываю. На самом деле я просто смотрю на часы.',
    'Секрет хорошего фокуса — чтобы зритель сам захотел поверить.',
  ],
  tea: ['Чай — это не напиток. Это способ подумать.', 'Зелёный, без сахара. Остальное — компромиссы.'],
  read: [
    'Сейчас {time}, ты {busy}. Значит, ты из тех, кто доводит дела до конца. Или до ночи.',
    'Ты напряжённо смотришь в экран, но пишешь мне. Значит, хочешь отвлечься. Угадал?',
  ],
  // Ответы на команды
  open: ['Открываю {name}.'],
  notFound: ['Хм, не нахожу «{q}». Точно так называется?'],
  louder: ['Громче. Пусть соседи тоже насладятся.'],
  quieter: ['Тише. Так даже лучше думается.'],
  mute: ['Тишина. Я её тоже люблю.'],
  pause: ['Пауза.'],
  play: ['Музыка!'],
  next: ['Следующий. Надеюсь, этот тебе понравится больше.'],
  prev: ['Возвращаю.'],
  remindWhen: ['Когда напомнить? Скажи «через 10 минут» или «в 18:30».'],
  remindOk: ['Хорошо. Напомню в {time}: «{msg}».'],
  noReminders: ['Напоминаний нет. Память у тебя, видимо, отличная.'],
  noTasks: ['Задач нет. Наслаждайся — это ненадолго.'],
  freeDay: ['Задач нет — подозрительно свободный день.'],
  noWeather: ['Не могу достучаться до погоды. Выгляни в окно — старый добрый способ.'],
  pomodoro: ['Запускаю фокус. Я присмотрю за временем.'],
  unknown: ['Это мне пока не по зубам.'],
  canTail: ['А чтобы поговорить обо всём — подключи мне нейросеть в настройках ассистента. Есть и бесплатные.'],
  greet: ['Я тут. Если что — нажми на меня.', 'Патрик на месте. Наблюдаю.'],
  // Подбросили мышкой
  flyStart: ['Ого!', 'Эй-эй-эй!', 'Лечу-у!', 'Ну вот, опять.'],
  thrown: ['Ух! Ещё раз?', 'Это было… неожиданно.', 'Я так и знал, что ты это сделаешь.', 'Голова кружится. Но приятно.', 'Мягкая посадка. Почти.'],
  thrownHard: ['Эй! Я тебе не мячик!', 'Полегче! У меня же чай.', 'Всё, я обиделся. Секунд на пять.'],
  dropped: ['Ой! Земля ближе, чем казалось.', 'Мягкая посадка. Почти.', 'Я так и знал, что ты меня уронишь.', 'Ничего, я крепкий.'],
  // Потрясли мышкой — кружится голова
  dizzy: ['О-о-ох… Почему комнат две?', 'Всё кружится… Я в порядке. Наверное.', 'Не тряси меня, я не коктейль.', 'Кажется, я вижу звёзды. И это не метафора.'],
};

const TERESA = {
  idle: [
    'Так. Что у нас по делам? Только честно.',
    'Кофе есть, план есть. Можно работать.',
    'Я не ворчу. Я контролирую ситуацию.',
    'Если что-то горит — говори сразу, а не через час.',
    'Сначала факты, потом выводы. Не наоборот.',
    'Десять вкладок открыто. Это расследование или прокрастинация?',
    'Правила существуют не просто так. Даже скучные.',
    'Я присматриваю. Это моя работа.',
    'Иногда «нет» — самый продуктивный ответ.',
    'Сделаем по-моему: быстро и без фокусов.',
  ],
  click: ['Да? Слушаю.', 'Я на месте.', 'Говори, я записываю.', 'Без паники. Что случилось?', 'Ещё раз ткнёшь — заведу на тебя дело.'],
  angry: ['Так. Хватит. Я серьёзно.', 'Ещё раз — и пишешь объяснительную.', 'Терпение у меня железное. Но не бесконечное.'],
  musicStart: [
    '{artist}? Неожиданно. Но одобряю.',
    'Музыка — ладно. Но работа сама себя не сделает.',
    '«{title}». Под такое хорошо разбирать завалы.',
    'Хорошо, пусть играет. Только не отвлекайся.',
  ],
  overload: ['Компьютер на пределе. Закрой лишнее, пока он не сдался.', 'Процессор кипит. Это не я, это он.', 'Слишком много всего открыто. Наведём порядок?'],
  followersUp: ['{net}: +{n}. Хорошая работа.', '+{n} в {net}. Растём — и правильно.'],
  followersDown: ['{net}: минус {n}. Бывает. Работаем дальше.', 'Минус {n} в {net}. Не повод раскисать.'],
  taskAdded: ['Записала: «{t}». Я-то не забуду — и ты не забудь.', '«{t}» — в списке. Беру на контроль.'],
  taskDone: ['Закрыто. Так держать.', 'Одно дело раскрыто. Следующее.'],
  pomodoroWork: ['Перерыв. Встань, разомнись — это приказ.', 'Пять минут отдыха. Не обсуждается.'],
  pomodoroBreak: ['Перерыв окончен. Возвращаемся к работе.', 'Отдохнули — за дело.'],
  wake: ['Вернулся? Отлично. Пока тебя не было — всё спокойно.', 'С возвращением. Я ничего не пропустила.'],
  morning: ['Доброе утро. Кофе — и за работу.'],
  night: ['Поздно уже. Иди спать — это не просьба.'],
  hello: ['Привет. Что у нас сегодня?', 'Здравствуй. Давай по делу — я слушаю.'],
  thanks: ['Не за что. Это моя работа.', 'Обращайся. Лучше по делу.'],
  who: ['Я Тереза. Слежу, чтобы дела делались, напоминания срабатывали, а ты не засиживался до ночи.'],
  jokes: [
    'Чтение мыслей? Нет. Я просто внимательно читаю отчёты.',
    'Знаю я одного «экстрасенса». Хлопот с ним больше, чем пользы. Почти.',
    'Мой лучший фокус — сдавать всё в срок.',
  ],
  tea: ['Чай? Я за кофе. Чёрный, без сахара.', 'Кофе — топливо. Чай — для тех, у кого есть время.'],
  read: [
    'Сейчас {time}, ты {busy}. Вывод: пора расставить приоритеты.',
    'Не нужно читать мысли, чтобы понять: ты устал. Сделай перерыв.',
  ],
  open: ['Открываю {name}.'],
  notFound: ['Не нахожу «{q}». Проверь название.'],
  louder: ['Громче. Только соседей не пугай.'],
  quieter: ['Тише. Так проще сосредоточиться.'],
  mute: ['Звук выключен. Тишина — это хорошо.'],
  pause: ['Пауза.'],
  play: ['Включаю.'],
  next: ['Следующий трек.'],
  prev: ['Возвращаю.'],
  remindWhen: ['Когда напомнить? Например: «через 10 минут» или «в 18:30».'],
  remindOk: ['Принято. Напомню в {time}: «{msg}».'],
  noReminders: ['Напоминаний нет. Всё под контролем.'],
  noTasks: ['Задач нет. Редкий случай — наслаждайся.'],
  freeDay: ['Задач нет — день свободен. Пока что.'],
  noWeather: ['Погода не отвечает. Выгляни в окно.'],
  pomodoro: ['Запускаю фокус. Работаем без отвлечений.'],
  unknown: ['Такого я пока не умею.'],
  canTail: ['Для свободного разговора подключи нейросеть в настройках ассистента — есть бесплатные.'],
  greet: ['Я на месте. Если что — нажми на меня.', 'Тереза на связи. Работаем.'],
  // Подбросили мышкой
  flyStart: ['Эй!', 'Что ты делаешь?!', 'Поставь меня!', 'Так. Это лишнее.'],
  thrown: ['Так. Больше так не делай.', 'Серьёзно? Я на работе.', 'Ладно, это было весело. Немного.', 'Приземлилась. Можно работать дальше?'],
  thrownHard: ['Ещё раз — и пишешь объяснительную.', 'Аккуратнее! Я же с кофе.', 'Это было превышение полномочий.'],
  dropped: ['Ай. Можно было и аккуратнее.', 'Приземлилась. Работаем дальше.', 'Так. Больше меня не роняй.', 'Цела. Кофе — нет.'],
  // Потрясли мышкой — кружится голова
  dizzy: ['Ох… Стоп. Мир, остановись.', 'Голова кружится. Это уже нападение на сотрудника.', 'Не тряси меня. Я не снежный шар.', 'Так… Сколько тут тебя? Трое?'],
};

let LINES = PATRICK;   // меняется в applyCfg по выбранному ассистенту
let PERSONA = ASSISTANTS.patrick;
const line = (key, v) => fill(pick(LINES[key] || PATRICK[key]), v || {});

const fill = (s, v) => s.replace(/\{(\w+)\}/g, (_, k) => (v[k] != null ? v[k] : ''));

// ---------- Облачко и голос ----------

let hideTimer = null;
let typeTimer = null;
let typingUntil = 0;
const talk = () => (cfg ? cfg.assistant.talk : 'normal');
const muted = () => cfg && cfg.assistant.muteUntil > Date.now();

function say(text, { ms, important = false } = {}) {
  if (!text) return;
  if (muted() && !important) return;
  const box = $('#bubble'), t = $('#btext');
  box.classList.remove('hidden');
  clearInterval(typeTimer);
  clearTimeout(hideTimer);
  // Печатает буква за буквой — как будто говорит
  t.textContent = '';
  let i = 0;
  // Пока текст печатается — шевелит губами (см. render) и стучит «машинка» (если не говорит вслух)
  const typeMs = Math.ceil(text.length / 2) * 18;
  typingUntil = Date.now() + typeMs + 150;
  const snd = cfg && cfg.assistant;
  if (snd && !snd.speak && (snd.typeSound || 'typewriter') !== 'off') {
    TypeSound.play(typeMs, { kind: snd.typeSound || 'typewriter', volume: snd.typeVolume ?? 0.4, pitch: PERSONA.female ? 'high' : 'low' });
  }
  typeTimer = setInterval(() => {
    i += 2;
    t.textContent = text.slice(0, i);
    if (i >= text.length) clearInterval(typeTimer);
  }, 18);
  const dur = ms || Math.min(14000, Math.max(4000, text.length * 65));
  hideTimer = setTimeout(() => { if (!asking) box.classList.add('hidden'); t.textContent = ''; }, dur);
  if (cfg && cfg.assistant.speak) speak(text);
}

function speak(text) {
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'ru-RU';
    const voice = PERSONA.female ? /irina|svetlana|ekaterina|female/i : /pavel|dmitry|\bmale/i;
    const v = speechSynthesis.getVoices().find((x) => /ru/i.test(x.lang) && voice.test(x.name)) ||
      speechSynthesis.getVoices().find((x) => /ru/i.test(x.lang));
    if (v) u.voice = v;
    u.rate = 1.05;
    speechSynthesis.speak(u);
  } catch {}
}

// ---------- Эмоции и кадры ----------

function react(name, text, opts = {}) {
  emotion = { name, until: Date.now() + (opts.hold || 4500), cls: opts.cls || (name === 'joy' ? 'hop' : name === 'angry' || name === 'overload' ? 'shake' : '') };
  render();
  if (text) say(text, opts);
}

const night = () => { const h = new Date().getHours(); return h >= 1 && h < 6; };

// Базовое состояние, когда нет свежей эмоции
function baseState() {
  if (idleSec > 300 || (night() && idleSec > 60)) return { name: 'sleep', cls: 'sleeping' };
  if (cpu >= 92) return { name: 'overload', cls: 'shake' };
  if (cpu >= 80) return { name: 'worry', cls: '' };
  // Под музыку танцует, меняя позы; видео — просто сидит и смотрит (см. videoOn в pickFrame)
  if (media && media.active && media.playing && media.kind !== 'video') {
    return { name: Math.floor(Date.now() / 2400) % 2 ? 'joy' : 'smug', cls: 'dance' };
  }
  return { name: 'idle', cls: '' };
}
const videoOn = () => !!(media && media.active && media.playing && media.kind === 'video');

// ---------- Покадровая анимация ----------
// Кадры анимации (assets/<имя>/anim/*.png) — на том же холсте, что и кадры эмоций, поэтому смена
// «эмоция ↔ анимация» без скачков. Состояния по приоритету:
//   разовое действие (машет, пьёт чай/кофе) → эмоция → ходьба (с разворотом) → думает (ждёт «мозг») →
//   сон (засыпает, потом дышит во сне) → танец под музыку → стоит (моргает, говорит губами).
// Если у персонажа нет кадров анимации — прежнее поведение на кадрах эмоций.
const SEQ = {
  walk: ['walk1', 'walk2', 'walk3', 'walk4', 'walk5', 'walk6', 'walk7', 'walk8'],
  turnIn: ['turn1', 'turn2', 'side'],
  turnOut: ['side', 'turn2', 'turn1'],
  dance: ['dance1', 'dance2', 'dance3', 'dance4'],
  think: ['think1', 'think2'],
  talk: ['talk1', 'talk2', 'talk1', 'talk3', 'stand', 'talk2'],
};
const ACTS = {
  wave: [['wave1', 220], ['wave2', 200], ['wave3', 200], ['wave2', 200], ['wave3', 200], ['wave4', 300]],
  sip: [['sip1', 900], ['sip2', 1600], ['sip1', 700]],
  // Позвали по имени: короткий взмах «я здесь»
  called: [['wave1', 170], ['wave2', 150], ['wave1', 150], ['wave4', 200]],
  // Приземление: с высоты — плюхается со звёздочками, встаёт, отряхивается; с малой — сразу отряхивается
  landBig: [['fall5', 220], ['fall6', 1300], ['fall7', 450], ['fall8', 800]],
  landSmall: [['fall5', 200], ['fall8', 650]],
  // Кружится голова: плюхается, сидит со звёздочками, встаёт — и дальше шатается (без «отряхивается»)
  landDizzy: [['fall5', 220], ['fall6', 1300], ['fall7', 450]],
};

// Позвали по имени (из assistant-voice.js). waiting — позвали одним именем и ждём команду
const listening = () => typeof followUntil !== 'undefined' && Date.now() < followUntil;
function onCalled(waiting) {
  // Гулял — останавливается (разворот к человеку сделает сама анимация ходьбы)
  if (walk.state === 'walk') { walk.state = 'pause'; walk.until = performance.now() + (waiting ? 10000 : 3000); }
  emotion = null;
  playAct('called');
  const box = $('#spritebox');
  box.classList.remove('perk'); void box.offsetWidth; box.classList.add('perk');
  setTimeout(() => box.classList.remove('perk'), 400);
}
// На этих эмоциях во время речи лучше показать шевелящиеся губы; на ярких (злость, шок…) — оставить эмоцию
const TALK_OVER = new Set(['idle', 'tip', 'smug', 'think']);

let act = null;            // { seq, t0 } — разовое действие
let walkAnim = null;       // { phase: 'in'|'walk'|'out', t0 }
let sleepSince = 0;
let nextBlink = Date.now() + 3000;
let nextSip = Date.now() + 120000;
const hasAnim = () => !!PERSONA.anim;

function playAct(name) {
  if (!hasAnim() || !ACTS[name]) return;
  act = { seq: ACTS[name], t0: Date.now() };
}

// Какой кадр сейчас: { frame, anim (из anim/), cls (эффект CSS), pop (подскок при смене), g (группа) }.
// Группа — «что он сейчас делает» (стоит, идёт, говорит, танцует, эмоция X…): при смене группы
// прошлый кадр плавно растворяется (см. render), а внутри группы кадры сменяются чётко.
// ---------- Сидит, когда ничего не происходит ----------
// Стоит спокойно ~7,5 с (или уснул) — садится. Сидя моргает, оглядывается, пьёт чай/кофе, потягивается,
// засыпает сидя. Что-то случилось (говорит, позвали, эмоция, идёт гулять…) — встаёт; схватили мышкой — сразу.
const SIT_AFTER = 7500;
const SIT_EVENTS = [
  [40, [['sit4', 1700]]],                                                              // оглядывается
  [30, [['sit5', 1800], ['sit6', 1300], ['sit5', 1200], ['sit6', 1100], ['sit5', 900]]],  // чашка
  [15, [['sit8', 1500]]],                                                              // потягивается
  [15, [['sit3', 900]]],                                                               // прикрыл глаза
];
let calmSince = Date.now();
let seated = null;        // { since, ev: { seq, t0 } | null, nextEv, nextBlink }
let standUntil = 0;       // встаёт (кадр sit1) до этого времени

function pickFrame(now) {
  const st = pickFrameBase(now);
  if (!hasAnim()) return st;
  const A = (frame, g, extra) => ({ frame, anim: true, cls: '', g, ...extra });
  const calm = (st.g === 'stand' || st.g === 'sleep') && !drag && !fly && !asking && $('#bubble').classList.contains('hidden');
  // Идёт видео — садится смотреть сразу, не дожидаясь SIT_AFTER
  if (!calm || (!seated && now - calmSince < SIT_AFTER && st.g !== 'sleep' && !videoOn())) {
    if (!calm) calmSince = now;
    if (seated) {
      // встаёт: схватили или бросили — сразу, иначе через кадр «присел»
      if (!drag && !fly && now - seated.since > 300) standUntil = now + 200;
      seated = null;
    }
    if (now < standUntil && !drag && !fly) return A('sit1', 'sit');
    return st;
  }
  if (!seated) seated = { since: now, ev: null, nextEv: now + 4000 + Math.random() * 8000, nextBlink: now + 2500 };
  const t = now - seated.since;
  if (t < 220) return A('sit1', 'sit');                         // садится
  if (st.g === 'sleep') return A('sit7', 'sit', { cls: 'sleeping' });   // уснул сидя
  if (seated.ev) {
    let k = now - seated.ev.t0;
    for (const [f, d] of seated.ev.seq) { if (k < d) return A(f, 'sit'); k -= d; }
    seated.ev = null;
    seated.nextEv = now + 6000 + Math.random() * 12000;
  }
  if (now >= seated.nextEv) {
    let r = Math.random() * 100;
    const ev = SIT_EVENTS.find(([w]) => (r -= w) < 0) || SIT_EVENTS[0];
    seated.ev = { seq: ev[1], t0: now };
    return A(ev[1][0][0], 'sit');
  }
  if (now >= seated.nextBlink) {
    if (now < seated.nextBlink + 150) return A('sit3', 'sit');
    seated.nextBlink = now + 2500 + Math.random() * 3500;
  }
  return A('sit2', 'sit');
}

function pickFrameBase(now) {
  if (emotion && now >= emotion.until) emotion = null;
  const base = baseState();
  const A = (frame, g, extra) => ({ frame, anim: true, cls: '', g, ...extra });
  if (!hasAnim()) {
    let st = emotion || base;
    if (isWalking && !emotion) st = { name: Math.floor(now / 380) % 2 ? 'smug' : 'idle', cls: 'walking' };
    return { frame: st.name, anim: false, cls: st.cls, pop: st.cls !== 'walking', g: st.cls === 'walking' ? 'walk' : 'emo:' + st.name };
  }
  const loop = (seq, ms, t0 = 0) => seq[Math.floor((now - t0) / ms) % seq.length];
  // Держат мышкой в воздухе: удивился → вырывается (пока его водят) → если держат неподвижно,
  // выдыхается и обижается; низко над землёй — тянется к ней. По земле — идёт следом
  if (drag && drag.moved) {
    if (drag.lifted) {
      const H = (f) => A(f, 'held', { cls: 'dangling' });
      // Трясут — болтается, ошарашенный; голова уже кружится — обмяк
      // (кадр — по направлению рывка: тянут влево — голову отбрасывает влево)
      if (drag.shaking) return A(drag.dir && drag.dir.s > 0 ? 'dizzy2' : 'dizzy1', 'held', { cls: 'shaken' });
      if (now < dizzyUntil) return H('dizzy3');
      if (now - drag.liftedAt < 380) return H('held1');
      if (drag.nearGround) return H('held8');
      const still = now - (drag.lastMove || drag.liftedAt);
      if (still > 2700) return H('held7');
      if (still > 1500) return H('held6');
      return H(loop(['held2', 'held4', 'held3', 'held5'], 150, drag.liftedAt));
    }
    return A(loop(SEQ.walk, 105), 'carried');
  }
  // Падает: испугался → машет руками → у самой земли группируется
  // (после первого касания земли отскоки идут уже с кадрами приземления — см. ACTS.landBig/landSmall)
  if (fly && !fly.landAct && !(fly.y >= fly.info.ground && fly.vy === 0)) {
    if (now - fly.t0 < 180) return A('fall1', 'fall');
    // ~0.12 с до земли (или ближе 40 px) — группируется
    if (fly.vy > 0 && fly.info.ground - fly.y < Math.max(40, fly.vy * 0.12)) return A('fall4', 'fall');
    return A(loop(['fall2', 'fall3'], 110, fly.t0), 'fall');
  }
  // Разовое действие
  if (act) {
    let t = now - act.t0;
    for (const [f, d] of act.seq) { if (t < d) return A(f, 'act'); t -= d; }
    act = null;
  }
  const talking = now < typingUntil;
  // Голова кружится: стоит, пошатываясь (звёздочки над головой — класс dizzy, см. render)
  // Шатается влево-вправо, иногда чуть не падает; под конец трясёт головой и приходит в себя
  if (now < dizzyUntil) {
    const left = dizzyUntil - now;
    if (left < 500) return A('dizzy8', 'dizzy');
    if (left < 950) return A('dizzy7', 'dizzy');
    return A(loop(['dizzy4', 'dizzy5', 'dizzy4', 'dizzy5', 'dizzy6'], 380), 'dizzy');
  }
  // Эмоция (с губами, если говорит спокойно)
  if (emotion) {
    if (emotion.name === 'think' && !talking) return A(loop(SEQ.think, 450), 'think');
    if (talking && TALK_OVER.has(emotion.name)) return A(loop(SEQ.talk, 110), 'talk');
    return { frame: emotion.name, anim: false, cls: emotion.cls, pop: true, g: 'emo:' + emotion.name };
  }
  // Ходьба: разворот в профиль → шаги → разворот обратно (сам разворот — часть группы «идёт»)
  if (isWalking) {
    if (!walkAnim || walkAnim.phase === 'out') walkAnim = { phase: 'in', t0: now };
    if (walkAnim.phase === 'in') {
      const i = Math.floor((now - walkAnim.t0) / 110);
      if (i < SEQ.turnIn.length) return A(SEQ.turnIn[i], 'walk');
      walkAnim = { phase: 'walk', t0: now };
    }
    return A(loop(SEQ.walk, 105, walkAnim.t0), 'walk');
  }
  if (walkAnim && walkAnim.phase !== 'out') walkAnim = { phase: 'out', t0: now };
  if (walkAnim && walkAnim.phase === 'out') {
    const i = Math.floor((now - walkAnim.t0) / 110);
    if (i < SEQ.turnOut.length) return A(SEQ.turnOut[i], 'walk');
    walkAnim = null;
  }
  if (thinking) return A(loop(SEQ.think, 450), 'think');
  if (talking) return A(loop(SEQ.talk, 110), 'talk');
  // Ждёт команду после имени: поза «слушаю» — наклон к человеку и покачивание (CSS), моргает как обычно
  if (listening()) {
    if (now >= nextBlink && now < nextBlink + 140) return { ...A('blink2', 'listen'), cls: 'listening' };
    if (now >= nextBlink + 140) nextBlink = now + 2500 + Math.random() * 3500;
    return { ...A('stand', 'listen'), cls: 'listening' };
  }
  // Сон: клюёт носом, потом спит и дышит (переходы внутри сна тоже плавные — см. render)
  if (base.name === 'sleep') {
    if (!sleepSince) sleepSince = now;
    const t = now - sleepSince;
    if (t < 1500) return A('doze1', 'sleep', { soft: true });
    if (t < 3000) return A('doze2', 'sleep', { soft: true });
    return A(Math.floor(t / 1400) % 2 ? 'sleep2' : 'sleep1', 'sleep', { soft: true });
  }
  sleepSince = 0;
  if (base.cls === 'dance') return A(loop(SEQ.dance, 320), 'dance');
  if (base.name !== 'idle') return { frame: base.name, anim: false, cls: base.cls, pop: true, g: 'emo:' + base.name };
  // Стоит: моргает раз в 2,5–6 с; иногда пьёт чай/кофе
  if (now >= nextSip && !seated && $('#bubble').classList.contains('hidden') && idleSec < 120) {
    nextSip = now + 90000 + Math.random() * 120000;
    playAct('sip');
    return pickFrame(now);
  }
  if (now >= nextBlink) {
    if (now < nextBlink + 140) return A('blink2', 'stand');
    nextBlink = now + 2500 + Math.random() * 3500;
  }
  return A('stand', 'stand');
}

const preloaded = {};
function preloadFrames() {
  if (!PERSONA || preloaded[PERSONA.dir]) return;
  preloaded[PERSONA.dir] = [...(PERSONA.anim || []).map((n) => `${PERSONA.dir}/anim/${n}.png`),
    ...['idle', 'joy', 'sad', 'angry', 'shock', 'shy', 'sleep', 'worry', 'smug', 'overload', 'think', 'idea', 'tip'].map((n) => `${PERSONA.dir}/${n}.png`)]
    .map((src) => { const im = new Image(); im.src = src; return im; });
}

function render() {
  if (!cfg) return;   // пока не знаем, кто из ассистентов, — ничего не рисуем
  checkShake(Date.now());
  const st = pickFrame(Date.now());
  renderGroup = st.g;
  const body = document.body;
  for (const c of ['dance', 'hop', 'shake', 'sleeping', 'walking', 'listening', 'dangling', 'falling', 'shaken']) body.classList.toggle(c, st.cls === c);
  // Звёздочки — пока кружится; когда уже трясёт головой и приходит в себя (последние ~0,95 с) — пропадают
  body.classList.toggle('dizzy', Date.now() < dizzyUntil - 950);
  body.classList.toggle('animated', hasAnim());
  body.classList.toggle('sitsleep', st.anim && st.frame === 'sit7');   // в этом кадре «Z» не нарисованы
  const key = (st.anim ? 'a:' : 'e:') + st.frame;
  if (key !== lastFrame) {
    const wasAnim = lastFrame.startsWith('a:');
    lastFrame = key;
    const img = $('#sprite');
    img.src = st.anim ? `${PERSONA.dir}/anim/${st.frame}.png` : `${PERSONA.dir}/${st.frame}.png`;
    // Подскок — только при появлении эмоции, не на каждом кадре анимации
    if (st.pop && !(!wasAnim && st.anim)) { const box = $('#spritebox'); box.classList.remove('pop'); void box.offsetWidth; box.classList.add('pop'); }
  }
}
// Кадры выбираются каждые 40 мс, когда он двигается (идёт, говорит, его тащат, падает…),
// и реже, когда спокоен: сидит/спит — 120 мс, стоит/танцует/эмоция — 80 мс. Плавные покачивания —
// это CSS, они от частоты не зависят; так окно ассистента почти не тратит процессор в покое.
let renderGroup = '';
function renderLoop() {
  try { render(); } catch (e) { console.warn('render', e); }
  const g = renderGroup || '';
  const calm = !drag && !fly;
  const ms = !calm ? 40 : (g === 'sit' || g === 'sleep') ? 120 : (g === 'stand' || g === 'dance' || g.startsWith('emo:')) ? 80 : 40;
  setTimeout(renderLoop, ms);
}
setTimeout(renderLoop, 40);   // не сразу: drag/fly объявлены ниже по файлу

// ---------- Прогулка по экрану ----------
// Идёт к случайной точке нижнего края, стоит там несколько секунд, снова идёт.
// Не ходит, пока открыта строка вопроса, пока его тащат, когда спит, танцует или реагирует на что-то.

const WALK_SPEED = 46;   // пикселей в секунду
let isWalking = false;
const walk = { state: 'pause', until: performance.now() + 3000, target: 0, x: null, dir: 1, min: 0, max: 0, last: 0, sent: null };
const walkMode = () => cfg && cfg.assistant.mode === 'walk';

async function syncWalkBounds() {
  if (!walkMode()) return;
  const b = await dock.assistWalkBounds();
  if (!b || !Number.isFinite(b.min) || !Number.isFinite(b.max)) return;
  walk.min = b.min; walk.max = b.max;
  if (Number.isFinite(b.x) && (walk.x === null || !isWalking)) walk.x = b.x;
}
setInterval(syncWalkBounds, 3000);

function setWalking(on) {
  if (on === isWalking) return;
  isWalking = on;
  render();
}

function walkFrame(now) {
  requestAnimationFrame(walkFrame);
  const dt = Math.max(0, Math.min(0.1, (now - walk.last) / 1000));
  walk.last = now;
  // Сбитое место или границы (NaN) — ждём свежих данных от главного процесса
  if (!Number.isFinite(walk.x) || !Number.isFinite(walk.target)) { walk.x = null; walk.state = 'pause'; walk.target = 0; }
  if (!walkMode() || walk.x === null || !(walk.max > walk.min)) { setWalking(false); return; }
  const base = baseState();
  // Не гуляет, пока его позвали и он ждёт команду или машет в ответ
  const busy = asking || drag || Date.now() < dizzyUntil || videoOn() || (emotion && Date.now() < emotion.until) || base.name === 'sleep' || base.cls === 'dance' || base.cls === 'shake' ||
    listening() || (act && act.seq === ACTS.called) || !!fly;
  if (busy) { setWalking(false); walk.state = 'pause'; walk.until = Math.max(walk.until, now + 2500); return; }

  if (walk.state === 'pause') {
    setWalking(false);
    if (now < walk.until) return;
    // Новая цель: не ближе 150 px, чтобы прогулка была заметной
    let target;
    do target = walk.min + Math.random() * (walk.max - walk.min);
    while (Math.abs(target - walk.x) < 150 && walk.max - walk.min > 320);
    walk.target = target;
    walk.dir = target > walk.x ? 1 : -1;
    document.body.classList.toggle('left', walk.dir < 0);
    walk.state = 'walk';
  }

  walk.x += walk.dir * WALK_SPEED * dt;
  if ((walk.dir > 0 && walk.x >= walk.target) || (walk.dir < 0 && walk.x <= walk.target)) {
    walk.x = walk.target;
    walk.state = 'pause';
    walk.until = now + 4000 + Math.random() * 12000;
    setWalking(false);
    // Иногда, дойдя, оглядывается и что-нибудь говорит
    if (talk() === 'chatty' && Math.random() < 0.25 && $('#bubble').classList.contains('hidden')) {
      react(pick(['think', 'smug']), pick(LINES.idle), { hold: 3000 });
    }
  } else {
    setWalking(true);
  }
  const rx = Math.round(walk.x) | 0;   // без -0
  if (rx !== walk.sent) { walk.sent = rx; dock.assistWalk(rx); }
}
requestAnimationFrame((t) => { walk.last = t; walkFrame(t); });

// ---------- Реакции на события ----------

let lastTrack = '';
dock.onMedia((m) => {
  media = m;
  const key = m && m.active ? `${m.artist}|${m.title}` : '';
  // Новый трек — иногда комментирует; про видео молчит (не мешает смотреть)
  if (key && key !== lastTrack && m.playing && m.kind !== 'video') {
    const chance = talk() === 'quiet' ? 0 : talk() === 'chatty' ? 0.8 : 0.4;
    if (lastTrack && Math.random() < chance) react('joy', fill(pick(LINES.musicStart), { artist: m.artist || 'это', title: m.title }));
  }
  if (key) lastTrack = key;
});

let lastSocial = null;
dock.onSocial((list) => {
  if (lastSocial) {
    for (const a of list) {
      const prev = lastSocial.find((x) => x.id === a.id);
      if (!prev || prev.count == null || a.count == null || a.count === prev.count) continue;
      const d = a.count - prev.count;
      const v = { n: Math.abs(d).toLocaleString('ru-RU'), net: SOCIAL[a.platform].name };
      if (d > 0) react('joy', fill(pick(LINES.followersUp), v));
      else if (talk() !== 'quiet') react('sad', fill(pick(LINES.followersDown), v));
    }
  }
  lastSocial = list;
  social = list;
});

let lastTodos = null;
dock.onTodos((list) => {
  if (lastTodos) {
    const added = list.filter((t) => !lastTodos.some((o) => o.text === t.text));
    const doneBefore = lastTodos.filter((t) => t.done).length, doneNow = list.filter((t) => t.done).length;
    if (added.length && !fromMe) react('tip', fill(pick(LINES.taskAdded), { t: added[0].text }));
    else if (doneNow > doneBefore) react('smug', pick(LINES.taskDone));
  }
  fromMe = false;
  lastTodos = list;
  todos = list;
});
let fromMe = false;

dock.onAssistEvent((ev) => {
  if (ev.type === 'reminder') {
    react('shock', '⏰ ' + ev.text, { hold: 2500, important: true, ms: 12000 });
    setTimeout(() => react('tip', null, { hold: 6000 }), 2500);
  } else if (ev.type === 'pomodoro') {
    const work = /перерыв \d/i.test(ev.text) || /Фокус окончен/i.test(ev.text);
    react('shock', null, { hold: 1500 });
    setTimeout(() => react('tip', pick(work ? LINES.pomodoroWork : LINES.pomodoroBreak), { hold: 5000, important: true }), 1500);
  }
});

// Пользователь отошёл — засыпает; вернулся — здоровается
let wasAsleep = false;
dock.onAssistIdle((s) => {
  const asleep = s > 300;
  if (wasAsleep && !asleep) {
    const h = new Date().getHours();
    if (h >= 5 && h < 11) { react('tip', pick(LINES.morning)); setTimeout(() => run('сводка', true), 4500); }
    else react('joy', pick(LINES.wake));
  }
  wasAsleep = asleep;
  idleSec = s;
});

// Нагрузка процессора
let overloadSaid = 0;
setInterval(async () => {
  const s = await dock.stats();
  cpu = s.cpu;
  if (cpu >= 92 && Date.now() - overloadSaid > 10 * 60e3 && talk() !== 'quiet') {
    overloadSaid = Date.now();
    say(pick(LINES.overload));
  }
}, 4000);

// Иногда просто говорит что-нибудь в характере
function scheduleQuip() {
  const t = talk();
  const min = t === 'chatty' ? 90 : 240, max = t === 'chatty' ? 180 : 420;
  setTimeout(() => {
    if (t !== 'quiet' && !asking && idleSec < 120 && $('#bubble').classList.contains('hidden')) {
      const h = new Date().getHours();
      react(pick(['smug', 'think', 'idle']), pick(h >= 23 || h < 5 ? LINES.night : LINES.idle), { hold: 3500 });
    }
    scheduleQuip();
  }, (min + Math.random() * (max - min)) * 1000);
}

// ---------- Мышь: клики насквозь, клик, «тык», перетаскивание ----------

// Где на окне Патрик и его облачко — главный процесс по этим прямоугольникам решает,
// ловить ли мышь (над ними) или пропускать клики насквозь (везде вокруг).
let lastHit = '';
function reportHit() {
  const rects = [];
  for (const sel of ['#char', '#bubble']) {
    const el = $(sel);
    if (el.classList.contains('hidden')) continue;
    const r = el.getBoundingClientRect();
    // Персонаж — узкий прямоугольник по центру кадра, без пустых краёв картинки
    // Над фигурой на холсте — пустой запас (pad): его не ловим
    if (sel === '#char') { const pad = (PERSONA.pad || 0) + 0.04; rects.push({ x: r.left + r.width * (1 - PERSONA.hitW) / 2, y: r.top + r.height * pad, w: r.width * PERSONA.hitW, h: r.height * (1 - pad) }); }
    else rects.push({ x: r.left, y: r.top, w: r.width, h: r.height });
  }
  // Держим мышь: открыт вопрос, тащат или летит (в полёте его можно поймать)
  const hold = asking || !!drag || !!fly;
  const key = JSON.stringify([rects.map((r) => [r.x, r.y, r.w, r.h].map(Math.round)), hold]);
  if (key !== lastHit) { lastHit = key; dock.assistHit(rects, hold); }
}
setInterval(reportHit, 250);

let pokes = [];
let drag = null;
let releasingDrag = null;
const ch = $('#char');

// ---------- Перетаскивание и подбрасывание ----------
// Схватили мышкой — окно едет за курсором в любую сторону (не ниже «земли», где он стоял).
// Отпустили — скорость курсора за последние ~0,1 с становится скоростью броска: летит по дуге,
// крутится, отскакивает от краёв экрана, падает, пару раз подпрыгивает и проскальзывает.
// Где остановился — там его новое место. В полёте его можно поймать снова.
// Без захвата мыши (setPointerCapture): захват, оставшийся без отпускания, уводил все нажатия
// в окно ассистента. Слушаем движение по всему окну — оно едет за курсором.
const G = 2600;            // ускорение падения, пикс/с²
let fly = null;            // полёт: { x, y, vx, vy, info, last, spin, bounces, peak }

// Панель движется или сменился DPI — полёт получает новую поверхность приземления.
dock.onAssistGround((bounds) => {
  const info = fly ? fly.info : drag && drag.info;
  if (!info || bounds.id !== info.id) return;
  Object.assign(info, bounds);
  if (fly) {
    const [x, y] = clampPos(fly.x, fly.y, info);
    if (fly.y > y) fly.vy = Math.min(0, fly.vy);
    fly.x = x; fly.y = y;
  }
});

async function beginDragFlight(d) {
  const info = await dock.assistFlyStart(d.grab);
  // Кнопку могли отпустить, пока главный процесс готовил границы.
  if (drag !== d) {
    if (info) dock.assistFlyEnd(info.id, info.x);
    return null;
  }
  d.info = info;
  return info;
}

const setSpin = (deg) => ch.style.setProperty('--spin', deg.toFixed(1) + 'deg');

ch.addEventListener('pointerdown', async (e) => {
  if (e.button !== 0) return;
  releasingDrag = null;
  const caught = !!fly;
  if (fly) { fly = null; setSpin(0); }        // поймали на лету
  const d = drag = { sx: e.screenX, sy: e.screenY, grab: { x: e.clientX, y: e.clientY }, moved: caught,
    hist: [{ t: performance.now(), x: e.screenX, y: e.screenY }], info: null };
  if (caught) await beginDragFlight(d);
  reportHit();
});

document.addEventListener('pointermove', async (e) => {
  if (!drag) return;
  const d = drag;
  if (!(e.buttons & 1)) { endDrag(e); return; }   // кнопку отпустили где-то вне окна
  const now = performance.now();
  drag.hist.push({ t: now, x: e.screenX, y: e.screenY });
  while (drag.hist.length > 2 && now - drag.hist[0].t > 120) drag.hist.shift();
  const dx = e.screenX - drag.sx, dy = e.screenY - drag.sy;
  if (!drag.moved && Math.hypot(dx, dy) > 5) {
    drag.moved = true;
    await beginDragFlight(d);
    if (drag !== d) return;
    if (!d.info) { d.moved = false; return; }
  }
  if (drag.moved && drag.info) await moveTo(drag.info);
});
document.addEventListener('pointerup', (e) => endDrag(e));
document.addEventListener('pointercancel', (e) => endDrag(e, true));

function clampPos(x, y, info) {
  return [Math.max(info.minX, Math.min(info.maxX, x)), Math.max(info.minY, Math.min(info.ground, y))];
}
async function moveTo(info) {
  const d = drag;
  if (!d) return;
  const seq = d.moveSeq = (d.moveSeq || 0) + 1;
  const p = await dock.assistHoldMove(info.id);
  if (!p || drag !== d || d.moveSeq !== seq) return;
  const cx = p.x, cy = p.y;
  // Держат в воздухе или тащат по земле — для анимации (см. pickFrame)
  if (drag) {
    const lifted = cy < info.ground - 3;
    if (lifted && !drag.liftedAt) drag.liftedAt = Date.now();
    if (!lifted) drag.liftedAt = 0;
    drag.lifted = lifted;
    drag.nearGround = lifted && cy > info.ground - 45;
    // Тело отстаёт от руки: наклон против движения, плавно
    const h = drag.hist, a = h[Math.max(0, h.length - 4)], b = h[h.length - 1];
    const vx = b.t > a.t ? (b.x - a.x) / ((b.t - a.t) / 1000) : 0;
    // Водят мышкой — вырывается; держат неподвижно — устаёт (см. pickFrame)
    const p = h[Math.max(0, h.length - 2)];
    if (Math.hypot(b.x - p.x, b.y - p.y) > 3) drag.lastMove = Date.now();
    trackShake(b, p, lifted);
    const target = Math.max(-22, Math.min(22, -vx * 0.02));
    drag.sway = (drag.sway || 0) * 0.7 + target * 0.3;
    setSpin(lifted ? drag.sway : 0);
  }
  return [cx, cy];
}

// ---------- Потрясли — кружится голова ----------
// Тряска — частая смена направления движения мышки (≥ 4 разворота за 0,9 с, на заметной скорости).
// Трясли дольше ~0,7 с — после тряски несколько секунд кружится голова (тем дольше, чем дольше трясли).
function trackShake(b, p, lifted) {
  const d = drag;
  if (!lifted) { d.shaking = false; return; }
  const dt = (b.t - p.t) / 1000;
  if (dt <= 0) return;
  const vx = (b.x - p.x) / dt, vy = (b.y - p.y) / dt;
  // Ось тряски — по которой быстрее; разворот — смена знака скорости
  const v = Math.abs(vx) >= Math.abs(vy) ? { ax: 'x', s: Math.sign(vx), sp: Math.abs(vx) } : { ax: 'y', s: Math.sign(vy), sp: Math.abs(vy) };
  if (v.sp < 350 || !v.s) return;
  const now = Date.now();
  d.flips = (d.flips || []).filter((t) => now - t < 900);
  if (d.dir && d.dir.ax === v.ax && d.dir.s !== v.s) d.flips.push(now);
  d.dir = v;
  if (d.flips.length >= 4) {
    if (!d.shaking) { d.shaking = true; d.shakeStart = now; }
    d.lastFlip = now;
  }
}
function checkShake(now) {
  const d = drag;
  if (!d || !d.shaking) return;
  if (now - d.lastFlip < 450) return;   // ещё трясут
  stopShake(d, now);
}
function stopShake(d, now) {
  d.shaking = false;
  const shook = (d.lastFlip || now) - d.shakeStart;
  if (shook < 700) return;
  const fresh = now >= dizzyUntil;
  dizzyUntil = now + Math.min(7000, 2500 + shook * 1.2);
  if (fresh) say(pick(LINES.dizzy), { important: true });
}

// gentle — небольшая дуга от рывка вбок: без «Ого!», вращение едва заметное
function startFlight(info, x, y, vx, vy, opts = {}) {
  const speed = Math.hypot(vx, vy);
  fly = { x, y, vx, vy, info, last: performance.now(), t0: Date.now(), spin: 0, bounces: 0, peak: opts.gentle ? 0 : speed, spinK: opts.gentle ? 0.08 : 0.45 };
  if (!opts.gentle && speed > 600) react('shock', pick(LINES.flyStart), { hold: 60000, important: true, ms: 2500 });
  else emotion = null;
  const f = fly;
  requestAnimationFrame((now) => flyStep(now, f));
}

// Кадры у прозрачного окна приходят не всегда 60 раз в секунду — считаем по настоящему времени,
// мелкими шагами (≤ 8 мс), чтобы полёт шёл с правильной скоростью при любой частоте кадров
function flyStep(now, f) {
  if (!f || fly !== f) return;
  // Отметка кадра бывает чуть раньше начала броска — время не может идти назад
  let left = Math.max(0, Math.min(0.1, (now - f.last) / 1000));
  f.last = Math.max(f.last, now);
  while (left > 0 && fly === f) {
    const dt = Math.min(0.008, left);
    left -= dt;
    if (physics(f, dt)) return land();
  }
  if (fly !== f) return;
  setSpin(f.spin);
  // Окно двигаем не чаще ~60 раз в секунду: у окна бывает и 300 кадров в секунду
  if (now - (f.sent || 0) >= 15) { f.sent = now; dock.assistFlyMove(f.info.id, f.x, f.y); }
  requestAnimationFrame((next) => flyStep(next, f));
}

// Один шаг физики; true — остановился (приземлился и замер)
function physics(f, dt) {
  const { info } = f;
  const onGround = f.y >= info.ground - 0.5 && f.vy >= 0;
  if (!onGround) {
    f.vy += G * dt;
    f.vx *= 1 - 0.25 * dt;                       // сопротивление воздуха
    f.spin += f.vx * dt * (f.spinK ?? 0.45);     // крутится (или чуть наклоняется) в сторону полёта
  } else {
    f.vx *= Math.max(0, 1 - 7 * dt);             // проскальзывает и тормозит
    f.spin *= Math.max(0, 1 - 14 * dt);          // выпрямляется
  }
  f.x += f.vx * dt;
  f.y += f.vy * dt;
  // Края экрана: отскок
  if (f.x < info.minX) { f.x = info.minX; f.vx = Math.abs(f.vx) * 0.55; }
  if (f.x > info.maxX) { f.x = info.maxX; f.vx = -Math.abs(f.vx) * 0.55; }
  if (f.y < info.minY) { f.y = info.minY; f.vy = Math.abs(f.vy) * 0.4; }
  // Земля: подпрыгивает, пока удар сильный, потом стоит. Касание — только когда летит вниз
  // (в начале броска он стоит ровно на земле, но летит вверх)
  if (f.y > info.ground || (f.y >= info.ground && f.vy >= 0)) {
    f.impact = Math.max(f.impact || 0, f.vy);   // сила удара о землю — для реакции после падения
    // Первое касание земли — анимация приземления (с высоты — плюхается и встаёт)
    // (голова кружится — плюхается и сидит со звёздочками даже с небольшой высоты)
    if (!f.landAct && f.vy > 0) {
      f.landAct = true;
      const dizzy = Date.now() < dizzyUntil;
      playAct(dizzy ? 'landDizzy' : f.vy > 1150 ? 'landBig' : 'landSmall');
      // …и, поднявшись, ещё пару секунд пошатывается
      if (dizzy) dizzyUntil = Math.max(dizzyUntil, Date.now() + 1970 + 3000);
    }
    f.y = info.ground;
    if (f.vy > 420) {
      f.vy = -f.vy * 0.38;
      f.vx *= 0.75;
      f.bounces++;
      // Удар о землю — сплющивается («пружинка»)
      const box = $('#spritebox');
      box.classList.remove('pop'); void box.offsetWidth; box.classList.add('pop');
    } else f.vy = 0;
  }
  return f.y >= info.ground && f.vy === 0 && Math.abs(f.vx) < 25 && Math.abs(f.spin) < 2;
}

function land() {
  const f = fly;
  fly = null;
  setSpin(0);
  dock.assistFlyEnd(f.info.id, f.x);
  // На прогулке продолжает идти с нового места
  walk.x = null;
  setTimeout(syncWalkBounds, 50);
  emotion = null;
  if (Date.now() < dizzyUntil) return;   // голова кружится — про падение уже не до слов
  // Уронили с высоты — комментирует (примерно с 250 px и выше)
  const hit = Math.max(f.peak, f.impact || 0);
  if (hit > 2400) react('angry', pick(LINES.thrownHard), { hold: 3000, important: true });
  else if (hit > 1150) react(pick(['worry', 'shock', 'smug']), pick(LINES.dropped), { hold: 2800, important: true });
}

async function endDrag(e, cancelled) {
  if (!drag) return;
  const d = drag;
  if (d.shaking) stopShake(d, Date.now());   // отпустили прямо во время тряски
  drag = null;
  reportHit();
  if (cancelled && !d.moved) return;
  if (d.moved) {
    if (!d.info) return;
    releasingDrag = d;
    const position = await dock.assistFlyRelease(d.info.id);
    if (!position) { if (releasingDrag === d) releasingDrag = null; return; }
    if (releasingDrag !== d || drag) { dock.assistFlyEnd(d.info.id, position.x); return; }
    releasingDrag = null;
    const { x, y } = position;
    Object.assign(d.info, position);
    // Скорость мышки за последние ~0,1 с. Резко дёрнули вбок — небольшая дуга в ту сторону,
    // иначе просто падает вниз
    const a = d.hist[0], b = d.hist[d.hist.length - 1];
    const span = Math.max(16, b.t - a.t) / 1000;
    const mvx = (b.x - a.x) / span, mvy = (b.y - a.y) / span;
    const flick = Math.abs(mvx) > 900 && Math.abs(mvx) > Math.abs(mvy) * 1.2;
    if (flick) {
      const vx = Math.sign(mvx) * Math.min(950, Math.abs(mvx) * 0.33);
      const vy = -Math.min(520, 220 + Math.abs(mvx) * 0.08);
      startFlight(d.info, x, y, vx, vy, { gentle: true });
      return;
    }
    setSpin(0);
    if (y >= d.info.ground - 1) {
      // Перенесли по земле — сразу новое место
      dock.assistFlyEnd(d.info.id, x);
      walk.x = null;
      setTimeout(syncWalkBounds, 50);
      return;
    }
    // Отпустили в воздухе — просто падает вниз
    startFlight(d.info, x, y, 0, 0);
    return;
  }
  // Клик: часто тыкают — злится; иначе смущается и открывает строку вопроса
  const now = Date.now();
  pokes = pokes.filter((t) => now - t < 2500).concat(now);
  if (pokes.length >= 4) { pokes = []; closeAsk(); react('angry', pick(LINES.angry), { hold: 3500 }); return; }
  if (!e.target.closest('#char')) return;   // отпустили не над Патриком — это не клик
  if (asking) { closeAsk(); return; }
  react('shy', null, { hold: 1500 });
  openAsk();
}
// Правый клик по ассистенту ничего не делает: меню — у кнопки ассистента на панели
ch.addEventListener('contextmenu', (e) => e.preventDefault());

// ---------- Строка вопроса ----------

let asking = false;
function openAsk() {
  asking = true;
  $('#bubble').classList.remove('hidden');
  $('#ask').classList.remove('hidden');
  if (!$('#btext').textContent) $('#btext').textContent = '';
  reportHit();
  dock.assistFocus();
  setTimeout(() => $('#q').focus(), 60);
}
function closeAsk() {
  asking = false;
  $('#ask').classList.add('hidden');
  $('#q').value = '';
  if (!$('#btext').textContent) $('#bubble').classList.add('hidden');
  reportHit();
  dock.assistUnfocus();
}
$('#ask').addEventListener('submit', async (e) => {
  e.preventDefault();
  const q = $('#q').value.trim();
  if (!q || thinking) return;
  $('#q').value = '';
  await refreshBrain();   // ключ могли только что ввести в настройках
  if (brainReady()) askBrain(q);
  else run(q);
});

// ---------- «Мозг» ----------
// Свободные вопросы — модели; без ключа или без интернета работают прежние команды (run).

let brainState = null;
let thinking = false;
async function refreshBrain() { try { brainState = await dock.brainStatus(); } catch { brainState = null; } }
const brainReady = () => !!(brainState && brainState.enabled && brainState.ready);

const BRAIN_ERRORS = {
  auth: 'Ключ API не подошёл. Проверь его в настройках ассистента.',
  billing: 'Закончились средства или бесплатный лимит на этом сервисе.',
  ollama: 'Ollama не отвечает. Запусти её (ollama.com) или выбери другую нейросеть в настройках.',
  model: 'Такой модели нет у сервиса. Выбери другую в настройках ассистента.',
  rate: 'Слишком много вопросов подряд. Дай мне минуту.',
  steps: 'Запутался в действиях. Попробуй сказать проще.',
};

// Команды с чёткой формой выполняем сразу, без нейросети: так быстрее и маленькая модель их не перепутает.
// Всё остальное (вопросы, «включи …» с поиском по библиотеке) — «мозгу»
const DIRECT = [
  /^(перемешай|включи перемешивание|включи шафл|выключи перемешивание|не перемешивай|по порядку|играй по порядку)/,
  /^(повторяй|поставь на повтор|включи повтор|выключи повтор|не повторяй|убери повтор)/,
  /^(лайкни|лайк|сохрани (эту )?(песню|трек))/,
  /^добавь\s+(эту песню|этот трек|.+?)\s+в\s+(?!задач|очередь)/,
  /^(добавь задачу|добавь в задачи|новая задача|запиши)[:\s]/,
  /^(громче|погромче|сделай громче|тише|потише|сделай тише|пауза|стоп|поставь на паузу|дальше|следующ|некст|переключи|назад|предыдущ)/,
  /^(выключи|убери)\s+звук|^без звука/,
  /^(включи|выключи|отключи)\s+(блютуз|bluetooth|вай[ -]?фай|wi[ -]?fi|wifi)/,
  /^(найди в интернете|поищи в интернете|загугли|погугли|найди в гугле)\s/,
  /^открой\s+(папку\s+)?(загрузки|документы|рабочий стол|изображения|картинки|фото|музыку|видео|корзину|этот компьютер|мой компьютер)$/,
  /^(помодоро|запусти помодоро|запусти фокус)/,
];
const isDirect = (q) => { const l = q.toLowerCase().trim().replace(/[!?.]+$/, ''); return DIRECT.some((re) => re.test(l)) && !/^добавь\s+.+\s+в\s+(задач|очередь)/.test(l); };

async function askBrain(q) {
  if (isDirect(q)) return run(q);
  thinking = true;
  $('#q').disabled = true;
  react('think', null, { hold: 90000 });
  // Пока модель думает — точки в облачке
  clearInterval(typeTimer); clearTimeout(hideTimer);
  $('#bubble').classList.remove('hidden');
  let dots = 0;
  typeTimer = setInterval(() => { dots = (dots + 1) % 4; $('#btext').textContent = '·'.repeat(dots + 1); }, 350);
  let r;
  try { r = await dock.brainAsk(q); } catch (e) { r = { error: 'api', detail: e.message }; }
  clearInterval(typeTimer);
  thinking = false;
  $('#q').disabled = false;
  if (asking) $('#q').focus();
  emotion = null;
  if (r.error === 'offline') return run(q);   // нет интернета — справимся сами, чем умеем
  if (r.error) return react('worry', BRAIN_ERRORS[r.error] || 'Не получилось ответить: ' + (r.detail || 'ошибка'), { hold: 4000, important: true, ms: 9000 });
  if (r.refusal) return react('worry', PERSONA.female ? 'Об этом я говорить не стану.' : 'Нет, об этом я, пожалуй, промолчу.', { hold: 3000, important: true });
  const text = r.text || '…';
  react(r.emotion || 'idle', text, { hold: 4000, important: true, ms: Math.min(25000, Math.max(5000, text.length * 70)) });
}
$('#q').addEventListener('keydown', (e) => { if (e.key === 'Escape') closeAsk(); });
document.querySelectorAll('.chips button').forEach((b) => b.addEventListener('click', () => run(b.dataset.q)));
dock.onAssistBlur(() => { if (asking) closeAsk(); });
// Команды из меню кнопки ассистента на панели; «?ask» — открыть строку вопроса
dock.onAssistCmd((c) => { if (c === '?ask') { if (!asking) openAsk(); return; } run(c, true); });

// ---------- Команды ----------

const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const DOW = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
const hhmm = (d) => d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

async function weatherLine() {
  try {
    const w = cfg.weather;
    const result = await dock.weather();
    if (!result.ok) return result.message;
    const d = result.data;
    const high = d.daily.temperature_2m_max[0];
    return `${w.city}: ${Math.round(d.current.temperature_2m)}°, ${weatherText(d.current.weather_code).toLowerCase()}${high == null ? '' : `, днём до ${Math.round(high)}°`}. Данные Яндекс Погоды`;
  } catch { return null; }
}

async function summary() {
  const now = new Date();
  const lines = [`Сегодня ${DOW[now.getDay()]}, ${now.getDate()} ${MONTHS[now.getMonth()]}.`];
  const w = await weatherLine();
  if (w) lines.push(w + '.');
  const left = todos.filter((t) => !t.done);
  lines.push(left.length ? `Задач: ${left.length}. Начни с «${left[0].text}».` : line('freeDay'));
  const rem = (cfg.assistant.reminders || []).filter((r) => new Date(r.at).toDateString() === now.toDateString());
  if (rem.length) lines.push(`Напоминаний сегодня: ${rem.length}, ближайшее в ${hhmm(new Date(rem[0].at))}.`);
  const sel = social.find((a) => a.selected) || social[0];
  if (sel && sel.count != null) lines.push(`${SOCIAL[sel.platform].name}: ${sel.count.toLocaleString('ru-RU')} подписчиков.`);
  if (media && media.active && media.playing) lines.push(`Играет «${media.title}».`);
  return lines.join('\n');
}

// «через 10 минут», «через 2 часа», «в 18:30» → время в мс
function parseWhen(l) {
  // [а-яё]* вместо \w*: в JavaScript \w не ловит русские буквы
  let m = l.match(/через\s+(\d+|полчаса|час|минуту)\s*(сек[а-яё]*|мин[а-яё]*|час[а-яё]*|ч|м)?/);
  if (m) {
    if (m[1] === 'полчаса') return { at: Date.now() + 30 * 60e3, rest: l.replace(m[0], '') };
    if (m[1] === 'час') return { at: Date.now() + 3600e3, rest: l.replace(m[0], '') };
    if (m[1] === 'минуту') return { at: Date.now() + 60e3, rest: l.replace(m[0], '') };
    const n = +m[1], u = m[2] || 'мин';
    const ms = /^сек/.test(u) ? 1e3 : /^(час|ч)/.test(u) ? 3600e3 : 60e3;
    return { at: Date.now() + n * ms, rest: l.replace(m[0], '') };
  }
  m = l.match(/в\s+(\d{1,2})[:.](\d{2})/);
  if (m) {
    const d = new Date();
    d.setHours(+m[1], +m[2], 0, 0);
    if (d.getTime() < Date.now()) d.setDate(d.getDate() + 1);
    return { at: d.getTime(), rest: l.replace(m[0], '') };
  }
  return null;
}

const CAN = () => brainReady()
  ? 'Спрашивай что угодно обычными словами. Могу открыть программу, сайт или папку, включить песню или видео, переключить музыку и громкость, Wi-Fi и Bluetooth, открыть нужные параметры Windows, добавить или закрыть задачу, поставить напоминание, рассказать погоду' +
    (brainState.providers[brainState.provider].search ? ' и поискать в интернете.' : '.')
  : 'Пока я умею:\n• «открой Telegram», «открой сайт ютуб», «открой загрузки»\n• «включи Linkin Park Numb» — найду на YouTube\n• «выключи блютуз», «найди в интернете …»\n• «напомни через 10 минут позвонить», «напомни в 18:30 …»\n• «добавь задачу …», «задачи», «погода», «сводка»\n• «громче», «тише», «пауза», «дальше», «помодоро»\n' + line('canTail');

async function run(text, silentEcho) {
  const l = text.toLowerCase().trim().replace(/[!?.]+$/, '');
  let m;
  react('think', null, { hold: 600 });

  const act = async (name, args, emo = 'tip') => { const r = await dock.assistAct(name, args); return react(r.ok ? emo : 'worry', r.text); };
  // Перемешивание и повтор
  if (/^(перемешай|включи перемешивание|включи шафл|в случайном порядке)/.test(l)) return act('playback_mode', { shuffle: 'on', repeat: 'keep' });
  if (/^(выключи перемешивание|не перемешивай|по порядку|играй по порядку)/.test(l)) return act('playback_mode', { shuffle: 'off', repeat: 'keep' });
  if (/^(повторяй|поставь на повтор|включи повтор)\s*(этот\s+|эту\s+)?(трек|песню)?$/.test(l) && /(трек|песн)/.test(l)) return act('playback_mode', { shuffle: 'keep', repeat: 'track' });
  if (/^(повторяй|поставь на повтор|включи повтор)/.test(l)) return act('playback_mode', { shuffle: 'keep', repeat: /(трек|песн)/.test(l) ? 'track' : 'context' });
  if (/^(выключи повтор|не повторяй|убери повтор)/.test(l)) return act('playback_mode', { shuffle: 'keep', repeat: 'off' });
  // Лайк и добавление в плейлист: «лайкни», «добавь эту песню в скачано», «добавь Numb в three eras of olya»
  if (/^(лайкни|лайк|сохрани (эту )?(песню|трек)|добавь (эту песню |этот трек )?в любимые)/.test(l)) return act('add_to_playlist', { playlist: 'Любимые треки', track: 'текущий' });
  if ((m = text.trim().match(/^добавь\s+(.+?)\s+в\s+(?:плейлист\s+)?(.+?)[.!?]*$/i)) && !/^(задач|очередь)/i.test(m[2]) && !/^(задач|в задачи|напомин)/i.test(m[1])) {
    const track = /^(эту|этот|текущ)/i.test(m[1]) ? 'текущий' : m[1];
    return act('add_to_playlist', { playlist: m[2], track });
  }
  // Wi-Fi / Bluetooth
  if ((m = l.match(/^(включи|выключи|отключи)\s+(блютуз|bluetooth|вай[ -]?фай|wi[ -]?fi|wifi)/))) {
    return act('toggle_radio', { device: /блю|blue/.test(m[2]) ? 'bluetooth' : 'wifi', state: m[1] === 'включи' ? 'on' : 'off' });
  }
  // «Найди в интернете …», «загугли …»
  if ((m = l.match(/^(?:найди в интернете|поищи в интернете|загугли|погугли|найди в гугле)\s+(.+)/))) {
    return act('search_in_browser', { query: m[1], engine: /гугл/.test(l) ? 'google' : 'yandex' });
  }
  // Папки
  if ((m = l.match(/^открой\s+(?:папку\s+)?(загрузки|документы|рабочий стол|изображения|картинки|фото|музыку|видео|корзину|этот компьютер|мой компьютер)$/))) {
    return act('open_folder', { folder: m[1].replace(/^музыку$/, 'музыка').replace(/^корзину$/, 'корзина') });
  }
  // Сайт: «открой сайт ютуб», «открой vk.com»
  if ((m = l.match(/^открой\s+(?:сайт\s+)?([\w-]+(?:\.[\w-]+)+\S*)$/)) || (m = l.match(/^открой\s+сайт\s+(.+)/))) {
    const s = m[1].trim();
    const known = { ютуб: 'youtube.com', youtube: 'youtube.com', вк: 'vk.com', вконтакте: 'vk.com', гугл: 'google.com', яндекс: 'ya.ru', почту: 'mail.google.com', гитхаб: 'github.com', github: 'github.com' };
    return act('open_website', { url: known[s] || (/\./.test(s) ? s : s + '.com') });
  }
  if ((m = l.match(/^(?:открой|запусти|включи)\s+(.+)/)) && !/^музык/.test(m[1])) {
    const name = await dock.assistOpen(m[1]);
    if (name) return react('tip', line('open', { name }));
    // «Включи …» — не программа, значит музыка (Spotify) или видео (YouTube)
    if (/^включи/.test(l)) {
      react('think', null, { hold: 4000 });
      const video = /(видео|клип|ролик|ютуб|youtube)/.test(l);
      const query = text.trim().replace(/^включи\s+(?:мне\s+)?(?:песню|трек|видео|клип|ролик|альбом|плейлист)?\s*/i, '').replace(/\s+(?:на|в)\s+(?:ютубе|youtube|спотифай|spotify)\s*$/i, '');
      const kind = /(любим|лайкнут)/.test(l) ? 'liked' : /альбом/.test(l) ? 'album' : /плейлист/.test(l) ? 'playlist' : /^включи\s+(?:что-нибудь|что-то)\s+(?:из|от)\s+/.test(l) ? 'artist' : 'track';
      return act('play_media', { query: query.replace(/^(?:что-нибудь|что-то)\s+(?:из|от)\s+/i, ''), service: video ? 'youtube' : 'spotify', kind }, 'joy');
    }
    return react('think', line('notFound', { q: m[1] }));
  }
  if (/^(?:громче|погромче|сделай громче)/.test(l)) { dock.assistKey('volup', 5); return react('smug', line('louder')); }
  if (/^(?:тише|потише|сделай тише)/.test(l)) { dock.assistKey('voldown', 5); return react('idle', line('quieter')); }
  if (/(?:выключи|убери)\s+звук|без звука/.test(l)) { dock.assistKey('mute'); return react('idle', line('mute')); }
  if (/^(?:пауза|стоп|останови|поставь на паузу)/.test(l)) { if (media && media.playing) dock.assistKey('playpause'); return react('idle', line('pause')); }
  if (/^(?:играй|продолжи|включи музыку|play)/.test(l)) { if (!(media && media.playing)) dock.assistKey('playpause'); return react('joy', line('play')); }
  if (/(?:дальше|следующ|некст|переключи)/.test(l)) { dock.assistKey('next'); return react('smug', line('next')); }
  if (/(?:назад|предыдущ)/.test(l)) { dock.assistKey('prev'); return react('idle', line('prev')); }

  if (/^напомни/.test(l)) {
    const w = parseWhen(l);
    if (!w) return react('think', line('remindWhen'));
    const what = w.rest.replace(/^напомни(?:\s+мне)?/, '').replace(/^\s*(?:что|чтобы|о том,? что|про)\s+/, '').trim() || 'Ты просил напомнить';
    const msg = what[0].toUpperCase() + what.slice(1);
    await dock.assistRemind(w.at, msg);
    return react('tip', line('remindOk', { time: hhmm(new Date(w.at)), msg }));
  }
  if (/^(?:мои\s+)?напоминания/.test(l)) {
    const r = cfg.assistant.reminders || [];
    return react('tip', r.length ? 'Напоминания:\n' + r.map((x) => `• ${hhmm(new Date(x.at))} — ${x.text}`).join('\n') : line('noReminders'));
  }

  if ((m = l.match(/^(?:добавь задачу|добавь в задачи|новая задача|задача|запиши)[:\s]+(.+)/))) {
    const t = text.trim().slice(text.trim().length - m[1].length);
    fromMe = true;
    dock.setTodos([...todos, { text: t, done: false }]);
    return react('tip', fill(pick(LINES.taskAdded), { t }));
  }
  if (/^(?:задачи|мои задачи|список дел|что у меня)/.test(l)) {
    const left = todos.filter((t) => !t.done);
    return react('tip', left.length ? 'Задачи:\n' + left.slice(0, 6).map((t) => '• ' + t.text).join('\n') + (left.length > 6 ? `\n…и ещё ${left.length - 6}` : '') : line('noTasks'));
  }

  if (/погод/.test(l)) {
    react('think', null, { hold: 1500 });
    const w = await weatherLine();
    return react('tip', w ? w + '.' : line('noWeather'));
  }
  if (/(?:сводка|что сегодня|план на день|доброе утро)/.test(l)) {
    react('think', null, { hold: 1500 });
    return react('idea', await summary(), { hold: 7000, important: !!silentEcho });
  }
  if (/(?:помодоро|фокус|таймер)/.test(l)) { dock.assistPomodoro(); return react('tip', line('pomodoro')); }

  if (/(?:привет|здравствуй|хай|добрый)/.test(l)) { playAct('wave'); return react('joy', pick(LINES.hello)); }
  if (/(?:спасибо|благодарю|спс)/.test(l)) return react('smug', pick(LINES.thanks));
  if (/(?:кто ты|ты кто|как тебя зовут)/.test(l)) return react('smug', pick(LINES.who));
  if (/(?:шутк|анекдот|пошути)/.test(l)) return react('smug', pick(LINES.jokes));
  if (/ча[йяю]|кофе/.test(l)) return react('smug', pick(LINES.tea));
  if (/(?:угадай|прочитай меня|что я думаю|что ты видишь)/.test(l)) {
    const busy = media && media.playing ? 'слушаешь музыку' : todos.some((t) => !t.done) ? 'откладываешь задачи' : 'отдыхаешь';
    return react('smug', fill(pick(LINES.read), { time: hhmm(new Date()), busy }));
  }
  if (/(?:что ты умеешь|помощь|команды|help)/.test(l)) return react('tip', CAN(), { hold: 6000 });
  return react('think', line('unknown') + '\n' + CAN(), { hold: 6000 });
}

// ---------- Настройки ----------

function applyCfg(c) {
  const modeChanged = !cfg || cfg.assistant.mode !== c.assistant.mode;
  const personaChanged = !!cfg && assistantOf(cfg) !== assistantOf(c);
  cfg = c;
  PERSONA = assistantOf(c);
  LINES = PERSONA === ASSISTANTS.teresa ? TERESA : PATRICK;
  document.title = PERSONA.name;
  $('#q').placeholder = `Спросите ${PERSONA.acc}…`;
  $('#sprite').alt = PERSONA.name;
  // --fh — рост фигуры на экране (размер из настроек), --h — высота всего холста с запасом сверху
  const fh = SIZES[c.assistant.size] || 120;
  const root = document.documentElement.style;
  root.setProperty('--ar', String(PERSONA.ratio));
  root.setProperty('--fh', fh + 'px');
  root.setProperty('--h', Math.round(fh * (PERSONA.grow || 1)) + 'px');
  root.setProperty('--pad', ((PERSONA.pad || 0) * 100).toFixed(2) + '%');
  preloadFrames();
  // Кадр — сразу из папки выбранного ассистента
  lastFrame = '';
  render();
  if (personaChanged) {
    emotion = null;
    act = null;
    reportHit();
    playAct('wave');
    react('joy', line('greet'), { hold: 2500 });
  }
  if (modeChanged) {
    walk.x = null;
    walk.state = 'pause';
    walk.until = performance.now() + 1500;
    if (c.assistant.mode !== 'walk') document.body.classList.remove('left');
    setTimeout(syncWalkBounds, 100);
  }
}
dock.onConfig(applyCfg);
dock.config().then((c) => {
  applyCfg(c);
  refreshBrain();
  setTimeout(() => { playAct('wave'); react('tip', line('greet'), { hold: 3000 }); }, 1500);
  scheduleQuip();
});
dock.todos().then((l) => { lastTodos = l; todos = l; });
dock.social().then((l) => { lastSocial = l; social = l; });
dock.media().then((m) => { media = m; if (m && m.active) lastTrack = `${m.artist}|${m.title}`; });
