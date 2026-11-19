// Нарезает дополнительные листы анимации (прозрачный PNG, ряды по 8 кадров):
//   assets/held-sheet-<имя>.png — «вишу и вырываюсь»  → anim/held1..held8
//   assets/fall-sheet.png       — «падение»: ряд 1 Патрик, ряд 2 Тереза → anim/fall1..fall8
// Кадры кладутся на тот же холст, что и остальная анимация (assets/<имя>/frames.json), в том же масштабе.
// Выравнивание: в воздухе — по центру массы фигуры (тело не скачет, пока он вырывается или летит);
// на земле (падение 5–8) — ногами на линию земли и центром туловища в центр холста.
// Куски фигуры и значки (звёздочки, линии движения) собираются по близости — как в slice-emotions.js.
// Запуск: node_modules\electron\dist\electron.exe tools\slice-extra.js
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const A = (f) => path.join(ROOT, 'assets', f);
const TARGET_H = { patrick: 233, teresa: 231 };
const SOLID = 110;

// Что резать: лист, ряд (0 — верхний), имена, как выравнивать, по какому кадру мерить рост
const JOBS = [
  { p: 'patrick', sheet: 'held-sheet-patrick.png', row: 0, prefix: 'held', air: [0, 1, 2, 3, 4, 5, 6, 7], ref: 5, refK: 1.0 },
  { p: 'teresa', sheet: 'held-sheet-teresa.png', row: 0, prefix: 'held', air: [0, 1, 2, 3, 4, 5, 6, 7], ref: 5, refK: 1.0 },
  { p: 'patrick', sheet: 'fall-sheet.png', row: 0, prefix: 'fall', air: [0, 1, 2, 3], ref: 7, refK: 1.0 },
  { p: 'teresa', sheet: 'fall-sheet.png', row: 1, prefix: 'fall', air: [0, 1, 2, 3], ref: 7, refK: 1.0 },
  // Кружится голова: 1–3 — трясут / обмяк в воздухе, 4–8 — шатается на земле
  { p: 'patrick', sheet: 'dizzy-sheet.png', row: 0, prefix: 'dizzy', air: [0, 1, 2], ref: 7, refK: 1.0 },
  { p: 'teresa', sheet: 'dizzy-sheet.png', row: 1, prefix: 'dizzy', air: [0, 1, 2], ref: 7, refK: 1.0 },
  // Сидит: стоячего кадра на листе нет — масштаб по ширине головы (как у anim/stand.png),
  // по горизонтали — по центру головы (ноги вытянуты вбок, туловище не годится)
  { p: 'patrick', sheet: 'sit-sheet.png', row: 0, prefix: 'sit', air: [], ref: 1, head: true },
  { p: 'teresa', sheet: 'sit-sheet.png', row: 1, prefix: 'sit', air: [], ref: 1, head: true },
];
// Можно резать только часть: electron tools\slice-extra.js dizzy
const ONLY = process.argv.slice(2).find((a) => /^[a-z]+$/.test(a));

process.on('unhandledRejection', (e) => { console.error('ошибка:', e && e.message); app.exit(1); });

app.whenReady().then(async () => {
  const w = new BrowserWindow({ show: false });
  await w.loadURL('about:blank');
  for (const job of JOBS) {
    if (ONLY && job.prefix !== ONLY) continue;
    if (!fs.existsSync(A(job.sheet))) { console.log(`${job.p} ${job.prefix}: нет ${job.sheet}`); continue; }
    const meta = JSON.parse(fs.readFileSync(A(`${job.p}/frames.json`), 'utf8'));
    const r = await w.webContents.executeJavaScript(`
      (async () => {
        const job = ${JSON.stringify(job)};
        const img = new Image(); img.src = ${JSON.stringify('data:image/png;base64,' + fs.readFileSync(A(job.sheet)).toString('base64'))}; await img.decode();
        const W = img.width, H = img.height;
        const c = document.createElement('canvas'); c.width = W; c.height = H;
        const g = c.getContext('2d'); g.drawImage(img, 0, 0);
        const px = g.getImageData(0, 0, W, H).data;
        // Куски по непрозрачным пикселям
        const lab = new Int32Array(W * H).fill(-1), comps = [];
        for (let k = 0; k < W * H; k++) {
          if (px[k * 4 + 3] < ${SOLID} || lab[k] >= 0) continue;
          const cp = { n: 0, x0: W, x1: 0, y0: H, y1: 0, sx: 0, sy: 0, id: comps.length };
          const st = [k]; lab[k] = cp.id;
          while (st.length) {
            const q = st.pop(), x = q % W, y = (q - x) / W;
            cp.n++; cp.sx += x; cp.sy += y;
            if (x < cp.x0) cp.x0 = x; if (x > cp.x1) cp.x1 = x; if (y < cp.y0) cp.y0 = y; if (y > cp.y1) cp.y1 = y;
            for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
              const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
              const nk = ny * W + nx; if (px[nk * 4 + 3] < ${SOLID} || lab[nk] >= 0) continue;
              lab[nk] = cp.id; st.push(nk);
            }
          }
          cp.cx = cp.sx / cp.n; cp.cy = cp.sy / cp.n;
          comps.push(cp);
        }
        // Ряды листа: по вертикали крупные куски делятся на полосы
        const big = comps.filter((cp) => cp.n > 3000).sort((a, b) => a.cy - b.cy);
        const rows = [];
        for (const b of big) { const r = rows.find((r) => Math.abs(r.cy - b.cy) < H / 4); if (r) r.items.push(b); else rows.push({ cy: b.cy, items: [b] }); }
        rows.sort((a, b) => a.cy - b.cy);
        const row = rows[job.row];
        if (!row) return { error: 'нет ряда ' + job.row };
        const bodies = row.items.sort((a, b) => b.n - a.n).slice(0, 8).sort((a, b) => a.cx - b.cx);
        // Остальное (значки, линии движения, отдельные пряди) — группами, к ближайшей по краю фигуре этого ряда
        const owner = new Int32Array(comps.length).fill(-1);
        bodies.forEach((b, i) => { owner[b.id] = i; });
        const rowY0 = Math.min(...bodies.map((b) => b.y0)) - 80, rowY1 = Math.max(...bodies.map((b) => b.y1)) + 40;
        const small = comps.filter((cp) => owner[cp.id] < 0 && cp.n >= 12 && cp.cy > rowY0 && cp.cy < rowY1);
        const parent = new Map(small.map((cp) => [cp.id, cp.id]));
        const find = (a) => { while (parent.get(a) !== a) a = parent.get(a); return a; };
        const gap = (a, b) => Math.max(0, Math.max(a.x0, b.x0) - Math.min(a.x1, b.x1)) + Math.max(0, Math.max(a.y0, b.y0) - Math.min(a.y1, b.y1));
        for (let i = 0; i < small.length; i++) for (let j = i + 1; j < small.length; j++) if (gap(small[i], small[j]) <= 22) parent.set(find(small[i].id), find(small[j].id));
        const groups = new Map();
        for (const cp of small) { const r0 = find(cp.id); if (!groups.has(r0)) groups.set(r0, []); groups.get(r0).push(cp); }
        for (const list of groups.values()) {
          const n = list.reduce((s, cp) => s + cp.n, 0), gx = list.reduce((s, cp) => s + cp.cx * cp.n, 0) / n;
          const gx0 = Math.min(...list.map((cp) => cp.x0)), gx1 = Math.max(...list.map((cp) => cp.x1));
          let best = 0, bd = Infinity;
          bodies.forEach((b, i) => { const edge = Math.max(0, Math.max(gx0, b.x0) - Math.min(gx1, b.x1)); const d = edge * 10 + Math.abs(gx - b.cx) / 100; if (d < bd) { bd = d; best = i; } });
          for (const cp of list) owner[cp.id] = best;
        }
        const fr = bodies.map((b) => ({ ...b, ux0: b.x0, ux1: b.x1, uy0: b.y0, uy1: b.y1 }));
        for (const cp of comps) { const i = owner[cp.id]; if (i < 0) continue; const f = fr[i];
          f.ux0 = Math.min(f.ux0, cp.x0); f.ux1 = Math.max(f.ux1, cp.x1); f.uy0 = Math.min(f.uy0, cp.y0); f.uy1 = Math.max(f.uy1, cp.y1); }
        // Центр туловища (для кадров на земле) — средний x фигуры в средней части роста
        for (const f of fr) {
          let sx = 0, n = 0;
          const a = Math.round(f.y1 - (f.y1 - f.y0) * 0.62), b = Math.round(f.y1 - (f.y1 - f.y0) * 0.32);
          for (let y = a; y <= b; y++) for (let x = f.x0; x <= f.x1; x++) if (lab[y * W + x] === f.id) { sx += x; n++; }
          f.tcx = n ? sx / n : f.cx;
        }
        const ref = fr[job.ref];
        let scale = ${TARGET_H[job.p]} * (job.refK || 1) / (ref.y1 - ref.y0 + 1);
        // Ширина головы: самая широкая строка в полосе сверху фигуры высотой band
        const headW = (rows, y0, band) => { let m = 0; for (let y = y0; y < y0 + band && y < rows.length; y++) m = Math.max(m, rows[y]); return m; };
        const rowsOf = (data, w, h, x0, x1, test) => {
          const out = [];
          for (let y = 0; y < h; y++) { let a = -1, b = -1; for (let x = x0; x <= x1; x++) if (test(y * w + x)) { if (a < 0) a = x; b = x; } out.push(a < 0 ? 0 : b - a + 1); }
          return out;
        };
        if (job.head) {
          const st = new Image(); st.src = ${JSON.stringify(job.p && fs.existsSync(A(`${job.p}/anim/stand.png`)) ? 'data:image/png;base64,' + fs.readFileSync(A(`${job.p}/anim/stand.png`)).toString('base64') : '')}; await st.decode();
          const sc = document.createElement('canvas'); sc.width = st.width; sc.height = st.height;
          const sg = sc.getContext('2d'); sg.drawImage(st, 0, 0);
          const sd = sg.getImageData(0, 0, st.width, st.height).data;
          const sRows = rowsOf(sd, st.width, st.height, 0, st.width - 1, (k) => sd[k * 4 + 3] >= ${SOLID});
          const sTop = sRows.findIndex((v) => v > 0);
          const band = ${TARGET_H[job.p]} * 0.22;          // верх головы до уровня глаз
          const want = headW(sRows, sTop, band);
          const rRows = rowsOf(px, W, H, ref.x0, ref.x1, (k) => lab[k] === ref.id).slice(0);
          for (let it = 0; it < 3; it++) scale = want / headW(rRows, ref.y0, band / scale);
          // центр головы каждого кадра
          for (const f of fr) {
            let sx = 0, n = 0; const y1 = Math.round(f.y0 + band / scale);
            for (let y = f.y0; y < y1; y++) for (let x = f.x0; x <= f.x1; x++) if (lab[y * W + x] === f.id) { sx += x; n++; }
            f.tcx = n ? sx / n : f.cx;
          }
        }
        const CW = ${meta.w}, CH = ${meta.h}, T = ${TARGET_H[job.p]};
        // В воздухе центр массы — там же, где центр массы стоящей фигуры (≈ 45% роста от земли)
        const airX = CW / 2, airY = CH - 3 - T * 0.45;
        // Висящие ноги длиннее стоящих — если «воздушные» кадры не влезают снизу, поднимаем их все
        // на одну общую величину (чтобы между кадрами ничего не скакало)
        let lift = 0;
        fr.forEach((f, i) => {
          if (!job.air.includes(i)) return;
          const bottom = airY - (f.cy - f.uy0) * scale + (f.uy1 - f.uy0 + 1) * scale;
          lift = Math.max(lift, bottom - (CH - 2));
        });
        const out = [], over = [];
        fr.forEach((f, i) => {
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
          let dx, dy;
          if (job.air.includes(i)) { dx = airX - (f.cx - f.ux0) * scale; dy = airY - lift - (f.cy - f.uy0) * scale; }
          else { dx = CW / 2 - (f.tcx - f.ux0) * scale; dy = CH - 3 - (f.y1 - f.uy0 + 1) * scale; }
          og.drawImage(t, dx, dy, fw * scale, fh * scale);
          if (dy < 0 || dx < 0 || dx + fw * scale > CW || dy + fh * scale > CH) over.push(i + 1 + ':' + Math.round(dy) + '/' + Math.round(dx) + '..' + Math.round(dx + fw * scale) + 'x' + Math.round(dy + fh * scale));
          out.push(o.toDataURL('image/png'));
        });
        return { n: fr.length, scale, out, over, lift: Math.round(lift) };
      })()`);
    if (r.error) { console.log(`${job.p} ${job.prefix}: ${r.error}`); continue; }
    const dir = A(`${job.p}/anim`);
    r.out.forEach((d, i) => fs.writeFileSync(path.join(dir, `${job.prefix}${i + 1}.png`), Buffer.from(d.split(',')[1], 'base64')));
    console.log(`${job.p} ${job.prefix}: кадров ${r.n}, масштаб ${r.scale.toFixed(3)}, подняты на ${r.lift}px${r.over.length ? ', выходят за холст: ' + r.over.join(' ') : ''}`);
  }
  app.quit();
});
