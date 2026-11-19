// Где программа хранит свои данные. Подключается первым — до brain.js, spotify.js и voice.js.
//
// · Папка данных Electron — всегда %APPDATA%\GlassDock, хотя программа теперь называется Click.
//   В ней лежит ключ, которым safeStorage шифрует ключи API и вход в Spotify: в другой папке
//   (например, %APPDATA%\Click) сохранённые ключи перестают расшифровываться.
// · Настройки, задачи, ключи и распознаватель речи — в %APPDATA%\GlassDock\data, а не рядом с кодом:
//   у собранной программы (Click.exe) папка с кодом может быть только для чтения.
//   При первом запуске всё переносится сюда из папки с кодом (как жило раньше).
const { app } = require('electron');
const path = require('path');
const fs = require('fs');

app.setPath('userData', path.join(app.getPath('appData'), 'GlassDock'));
const DATA = path.join(app.getPath('userData'), 'data');
fs.mkdirSync(DATA, { recursive: true });

// Перенос из папки с кодом — только того, чего в папке данных ещё нет
try {
  const src = __dirname;
  for (const f of fs.readdirSync(src)) {
    if (!(/^(config|todos|social|start-cache|start-icons)\.json$/.test(f) || f.endsWith('.key'))) continue;
    const to = path.join(DATA, f);
    if (!fs.existsSync(to)) fs.copyFileSync(path.join(src, f), to);
  }
  const wSrc = path.join(src, 'whisper'), wDst = path.join(DATA, 'whisper');
  if (fs.existsSync(wSrc) && !fs.existsSync(wDst)) fs.cpSync(wSrc, wDst, { recursive: true });
} catch (e) { console.warn('перенос данных', e.message); }

module.exports = { DATA, dataPath: (...p) => path.join(DATA, ...p) };
