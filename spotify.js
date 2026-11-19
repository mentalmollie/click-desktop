// Spotify: ассистент находит песню, исполнителя, альбом или плейлист и включает в Spotify пользователя.
// Основной путь — spotify_cli.exe, официальная утилита из папки Spotify: ищет и включает прямо в приложении
// на этом ПК, без входа и сети в обход. Запасной путь (старый Spotify без утилиты) — Web API:
// вход по схеме PKCE (нужен только Client ID «приложения» пользователя), токены — зашифрованно в spotify.key.
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { safeStorage, shell } = require('electron');

const CLI = path.join(process.env.APPDATA || '', 'Spotify', 'spotify_cli.exe');
const hasCli = () => fs.existsSync(CLI);
function cli(args, timeout = 15000) {
  return new Promise((res) => execFile(CLI, [...args, '--format', 'json'], { windowsHide: true, timeout, encoding: 'utf8', maxBuffer: 4 << 20 },
    (e, out, err) => {
      const text = String(out || '').trim();
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch {}
      res({ ok: !e, data, text, err: String(err || (e && e.message) || '').trim() });
    }));
}

const TOKEN_PATH = require('./paths').dataPath('spotify.key');
const PORT = 8971;
const REDIRECT = `http://127.0.0.1:${PORT}/callback`;
const SCOPES = 'user-read-playback-state user-modify-playback-state user-read-currently-playing';

function createSpotify({ config, netFetch }) {
  let tok = null;           // { access, refresh, exp }
  let login = null;         // { server, verifier, state, resolve }
  const calls = [];         // последние запросы к API (метод, путь, код ответа) — для проверки, без токенов

  const clientId = () => ((config().spotify || {}).clientId || '').trim();

  function load() {
    if (tok) return tok;
    try {
      const raw = fs.readFileSync(TOKEN_PATH);
      tok = JSON.parse(safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(raw) : raw.toString('utf8'));
    } catch { tok = null; }
    return tok;
  }
  function save(t) {
    tok = t;
    if (!t) { try { fs.unlinkSync(TOKEN_PATH); } catch {} return; }
    const s = JSON.stringify(t);
    fs.writeFileSync(TOKEN_PATH, safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(s) : Buffer.from(s, 'utf8'));
  }

  async function tokenRequest(params) {
    const r = await netFetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: clientId(), ...params }).toString(),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(d.error_description || d.error || `HTTP ${r.status}`), { status: r.status, code: d.error });
    return d;
  }

  async function access() {
    const t = load();
    if (!t) return null;
    if (t.exp - Date.now() > 60_000) return t.access;
    try {
      const d = await tokenRequest({ grant_type: 'refresh_token', refresh_token: t.refresh });
      save({ access: d.access_token, refresh: d.refresh_token || t.refresh, exp: Date.now() + d.expires_in * 1000, user: t.user });
      return tok.access;
    } catch (e) {
      if (e.code === 'invalid_grant' || e.status === 400) save(null);   // вход отозван — нужно войти заново
      throw e;
    }
  }

  async function api(method, p, body) {
    const a = await access();
    if (!a) throw Object.assign(new Error('не выполнен вход в Spotify'), { code: 'login' });
    const r = await netFetch('https://api.spotify.com/v1' + p, {
      method, headers: { Authorization: 'Bearer ' + a, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const raw = r.status === 204 ? '' : await r.text().catch(() => '');
    calls.push({ t: new Date().toLocaleTimeString('ru-RU'), method, path: p.split('?')[0], status: r.status, body: raw.slice(0, 200) });
    if (calls.length > 20) calls.shift();
    if (r.status === 204) return null;
    let d = null;
    try { d = JSON.parse(raw); } catch {}
    if (!r.ok) {
      const reason = d && d.error && (d.error.reason || d.error.message);
      throw Object.assign(new Error(reason || `HTTP ${r.status}`), { status: r.status, code: reason });
    }
    return d;
  }

  // ---------- Вход (PKCE): браузер → accounts.spotify.com → 127.0.0.1:8971/callback ----------
  function startLogin() {
    if (!clientId()) return Promise.resolve({ ok: false, error: 'noclient' });
    if (login) { try { login.server.close(); } catch {} login.resolve({ ok: false, error: 'restarted' }); }
    const verifier = crypto.randomBytes(48).toString('base64url');
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    const state = crypto.randomBytes(12).toString('hex');
    return new Promise((resolve) => {
      const done = (r) => { if (!login) return; clearTimeout(login.timer); try { login.server.close(); } catch {} login = null; resolve(r); };
      const page = (title, text) => `<!doctype html><meta charset="utf-8"><title>${title}</title><body style="font:16px system-ui;background:#121212;color:#fff;display:grid;place-items:center;height:100vh;margin:0"><div style="text-align:center"><h2>${title}</h2><p style="color:#aaa">${text}</p></div>`;
      const server = http.createServer(async (req, res) => {
        const u = new URL(req.url, REDIRECT);
        if (u.pathname !== '/callback') { res.writeHead(404); return res.end(); }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        if (u.searchParams.get('state') !== state || !u.searchParams.get('code')) {
          res.end(page('Не получилось', u.searchParams.get('error') === 'access_denied' ? 'Вход отменён.' : 'Попробуйте ещё раз из настроек Click.'));
          return done({ ok: false, error: u.searchParams.get('error') || 'state' });
        }
        try {
          const d = await tokenRequest({ grant_type: 'authorization_code', code: u.searchParams.get('code'), redirect_uri: REDIRECT, code_verifier: verifier });
          save({ access: d.access_token, refresh: d.refresh_token, exp: Date.now() + d.expires_in * 1000 });
          let user = '';
          // product (тариф) Spotify отдаёт не всем приложениям — нет поля, значит «неизвестно», а не «без Premium»
          try { const me = await api('GET', '/me'); user = me.display_name || me.id; save({ ...tok, user, premium: me.product ? me.product === 'premium' : null }); } catch {}
          res.end(page('Готово', 'Click подключён к Spotify. Эту вкладку можно закрыть.'));
          done({ ok: true, user });
        } catch (e) {
          res.end(page('Не получилось', 'Spotify не принял вход: ' + String(e.message).replace(/[<>&]/g, '')));
          done({ ok: false, error: 'token', detail: e.message });
        }
      });
      server.on('error', (e) => done({ ok: false, error: 'port', detail: e.message }));
      server.listen(PORT, '127.0.0.1', () => {
        const q = new URLSearchParams({ client_id: clientId(), response_type: 'code', redirect_uri: REDIRECT, scope: SCOPES, state, code_challenge_method: 'S256', code_challenge: challenge });
        shell.openExternal('https://accounts.spotify.com/authorize?' + q);
      });
      login = { server, resolve, timer: setTimeout(() => done({ ok: false, error: 'timeout' }), 5 * 60_000) };
    });
  }

  function logout() { save(null); return status(); }

  function status() {
    const t = load();
    return { cli: hasCli(), ready: hasCli() || !!t, clientId: clientId(), redirect: REDIRECT, loggedIn: !!t, user: t ? t.user || '' : '', premium: t ? t.premium : null, logging: !!login };
  }

  // ---------- Поиск и включение ----------
  const TYPES = { track: 'track', artist: 'artist', album: 'album', playlist: 'playlist' };

  // Ищем сразу песни, исполнителей, альбомы и плейлисты и берём то, что лучше всего совпадает со словами
  // человека: модель может перепутать вид («Linkin Park Numb» как исполнителя), а совпадение слов — нет.
  // Запрошенный вид получает небольшую прибавку — при равенстве выигрывает он.
  const words = (s) => String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9\s]+/g, ' ').split(/\s+/).filter(Boolean);
  // Слово совпало: целиком или общим началом от 4 букв («скачанное» ~ «скачано», «депрессия» ~ «depression» — нет)
  const same = (a, b) => a === b || (a.length >= 4 && b.length >= 4 && a.slice(0, Math.min(a.length, b.length, 6)) === b.slice(0, Math.min(a.length, b.length, 6)));
  function score(qw, text) {
    const tw = words(text);
    if (!tw.length || !qw.length) return 0;
    const hit = qw.filter((w) => tw.some((t) => same(w, t))).length;
    const covered = tw.filter((t) => qw.some((w) => same(w, t))).length;
    return (hit / qw.length) * 0.7 + (covered / tw.length) * 0.3;   // покрытие запроса важнее «лишних» слов в названии
  }

  // ---------- Библиотека пользователя: его плейлисты, альбомы, исполнители ----------
  let lib = { at: 0, items: [] };
  let libLoading = null;
  async function library(force) {
    if (!hasCli()) return [];
    if (!force && Date.now() - lib.at < 5 * 60_000) return lib.items;
    if (libLoading) return libLoading;
    libLoading = (async () => {
      const items = [];
      for (let offset = 0; offset < 1000; offset += 200) {
        const r = await cli(['library', 'list', '--limit', '200', '--offset', String(offset)]);
        const page = (r.data && r.data.items) || [];
        items.push(...page.filter((x) => x && x.uri && ['playlist', 'album', 'artist'].includes(x.type)));
        if (!r.data || !r.data.has_more || !page.length) break;
      }
      if (items.length || !lib.items.length) lib = { at: Date.now(), items };
      return lib.items;
    })();
    try { return await libLoading; } finally { libLoading = null; }
  }
  // Названия плейлистов для «мозга» (из кэша; обновление — в фоне)
  function playlistNames() {
    if (hasCli() && Date.now() - lib.at > 5 * 60_000) library().catch(() => {});
    return lib.items.filter((x) => x.type === 'playlist').map((x) => x.name);
  }
  const LIKED = { uri: 'spotify:collection:tracks', type: 'playlist', title: 'Любимые треки' };
  const isLiked = (q) => /(любим|лайкнут|лайкнут|понравивш|сохранённ|сохраненн|liked)/i.test(q);
  async function find(query, kind) {
    const want = TYPES[kind] || 'track';
    const d = await api('GET', `/search?type=track,artist,album,playlist&limit=4&q=${encodeURIComponent(query)}`);
    const qw = words(query);
    const cands = [];
    for (const type of Object.keys(TYPES)) {
      const items = ((d && d[type + 's'] && d[type + 's'].items) || []).filter(Boolean);
      items.forEach((it, i) => {
        const who = it.artists ? it.artists.map((a) => a.name).join(' ') : '';
        const text = type === 'artist' || type === 'playlist' ? it.name : `${who} ${it.name}`;
        // Порядок выдачи Spotify (популярность) — лёгкая прибавка первым
        const s = score(qw, text) + (type === want ? 0.12 : 0) + (i === 0 ? 0.05 : 0) - i * 0.02;
        const shown = it.artists ? it.artists.map((a) => a.name).join(', ') : it.owner ? it.owner.display_name : '';
        cands.push({ s, uri: it.uri, type, title: shown && type !== 'artist' ? `${shown} — ${it.name}` : it.name });
      });
    }
    if (!cands.length) return null;
    // Настроение/жанр («музыка для работы») редко совпадает словами — плейлист оставляем, если его и просили
    cands.sort((a, b) => b.s - a.s);
    return cands[0];
  }

  // Устройство для воспроизведения: активное, иначе этот компьютер; Spotify не запущен — запускаем и ждём
  async function device() {
    for (let i = 0; i < 12; i++) {
      const d = await api('GET', '/me/player/devices');
      const list = (d && d.devices) || [];
      const dev = list.find((x) => x.is_active) || list.find((x) => x.type === 'Computer') || list[0];
      if (dev) return dev;
      if (i === 0) shell.openExternal('spotify:');
      await new Promise((r) => setTimeout(r, 1000));
    }
    return null;
  }

  // ---------- Через spotify_cli (основной путь) ----------
  async function cliReady() {
    let s = await cli(['status']);
    if (s.data && s.data.running && s.data.logged_in) return true;
    if (s.data && !s.data.running) {
      await cli(['open']);
      for (let i = 0; i < 15; i++) {
        await new Promise((r) => setTimeout(r, 700));
        s = await cli(['status']);
        if (s.data && s.data.running && s.data.logged_in) return true;
      }
    }
    return false;
  }
  async function cliFind(query, kind) {
    if (kind === 'liked' || isLiked(query)) return LIKED;
    const want = TYPES[kind] || 'track';
    // Без --type утилита отдаёт песни и исполнителей; альбомы и плейлисты — отдельными запросами, параллельно
    const [all, albums, lists, mine] = await Promise.all([
      cli(['search', query, '--limit', '4']),
      cli(['search', query, '--type', 'album', '--limit', '3']),
      cli(['search', query, '--type', 'playlist', '--limit', '3']),
      library().catch(() => []),
    ]);
    // Без служебных слов: «мой плейлист скачано» → «скачано» (\b в JS не работает с русскими буквами — фильтруем слова)
    const qw0 = words(query).filter((w) => !/^(мой|мою|мое|мои|моих|моего|моем|моей|плейлист[а-я]*|playlist|подборк[а-я]*|из|в|мне)$/.test(w));
    // Своё (плейлисты, альбомы, исполнители из библиотеки) — с прибавкой: «включи скачано» — это плейлист человека
    const myCands = [];
    for (const it of mine) {
      const text = it.type === 'album' ? `${(it.artists || []).join(' ')} ${it.name}` : it.name;
      const s0 = score(qw0.length ? qw0 : words(query), text);
      if (s0 < 0.5) continue;   // совпало меньше половины — не то
      const shown = it.type === 'album' && it.artists && it.artists.length ? `${it.artists.join(', ')} — ${it.name}` : it.name;
      myCands.push({ s: s0 + 0.3 + (it.type === want ? 0.12 : 0), uri: it.uri, type: it.type, title: shown, mine: true });
    }
    const pools = {
      track: (all.data && all.data.tracks) || [], artist: (all.data && all.data.artists) || [],
      album: (albums.data && albums.data.albums) || [], playlist: (lists.data && lists.data.playlists) || [],
    };
    const qw = words(query);
    const cands = [];
    for (const [type, items] of Object.entries(pools)) {
      items.filter(Boolean).forEach((it, i) => {
        const who = (it.artists || []).join(' ');
        const text = type === 'artist' || type === 'playlist' ? it.name : `${who} ${it.name}`;
        const s = score(qw, text) + (type === want ? 0.12 : 0) + (i === 0 ? 0.05 : 0) - i * 0.02;
        const shown = (it.artists || []).join(', ') || it.author || '';
        cands.push({ s, uri: it.uri, type, title: shown && type !== 'artist' ? `${shown} — ${it.name}` : it.name });
      });
    }
    cands.push(...myCands);
    cands.sort((a, b) => b.s - a.s);
    return cands[0] || null;
  }
  // «Любимые треки»: утилита включает их только по адресу spotify:user:<id>:collection
  // (spotify:collection:tracks даёт «client unknown error»). Иногда первый раз она просто продолжает
  // прежний плейлист — поэтому проверяем, что заиграли именно «Любимые», и при необходимости повторяем
  let userId = '';
  async function playLiked() {
    if (!userId) { const me = await cli(['me']); userId = (me.data && me.data.username) || ''; }
    if (!userId) return { ok: false, error: 'api', detail: 'не удалось узнать аккаунт Spotify' };
    const uri = `spotify:user:${userId}:collection`;
    for (let i = 0; i < 3; i++) {
      const r = await cli(['play', uri]);
      if (!r.ok && i === 2) return { ok: false, error: 'api', detail: r.err || r.text };
      await new Promise((res) => setTimeout(res, 1200 + i * 600));
      const np = await cli(['now-playing']);
      const c = np.data && np.data.currently_playing;
      if (c && c.is_playing && /(любим|liked)/i.test(c.context_description || '')) return { ok: true, title: 'Любимые треки', type: 'playlist' };
    }
    return { ok: false, error: 'api', detail: 'Spotify не переключился на «Любимые треки»' };
  }

  async function cliPlay(query, kind) {
    if (!(await cliReady())) return { ok: false, error: 'notready' };
    const it = await cliFind(query, kind);
    if (!it) return { ok: false, error: 'notfound' };
    if (it === LIKED) return playLiked();
    const r = await cli(['play', it.uri]);
    if (!r.ok) return { ok: false, error: 'api', detail: r.err || r.text, title: it.title };
    return { ok: true, title: it.title, type: it.type };
  }
  async function cliQueue(query) {
    if (!(await cliReady())) return { ok: false, error: 'notready' };
    const it = await cliFind(query, 'track');
    if (!it) return { ok: false, error: 'notfound' };
    if (it.type !== 'track') return { ok: false, error: 'notfound' };
    const r = await cli(['queue', 'add', it.uri]);
    return r.ok ? { ok: true, title: it.title } : { ok: false, error: 'api', detail: r.err || r.text };
  }

  async function play(query, kind = 'track') {
    if (hasCli()) return cliPlay(query, kind);
    if (!load()) return { ok: false, error: 'login' };
    try {
      const it = await find(query, kind);
      if (!it) return { ok: false, error: 'notfound' };
      const dev = await device();
      if (!dev) { shell.openExternal(it.uri); return { ok: false, error: 'nodevice', title: it.title }; }
      const body = it.type === 'track' ? { uris: [it.uri] } : { context_uri: it.uri };
      try {
        // Сначала явно «переносим» воспроизведение на это устройство: иначе приложение, числящееся активным,
        // но с устаревшим состоянием, отвечает «ок» и ничего не включает
        await api('PUT', '/me/player', { device_ids: [dev.id], play: false }).catch(() => {});
        await new Promise((r) => setTimeout(r, 400));
        await api('PUT', `/me/player/play?device_id=${encodeURIComponent(dev.id)}`, body);
        // Проверяем, что заиграло; нет — повторяем один раз
        await new Promise((r) => setTimeout(r, 1200));
        const p = await api('GET', '/me/player').catch(() => null);
        if (!p || !p.is_playing || !p.item) {
          await api('PUT', `/me/player/play?device_id=${encodeURIComponent(dev.id)}`, body);
          await new Promise((r) => setTimeout(r, 1500));
          const p2 = await api('GET', '/me/player').catch(() => null);
          if (!p2 || !p2.is_playing || !p2.item) return { ok: false, error: 'silent', title: it.title };
        }
      } catch (e) {
        // Без Premium включать нельзя — открываем найденное в приложении
        if (e.code === 'PREMIUM_REQUIRED' || e.status === 403) { shell.openExternal(it.uri); return { ok: false, error: 'premium', title: it.title }; }
        throw e;
      }
      return { ok: true, title: it.title, type: it.type, device: dev.name };
    } catch (e) {
      if (e.code === 'login') return { ok: false, error: 'login' };
      return { ok: false, error: 'api', detail: e.message };
    }
  }

  async function queue(query) {
    if (hasCli()) return cliQueue(query);
    if (!load()) return { ok: false, error: 'login' };
    try {
      const it = await find(query, 'track');
      if (!it) return { ok: false, error: 'notfound' };
      const dev = await device();
      await api('POST', `/me/player/queue?uri=${encodeURIComponent(it.uri)}${dev ? '&device_id=' + encodeURIComponent(dev.id) : ''}`);
      return { ok: true, title: it.title };
    } catch (e) {
      if (e.code === 'PREMIUM_REQUIRED' || e.status === 403) return { ok: false, error: 'premium' };
      return { ok: false, error: 'api', detail: e.message };
    }
  }

  // Устройства и что играет — для проверки и настроек
  async function player() {
    try {
      const d = await api('GET', '/me/player/devices');
      const p = await api('GET', '/me/player').catch(() => null);
      return {
        ok: true,
        devices: ((d && d.devices) || []).map((x) => ({ name: x.name, type: x.type, active: x.is_active, restricted: x.is_restricted })),
        playing: p ? { device: p.device && p.device.name, is_playing: p.is_playing, item: p.item && `${(p.item.artists || []).map((a) => a.name).join(', ')} — ${p.item.name}` } : null,
        calls: calls.slice(-8),
      };
    } catch (e) { return { ok: false, error: e.code || 'api', detail: e.message }; }
  }

  // ---------- Перемешивание, повтор, добавление в плейлист ----------
  const needCli = () => (hasCli() ? null : { ok: false, error: 'nocli' });

  async function mode(shuffle, repeat) {
    if (needCli()) return needCli();
    if (!(await cliReady())) return { ok: false, error: 'notready' };
    const done = [];
    if (shuffle === 'on' || shuffle === 'off') {
      const r = await cli(['shuffle', shuffle]);
      if (!r.ok) return { ok: false, error: 'api', detail: r.err || r.text };
      done.push(shuffle === 'on' ? 'перемешивание включено' : 'перемешивание выключено');
    }
    if (['off', 'context', 'track'].includes(repeat)) {
      const r = await cli(['repeat', repeat]);
      if (!r.ok) return { ok: false, error: 'api', detail: r.err || r.text };
      done.push({ off: 'повтор выключен', context: 'повтор плейлиста/альбома', track: 'повтор этого трека' }[repeat]);
    }
    return { ok: true, done };
  }

  async function nowPlaying() {
    const r = await cli(['now-playing']);
    const c = r.data && r.data.currently_playing;
    return c && c.uri ? { uri: c.uri, title: c.description || '' } : null;
  }

  // Плейлист из библиотеки человека по названию (только плейлисты; «любимые» — особый случай)
  async function myPlaylist(name) {
    if (isLiked(name)) return LIKED;
    const items = (await library(true)).filter((x) => x.type === 'playlist');
    const qw = words(name).filter((w) => !/^(мой|мою|мое|мои|моих|плейлист[а-я]*|playlist|в|во)$/.test(w));
    let best = null;
    for (const it of items) {
      const s = score(qw.length ? qw : words(name), it.name);
      if (s >= 0.5 && (!best || s > best.s)) best = { s, uri: it.uri, title: it.name };
    }
    return best;
  }

  // Добавить трек (текущий или найденный по названию) в плейлист или в «Любимые треки»
  async function addToPlaylist(playlistName, trackQuery) {
    if (needCli()) return needCli();
    if (!(await cliReady())) return { ok: false, error: 'notready' };
    const pl = await myPlaylist(String(playlistName || 'любимые'));
    if (!pl) return { ok: false, error: 'noplaylist' };
    let track;
    const q = String(trackQuery || '').trim();
    if (!q || /^(эт|текущ|сейчас|current|this|играющ)/i.test(q)) {
      track = await nowPlaying();
      if (!track || !/^spotify:track:/.test(track.uri)) return { ok: false, error: 'nothingplaying' };
    } else {
      const it = await cliFind(q, 'track');
      if (!it || it.type !== 'track') return { ok: false, error: 'notfound' };
      track = { uri: it.uri, title: it.title };
    }
    const r = pl === LIKED ? await cli(['library', 'add', track.uri]) : await cli(['playlist', 'add', pl.uri, track.uri]);
    if (!r.ok) {
      // Чужой плейлист (This Is…, Микс дня) менять нельзя
      if (/(forbidden|403|not allowed|permission|owner|collaborat)/i.test(r.err + r.text)) return { ok: false, error: 'notmine', playlist: pl.title };
      return { ok: false, error: 'api', detail: r.err || r.text };
    }
    return { ok: true, track: track.title, playlist: pl.title };
  }

  // Что включилось бы — без включения (для проверок)
  const pick = (q, kind) => (hasCli() ? cliFind(q, kind) : find(q, kind));

  return { startLogin, logout, status, play, queue, player, library, playlistNames, pick, mode, addToPlaylist, myPlaylist, nowPlaying };
}

module.exports = { createSpotify };
