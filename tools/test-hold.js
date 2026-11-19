const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { fixture, section } = require('./test-dock');
const assistant = fs.readFileSync(path.join(__dirname, '..', 'assistant.js'), 'utf8');

for (const dpi of [1, 1.25, 1.5]) {
  const f = fixture(dpi);
  f.run('placeWindow(1200, 54, 1200)');
  const original = { ...f.calls.assist };
  const grab = { x: 160, y: 240 };
  // The mouse has already crossed the drag threshold while the start IPC was pending.
  let cursor = { x: original.x + grab.x, y: original.y + grab.y - 100 };
  f.moveCursor(cursor);
  const info = f.flyStart(grab);
  assert.equal(info.y, original.y - 100, 'first move must preserve the original pointerdown grab point');
  let held = { x: info.x, y: info.y };
  const moves = f.calls.positioned;
  for (let tick = 0; tick < 300; tick++) {
    const p = f.holdMove(info.id);
    assert.equal(p.x, held.x);
    assert.equal(p.y, held.y, 'stationary mouse must not accumulate downward drift');
    f.flyMove(info.id, held.x, held.y + 1000);
    assert.deepEqual(f.calls.assist, held, 'gravity frames must be ignored while the mouse holds the character');
  }
  assert.equal(f.calls.positioned, moves, 'stationary cursor must not keep repositioning the native window');
  for (const [dx, dy] of [[20, -40], [-30, 10], [10, 15], [0, 0]]) {
    cursor = { x: cursor.x + dx, y: cursor.y + dy };
    f.moveCursor(cursor);
    const p = f.holdMove(info.id);
    held = { x: cursor.x - grab.x, y: cursor.y - grab.y };
    assert.equal(p.x, held.x);
    assert.equal(p.y, held.y);
    assert.deepEqual(f.calls.assist, held, 'native window must preserve the exact grab offset');
  }
  f.run('slideDock(false)');
  const hide = { ...f.ctx.anim };
  f.frame(hide.id, hide.to, true);
  assert.deepEqual(f.calls.assist, held, 'hiding the panel must not pull a held character down');
  // A one-DIP readback discrepancy at fractional DPI must not feed back into the anchor.
  f.calls.assist = { x: held.x + 1, y: held.y + 1 };
  const beforeRounding = f.calls.positioned;
  for (let tick = 0; tick < 100; tick++) {
    assert.equal(f.holdMove(info.id).y, held.y);
  }
  assert.equal(f.calls.positioned, beforeRounding);
  const release = f.flyRelease(info.id);
  assert.equal(release.x, held.x);
  assert.equal(release.y, held.y, 'release must return canonical coordinates, not browser screen coordinates');
  assert.equal(f.holdMove(info.id), null, 'queued hold requests must stop after release');
  f.flyMove(info.id, held.x, release.ground);
  assert.equal(f.calls.assist.y, release.ground, 'physics must resume only after release');
}

(async () => {
  // Out-of-order asynchronous replies must not rewind the held pose.
  const pending = [], spins = [];
  const drag = { info: { id: 7, ground: 300 }, hist: [{ t: 0, x: 0, y: 0 }, { t: 100, x: 10, y: 0 }] };
  const ctx = vm.createContext({ drag, Date, trackShake() {}, setSpin: (s) => spins.push(s),
    dock: { assistHoldMove: () => new Promise((resolve) => pending.push(resolve)) },
  });
  vm.runInContext(section(assistant, 'async function moveTo(', '// ---------- Потрясли'), ctx);
  const first = ctx.moveTo(drag.info), second = ctx.moveTo(drag.info);
  pending[1]({ x: 200, y: 100 });
  await second;
  const spinCount = spins.length;
  pending[0]({ x: 200, y: 300 });
  await first;
  assert.equal(spins.length, spinCount);
  assert.equal(drag.lifted, true);

  const flights = [], ended = [];
  let resolveRelease;
  const releaseCtx = vm.createContext({
    drag: { moved: true, info: { id: 8 }, hist: [{ t: 0, x: 0, y: 0 }, { t: 100, x: 10, y: 0 }] },
    releasingDrag: null, reportHit() {}, setSpin() {},
    dock: { assistFlyRelease: () => new Promise((resolve) => { resolveRelease = resolve; }), assistFlyEnd: (...args) => ended.push(args) },
    startFlight: (...args) => flights.push(args),
  });
  vm.runInContext(section(assistant, 'async function endDrag(', '// Правый клик'), releaseCtx);
  const released = releaseCtx.endDrag({ screenX: 100000, screenY: 100000 });
  resolveRelease({ id: 8, x: 200, y: 100, ground: 300 });
  await released;
  assert.equal(flights[0][1], 200);
  assert.equal(flights[0][2], 100);
  assert.equal(flights.length, 1, 'fall must start from the main-process release position');
  releaseCtx.drag = { moved: true, info: { id: 9 }, hist: [] };
  const superseded = releaseCtx.endDrag({});
  releaseCtx.drag = {};
  releaseCtx.releasingDrag = null;
  resolveRelease({ id: 9, x: 210, y: 110 });
  await superseded;
  assert.equal(flights.length, 1, 'a new grab must cancel the pending release of the old grab');
  assert.deepEqual(ended.at(-1), [9, 210]);
  console.log('PASS: fixed native grab point at DPI 100/125/150%, stationary hold, window feedback, held gravity rejection, canonical release and asynchronous reply ordering.');
})().catch((error) => { console.error(error); process.exitCode = 1; });
