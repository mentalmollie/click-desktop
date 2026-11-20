// Голос: ассистент слушает микрофон и откликается на своё имя («Патрик, открой Telegram»).
// Как устроено:
//  1. Микрофон → звук 16 кГц. Простой детектор речи сравнивает громкость с фоном и режет звук на фразы
//     (пауза ~0,8 с — конец фразы, не длиннее 12 с).
//  2. Фраза → распознавание в главном процессе (Groq Whisper или whisper.cpp на этом ПК).
//  3. Если в тексте есть имя — остальное выполняется как вопрос/команда (через «мозг» или прежние команды).
//     Одно имя без команды — «Да?», и следующая фраза в течение 8 секунд считается командой без имени.
// Пока ассистент выполняет команду или думает, следующую фразу не обрабатываем.
// Работает в окне ассистента рядом с assistant.js и пользуется его функциями (react, say, askBrain, run).

const VOICE_SR = 16000;
const FRAME = 2048;                 // 128 мс
const END_SILENCE = 6;              // кадров тишины до конца фразы (~0,8 с)
const MAX_FRAMES = Math.round(12 * VOICE_SR / FRAME);
const MIN_VOICED = 3;               // короче ~0,4 с — шум, не фраза
const PREROLL = 3;                  // захватываем немного звука до начала речи
const FOLLOW_MS = 8000;
// Пока играет музыка: порог — выше её средней громкости, а длинные сплошные куски (> ~5 с без пауз)
// считаем музыкой и не распознаём — иначе Whisper без остановки разбирает песни и грузит процессор
const MUSIC_K = 1.8;
const MUSIC_MAX_FRAMES = Math.round(5 * VOICE_SR / FRAME);
const musicOn = () => !!(typeof media !== 'undefined' && media && media.active && media.playing);
let ambient = 0.004;                // средняя громкость всего подряд (с музыкой), медленно

// Только обращение (именительный падеж): «Терезе бы понравилось» — не зовут, а упоминают
const NAMES = {
  patrick: /^(патрик|патрек|петрик|patrick|patric)$/,
  teresa: /^(тереза|тереса|терез|тереза?чка|teresa|theresa)$/,
};
// Распознаватель иногда слышит имя чуть иначе («Терезо», «Дереза», «Патрег») — прощаем 1–2 буквы
const BASE_NAME = { patrick: 'патрик', teresa: 'тереза' };
function lev(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  }
  return d[a.length][b.length];
}
// Не «Терезе»/«Терезу»/«Патрика» — так говорят о нём, а не зовут
// и первая буква та же (или глухая/звонкая пара: Дереза, Батрик) — иначе «береза» тоже стала бы Терезой
const FIRST = { patrick: /^[пб]/, teresa: /^[тд]/ };
const isName = (w) => NAMES[personaId()].test(w) ||
  (w.length >= 5 && w.length <= 8 && FIRST[personaId()].test(w) && lev(w, BASE_NAME[personaId()]) <= 2 &&
   !/^(терезе|терезу|терезой|терезы|патрика|патрику|патриком|патрике)$/.test(w));
// Обращаются в начале («Тереза, открой…», «Эй, Тереза…») или в конце фразы («…открой Telegram, Тереза»)
// Лёгкая модель (tiny) часто рвёт имя на два слова: «Ты реза», «Па трик». Если два соседних слова
// в начале (или после «эй») или в конце фразы вместе похожи на имя — склеиваем их
function mergeName(words) {
  if (words.length < 2) return words;
  for (const i of [0, 1, words.length - 2]) {
    if (i < 0 || i + 1 >= words.length || isName(words[i]) || isName(words[i + 1])) continue;
    if (isName(words[i] + words[i + 1])) return [...words.slice(0, i), words[i] + words[i + 1], ...words.slice(i + 2)];
  }
  return words;
}
function findName(words) {
  const at = [0, 1, words.length - 1];
  for (const i of at) if (i >= 0 && i < words.length && isName(words[i]) && (i !== 1 || /^(а|эй|слушай|алло|ну)$/.test(words[0]))) return i;
  return -1;
}
const HEARD = {
  patrick: ['Да?', 'Слушаю.', 'Я весь внимание.', 'М?'],
  teresa: ['Да?', 'Слушаю.', 'Говори.', 'Я здесь.'],
};

let mic = null;                     // { stream, ctx, node }
let voiceWanted = false;
let noise = 0.004;                  // уровень фона (RMS), подстраивается сам
let seg = null;                     // { frames: [], voiced, silence }
let pre = [];
let transcribing = false;
let followUntil = 0;
let voiceErrorSaid = 0;
let sent = [];                      // время отправок — чтобы шум за окном не съел бесплатный лимит
// Последние фразы — для отладки (что услышал, что распознал, что сделал); в окне, никуда не отправляется
const voiceLog = [];
const vlog = (o) => { voiceLog.push({ t: new Date().toLocaleTimeString('ru-RU'), ...o }); if (voiceLog.length > 30) voiceLog.shift(); };
let peak = 0;                       // самый громкий кадр с прошлого опроса — для отладки уровня

const personaId = () => (cfg && cfg.assistant.persona) || 'patrick';
const voiceCfg = () => (cfg && cfg.assistant.voice) || {};

// Точка над головой видна, только когда ассистента позвали: ждёт команду после имени (mic-wait)
// или коротко — когда услышал имя сразу с командой (mic-called). Остальное время её нет
let calledUntil = 0;
function setMicClass() {
  document.body.classList.toggle('mic-on', !!mic);
  document.body.classList.toggle('mic-hear', !!(mic && seg));
  document.body.classList.toggle('mic-wait', !!(mic && Date.now() < followUntil));
  document.body.classList.toggle('mic-called', !!(mic && Date.now() < calledUntil));
}

async function startMic() {
  if (mic) return true;
  try {
    // В настройках микрофон выбран по названию; id ищем здесь (у каждого окна он свой)
    const dev = voiceCfg().device || '';
    const base = { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true };
    let stream = await navigator.mediaDevices.getUserMedia({ audio: base });
    if (dev && stream.getAudioTracks()[0].label !== dev) {
      const found = (await navigator.mediaDevices.enumerateDevices()).find((d) => d.kind === 'audioinput' && d.label === dev);
      if (found) {
        stream.getTracks().forEach((t) => t.stop());
        stream = await navigator.mediaDevices.getUserMedia({ audio: { ...base, deviceId: { exact: found.deviceId } } });
      }
    }
    const ctx = new AudioContext({ sampleRate: VOICE_SR });
    const src = ctx.createMediaStreamSource(stream);
    const node = ctx.createScriptProcessor(FRAME, 1, 1);
    node.onaudioprocess = (e) => onFrame(new Float32Array(e.inputBuffer.getChannelData(0)));
    src.connect(node);
    node.connect(ctx.destination);   // выход пустой — без подключения обработчик не вызывается
    await ctx.resume();
    mic = { stream, ctx, node, src, dev };
    setMicClass();
    return true;
  } catch (e) {
    console.warn('mic', e);
    if (Date.now() - voiceErrorSaid > 10 * 60e3) {
      voiceErrorSaid = Date.now();
      react('worry', 'Не могу включить микрофон. Проверь, что он подключён и Windows разрешает к нему доступ.', { important: true, hold: 4000 });
    }
    return false;
  }
}

function stopMic() {
  if (!mic) return;
  try { mic.node.disconnect(); mic.src.disconnect(); } catch {}
  mic.stream.getTracks().forEach((t) => t.stop());
  mic.ctx.close().catch(() => {});
  mic = null;
  seg = null;
  pre = [];
  setMicClass();
}

// Сейчас не слушаем: выполняет команду, думает или распознаёт прошлую фразу.
const deaf = () => transcribing || voiceCommandBusy || thinking;

function onFrame(f) {
  let sum = 0;
  for (let i = 0; i < f.length; i++) sum += f[i] * f[i];
  const rms = Math.sqrt(sum / f.length);
  const sens = Math.max(0, Math.min(1, voiceCfg().sensitivity ?? 0.5));
  ambient = ambient * 0.99 + rms * 0.01;   // ~13 с
  const music = musicOn();
  let thr = Math.max(0.006, noise * (2 + 4 * (1 - sens)));
  if (music) thr = Math.max(thr, ambient * MUSIC_K);
  if (rms > peak) peak = rms;

  if (deaf()) { if (seg) { seg = null; setMicClass(); } pre = []; return; }

  if (!seg) {
    // Фон подстраиваем только в тишине
    if (rms < thr) noise = noise * 0.97 + rms * 0.03;
    pre.push(f);
    if (pre.length > PREROLL) pre.shift();
    if (rms > thr) { seg = { frames: [...pre], voiced: 1, silence: 0 }; pre = []; setMicClass(); }
    return;
  }
  seg.frames.push(f);
  if (rms > thr) { seg.voiced++; seg.silence = 0; } else seg.silence++;
  // Под музыку: долго без пауз — это песня, а не обращение. Выбрасываем, не распознавая
  if (music && seg.frames.length >= MUSIC_MAX_FRAMES && seg.voiced / seg.frames.length > 0.75) {
    vlog({ skip: 'музыка', sec: +(seg.frames.length * FRAME / VOICE_SR).toFixed(1) });
    seg = null;
    setMicClass();
    return;
  }
  if (seg.silence >= END_SILENCE || seg.frames.length >= MAX_FRAMES) {
    const s = seg;
    seg = null;
    setMicClass();
    if (s.voiced < MIN_VOICED) { vlog({ skip: 'короткий звук', frames: s.frames.length, voiced: s.voiced }); return; }
    const frames = s.frames.slice(0, s.frames.length - Math.max(0, s.silence - 2));
    // Ждём команду после имени — отдаём всё; иначе сначала проверяем, похоже ли это на голос
    const sp = Date.now() < followUntil ? null : speechLike(frames, thr);
    if (sp && !sp.ok) { vlog({ skip: 'не похоже на речь', ...sp }); return; }
    if (sp) vlog({ pass: 'похоже на речь', zOk: sp.zOk, cv: sp.cv, peak: sp.peak });
    phrase(frames);
  }
}

// Похоже ли на речь — дёшево, до распознавания (Whisper — самое дорогое, что делает программа):
//  · частота переходов через ноль (ZCR) у голоса умеренная; у шипения, шороха, клавиатуры — высокая,
//    у гула и низкого стука — почти нулевая;
//  · громкость речи «пульсирует» слогами; ровный шум (вентилятор, пылесос, вода) — почти нет.
// Пороги мягкие: лучше лишний раз распознать шум, чем пропустить обращение.
function speechLike(frames, thr) {
  const rms = [], zcr = [];
  for (const f of frames) {
    let s = 0, z = 0;
    for (let i = 0; i < f.length; i++) { s += f[i] * f[i]; if (i && (f[i] >= 0) !== (f[i - 1] >= 0)) z++; }
    rms.push(Math.sqrt(s / f.length));
    zcr.push(z / f.length);
  }
  const loud = rms.map((r, i) => (r > thr ? i : -1)).filter((i) => i >= 0);
  if (!loud.length) return { ok: false, why: 'тихо' };
  const zOk = loud.filter((i) => zcr[i] > 0.012 && zcr[i] < 0.32).length / loud.length;
  const mean = rms.reduce((a, b) => a + b, 0) / rms.length;
  const cv = Math.sqrt(rms.reduce((a, r) => a + (r - mean) ** 2, 0) / rms.length) / (mean || 1);
  // (на проверке: речь — cv 0,7–1,1, ровный гул — до ~0,3)
  const ok = zOk >= 0.45 && cv >= 0.35;
  return { ok, zOk: +zOk.toFixed(2), cv: +cv.toFixed(2), peak: +Math.max(...rms).toFixed(3), loud: loud.length };
}

function toWav(frames) {
  const n = frames.reduce((a, f) => a + f.length, 0);
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, VOICE_SR, true); v.setUint32(28, VOICE_SR * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, n * 2, true);
  let o = 44;
  for (const f of frames) for (let i = 0; i < f.length; i++, o += 2) v.setInt16(o, Math.max(-1, Math.min(1, f[i])) * 0x7fff, true);
  return buf;
}

const VOICE_ERRORS = {
  nokey: 'Чтобы я слышал, сохрани ключ Groq в настройках ассистента (раздел «Голос»).',
  auth: 'Ключ Groq не подошёл — не могу разобрать речь.',
  rate: 'Groq просит передышку: слишком много фраз подряд.',
  nomodel: 'Локальный распознаватель не скачан. Скачай его в настройках ассистента.',
  nobin: 'Локальный распознаватель не установлен. Скачай его в настройках ассистента.',
};

async function phrase(frames) {
  const now = Date.now();
  // Не больше 15 фраз в минуту в облако: дальше ждём (речь вокруг, телевизор)
  if (voiceCfg().engine !== 'local') {
    sent = sent.filter((t) => now - t < 60e3);
    if (sent.length >= 15) { vlog({ skip: 'лимит 15 фраз в минуту' }); return; }
    sent.push(now);
  }
  transcribing = true;
  let r;
  const t0 = Date.now();
  try { r = await dock.voiceTranscribe(toWav(frames)); } catch (e) { r = { error: 'api', detail: e.message }; }
  transcribing = false;
  vlog({ sec: +(frames.length * FRAME / VOICE_SR).toFixed(1), ms: Date.now() - t0, ...(r.error ? { error: r.error, detail: r.detail } : { text: r.text }) });
  if (r.error) {
    if (r.error !== 'offline' && Date.now() - voiceErrorSaid > 10 * 60e3) {
      voiceErrorSaid = Date.now();
      react('worry', VOICE_ERRORS[r.error] || 'Не получается разобрать речь: ' + (r.detail || r.error), { important: true, hold: 4000 });
    }
    return;
  }
  heard(r.text || '');
}

function heard(text) {
  const norm = text.toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9\s]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!norm) return;
  const words = mergeName(norm.split(' '));
  const at = findName(words);
  if (at >= 0) {
    // Команда — всё, кроме обращения: «Патрик, открой телеграм» и «открой телеграм, Патрик»
    const rest = at === words.length - 1 && at > 1 ? words.slice(0, at) : words.slice(at + 1);
    const cmd = rest.join(' ').trim();
    if (cmd.replace(/\s/g, '').length < 3) {
      followUntil = Date.now() + FOLLOW_MS;
      setMicClass();
      setTimeout(setMicClass, FOLLOW_MS + 50);
      // Отклик: машет «я здесь», говорит «Да?» и встаёт в позу «слушаю» (см. onCalled и pickFrame)
      onCalled(true);
      say(pick(HEARD[personaId()]), { important: true, ms: 3000 });
      return;
    }
    followUntil = 0;
    calledUntil = Date.now() + 1500;
    setMicClass();
    setTimeout(setMicClass, 1550);
    onCalled(false);
    return voiceCommand(cleanCase(text, words[at], at === words.length - 1 && at > 1));
  }
  if (Date.now() < followUntil) {
    followUntil = 0;
    setMicClass();
    voiceCommand(text.trim());
  }
}

// Убираем обращение из исходной фразы, сохраняя регистр («открой Telegram»)
function cleanCase(text, name, atEnd) {
  const n = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const t = text.replace(/ё/g, 'е').trim();
  const re = atEnd
    ? new RegExp('[\\s,—-]*' + n + '[\\s,.!?]*$', 'i')
    : new RegExp('^\\s*((а|эй|слушай|алло|ну)[\\s,]+)?' + n + '[\\s,.!?—-]*', 'i');
  return t.replace(re, '').replace(/^[\s,.!?—-]+|[\s,—-]+$/g, '').trim() || t;
}

async function voiceCommand(cmd) {
  if (thinking || voiceCommandBusy) return;
  vlog({ command: cmd });
  voiceCommandBusy = true;
  try {
    await refreshBrain();
    if (brainReady()) await askBrain(cmd);
    else await run(cmd);
  } catch { react('worry', 'Не удалось выполнить команду. Попробуй ещё раз.', { important: true }); }
  finally { voiceCommandBusy = false; }
}

async function applyVoice() {
  const want = !!(cfg && cfg.assistant.enabled && voiceCfg().enabled);
  // Сменили микрофон в настройках — переоткрываем
  if (want && mic && mic.dev !== (voiceCfg().device || '')) stopMic();
  if (want === voiceWanted && (!want || mic)) return;
  voiceWanted = want;
  if (want) await startMic();
  else stopMic();
}
dock.onConfig(() => setTimeout(applyVoice, 0));
setTimeout(applyVoice, 1500);
