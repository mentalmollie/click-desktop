// Штатные ссылки установленного приложения Яндекс Музыки. Без перехода в браузер.
const APP_ROOT = 'yandexmusic://';
const path = require('node:path');
const fs = require('node:fs');
function findYandexMusicExecutable({ env = process.env, exists = (file) => { try { return fs.statSync(file).isFile(); } catch { return false; } } } = {}) {
  const roots = [env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Programs', 'YandexMusic'),
    env.ProgramFiles && path.join(env.ProgramFiles, 'YandexMusic'), env['ProgramFiles(x86)'] && path.join(env['ProgramFiles(x86)'], 'YandexMusic')].filter(Boolean);
  for (const root of roots) for (const name of ['Яндекс Музыка.exe', 'YandexMusic.exe']) {
    const file = path.join(root, name); if (exists(file)) return file;
  }
  return null;
}
function createNativeOpener({ getExecutable = findYandexMusicExecutable, spawn }) {
  return (uri) => new Promise((resolve, reject) => {
    const file = getExecutable();
    if (!file) { reject(new Error('Desktop Yandex Music not found')); return; }
    try {
      const child = spawn(file, [uri], { detached: true, windowsHide: false, stdio: 'ignore' });
      child.once('error', reject);
      child.once('spawn', () => { child.unref(); resolve(); });
    } catch (e) { reject(e); }
  });
}
function isYandexMusicUrl(value) {
  try { const u = new URL(value); return ['http:', 'https:'].includes(u.protocol) && /^music\.yandex\.(ru|com|kz|by|uz)$/.test(u.hostname) && !u.username && !u.password && !u.port; }
  catch { return false; }
}
function appUrl(query = '') {
  if (typeof query !== 'string') throw new Error('Неверный запрос музыки.');
  const q = query.trim();
  if (Array.from(q).length > 160) throw new Error('Сократи запрос музыки до 160 символов.');
  return q ? APP_ROOT + 'search?text=' + encodeURIComponent(q) : APP_ROOT;
}
function webUrlToApp(value) {
  if (!isYandexMusicUrl(value)) throw new Error('Неверная ссылка Яндекс Музыки.');
  const u = new URL(value);
  const result = APP_ROOT + u.pathname.replace(/^\/+/, '') + u.search + u.hash;
  if (result.length > 2081) throw new Error('Ссылка Яндекс Музыки слишком длинная.');
  return result;
}
function createYandexMusic({ available, openExternal }) {
  function status() { try { return { installed: !!available() }; } catch { return { installed: false }; } }
  async function launch(uri, text) {
    if (!status().installed) return { ok: false, text: 'Приложение Яндекс Музыки не найдено. Установи его и попробуй снова.' };
    try { await openExternal(uri); return { ok: true, text }; }
    catch { return { ok: false, text: 'Не удалось открыть приложение Яндекс Музыки. Запусти его вручную один раз и попробуй снова.' }; }
  }
  async function open(query = '') {
    try { return await launch(appUrl(query), query.trim() ? `Открыт поиск «${query.trim()}» в приложении Яндекс Музыки. Нажми Play у нужного трека.` : 'Открыто приложение Яндекс Музыки.'); }
    catch (e) { return { ok: false, text: e.message }; }
  }
  async function openLink(value) {
    try { return await launch(webUrlToApp(value), 'Открыто в приложении Яндекс Музыки.'); }
    catch (e) { return { ok: false, text: e.message }; }
  }
  return { status, open, openLink };
}
module.exports = { createYandexMusic, appUrl, webUrlToApp, isYandexMusicUrl, findYandexMusicExecutable, createNativeOpener };
