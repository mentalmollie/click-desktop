// Regression checks for window geometry, autohide and hover. No desktop changes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
const renderer = fs.readFileSync(path.join(__dirname, '..', 'renderer.js'), 'utf8');
function section(source, start, end) {
  return source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
}
function fixture(displayScale = 1.25) {
  let bounds = { x: 0, y: 0, width: 900, height: 54 }, zoom = 1;
  let cursor = { x: -100, y: -100 };
  const calls = { bounds: 0, raised: 0, positioned: 0, groundUpdates: [] };
  const assistantSize = { width: 360, height: 320 };
  const handlers = {};
  const screenRect = { x: 0, y: 0, width: Math.round(1920 / displayScale), height: Math.round(1080 / displayScale) };
  const display = { workArea: { ...screenRect }, bounds: { ...screenRect }, scaleFactor: displayScale };
  const win = {
    isDestroyed: () => false, isVisible: () => true,
    getBounds: () => ({ ...bounds }),
    setBounds: (b) => { bounds = { ...b }; calls.bounds++; },
    setPosition: (x, y) => { bounds = { ...bounds, x, y }; calls.bounds++; },
    showInactive() {},
    webContents: { getZoomFactor: () => zoom, setZoomFactor: (s) => { zoom = s; }, send() {} },
  };
  const assistWin = {
    isDestroyed: () => false, isVisible: () => true,
    setPosition: (x, y) => { calls.positioned++; calls.assist = { x, y }; },
    moveTop: () => calls.raised++, getBounds: () => ({ ...(calls.assist || { x: 0, y: 0 }), ...assistantSize }),
    webContents: { send: (channel, data) => calls.groundUpdates.push({ channel, data }), getZoomFactor: () => 1 },
    setIgnoreMouseEvents() {},
  };
  const ctx = vm.createContext({ win, assistWin, config: {
    appearance: { scale: 0.85, margin: 4, width: 'full', position: 'bottom', blur: false, autoHide: true },
    assistant: { pos: 0.88, mode: 'sit' },
  }, screen: { getPrimaryDisplay: () => display, getCursorScreenPoint: () => cursor },
  app: {}, panel: null, panelMenuOpen: false, appbarRect: null, Date,
  updateAppbar() {}, saveConfig() {}, setInterval() {}, ipcMain: {
    on: (name, fn) => { handlers[name] = fn; }, handle: (name, fn) => { handlers[name] = fn; },
  },
  alive: (w) => !!w && !w.isDestroyed(),
  dockSize: [], dockTarget: null, dockShown: true, anim: null, dockSlideId: 0, hideAt: 0,
  ASSIST_W: 360, ASSIST_H: 320, ASSIST_SINK: 10, ASSIST_EDGE_GAP: 4,
  assistFlying: false, assistFlight: null, assistFlightId: 0, walkX: null,
  walking: () => false,
  });
  vm.runInContext([
    section(main, 'function placeWindow(', '// ---------- Автоматическое'),
    section(main, 'const autoHideOn =', '// Окно существует'),
    section(main, 'function autoHideTick()', 'setInterval(autoHideTick'),
    section(main, 'function raiseAssistant()', '// Границы прогулки'),
    section(main, 'function walkBounds()', '// Летит'),
    section(main, 'function assistLimits()', '// Шаг прогулки'),
    section(main, 'function assistFlightBounds()', '// Перетаскивание Патрика вдоль панели'),
    section(main, 'let assistRects =', 'setInterval(assistHitTick'),
  ].join('\n'), ctx);
  return { ctx, calls, display, win, assistantSize, moveCursor: (c) => { cursor = c; }, run: (s) => vm.runInContext(s, ctx),
    frame: (id, y, last = false, sender = win.webContents) => handlers['dock:pos']({ sender }, id, y, last),
    flyStart: (grab) => handlers['assist:flyStart']({ sender: assistWin.webContents }, grab),
    holdMove: (id) => handlers['assist:holdMove']({ sender: assistWin.webContents }, id),
    flyRelease: (id) => handlers['assist:flyRelease']({ sender: assistWin.webContents }, id),
    flyMove: (id, x, y) => handlers['assist:flyMove']({ sender: assistWin.webContents }, id, x, y),
    flyEnd: (id, x) => handlers['assist:flyEnd']({ sender: assistWin.webContents }, id, x),
  };
}

for (const displayScale of [1, 1.25, 1.5]) {
for (const scale of [0.85, 1, 1.25, 1.5]) {
  for (const width of ['auto', 'full']) {
    const f = fixture(displayScale);
    f.ctx.config.appearance.scale = scale;
    f.ctx.config.appearance.width = width;
    f.run('placeWindow(1200.25, 54, 1200.25)');
    const before = f.win.getBounds(), count = f.calls.bounds;
    for (let i = 0; i < 50; i++) {
      f.moveCursor({ x: before.x + 30, y: before.y + 5 });
      f.run('assistHitTick(); placeWindow(1200.25, 54, 1200.25)');
      f.moveCursor({ x: 0, y: 0 });
      f.run('assistHitTick()');
    }
    assert.deepEqual(f.win.getBounds(), before, `hover changes bounds at ${scale}/${width}`);
    assert.equal(f.calls.bounds, count, 'unchanged geometry must not resize the native window');
    assert.ok(f.calls.raised > 0, 'assistant must be raised over the dock');
  }
}
}
for (const position of ['top', 'bottom']) {
  const f = fixture();
  f.ctx.config.appearance.position = position;
  f.run('placeWindow(1200, 54, 1200)');
  f.run('slideDock(false); anim.until = 0; autoHideTick()');
  const hiddenY = f.win.getBounds().y, hiddenAssistY = f.calls.assist.y;
  f.run('showDock(); anim.until = 0; autoHideTick()');
  assert.notEqual(f.win.getBounds().y, hiddenY);
  assert.notEqual(f.calls.assist.y, hiddenAssistY, 'assistant must follow the dock during autohide');
  assert.ok(hiddenAssistY + f.assistantSize.height <= f.display.bounds.y + f.display.bounds.height - 4);
  f.run('slideDock(false); placeWindow(1300, 60, 1300); anim.until = 0; autoHideTick()');
  assert.equal(f.win.getBounds().height, Math.ceil(60 * 0.85) + (position === 'bottom' ? 4 : 0));
}
for (const position of ['top', 'bottom']) {
  const f = fixture(1.25);
  f.ctx.config.appearance.position = position;
  f.run('placeWindow(1200, 54, 1200)');
  const assistantBefore = { ...f.calls.assist };
  const shownY = f.win.getBounds().y;
  for (let cycle = 0; cycle < 20; cycle++) {
    f.run('slideDock(false)');
    const hide = { ...f.ctx.anim };
    f.frame(hide.id, (hide.from + hide.to) / 2);
    assert.notEqual(f.calls.assist.y, assistantBefore.y, 'assistant must move with each dock animation frame');
    assert.ok(f.calls.assist.y + f.assistantSize.height <= f.display.bounds.y + f.display.bounds.height - 4, 'assistant must stop before leaving the screen');
    f.run('showDock()');
    const show = { ...f.ctx.anim };
    const beforeStaleFrame = f.win.getBounds();
    f.frame(hide.id, hide.to, true);
    assert.deepEqual(f.win.getBounds(), beforeStaleFrame, 'old final frame must not reverse a new animation');
    assert.equal(f.ctx.anim.id, show.id, 'old frame must not finish a new animation');
    f.frame(show.id, NaN);
    f.frame(show.id, show.to, true, {});
    assert.deepEqual(f.win.getBounds(), beforeStaleFrame, 'invalid or foreign frames must be ignored');
    const halfway = (show.from + show.to) / 2;
    f.frame(show.id, halfway);
    const afterHalfway = f.win.getBounds();
    f.frame(show.id, show.from);
    assert.deepEqual(f.win.getBounds(), afterHalfway, 'animation must never step backwards');
    f.frame(show.id, show.to, true);
    assert.equal(f.win.getBounds().y, shownY, 'animation must finish at the shown position');
    f.run('placeAssistant()');
    assert.deepEqual(f.calls.assist, assistantBefore, 'assistant must return to the dock after repeated reversals');
    f.frame(show.id, show.from);
    assert.equal(f.win.getBounds().y, shownY, 'late frame after completion must be ignored');
  }
  f.display.workArea.y += 2;
  f.display.workArea.height -= 4;
  f.run('placeWindow(1200, 54, 1200)');
  assert.equal(f.win.getBounds().y, shownY, 'temporary Windows work-area changes must not move the autohiding dock');
  assert.deepEqual(f.calls.assist, assistantBefore);
}
{
  const f = fixture();
  f.run('placeWindow(1200, 54, 1200)');
  const before = f.win.getBounds();
  f.run('placeWindow(NaN, 54, 1200); placeWindow(0, 54, 1200)');
  assert.deepEqual(f.win.getBounds(), before);
}
{
  const frames = [], queued = [];
  let onSlide, now = 0;
  const ctx = vm.createContext({
    dock: { onSlide: (cb) => { onSlide = cb; }, slidePos: (...args) => frames.push(args) },
    performance: { now: () => now }, requestAnimationFrame: (cb) => queued.push(cb),
  });
  vm.runInContext(section(renderer, 'const easeOut =', '// ---------- Настройки'), ctx);
  onSlide({ id: 1, from: 800, to: 864, show: false, ms: 240 });
  onSlide({ id: 2, from: 820, to: 800, show: true, ms: 280 });
  queued.shift()(16);
  assert.equal(frames.length, 0, 'renderer must cancel the previous queued animation frame');
  for (now of [16, 32, 64, 128, 200, 280]) queued.shift()(now);
  assert.ok(frames.every(([id]) => id === 2), 'renderer must preserve the main-process animation identity');
  assert.ok(frames.every(([, y], i) => i === 0 || y <= frames[i - 1][1]), 'renderer trajectory must be monotonic');
  assert.deepEqual(frames.at(-1), [2, 800, true]);
  assert.equal(queued.length, 0, 'finished animation must stop scheduling frames');
}
{
  const sent = [];
  const ctx = vm.createContext({
    dockEl: { getBoundingClientRect: () => ({ width: 1200.25, height: 54 }), querySelectorAll: () => [] },
    document: { body: { classList: { contains: () => false } } }, dock: { resize: (...args) => sent.push(args) },
  });
  vm.runInContext(section(renderer, 'let lastSize =', 'const sizeObserver ='), ctx);
  vm.runInContext('reportSize(); reportSize(); reportSize()', ctx);
  assert.equal(sent.length, 1, 'duplicate layout notifications must not resize the dock');
  assert.equal(sent[0][0], 1200.25, 'fractional CSS width must survive until physical scaling');
}
console.log('PASS: Windows DPI 100/125/150%, dock scale 85/100/125/150%, assistant following dock within screen, animation reversals and stale frames, work-area changes, autohide recovery, size deduplication.');
module.exports = { fixture, section };
