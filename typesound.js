// Звук печати ответа в облачке ассистента — синтезируется на лету (Web Audio), без звуковых файлов.
//   typewriter — пишущая машинка: щелчки клавиш с разбросом, изредка «тяжёлый» удар, в конце длинного
//                ответа — тихий звонок каретки;
//   blip       — мягкие тональные «бип», как у персонажей в играх (у каждого ассистента своя высота).
// Используется в окне ассистента (assistant.js) и в настройках (образец при выборе).
const TypeSound = (() => {
  let ctx = null;
  let noiseBuf = null;
  let current = null;   // { master, timer } — что играет сейчас

  const ac = () => {
    if (!ctx) ctx = new AudioContext();
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  };
  const rnd = (a, b) => a + Math.random() * (b - a);

  function noise() {
    if (noiseBuf) return noiseBuf;
    const c = ac();
    noiseBuf = c.createBuffer(1, Math.round(c.sampleRate * 0.06), c.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return noiseBuf;
  }

  // Удар клавиши: короткий шум через полосовой фильтр (металлический «щёлк») + низкий «тук» корпуса
  function key(out, t, vol, heavy) {
    const c = ac();
    const src = c.createBufferSource();
    src.buffer = noise();
    src.playbackRate.value = rnd(0.85, 1.2);
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = rnd(1700, 3200) * (heavy ? 0.75 : 1);
    bp.Q.value = rnd(1.2, 2.5);
    const g = c.createGain();
    const peak = vol * (heavy ? 1.3 : rnd(0.7, 1));
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0008, t + (heavy ? 0.06 : 0.035));
    src.connect(bp).connect(g).connect(out);
    src.start(t);
    src.stop(t + 0.08);
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(rnd(110, 170) * (heavy ? 0.8 : 1), t);
    o.frequency.exponentialRampToValueAtTime(60, t + 0.03);
    const og = c.createGain();
    og.gain.setValueAtTime(0, t);
    og.gain.linearRampToValueAtTime(vol * (heavy ? 0.9 : 0.5), t + 0.002);
    og.gain.exponentialRampToValueAtTime(0.0008, t + 0.04);
    o.connect(og).connect(out);
    o.start(t);
    o.stop(t + 0.05);
  }

  // Звонок каретки: две затухающие «колокольные» гармоники
  function bell(out, t, vol) {
    const c = ac();
    for (const [f, k] of [[2093, 1], [3140, 0.45], [4186, 0.2]]) {
      const o = c.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      const g = c.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(vol * 0.35 * k, t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0005, t + 0.9);
      o.connect(g).connect(out);
      o.start(t);
      o.stop(t + 0.95);
    }
  }

  // «Бип»: короткий мягкий тон с лёгким разбросом высоты — как «речь» персонажа
  function blip(out, t, vol, base) {
    const c = ac();
    const o = c.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(base * rnd(0.9, 1.25), t);
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol * 0.6, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0008, t + 0.055);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + 0.07);
  }

  function stop() {
    if (!current) return;
    clearTimeout(current.timer);
    try {
      const c = ac();
      current.master.gain.setTargetAtTime(0, c.currentTime, 0.01);
      const m = current.master;
      setTimeout(() => { try { m.disconnect(); } catch {} }, 200);
    } catch {}
    current = null;
  }

  // Играть «печать» ms миллисекунд. opts: { kind, volume (0..1), pitch: 'low'|'high', bell }
  function play(ms, opts = {}) {
    stop();
    const kind = opts.kind || 'typewriter';
    if (kind === 'off' || ms <= 0) return;
    const vol = Math.max(0, Math.min(1, opts.volume ?? 0.4));
    if (!vol) return;
    const c = ac();
    const master = c.createGain();
    master.gain.value = 1;
    master.connect(c.destination);
    const me = { master, timer: null };
    current = me;
    const t0 = c.currentTime + 0.02;
    const end = t0 + ms / 1000;
    const base = opts.pitch === 'high' ? 330 : 220;
    // Расписываем удары заранее (точно по времени аудио), а не таймерами
    let t = t0, n = 0;
    while (t < end) {
      if (kind === 'blip') {
        blip(master, t, vol, base);
        t += rnd(0.065, 0.095);
      } else {
        // Иногда пауза между «словами»
        const heavy = n > 0 && Math.random() < 0.12;
        key(master, t, vol, heavy);
        t += Math.random() < 0.15 ? rnd(0.12, 0.2) : rnd(0.045, 0.085);
      }
      n++;
    }
    if (kind === 'typewriter' && opts.bell !== false && ms > 900) bell(master, end + 0.08, vol);
    me.timer = setTimeout(() => { if (current === me) current = null; try { master.disconnect(); } catch {} }, ms + 1400);
  }

  return { play, stop };
})();
