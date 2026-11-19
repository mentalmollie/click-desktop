// Нарезает листы эмоций в новом стиле: assets/emotions-sheet-<имя>.png — один ряд из 13 кадров
// на прозрачном фоне. Кадры кладутся на тот же холст, что и кадры анимации (assets/<имя>/frames.json):
// тот же рост фигуры, ноги на той же линии, центр туловища — в центре холста. Значки эмоций («!», капли,
// лампочка) находятся как отдельные куски и достаются ближайшей фигуре — даже если стоят между кадрами.
// Старые кадры эмоций уже сохранены в assets/<имя>/orig (их делает slice-anim.js).
// Запуск: node_modules\electron\dist\electron.exe tools\slice-emotions.js
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const NAMES = ['idle', 'joy', 'sad', 'angry', 'shock', 'shy', 'sleep', 'worry', 'smug', 'overload', 'think', 'idea', 'tip'];
const TARGET_H = { patrick: 233, teresa: 231 };   // рост фигуры — как в кадрах анимации
const SOLID = 110;                                  // полупрозрачная кайма от вырезания фона — не считаем

process.on('unhandledRejection', (e) => { console.error('ошибка:', e && e.message); app.exit(1); });

app.whenReady().then(async () => {
  const w = new BrowserWindow({ show: false });
  await w.loadURL('about:blank');
  for (const p of ['patrick', 'teresa']) {
    const sheet = path.join(ROOT, 'assets', `emotions-sheet-${p}.png`);
    if (!fs.existsSync(sheet)) { console.log(`${p}: нет листа`); continue; }
    const meta = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets', p, 'frames.json'), 'utf8'));
    const r = await w.webContents.executeJavaScript(`
      (async () => {
        const img = new Image(); img.src = ${JSON.stringify('data:image/png;base64,' + fs.readFileSync(sheet).toString('base64'))}; await img.decode();
        const W = img.width, H = img.height;
        const c = document.createElement('canvas'); c.width = W; c.height = H;
        const g = c.getContext('2d'); g.drawImage(img, 0, 0);
        const id = g.getImageData(0, 0, W, H), px = id.data;
        // Куски (8-связность) по непрозрачным пикселям
        const lab = new Int32Array(W * H).fill(-1), comps = [];
        for (let k = 0; k < W * H; k++) {
          if (px[k * 4 + 3] < ${SOLID} || lab[k] >= 0) continue;
          const cp = { n: 0, x0: W, x1: 0, y0: H, y1: 0, sx: 0, id: comps.length };
          const st = [k]; lab[k] = cp.id;
          while (st.length) {
            const q = st.pop(), x = q % W, y = (q - x) / W;
            cp.n++; cp.sx += x;
            if (x < cp.x0) cp.x0 = x; if (x > cp.x1) cp.x1 = x; if (y < cp.y0) cp.y0 = y; if (y > cp.y1) cp.y1 = y;
            for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
              const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
              const nk = ny * W + nx; if (px[nk * 4 + 3] < ${SOLID} || lab[nk] >= 0) continue;
              lab[nk] = cp.id; st.push(nk);
            }
          }
          cp.cx = cp.sx / cp.n;
          comps.push(cp);
        }
        // Фигуры — 13 самых крупных кусков; остальное (значки, пряди) — ближайшей фигуре по горизонтали
        const bodies = [...comps].sort((a, b) => b.n - a.n).slice(0, ${NAMES.length}).sort((a, b) => a.cx - b.cx);
        const owner = new Int32Array(comps.length).fill(-1);
        bodies.forEach((b, i) => { owner[b.id] = i; });
        // Значок бывает из нескольких кусков («z z», лампочка с лучами): сначала собираем близкие куски
        // в одну группу (зазор до 22 px), потом всю группу отдаём фигуре, ближайшей к центру группы
        const small = comps.filter((cp) => owner[cp.id] < 0 && cp.n >= 12);
        const parent = new Map(small.map((cp) => [cp.id, cp.id]));
        const find = (a) => { while (parent.get(a) !== a) a = parent.get(a); return a; };
        const gap = (a, b) => Math.max(0, Math.max(a.x0, b.x0) - Math.min(a.x1, b.x1)) + Math.max(0, Math.max(a.y0, b.y0) - Math.min(a.y1, b.y1));
        for (let i = 0; i < small.length; i++) for (let j = i + 1; j < small.length; j++) {
          if (gap(small[i], small[j]) <= 22) parent.set(find(small[i].id), find(small[j].id));
        }
        const groups = new Map();
        for (const cp of small) { const r0 = find(cp.id); if (!groups.has(r0)) groups.set(r0, []); groups.get(r0).push(cp); }
        for (const list of groups.values()) {
          const n = list.reduce((s, cp) => s + cp.n, 0), gx = list.reduce((s, cp) => s + cp.cx * cp.n, 0) / n;
          const gx0 = Math.min(...list.map((cp) => cp.x0)), gx1 = Math.max(...list.map((cp) => cp.x1));
          // Ближе всего к краю фигуры (поднятая рука, голова), при равенстве — к её центру
          let best = 0, bd = Infinity;
          bodies.forEach((b, i) => {
            const edge = Math.max(0, Math.max(gx0, b.x0) - Math.min(gx1, b.x1));
            const d = edge * 10 + Math.abs(gx - b.cx) / 100;
            if (d < bd) { bd = d; best = i; }
          });
          for (const cp of list) owner[cp.id] = best;
        }
        const frames = bodies.map((b) => ({ ...b, ux0: b.x0, ux1: b.x1, uy0: b.y0, uy1: b.y1 }));
        for (const cp of comps) { const i = owner[cp.id]; if (i < 0) continue; const f = frames[i];
          f.ux0 = Math.min(f.ux0, cp.x0); f.ux1 = Math.max(f.ux1, cp.x1); f.uy0 = Math.min(f.uy0, cp.y0); f.uy1 = Math.max(f.uy1, cp.y1); }
        // Центр туловища — средний x пикселей фигуры в средней части роста
        for (const f of frames) {
          let sx = 0, n = 0;
          const a = Math.round(f.y1 - (f.y1 - f.y0) * 0.62), b = Math.round(f.y1 - (f.y1 - f.y0) * 0.32);
          for (let y = a; y <= b; y++) for (let x = f.x0; x <= f.x1; x++) if (lab[y * W + x] === f.id) { sx += x; n++; }
          f.tcx = n ? sx / n : f.cx;
        }
        const ref = frames[0];
        const scale = ${TARGET_H[p]} / (ref.y1 - ref.y0 + 1);
        const CW = ${meta.w}, CH = ${meta.h};
        const out = [], over = [];
        frames.forEach((f, i) => {
          // Только пиксели этой фигуры и её значков (соседские куски в ту же область не попадают)
          const fw = f.ux1 - f.ux0 + 1, fh = f.uy1 - f.uy0 + 1;
          const t = document.createElement('canvas'); t.width = fw; t.height = fh;
          const tg = t.getContext('2d'); const td = tg.createImageData(fw, fh);
          for (let y = f.uy0; y <= f.uy1; y++) for (let x = f.ux0; x <= f.ux1; x++) {
            const k = y * W + x, L = lab[k];
            if (L < 0 || owner[L] !== i) continue;
            const o = ((y - f.uy0) * fw + (x - f.ux0)) * 4;
            td.data[o] = px[k * 4]; td.data[o + 1] = px[k * 4 + 1]; td.data[o + 2] = px[k * 4 + 2]; td.data[o + 3] = 255;
          }
          tg.putImageData(td, 0, 0);
          const o = document.createElement('canvas'); o.width = CW; o.height = CH;
          const og = o.getContext('2d'); og.imageSmoothingEnabled = true; og.imageSmoothingQuality = 'high';
          // Ноги (низ фигуры) — на линию CH-3, центр туловища — в центр холста
          const dx = CW / 2 - (f.tcx - f.ux0) * scale, dy = CH - 3 - (f.y1 - f.uy0 + 1) * scale;
          og.drawImage(t, dx, dy, fw * scale, fh * scale);
          if (dy < 0 || dx < 0 || dx + fw * scale > CW) over.push(i + ':' + Math.round(dy) + '/' + Math.round(dx) + '..' + Math.round(dx + fw * scale));
          out.push(o.toDataURL('image/png'));
        });
        return { count: frames.length, comps: comps.length, scale, out, over, xs: frames.map((f) => Math.round(f.cx)) };
      })()`);
    const dir = path.join(ROOT, 'assets', p);
    r.out.forEach((d, i) => fs.writeFileSync(path.join(dir, NAMES[i] + '.png'), Buffer.from(d.split(',')[1], 'base64')));
    console.log(`${p}: кадров ${r.count}, кусков ${r.comps}, масштаб ${r.scale.toFixed(3)}, центры ${r.xs.join(',')}`);
    if (r.over.length) console.log(`  выходят за холст (кадр:верх/лево..право): ${r.over.join(' ')}`);
  }
  app.quit();
});
