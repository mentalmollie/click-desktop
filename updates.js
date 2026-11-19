// Проверка и скачивание нашего обычного установщика, без смены формата установки.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

function versionParts(version) {
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Неверный номер версии обновления.');
  const parts = version.split('.').map(Number);
  if (!parts.every(Number.isSafeInteger)) throw new Error('Неверный номер версии обновления.');
  return parts;
}
function newer(a, b) {
  const x = versionParts(a), y = versionParts(b);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
}
function validateManifest(raw, feedUrl, allowLocalHttp = false) {
  const base = new URL(feedUrl);
  const validUrl = (value) => {
    const url = new URL(value, base);
    const local = allowLocalHttp && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if ((url.protocol !== 'https:' && !(local && url.protocol === 'http:')) || url.origin !== base.origin || url.username || url.password) throw new Error('Неверный адрес файла обновления.');
    return url.href;
  };
  validUrl(feedUrl);
  versionParts(raw.version);
  if (raw.platform !== 'win32' || raw.arch !== 'x64') throw new Error('Это обновление не подходит для этой версии Click.');
  const hash = (s) => typeof s === 'string' && /^[a-f0-9]{64}$/i.test(s);
  if (!Number.isSafeInteger(raw.size) || raw.size <= 0 || raw.size > 1024 ** 3 || !hash(raw.sha256)) throw new Error('Повреждены сведения об обновлении.');
  if (!Array.isArray(raw.files) || !raw.files.length || raw.files.length > 128) throw new Error('Отсутствуют файлы обновления.');
  const files = raw.files.map((f) => {
    if (!Number.isSafeInteger(f.size) || f.size <= 0 || !hash(f.sha256) || typeof f.url !== 'string') throw new Error('Повреждены сведения о файле обновления.');
    return { url: validUrl(f.url), size: f.size, sha256: f.sha256.toLowerCase() };
  });
  if (files.reduce((sum, f) => sum + f.size, 0) !== raw.size) throw new Error('Неверный размер обновления.');
  return { version: raw.version, size: raw.size, sha256: raw.sha256.toLowerCase(), files,
    notes: typeof raw.notes === 'string' ? raw.notes.slice(0, 8000) : '', filename: `Click-Setup-${raw.version}.exe` };
}
async function fileHash(filename) {
  const hash = crypto.createHash('sha256');
  for await (const bytes of fs.createReadStream(filename)) hash.update(bytes);
  return hash.digest('hex');
}

function validateGithubRelease(raw, repository) {
  if (!/^[\w-]+\/[\w.-]+$/.test(repository) || !raw || raw.draft || raw.prerelease) throw new Error('Неверный релиз GitHub.');
  const version = String(raw.tag_name || '').replace(/^v/, '');
  versionParts(version);
  const filename = `Click-Setup-${version}.exe`;
  const assets = (raw.assets || []).filter((a) => a.name === filename);
  if (assets.length !== 1) throw new Error('В релизе нет установщика Click для Windows x64.');
  const asset = assets[0], sha256 = /^sha256:([a-f0-9]{64})$/i.exec(asset.digest || '')?.[1]?.toLowerCase();
  const expected = `https://github.com/${repository}/releases/download/${encodeURIComponent(raw.tag_name)}/${filename}`;
  if (!sha256 || !Number.isSafeInteger(asset.size) || asset.size <= 0 || asset.size > 1024 ** 3 || asset.state !== 'uploaded' || asset.browser_download_url !== expected) throw new Error('Не удалось проверить сведения об установщике GitHub.');
  return { version, filename, size: asset.size, sha256, notes: String(raw.body || '').slice(0, 8000),
    files: [{ url: expected, size: asset.size, sha256 }] };
}

async function readJson(response) {
  const chunks = []; let length = 0;
  for await (const bytes of response.body) {
    length += bytes.length;
    if (length > 512 * 1024) throw new Error('Сервер вернул слишком большой ответ.');
    chunks.push(Buffer.from(bytes));
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new Error('Сервер обновлений вернул неверный ответ.'); }
}

function createUpdater({ currentVersion, feedUrl, websiteUrl, repository, directory, fetchImpl = fetch, launch, onChange = () => {}, allowLocalHttp = false }) {
  if (repository && !/^[\w-]+\/[\w.-]+$/.test(repository)) throw new Error('Неверный репозиторий обновлений.');
  if (repository) feedUrl = `https://api.github.com/repos/${repository}/releases/latest`;
  let release = null, installer = null, action = null, controller = null;
  let state = { phase: 'idle', currentVersion, availableVersion: null, received: 0, total: 0, progress: 0,
    message: 'Проверьте, доступна ли новая версия Click.', notes: '', checkedAt: null, websiteUrl };
  const status = () => ({ ...state, canDownload: !!release && !installer && !['checking', 'downloading', 'installing'].includes(state.phase),
    canInstall: !!installer && !['checking', 'downloading', 'installing'].includes(state.phase) });
  const emit = (patch) => { state = { ...state, ...patch }; onChange(status()); return status(); };
  const run = (work) => {
    if (action) return action;
    action = Promise.resolve().then(work).finally(() => { action = null; controller = null; });
    return action;
  };
  const request = async (url) => {
    const response = await fetchImpl(url, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(120000)]), cache: 'no-store', headers: { 'User-Agent': `Click/${currentVersion}` } });
    if (!response.ok) throw new Error(response.status === 404 ? 'Новая версия пока не опубликована.' : [403, 429].includes(response.status) ? 'GitHub временно ограничил запросы. Попробуйте позже.' : `Сервер обновлений недоступен (${response.status}).`);
    if (response.url) {
      const resultUrl = new URL(response.url);
      if (resultUrl.protocol !== 'https:' && !(allowLocalHttp && ['localhost', '127.0.0.1', '[::1]'].includes(resultUrl.hostname))) throw new Error('Сервер вернул небезопасный адрес обновления.');
      if (repository && !['api.github.com', 'github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com'].includes(resultUrl.hostname)) throw new Error('GitHub вернул неизвестный адрес обновления.');
    }
    return response;
  };
  const fail = (error) => emit({ phase: 'error', message: error.message && !/fetch failed|network|ENOTFOUND|ECONN|abort|timeout/i.test(error.message)
    ? error.message : 'Не удалось связаться с сервером. Проверьте интернет и попробуйте ещё раз.' });

  function check() {
    return run(async () => {
      controller = new AbortController();
      const oldInstaller = installer, oldRelease = release;
      emit({ phase: 'checking', message: 'Проверяем обновления…' });
      try {
        const response = await request(feedUrl);
        const raw = await readJson(response);
        const next = repository ? validateGithubRelease(raw, repository) : validateManifest(raw, feedUrl, allowLocalHttp);
        const checkedAt = Date.now();
        if (!newer(next.version, currentVersion)) {
          release = null; installer = null;
          return emit({ phase: 'current', availableVersion: null, notes: '', checkedAt, progress: 0, received: 0, total: 0, message: 'У вас установлена последняя версия Click.' });
        }
        release = next;
        installer = oldRelease && oldRelease.sha256 === next.sha256 ? oldInstaller : null;
        return emit({ phase: installer ? 'ready' : 'available', availableVersion: next.version, notes: next.notes, total: next.size, checkedAt,
          progress: installer ? 100 : 0, received: installer ? next.size : 0,
          message: installer ? 'Обновление скачано и готово к установке.' : `Доступна версия ${next.version}.` });
      } catch (error) { return fail(error); }
    });
  }
  function download() {
    return run(async () => {
      if (!release) return emit({ phase: 'error', message: 'Сначала проверьте наличие обновлений.' });
      controller = new AbortController(); installer = null;
      const target = path.join(directory, release.filename), partial = target + '.part';
      let handle;
      emit({ phase: 'downloading', received: 0, progress: 0, total: release.size, message: 'Скачиваем обновление…' });
      try {
        await fsp.mkdir(directory, { recursive: true });
        await fsp.rm(partial, { force: true });
        handle = await fsp.open(partial, 'wx');
        const hash = crypto.createHash('sha256');
        let received = 0, notifiedAt = 0;
        for (const part of release.files) {
          const response = await request(part.url);
          const partHash = crypto.createHash('sha256'); let partSize = 0;
          for await (const bytes of response.body) {
            controller.signal.throwIfAborted();
            partSize += bytes.length; received += bytes.length;
            if (partSize > part.size || received > release.size) throw new Error('Размер скачанного файла не совпадает. Попробуйте скачать обновление снова.');
            hash.update(bytes); partHash.update(bytes);
            await handle.writeFile(bytes);
            if (Date.now() - notifiedAt > 100) {
              notifiedAt = Date.now();
              emit({ received, progress: Math.min(99, Math.floor(received * 100 / release.size)) });
            }
          }
          if (partSize !== part.size || partHash.digest('hex') !== part.sha256) throw new Error('Файл обновления повреждён. Попробуйте скачать его снова.');
        }
        if (received !== release.size || hash.digest('hex') !== release.sha256) throw new Error('Не удалось проверить файл обновления. Скачайте его ещё раз.');
        controller.signal.throwIfAborted();
        await handle.close(); handle = null;
        await fsp.rm(target, { force: true });
        await fsp.rename(partial, target); installer = target;
        return emit({ phase: 'ready', received, progress: 100, message: 'Обновление скачано. Нажмите «Установить», чтобы продолжить.' });
      } catch (error) {
        if (handle) await handle.close().catch(() => {});
        await fsp.rm(partial, { force: true }).catch(() => {});
        return controller.signal.aborted
          ? emit({ phase: 'available', received: 0, progress: 0, message: 'Скачивание отменено. Можно попробовать снова.' }) : fail(error);
      }
    });
  }
  function install() {
    return run(async () => {
      if (!installer || !release) return emit({ phase: 'error', message: 'Сначала скачайте обновление.' });
      emit({ phase: 'installing', message: 'Запускаем установщик. Click закроется на время обновления.' });
      try {
        if (await fileHash(installer) !== release.sha256) { installer = null; throw new Error('Файл обновления изменился. Скачайте его ещё раз.'); }
        await launch(installer);
        return status();
      } catch (error) { return fail(error); }
    });
  }
  async function history() {
    if (!repository) return [];
    const response = await fetchImpl(`https://api.github.com/repos/${repository}/releases?per_page=10`, {
      signal: AbortSignal.timeout(20000), headers: { 'User-Agent': `Click/${currentVersion}`, Accept: 'application/vnd.github+json' },
    });
    if (!response.ok) throw new Error('Не удалось загрузить историю версий с GitHub.');
    const releases = await readJson(response);
    if (!Array.isArray(releases)) throw new Error('GitHub вернул неверный список релизов.');
    return releases.filter((r) => !r.draft && !r.prerelease && /^v?\d+\.\d+\.\d+$/.test(r.tag_name)).slice(0, 10)
      .map((r) => ({ version: r.tag_name.replace(/^v/, ''), date: r.published_at, notes: String(r.body || '').slice(0, 8000) }));
  }
  return { status, check, download, install, history, cancel: () => { if (state.phase === 'downloading') controller?.abort(); } };
}
module.exports = { createUpdater, validateManifest, validateGithubRelease, newer, fileHash };
