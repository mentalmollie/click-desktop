// Распознавание речи для ассистента: фраза (WAV 16 кГц моно) → текст.
// Два движка:
//   groq  — Whisper в облаке Groq (бесплатно по ключу Groq, тот же ключ, что у «мозга»);
//   local — whisper.cpp на этом ПК (скачивается из настроек: программа ~9 МБ + модель 150–490 МБ).
// Локальный движок держим запущенным как whisper-server (модель грузится один раз),
// если в сборке его нет — запускаем whisper-cli на каждую фразу.
const fs = require('fs');
const path = require('path');
const os = require('os');
const net = require('net');
const { spawn, execFile } = require('child_process');

const DIR = require('./paths').dataPath('whisper');   // распознаватель и модели — в папке данных
const MODELS = {
  tiny: { file: 'ggml-tiny.bin', size: '75 МБ', note: 'самый лёгкий' },
  base: { file: 'ggml-base.bin', size: '148 МБ', note: 'быстрее' },
  small: { file: 'ggml-small.bin', size: '488 МБ', note: 'точнее' },
};
const MODEL_URL = (f) => `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${f}`;
const RELEASES = 'https://api.github.com/repos/ggml-org/whisper.cpp/releases?per_page=15';
const ASSET = 'whisper-bin-x64.zip';
// Подсказка распознавателю: имя выбранного ассистента пишется так, а не «Терезо» и «Патрег»
const PROMPTS = {
  patrick: 'Патрик, открой Telegram. Патрик, включи музыку. Напомни через 10 минут.',
  teresa: 'Тереза, открой Telegram. Тереза, включи музыку. Напомни через 10 минут.',
};

function findExe(name, dir = DIR) {
  if (!fs.existsSync(dir)) return null;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { const r = findExe(name, p); if (r) return r; }
    else if (e.name.toLowerCase() === name) return p;
  }
  return null;
}

function createVoice({ groqKey, config }) {
  let server = null, serverPort = 0, serverModel = '', starting = null;
  let installing = null;   // { stage, pct } пока идёт установка

  const engine = () => (config().assistant.voice || {}).engine || 'groq';
  const prompt = () => PROMPTS[config().assistant.persona] || PROMPTS.patrick;
  const localModel = () => (MODELS[(config().assistant.voice || {}).model] ? config().assistant.voice.model : 'small');
  const modelPath = (m = localModel()) => path.join(DIR, 'models', MODELS[m].file);

  function status() {
    const installed = Object.fromEntries(Object.keys(MODELS).map((m) => [m, fs.existsSync(modelPath(m))]));
    return {
      engine: engine(),
      groqKey: !!groqKey(),
      localBin: !!(findExe('whisper-server.exe') || findExe('whisper-cli.exe') || findExe('main.exe')),
      localModels: installed,
      model: localModel(),
      models: MODELS,
      installing,
    };
  }

  // ---------- Groq ----------
  async function groq(wav) {
    const key = groqKey();
    if (!key) return { error: 'nokey' };
    const fd = new FormData();
    fd.append('file', new Blob([wav], { type: 'audio/wav' }), 'speech.wav');
    fd.append('model', 'whisper-large-v3-turbo');
    fd.append('language', 'ru');
    fd.append('prompt', prompt());
    fd.append('response_format', 'json');
    fd.append('temperature', '0');
    try {
      const r = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
        method: 'POST', headers: { Authorization: 'Bearer ' + key }, body: fd, signal: AbortSignal.timeout(20_000),
      });
      const data = await r.json().catch(() => ({}));
      const why = `${r.status}: ${data.error?.message || ''}`.slice(0, 200);
      if (r.status === 401) return { error: 'auth', detail: why };
      if (r.status === 429) return { error: 'rate', detail: why };
      if (!r.ok) return { error: 'api', detail: `${r.status}: ${data.error?.message || ''}`.slice(0, 160) };
      return { text: String(data.text || '').trim() };
    } catch (e) {
      return { error: e.name === 'TimeoutError' ? 'api' : 'offline', detail: e.message };
    }
  }

  // ---------- whisper.cpp ----------
  const freePort = () => new Promise((res) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });

  async function ensureServer() {
    const exe = findExe('whisper-server.exe');
    if (!exe) return false;
    const m = localModel();
    if (server && serverModel === m) return true;
    if (starting) return starting;
    stopServer();
    starting = (async () => {
      serverPort = await freePort();
      serverModel = m;
      const threads = String(Math.max(2, Math.min(8, os.cpus().length - 2)));
      server = spawn(exe, ['-m', modelPath(m), '-l', 'ru', '--host', '127.0.0.1', '--port', String(serverPort), '-t', threads, '--prompt', prompt()],
        { cwd: path.dirname(exe), windowsHide: true, stdio: 'ignore' });
      server.on('exit', () => { server = null; });
      // Ждём, пока поднимется (модель грузится 1–5 с)
      for (let i = 0; i < 60; i++) {
        await new Promise((r) => setTimeout(r, 250));
        if (!server) break;
        try { const r = await fetch(`http://127.0.0.1:${serverPort}/`, { signal: AbortSignal.timeout(500) }); if (r.status < 500) return true; } catch {}
      }
      stopServer();
      return false;
    })();
    try { return await starting; } finally { starting = null; }
  }
  function stopServer() { if (server) { try { server.kill(); } catch {} server = null; } }

  // Сервер с моделью держит ~650 МБ памяти. Запускаем его на первую фразу и выгружаем после
  // 3 минут без распознаваний; следующая фраза после паузы распознаётся на ~0,5 с дольше.
  const IDLE_UNLOAD = 3 * 60e3;
  let idleTimer = null;
  function touchServer() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(stopServer, IDLE_UNLOAD);
  }

  async function local(wav) {
    if (!fs.existsSync(modelPath())) return { error: 'nomodel' };
    touchServer();
    if (await ensureServer()) {
      try {
        const fd = new FormData();
        fd.append('file', new Blob([wav], { type: 'audio/wav' }), 'speech.wav');
        fd.append('response_format', 'json');
        fd.append('temperature', '0');
        const r = await fetch(`http://127.0.0.1:${serverPort}/inference`, { method: 'POST', body: fd, signal: AbortSignal.timeout(60_000) });
        const data = await r.json();
        touchServer();   // считаем от конца распознавания
        return { text: String(data.text || '').replace(/\[[^\]]*\]/g, '').trim() };
      } catch (e) { return { error: 'local', detail: e.message }; }
    }
    // Запасной путь: whisper-cli на каждую фразу
    const cli = findExe('whisper-cli.exe') || findExe('main.exe');
    if (!cli) return { error: 'nobin' };
    const tmp = path.join(os.tmpdir(), `glassdock-voice-${Date.now()}.wav`);
    fs.writeFileSync(tmp, Buffer.from(wav));
    try {
      const out = await new Promise((res, rej) => execFile(cli, ['-m', modelPath(), '-l', 'ru', '-nt', '-np', '--prompt', prompt(), '-f', tmp],
        { cwd: path.dirname(cli), windowsHide: true, timeout: 60_000, encoding: 'utf8', maxBuffer: 1 << 20 }, (e, so) => (e ? rej(e) : res(so))));
      return { text: out.replace(/\[[^\]]*\]/g, '').replace(/\s+/g, ' ').trim() };
    } catch (e) { return { error: 'local', detail: e.message }; }
    finally { fs.unlink(tmp, () => {}); }
  }

  async function transcribe(wav) {
    return engine() === 'local' ? local(wav) : groq(wav);
  }

  // ---------- Установка локального движка (по кнопке в настройках) ----------
  async function download(url, dest, stage, onProgress) {
    const r = await fetch(url, { headers: { 'User-Agent': 'Click' } });
    if (!r.ok || !r.body) throw new Error(`${stage}: HTTP ${r.status}`);
    const total = +r.headers.get('content-length') || 0;
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const tmp = dest + '.part';
    const f = fs.createWriteStream(tmp);
    let got = 0;
    const reader = r.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      got += value.length;
      if (!f.write(Buffer.from(value))) await new Promise((res) => f.once('drain', res));
      installing = { stage, pct: total ? Math.round((got / total) * 100) : 0 };
      onProgress(status());
    }
    await new Promise((res, rej) => f.end((e) => (e ? rej(e) : res())));
    fs.renameSync(tmp, dest);
  }

  async function install(model, onProgress) {
    if (installing) return { error: 'busy' };
    if (!MODELS[model]) model = 'small';
    installing = { stage: 'program', pct: 0 };
    onProgress(status());
    try {
      if (!status().localBin) {
        // Готовые сборки лежат в релизах вида bNNNN — берём свежий, где есть whisper-bin-x64.zip
        const rels = await (await fetch(RELEASES, { headers: { 'User-Agent': 'GlassDock', Accept: 'application/vnd.github+json' } })).json();
        const asset = (Array.isArray(rels) ? rels : []).flatMap((r) => r.assets || []).find((a) => a.name === ASSET);
        if (!asset) throw new Error('не нашёл сборку whisper.cpp для Windows');
        const zip = path.join(DIR, ASSET);
        await download(asset.browser_download_url, zip, 'program', onProgress);
        const bin = path.join(DIR, 'bin');
        await new Promise((res, rej) => execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
          `Expand-Archive -LiteralPath '${zip.replace(/'/g, "''")}' -DestinationPath '${bin.replace(/'/g, "''")}' -Force`],
        { windowsHide: true, timeout: 120_000 }, (e) => (e ? rej(e) : res())));
        fs.unlink(zip, () => {});
        if (!status().localBin) throw new Error('в архиве нет whisper-server.exe / whisper-cli.exe');
      }
      if (!fs.existsSync(modelPath(model))) {
        installing = { stage: 'model', pct: 0 };
        await download(MODEL_URL(MODELS[model].file), modelPath(model), 'model', onProgress);
      }
      installing = null;
      stopServer();
      onProgress(status());
      return { ok: true };
    } catch (e) {
      installing = null;
      onProgress(status());
      return { error: 'install', detail: e.message };
    }
  }

  function remove() {
    stopServer();
    try { fs.rmSync(DIR, { recursive: true, force: true }); } catch {}
    return status();
  }

  return { transcribe, status, install, remove, stop: stopServer };
}

module.exports = { createVoice };
