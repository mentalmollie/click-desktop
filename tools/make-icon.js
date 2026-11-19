// Рисует иконку приложения Click: assets/app.ico (16…256 px) и assets/app-icon.png (256 px).
// Запуск: node_modules\electron\dist\electron.exe tools\make-icon.js
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const OUT = path.join(__dirname, '..', 'assets');
const SIZES = [16, 20, 24, 32, 40, 48, 64, 128, 256];

// Стеклянный квадрат (сине-фиолетовый градиент, блик сверху), белый курсор и три «лучика» клика
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#4f8cff"/>
      <stop offset=".55" stop-color="#6a5cff"/>
      <stop offset="1" stop-color="#a64dff"/>
    </linearGradient>
    <linearGradient id="gloss" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fff" stop-opacity=".38"/>
      <stop offset="1" stop-color="#fff" stop-opacity="0"/>
    </linearGradient>
    <filter id="sh" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="6" stdDeviation="7" flood-color="#1a0f4d" flood-opacity=".45"/>
    </filter>
  </defs>
  <rect x="8" y="8" width="240" height="240" rx="58" fill="url(#bg)"/>
  <path d="M8 66a58 58 0 0 1 58-58h124a58 58 0 0 1 58 58v34c-60 22-180 22-240 0z" fill="url(#gloss)"/>
  <rect x="9.5" y="9.5" width="237" height="237" rx="56.5" fill="none" stroke="#fff" stroke-opacity=".28" stroke-width="3"/>
  <g stroke="#fff" stroke-width="13" stroke-linecap="round" fill="none">
    <path d="M100 34v26"/>
    <path d="M38 96h26"/>
    <path d="M54 50l19 19"/>
  </g>
  <path filter="url(#sh)" fill="#fff" stroke="#fff" stroke-width="10" stroke-linejoin="round"
        d="M98 92l104 44-44 13 30 42-20 14-30-42-28 34z"/>
</svg>`;

app.whenReady().then(async () => {
  const w = new BrowserWindow({ show: false });
  await w.loadURL('about:blank');
  const pngs = await w.webContents.executeJavaScript(`
    (async () => {
      const img = new Image();
      img.src = 'data:image/svg+xml;base64,' + ${JSON.stringify(Buffer.from(SVG).toString('base64'))};
      await img.decode();
      const out = {};
      for (const s of ${JSON.stringify(SIZES)}) {
        const c = document.createElement('canvas'); c.width = c.height = s;
        const g = c.getContext('2d'); g.imageSmoothingQuality = 'high';
        g.drawImage(img, 0, 0, s, s);
        out[s] = c.toDataURL('image/png').split(',')[1];
      }
      return out;
    })()`);
  const bufs = SIZES.map((s) => Buffer.from(pngs[s], 'base64'));
  fs.writeFileSync(path.join(OUT, 'app-icon.png'), bufs[SIZES.indexOf(256)]);
  // ICO с PNG внутри: заголовок, по записи на размер, потом сами картинки
  const head = Buffer.alloc(6 + 16 * SIZES.length);
  head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(SIZES.length, 4);
  let off = head.length;
  SIZES.forEach((s, i) => {
    const e = 6 + 16 * i;
    head.writeUInt8(s >= 256 ? 0 : s, e); head.writeUInt8(s >= 256 ? 0 : s, e + 1);
    head.writeUInt8(0, e + 2); head.writeUInt8(0, e + 3);
    head.writeUInt16LE(1, e + 4); head.writeUInt16LE(32, e + 6);
    head.writeUInt32LE(bufs[i].length, e + 8); head.writeUInt32LE(off, e + 12);
    off += bufs[i].length;
  });
  fs.writeFileSync(path.join(OUT, 'app.ico'), Buffer.concat([head, ...bufs]));
  console.log('готово: assets/app.ico, assets/app-icon.png');
  app.quit();
});
