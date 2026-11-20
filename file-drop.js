// File handoff uses argument arrays, never a command shell or a default file association.
const path = require('node:path').win32;
function createFileDrop({ resolveTarget, stat, launch, activate }) {
  async function hover(target) {
    const app = resolveTarget(target);
    if (!app) return { ok: false };
    if (app.window) activate(app.window);
    return { ok: true, activated: !!app.window };
  }
  async function drop(target, input) {
    try {
      const app = resolveTarget(target);
      if (!app) throw new Error('Приложение больше не находится на панели.');
      if (!Array.isArray(input) || !input.length || input.length > 100) throw new Error('Перетащите от 1 до 100 файлов или папок.');
      const files = [];
      const seen = new Set();
      for (const value of input) {
        if (typeof value !== 'string' || !path.isAbsolute(value) || /[\x00-\x1f]/.test(value) || value.includes('"') || /^(?:\\\\[.?]\\|\\\?\?\\)/.test(value)) throw new Error('Нельзя передать этот файл.');
        const filename = path.normalize(value);
        const info = await stat(filename);
        if (!info.isFile() && !info.isDirectory()) throw new Error('Этот файл недоступен.');
        const key = filename.toLowerCase();
        if (!seen.has(key)) { files.push(filename); seen.add(key); }
      }
      if (!app.path || !path.isAbsolute(app.path) || !/\.exe$/i.test(app.path)) {
        throw new Error('Задержите файлы над значком, чтобы показать окно, затем перенесите их внутрь приложения.');
      }
      const info = await stat(app.path);
      if (!info.isFile()) throw new Error('Приложение не найдено.');
      const args = app.args || [];
      if (!Array.isArray(args) || args.some(a => typeof a !== 'string' || a.includes('\0'))) throw new Error('Неверные параметры приложения.');
      // Some launchers (Discord, Steam) don't forward arbitrary filenames to their app.
      if (/(?:^|\\)(?:update|steam)\.exe$/i.test(app.path)) throw new Error('Задержите файлы над значком и перенесите их в открывшееся окно приложения.');
      await launch(app.path, [...args, ...files]);
      return { ok: true, count: files.length };
    } catch (error) {
      return { ok: false, message: error.code === 'ENOENT' ? 'Файл или приложение больше не доступны.' : error.code === 'EACCES' ? 'Нет доступа к файлу или приложению.' : error.message || 'Не удалось передать файлы.' };
    }
  }
  return { hover, drop };
}
module.exports = { createFileDrop };
