// Собирает чистые кадры лица из листа 2: сгенерированные кадры перепутали глаза и рот
// (где-то закрыты глаза и открыт рот одновременно). Берём обычную позу (глаза открыты, рот закрыт)
// и переносим на неё только полосу глаз или только полосу рта из нужного кадра.
// Где именно глаза и рот — находим по разнице между кадрами. Запуск после slice-anim.js:
//   node_modules\electron\dist\electron.exe tools\anim-face.js
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
// Откуда что брать (имена — как нарезал slice-anim.js, до пересборки)
// eyes/mouth — ряды холста (по замеру крупного плана лица); разница кадров тут ненадёжна:
// генератор каждый раз чуть по-новому перерисовывает всё лицо
const RECIPE = {
  patrick: { base: 'blink1', closed: 'blink2', half: null, small: 'talk1', open: 'talk2', round: 'talk3', eyes: [132, 156], mouth: [157, 176] },
  teresa: { base: 'blink1', closed: 'blink2', half: null, small: 'blink2', open: 'talk1', round: 'talk2', eyes: [130, 151], mouth: [152, 171] },
};

// Любая ошибка — сообщаем и выходим, а не висим
process.on('unhandledRejection', (e) => { console.error('ошибка:', e && e.message); app.exit(1); });

app.whenReady().then(async () => {
  const w = new BrowserWindow({ show: false });
  await w.loadURL('about:blank');
  for (const [p, rc] of Object.entries(RECIPE)) {
    const dir = path.join(ROOT, 'assets', p, 'anim');
    // Исходники кадров лица кладёт slice-anim.js в anim/src — читаем только их, поэтому пересборку можно повторять
    const src = path.join(dir, 'src');
    const need = [...new Set(['base', 'closed', 'half', 'small', 'open', 'round'].map((k) => rc[k]).filter(Boolean))];
    const data = {};
    for (const n of need) data[n] = 'data:image/png;base64,' + fs.readFileSync(path.join(src, n + '.png')).toString('base64');
    const r = await w.webContents.executeJavaScript(`
      (async () => {
        const rc = ${JSON.stringify(rc)}, data = ${JSON.stringify(data)};
        const imgs = {};
        for (const [n, s] of Object.entries(data)) { const im = new Image(); im.src = s; await im.decode(); imgs[n] = im; }
        const W = imgs[rc.base].width, H = imgs[rc.base].height;
        const px = (n) => { const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d'); g.drawImage(imgs[n], 0, 0); return g.getImageData(0, 0, W, H).data; };
        const P = Object.fromEntries(Object.keys(imgs).map((n) => [n, px(n)]));
        const B = P[rc.base];
        // Голова: верхняя часть фигуры. Ищем по базовому кадру ряды с пикселями
        let top = H; for (let y = 0; y < H && top === H; y++) for (let x = 0; x < W; x++) if (B[(y * W + x) * 4 + 3] > 40) { top = y; break; }
        const cx = W / 2;
        const X0 = Math.round(cx - 46), X1 = Math.round(cx + 46);          // ширина лица
        const Y0 = top + 30, Y1 = top + 95;                                  // от бровей до подбородка
        const at = (S, x, y) => (x < 0 || y < 0 || x >= W || y >= H ? -1 : (y * W + x) * 4);
        const d3 = (S, i, j) => (j < 0 ? 765 : Math.abs(S[j] - B[i]) + Math.abs(S[j + 1] - B[i + 1]) + Math.abs(S[j + 2] - B[i + 2]) + Math.abs(S[j + 3] - B[i + 3]));
        // Сдвиг кадра относительно базового: подбираем по всей голове (волосы, контур), ±4 px
        const shift = {};
        for (const n of Object.keys(P)) {
          let best = [0, 0], bs = Infinity;
          for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
            let s = 0;
            for (let y = top; y < top + 100; y += 2) for (let x = X0 - 20; x < X1 + 20; x += 2) s += d3(P[n], (y * W + x) * 4, at(P[n], x + dx, y + dy));
            if (s < bs) { bs = s; best = [dx, dy]; }
          }
          shift[n] = best;
        }
        // Где кадр (со сдвигом) отличается от базового в пределах лица: по рядам
        const diffRows = (n) => {
          const S = P[n], [sx, sy] = shift[n], rows = [];
          for (let y = Y0; y < Y1; y++) {
            let k = 0;
            for (let x = X0; x < X1; x++) { const i = (y * W + x) * 4; if (d3(S, i, at(S, x + sx, y + sy)) > 120) k++; }
            rows.push(k);
          }
          return rows;
        };
        // Полосы глаз и рта: по кадру с закрытыми глазами (глаза) и с открытым ртом (рот)
        const band = (rows, pick) => {
          const on = rows.map((k) => k >= 2);
          const runs = []; let s = -1;
          for (let i = 0; i <= on.length; i++) { const v = i < on.length && on[i]; if (v && s < 0) s = i; if (!v && s >= 0) { if (i - s >= 2) runs.push([s, i]); s = -1; } }
          // склеиваем куски с разрывом до 3 рядов
          const merged = [];
          for (const r of runs) { const l = merged[merged.length - 1]; if (l && r[0] - l[1] <= 3) l[1] = r[1]; else merged.push([...r]); }
          if (!merged.length) return null;
          const b = pick === 'top' ? merged[0] : merged[merged.length - 1];
          return [Y0 + b[0] - 2, Y0 + b[1] + 2];
        };
        const eyes = rc.eyes || band(diffRows(rc.closed), 'top');
        const mouth = rc.mouth || band(diffRows(rc.open), 'bottom');
        const make = (from, rowsBand) => {
          const c = document.createElement('canvas'); c.width = W; c.height = H;
          const g = c.getContext('2d'); g.drawImage(imgs[rc.base], 0, 0);
          if (from && rowsBand) {
            const [sx, sy] = shift[from], h = rowsBand[1] - rowsBand[0];
            g.clearRect(X0, rowsBand[0], X1 - X0, h);
            g.drawImage(imgs[from], X0 + sx, rowsBand[0] + sy, X1 - X0, h, X0, rowsBand[0], X1 - X0, h);
          }
          return c.toDataURL('image/png');
        };
        return {
          eyes, mouth, face: [X0, X1, Y0, Y1], shift, rows: { closed: diffRows(rc.closed).join(','), open: diffRows(rc.open).join(',') },
          out: {
            stand: make(null, null),
            blink1: make(rc.half || rc.closed, eyes),
            blink2: make(rc.closed, eyes),
            talk1: make(rc.small, mouth),
            talk2: make(rc.open, mouth),
            talk3: make(rc.round, mouth),
          },
        };
      })()`);
    for (const [n, d] of Object.entries(r.out)) fs.writeFileSync(path.join(dir, n + '.png'), Buffer.from(d.split(',')[1], 'base64'));
    const metaPath = path.join(ROOT, 'assets', p, 'frames.json');
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    if (!meta.anim.includes('stand')) meta.anim.push('stand');
    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
    console.log(`${p}: лицо x ${r.face[0]}..${r.face[1]} y ${r.face[2]}..${r.face[3]}, сдвиги ${JSON.stringify(r.shift)}, глаза ряды ${r.eyes}, рот ряды ${r.mouth}`);
    console.log('  разница (закрытые глаза):', r.rows.closed);
    console.log('  разница (открытый рот):  ', r.rows.open);
  }
  app.quit();
});
