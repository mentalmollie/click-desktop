// Нарезает лист спрайтов ассистента (assets/<имя>/sheet.webp) на отдельные PNG с прозрачным фоном.
// Запуск: node_modules\electron\dist\electron.exe tools\slice-patrick.js [имя] [кадр1,кадр2,...]
//   по умолчанию — patrick; у Терезы третий ряд другой: think,tip,idea
// Порядок кадров на листе — слева направо, сверху вниз; имена — по эмоциям.
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const args = process.argv.slice(2).filter((a) => !a.startsWith('-') && !a.endsWith('.js'));
const DIR = path.join(__dirname, '..', 'assets', args[0] || 'patrick');
const NAMES = args[1] ? args[1].split(',') : [
  'idle', 'joy', 'sad', 'angry', 'shock',
  'shy', 'sleep', 'worry', 'smug', 'overload',
  'think', 'idea', 'tip',
];
const OUT_H = 240;   // высота кадра на выходе (на экране показываем вдвое меньше — чётко и на 4K)

const pageScript = `
(async () => {
  const img = new Image();
  img.src = ${JSON.stringify('data:image/webp;base64,' + fs.readFileSync(path.join(DIR, 'sheet.webp')).toString('base64'))};
  await img.decode();
  const W = img.width, H = img.height;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d'); g.drawImage(img, 0, 0);
  const id = g.getImageData(0, 0, W, H), px = id.data;
  const at = (x, y) => (y * W + x) * 4;
  const bg = [px[at(3,3)], px[at(3,3)+1], px[at(3,3)+2]];
  const dist = (i) => Math.hypot(px[i]-bg[0], px[i+1]-bg[1], px[i+2]-bg[2]);

  // 1) Заливка фона от краёв: чёрный контур персонажа её останавливает
  const bgMask = new Uint8Array(W * H);
  const stack = [];
  for (let x = 0; x < W; x++) { stack.push(x, 0, x, H - 1); }
  for (let y = 0; y < H; y++) { stack.push(0, y, W - 1, y); }
  while (stack.length) {
    const y = stack.pop(), x = stack.pop();
    if (x < 0 || y < 0 || x >= W || y >= H) continue;
    const k = y * W + x;
    if (bgMask[k] || dist(k * 4) > 34) continue;
    bgMask[k] = 1;
    stack.push(x + 1, y, x - 1, y, x, y + 1, x, y - 1);
  }
  // 2) Замкнутые островки фона (между рукой и телом) — только почти точное совпадение цвета
  for (let k = 0; k < W * H; k++) if (!bgMask[k] && dist(k * 4) < 14) bgMask[k] = 1;
  for (let k = 0; k < W * H; k++) if (bgMask[k]) px[k * 4 + 3] = 0;
  g.putImageData(id, 0, 0);

  const solid = (x, y) => !bgMask[y * W + x];
  // Полосы-ряды: строки без пикселей персонажа разделяют ряды
  const rowN = []; for (let y = 0; y < H; y++) { let n = 0; for (let x = 0; x < W; x++) if (solid(x, y)) n++; rowN.push(n); }
  let bands = []; let s = -1;
  for (let y = 0; y <= H; y++) { const on = y < H && rowN[y] > 2; if (on && s < 0) s = y; if (!on && s >= 0) { if (y - s > 60) bands.push([s, y]); s = -1; } }
  // Ряды могут касаться друг друга значками («?», лампочка) — слишком высокую полосу режем по самой пустой строке
  const split = [];
  for (const [a, b] of bands) {
    if (b - a < 450) { split.push([a, b]); continue; }
    let best = a + 250, bn = 1e9;
    for (let y = a + 250; y < b - 250; y++) if (rowN[y] < bn) { bn = rowN[y]; best = y; }
    split.push([a, best], [best, b]);
  }
  bands = split;

  const sprites = [];
  for (const [y0, y1] of bands) {
    const colHas = []; for (let x = 0; x < W; x++) { let n = 0; for (let y = y0; y < y1; y++) if (solid(x, y)) n++; colHas.push(n > 1); }
    let segs = []; s = -1;
    for (let x = 0; x <= W; x++) { const on = x < W && colHas[x]; if (on && s < 0) s = x; if (!on && s >= 0) { segs.push([s, x]); s = -1; } }
    // Склеиваем мелкие куски (искры, лампочка, «!!») с ближайшим соседом и близкие куски друг с другом
    let changed = true;
    while (changed) {
      changed = false;
      for (let i = 0; i < segs.length; i++) {
        const w = segs[i][1] - segs[i][0];
        const gapL = i > 0 ? segs[i][0] - segs[i-1][1] : 1e9, gapR = i < segs.length - 1 ? segs[i+1][0] - segs[i][1] : 1e9;
        if (w < 150 || Math.min(gapL, gapR) < 12) {
          const j = gapL <= gapR ? i - 1 : i + 1;
          if (j < 0 || j >= segs.length) continue;
          const a = Math.min(i, j);
          segs.splice(a, 2, [Math.min(segs[i][0], segs[j][0]), Math.max(segs[i][1], segs[j][1])]);
          changed = true; break;
        }
      }
    }
    for (const [x0, x1] of segs) {
      // Убираем мелкие обрывки у нижнего края, не связанные с персонажем (лучи лампочки из ряда ниже)
      const lab = new Int32Array((x1 - x0) * (y1 - y0)).fill(-1);
      const comps = [];
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        const li = (y - y0) * (x1 - x0) + (x - x0);
        if (!solid(x, y) || lab[li] >= 0) continue;
        const comp = { n: 0, minx: x, maxx: x, miny: y, maxy: y, pts: [] };
        const st = [x, y]; lab[li] = comps.length;
        while (st.length) {
          const cy = st.pop(), cx = st.pop();
          comp.n++; comp.pts.push(cx, cy);
          comp.minx = Math.min(comp.minx, cx); comp.maxx = Math.max(comp.maxx, cx);
          comp.miny = Math.min(comp.miny, cy); comp.maxy = Math.max(comp.maxy, cy);
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
            const nx = cx + dx, ny = cy + dy;
            if (nx < x0 || ny < y0 || nx >= x1 || ny >= y1 || !solid(nx, ny)) continue;
            const ni = (ny - y0) * (x1 - x0) + (nx - x0);
            if (lab[ni] < 0) { lab[ni] = comps.length; st.push(nx, ny); }
          }
        }
        comps.push(comp);
      }
      const main = comps.reduce((a, b) => (b.n > a.n ? b : a));
      for (const cp of comps) {
        if (cp === main || cp.n > 2500) continue;
        const nearBottom = cp.miny > y0 + (y1 - y0) * 0.75;
        const apart = cp.maxx < main.minx + 20 || cp.minx > main.maxx - 20;
        if ((nearBottom && apart) || cp.n < 60) {
          for (let i = 0; i < cp.pts.length; i += 2) { const k = cp.pts[i + 1] * W + cp.pts[i]; bgMask[k] = 1; px[k * 4 + 3] = 0; }
        }
      }
      g.putImageData(id, 0, 0);
      let top = y1, bot = y0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (solid(x, y)) { if (y < top) top = y; if (y > bot) bot = y; }
      // Опорная точка — середина ног: центр непрозрачных пикселей в нижних 20 строках
      let sx = 0, n = 0;
      for (let y = bot - 20; y <= bot; y++) for (let x = x0; x < x1; x++) if (solid(x, y)) { sx += x; n++; }
      sprites.push({ x0, x1, top, bot, foot: n ? sx / n : (x0 + x1) / 2 });
    }
  }

  // Все кадры — на одном холсте одинакового размера, ногами в одну точку
  const scale = ${OUT_H} / Math.max(...sprites.map((p) => p.bot - p.top + 1));
  const halfW = Math.max(...sprites.map((p) => Math.max(p.foot - p.x0, p.x1 - p.foot)));
  const outW = Math.ceil(halfW * 2 * scale) + 4, outH = ${OUT_H} + 4;
  const out = [];
  for (const p of sprites) {
    const o = document.createElement('canvas'); o.width = outW; o.height = outH;
    const og = o.getContext('2d');
    og.imageSmoothingEnabled = true; og.imageSmoothingQuality = 'high';
    const w = p.x1 - p.x0, h = p.bot - p.top + 1;
    const dx = outW / 2 - (p.foot - p.x0) * scale, dy = outH - 2 - h * scale;
    og.drawImage(c, p.x0, p.top, w, h, dx, dy, w * scale, h * scale);
    out.push(o.toDataURL('image/png'));
  }
  return { count: sprites.length, bands: bands.length, outW, outH, out, boxes: sprites.map((p) => [p.x0, p.x1, p.top, p.bot]) };
})()`;

app.whenReady().then(async () => {
  const w = new BrowserWindow({ show: false });
  await w.loadURL('about:blank');
  const r = await w.webContents.executeJavaScript(pageScript);
  console.log(JSON.stringify({ count: r.count, bands: r.bands, size: [r.outW, r.outH], boxes: r.boxes }));
  r.out.forEach((d, i) => {
    const name = NAMES[i] || 'extra' + i;
    fs.writeFileSync(path.join(DIR, name + '.png'), Buffer.from(d.split(',')[1], 'base64'));
  });
  fs.writeFileSync(path.join(DIR, 'frames.json'), JSON.stringify({ w: r.outW, h: r.outH, frames: NAMES.slice(0, r.count) }, null, 2));
  app.quit();
});
