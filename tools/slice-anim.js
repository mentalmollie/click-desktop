// Нарезает общий лист анимации (assets/anim-sheet.webp): 4 ряда-листа, слева Патрик, справа Тереза, по 8 кадров.
// Кадры масштабируются под рост текущих кадров эмоций, ставятся ногами на ту же линию и центром туловища
// в центр холста. Анимация бывает выше обычной позы (поднятые руки, колено, «Z» над головой), поэтому
// холст делаем выше на нужный запас — и кадры эмоций тоже перекладываем на такой же холст (запас сверху),
// чтобы анимация и эмоции сменяли друг друга без скачков. Итог пишется в assets/<имя>/anim/ и frames.json.
// Запуск: node_modules\electron\dist\electron.exe tools\slice-anim.js
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
// Лучше всего — PNG с прозрачным фоном; если его нет — картинка с ровным фоном (вырезаем по цвету)
const SHEET = ['anim-sheet.png', 'anim-sheet.webp'].map((f) => path.join(ROOT, 'assets', f)).find((f) => fs.existsSync(f));
const NAMES = [
  ['walk1', 'walk2', 'walk3', 'walk4', 'walk5', 'walk6', 'walk7', 'walk8'],
  ['blink1', 'blink2', 'talk1', 'talk2', 'talk3', 'turn1', 'turn2', 'side'],
  ['wave1', 'wave2', 'wave3', 'wave4', 'think1', 'think2', 'sip1', 'sip2'],
  ['dance1', 'dance2', 'dance3', 'dance4', 'doze1', 'doze2', 'sleep1', 'sleep2'],
];
const PEOPLE = ['patrick', 'teresa'];   // левая и правая половина листа
// Если у кого-то кадры ряда стоят в другом порядке: имя → [ряд][кадр]. «-» — кадр не нужен.
// Недостающие кадры — копии (COPY: новое имя ← существующее)
const OVERRIDE = {
  teresa: { 2: ['wave1', 'wave2', 'wave4', 'think1', '-', 'sip1', 'think2', '-'] },
};
const COPY = { teresa: { wave3: 'wave1', sip2: 'sip1' } };
const TARGET_H = { patrick: 233, teresa: 231 };   // рост персонажа на кадрах эмоций (idle)

const sheetData = `data:image/${SHEET.endsWith('.png') ? 'png' : 'webp'};base64,` + fs.readFileSync(SHEET).toString('base64');

// Общая часть для страницы: вырезать фон листа
const CUT_BG = `
  const img = new Image();
  img.src = ${JSON.stringify(sheetData)};
  await img.decode();
  const W = img.width, H = img.height;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d'); g.drawImage(img, 0, 0);
  const id = g.getImageData(0, 0, W, H), px = id.data;
  const bg = [px[(3 * W + 3) * 4], px[(3 * W + 3) * 4 + 1], px[(3 * W + 3) * 4 + 2]];
  const dist = (k) => Math.hypot(px[k * 4] - bg[0], px[k * 4 + 1] - bg[1], px[k * 4 + 2] - bg[2]);
  const bgMask = new Uint8Array(W * H);
  // Прозрачный фон: фоном считаем почти прозрачное, цвет не трогаем (тёмные волосы и белая чашка целы)
  const alphaSheet = px[(3 * W + 3) * 4 + 3] === 0;
  if (alphaSheet) for (let k = 0; k < W * H; k++) if (px[k * 4 + 3] < 24) { bgMask[k] = 1; px[k * 4 + 3] = 0; }
  const st = alphaSheet ? [] : [];
  if (!alphaSheet) {
    for (let x = 0; x < W; x++) st.push(x, 0, x, H - 1);
    for (let y = 0; y < H; y++) st.push(0, y, W - 1, y);
  }
  while (st.length) {
    const y = st.pop(), x = st.pop();
    if (x < 0 || y < 0 || x >= W || y >= H) continue;
    const k = y * W + x;
    if (bgMask[k] || dist(k) > 34) continue;
    bgMask[k] = 1;
    st.push(x + 1, y, x - 1, y, x, y + 1, x, y - 1);
  }
  // Замкнутые островки фона (между рукой и телом) — только если фон цветной, не белый и не прозрачный:
  // на белом фоне так пропали бы белые рубашка и чашка
  const bright = bg[0] + bg[1] + bg[2] > 690;
  if (!alphaSheet && !bright) for (let k = 0; k < W * H; k++) if (!bgMask[k] && dist(k) < 14) bgMask[k] = 1;
  for (let k = 0; k < W * H; k++) if (bgMask[k]) px[k * 4 + 3] = 0;
  g.putImageData(id, 0, 0);
  const solid = (x, y) => !bgMask[y * W + x];
`;

const findScript = `
(async () => {
  ${CUT_BG}
  // Ряды: строки с пикселями персонажей. Подписи («Лист 1…») — низкие полосы, их пропускаем
  const rowN = []; for (let y = 0; y < H; y++) { let n = 0; for (let x = 0; x < W; x++) if (solid(x, y)) n++; rowN.push(n); }
  const bands = []; let s = -1;
  for (let y = 0; y <= H; y++) { const on = y < H && rowN[y] > 2; if (on && s < 0) s = y; if (!on && s >= 0) { if (y - s > 90) bands.push([s, y]); s = -1; } }
  const halves = [[0, Math.floor(W / 2)], [Math.floor(W / 2), W]];
  const frames = [];
  for (const [y0, y1] of bands) {
    const row = [];
    for (const [hx0, hx1] of halves) {
      const colHas = []; for (let x = hx0; x < hx1; x++) { let n = 0; for (let y = y0; y < y1; y++) if (solid(x, y)) n++; colHas.push(n > 1); }
      let segs = []; let s2 = -1;
      for (let i = 0; i <= colHas.length; i++) { const on = i < colHas.length && colHas[i]; if (on && s2 < 0) s2 = i; if (!on && s2 >= 0) { segs.push([hx0 + s2, hx0 + i]); s2 = -1; } }
      // Мелкие куски («Z», пряди) приклеиваем к ближайшему соседу
      while (segs.length > 8) {
        let mi = 0; segs.forEach((sg, i) => { if (sg[1] - sg[0] < segs[mi][1] - segs[mi][0]) mi = i; });
        const gl = mi > 0 ? segs[mi][0] - segs[mi - 1][1] : 1e9, gr = mi < segs.length - 1 ? segs[mi + 1][0] - segs[mi][1] : 1e9;
        const j = gl <= gr ? mi - 1 : mi + 1, a = Math.min(mi, j);
        segs.splice(a, 2, [Math.min(segs[mi][0], segs[j][0]), Math.max(segs[mi][1], segs[j][1])]);
      }
      // Соседи слиплись (волосы касаются) — делим на 8 равных клеток
      if (segs.length !== 8) {
        const a = segs[0][0], b = segs[segs.length - 1][1], w = (b - a) / 8;
        segs = Array.from({ length: 8 }, (_, i) => [Math.round(a + i * w), Math.round(a + (i + 1) * w)]);
      }
      row.push(segs.map(([x0, x1]) => {
        let top = y1, bot = y0;
        for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (solid(x, y)) { if (y < top) top = y; if (y > bot) bot = y; }
        // Центр туловища: средний x пикселей в средней части фигуры (стабилен при шагах и наклонах)
        let sx = 0, n = 0;
        const a = Math.round(bot - (bot - top) * 0.62), b = Math.round(bot - (bot - top) * 0.32);
        for (let y = a; y <= b; y++) for (let x = x0; x < x1; x++) if (solid(x, y)) { sx += x; n++; }
        return { x0, x1, top, bot, cx: n ? sx / n : (x0 + x1) / 2 };
      }));
    }
    frames.push(row);
  }
  return { bands, frames };
})()`;

app.whenReady().then(async () => {
  const w = new BrowserWindow({ show: false });
  await w.loadURL('about:blank');
  const r = await w.webContents.executeJavaScript(findScript);
  console.log('ряды', JSON.stringify(r.bands), 'кадров', r.frames.map((row) => row.map((h) => h.length).join('+')).join(' '));
  if (r.frames.length !== 4) { console.log('ожидалось 4 ряда'); app.quit(); return; }

  for (const [hi, p] of PEOPLE.entries()) {
    const metaPath = path.join(ROOT, 'assets', p, 'frames.json');
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    const baseH = meta.baseH || meta.h;          // высота холста эмоций до запаса
    const CW = meta.w;
    const ref = r.frames[1][hi][0];              // «моргание 1» — обычная поза
    const scale = TARGET_H[p] / (ref.bot - ref.top + 1);
    // Запас сверху: самый высокий кадр анимации + 4 px
    let need = 0;
    r.frames.forEach((row) => row[hi].forEach((f) => { need = Math.max(need, (f.bot - f.top + 1) * scale - (baseH - 3)); }));
    const pad = Math.max(0, Math.ceil(need) + 4);
    const CH = baseH + pad;
    const plan = [];
    r.frames.forEach((row, bi) => row[hi].forEach((f, fi) => {
      const name = ((OVERRIDE[p] || {})[bi] || NAMES[bi])[fi];
      if (name !== '-') plan.push({ name, f });
    }));
    // Кадры эмоций — на холст той же высоты (запас сверху), из исходных PNG (они хранятся до первой перекладки)
    const emoDir = path.join(ROOT, 'assets', p);
    const origDir = path.join(emoDir, 'orig');
    fs.mkdirSync(origDir, { recursive: true });
    const emo = {};
    for (const name of meta.frames) {
      const orig = path.join(origDir, name + '.png');
      if (!fs.existsSync(orig)) fs.copyFileSync(path.join(emoDir, name + '.png'), orig);
      emo[name] = 'data:image/png;base64,' + fs.readFileSync(orig).toString('base64');
    }
    const out = await w.webContents.executeJavaScript(`
      (async () => {
        ${CUT_BG}
        const plan = ${JSON.stringify(plan)}, scale = ${scale}, CW = ${CW}, CH = ${CH}, pad = ${pad};
        const anim = {};
        for (const { name, f } of plan) {
          // Чистим клетку: оставляем саму фигуру, убираем подписи листа, мелкие точки и лишние «Z»
          // (в кадрах сна «Z» — по делу, их не трогаем)
          const sw = f.x1 - f.x0, sh = f.bot - f.top + 1;
          const t = document.createElement('canvas'); t.width = sw; t.height = sh;
          const tg = t.getContext('2d'); tg.drawImage(c, f.x0, f.top, sw, sh, 0, 0, sw, sh);
          const td = tg.getImageData(0, 0, sw, sh), tp = td.data;
          const lab = new Int32Array(sw * sh).fill(-1), comps = [];
          // Связность — только по явно непрозрачным пикселям: полупрозрачная кайма не должна «склеивать»
          // с фигурой лишние «Z» и точки. Слабые пиксели потом удаляем вместе с куском, к которому они примыкают
          const STRONG = 120;
          for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
            const k = y * sw + x;
            if (tp[k * 4 + 3] < STRONG || lab[k] >= 0) continue;
            const cp = { n: 0, top: y, bot: y, pts: [] }; lab[k] = comps.length;
            const q = [x, y];
            while (q.length) {
              const yy = q.pop(), xx = q.pop();
              cp.n++; cp.pts.push(xx, yy); if (yy < cp.top) cp.top = yy; if (yy > cp.bot) cp.bot = yy;
              for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
                const nx = xx + dx, ny = yy + dy; if (nx < 0 || ny < 0 || nx >= sw || ny >= sh) continue;
                const nk = ny * sw + nx; if (tp[nk * 4 + 3] < STRONG || lab[nk] >= 0) continue;
                lab[nk] = comps.length; q.push(nx, ny);
              }
            }
            comps.push(cp);
          }
          const main = comps.reduce((a, b) => (b.n > a.n ? b : a), comps[0]);
          const sleepy = /^(sleep|doze)/.test(name);
          let top = sh, bot = 0;
          for (const cp of comps) {
            // Мелочь, и отдельные небольшие куски у головы вне кадров сна («Z», нарисованные по ошибке)
            const nearHead = cp.top < main.top + (main.bot - main.top) * 0.3;
            const drop = cp !== main && (cp.n < (sleepy ? 6 : 80) || (!sleepy && ((cp.bot < main.top + 8 && cp.n < 3000) || (nearHead && cp.n < 500))));
            if (drop) {
              for (let i = 0; i < cp.pts.length; i += 2) {
                const x = cp.pts[i], y = cp.pts[i + 1];
                tp[(y * sw + x) * 4 + 3] = 0;
                // и полупрозрачную кайму вокруг куска
                for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
                  const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= sw || ny >= sh) continue;
                  const nk = (ny * sw + nx) * 4; if (tp[nk + 3] < STRONG) tp[nk + 3] = 0;
                }
              }
              continue;
            }
            if (cp.top < top) top = cp.top; if (cp.bot > bot) bot = cp.bot;
          }
          tg.putImageData(td, 0, 0);
          const o = document.createElement('canvas'); o.width = CW; o.height = CH;
          const og = o.getContext('2d'); og.imageSmoothingEnabled = true; og.imageSmoothingQuality = 'high';
          const h2 = bot - top + 1;
          og.drawImage(t, 0, top, sw, h2, CW / 2 - (f.cx - f.x0) * scale, CH - 3 - (sh - top) * scale, sw * scale, h2 * scale);
          anim[name] = o.toDataURL('image/png');
        }
        const emo = ${JSON.stringify(emo)}, moved = {};
        for (const [name, src] of Object.entries(emo)) {
          const im = new Image(); im.src = src; await im.decode();
          const o = document.createElement('canvas'); o.width = CW; o.height = CH;
          o.getContext('2d').drawImage(im, 0, pad);
          moved[name] = o.toDataURL('image/png');
        }
        return { anim, moved };
      })()`);
    fs.mkdirSync(path.join(emoDir, 'anim', 'src'), { recursive: true });
    for (const [name, data] of Object.entries(out.anim)) {
      const buf = Buffer.from(data.split(',')[1], 'base64');
      fs.writeFileSync(path.join(emoDir, 'anim', name + '.png'), buf);
      // Кадры лица — ещё и исходниками для tools/anim-face.js (он собирает из них чистые моргание и речь)
      if (NAMES[1].includes(name)) fs.writeFileSync(path.join(emoDir, 'anim', 'src', name + '.png'), buf);
    }
    for (const [to, from] of Object.entries(COPY[p] || {})) fs.copyFileSync(path.join(emoDir, 'anim', from + '.png'), path.join(emoDir, 'anim', to + '.png'));
    // Эмоции в новом стиле (assets/emotions-sheet-<имя>.png) режет tools/slice-emotions.js — их не трогаем,
    // старые эмоции перекладываем на новый холст, только если нового листа нет
    const newEmo = fs.existsSync(path.join(ROOT, 'assets', `emotions-sheet-${p}.png`));
    if (!newEmo) for (const [name, data] of Object.entries(out.moved)) fs.writeFileSync(path.join(emoDir, name + '.png'), Buffer.from(data.split(',')[1], 'base64'));
    else console.log(`${p}: эмоции — из нового листа; если холст изменился, запустите tools/slice-emotions.js`);
    fs.writeFileSync(metaPath, JSON.stringify({ ...meta, baseH, h: CH, anim: NAMES.flat() }, null, 2));
    console.log(`${p}: холст ${CW}x${CH} (запас сверху ${pad}px), кадров анимации ${plan.length}`);
  }
  app.quit();
});
