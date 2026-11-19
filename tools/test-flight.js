// Exercise production flight handlers and physics, including stale asynchronous input.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { fixture, section } = require('./test-dock');
const assistant = fs.readFileSync(path.join(__dirname, '..', 'assistant.js'), 'utf8');

for (const dpi of [1, 1.25, 1.5]) {
  for (const margin of [0, 4, 20]) {
    for (const blur of [false, true]) {
      const f = fixture(dpi);
      Object.assign(f.ctx.config.appearance, { margin, blur });
      f.run('placeWindow(1200, 54, 1200)');
      const shown = { ...f.calls.assist };
      const first = f.flyStart();
      f.flyRelease(first.id);
      f.flyMove(first.id, first.x, -1000000);
      assert.ok(f.calls.assist.y >= first.minY);
      f.run('slideDock(false)');
      const hide = { ...f.ctx.anim };
      for (let step = 1; step <= 10; step++) {
        f.frame(hide.id, hide.from + (hide.to - hide.from) * step / 10, step === 10);
        f.flyMove(first.id, 1000000, 1000000);
        const ground = f.run('assistFlightBounds().ground');
        assert.ok(f.calls.assist.y <= ground, 'main process must reject movement below the current surface');
        assert.ok(f.calls.assist.y + f.assistantSize.height <= f.display.bounds.height - 4, 'feet must remain inside the screen at every frame');
      }
      assert.ok(f.calls.assist.y > shown.y, 'assistant must descend with the hiding dock');
      assert.ok(f.calls.groundUpdates.length > 1, 'moving dock must update the active flight ground');
      f.flyEnd(first.id, shown.x);
      assert.equal(f.ctx.assistFlying, false);
      const settled = { ...f.calls.assist };
      f.flyMove(first.id, shown.x, 1000000);
      assert.deepEqual(f.calls.assist, settled, 'late flight frame must not move a landed assistant');
      const second = f.flyStart();
      f.flyRelease(second.id);
      f.flyMove(first.id, 0, 1000000);
      f.flyEnd(first.id, 0);
      assert.equal(f.ctx.assistFlight.id, second.id, 'old flight must not finish a new throw');
      assert.deepEqual(f.calls.assist, settled);
      f.flyMove(second.id, NaN, Infinity);
      assert.deepEqual(f.calls.assist, settled, 'invalid positions must be ignored');
      // Actual window dimensions can change with DPI while airborne.
      f.assistantSize.height = 400;
      f.assistantSize.width = 450;
      f.flyMove(second.id, second.x, 1000000);
      assert.ok(f.calls.assist.y + 400 <= f.display.bounds.height - 4);
      f.run('showDock()');
      const show = { ...f.ctx.anim };
      for (let step = 1; step <= 10; step++) {
        f.frame(show.id, show.from + (show.to - show.from) * step / 10, step === 10);
        f.flyMove(second.id, second.x, 1000000);
        assert.ok(f.calls.assist.y <= f.run('assistPos().y'), 'rising dock must lift the flight surface');
      }
      f.flyEnd(second.id, shown.x);
      assert.equal(f.calls.assist.y, shown.y - 80, 'landing must use the actual resized window height');
    }
  }
}

let onGround;
const physicsCtx = vm.createContext({
  G: 2600, fly: null, drag: null, dizzyUntil: 0, Date,
  dock: { onAssistGround: (cb) => { onGround = cb; } },
  playAct() {}, $: () => ({ classList: { add() {}, remove() {} }, offsetWidth: 1 }),
});
vm.runInContext([
  section(assistant, 'function clampPos(', 'async function moveTo('),
  section(assistant, 'dock.onAssistGround(', 'async function beginDragFlight('),
  section(assistant, 'function physics(', 'function land()'),
].join('\n'), physicsCtx);
for (const vx of [-5000, 0, 5000]) {
  for (const vy of [-10000, 0, 10000]) {
    const f = { x: 200, y: 0, vx, vy, spin: 0, spinK: 0.45, bounces: 0, info: { id: 1, minX: 0, maxX: 500, minY: -300, ground: 150 } };
    physicsCtx.fly = f;
    let landed = false;
    for (let frame = 0; frame < 5000 && !landed; frame++) {
      if (frame === 20) onGround({ id: 1, minX: 0, maxX: 500, minY: -300, ground: 80 });
      if (frame === 40) onGround({ id: 1, minX: 0, maxX: 500, minY: -300, ground: 180 });
      landed = physicsCtx.physics(f, 0.008);
      assert.ok(f.y <= f.info.ground && f.y >= f.info.minY, 'physics must remain within the live vertical limits');
      assert.ok(f.x >= f.info.minX && f.x <= f.info.maxX);
    }
    assert.ok(landed, 'throw must eventually land after the surface moves');
  }
}

const queued = [], sent = [];
let physicsSteps = 0;
const frameCtx = vm.createContext({
  fly: null, emotion: null, Date, performance: { now: () => 100 },
  requestAnimationFrame: (cb) => queued.push(cb),
  physics: () => { physicsSteps++; return false; },
  setSpin() {}, dock: { assistFlyMove: (...args) => sent.push(args) },
});
vm.runInContext(section(assistant, 'function startFlight(', '// Один шаг физики'), frameCtx);
frameCtx.startFlight({ id: 1 }, 0, 0, 10, 0, { gentle: true });
frameCtx.startFlight({ id: 2 }, 0, 0, 10, 0, { gentle: true });
queued.shift()(116);
assert.equal(physicsSteps, 0, 'queued frame of a caught throw must not advance the next throw');
queued.shift()(116);
assert.ok(physicsSteps > 0);
assert.equal(sent[0][0], 2);

(async () => {
  let resolveStart;
  const ended = [];
  const ctx = vm.createContext({ drag: {}, dock: {
    assistFlyStart: () => new Promise((resolve) => { resolveStart = resolve; }),
    assistFlyEnd: (...args) => ended.push(args),
  } });
  vm.runInContext(section(assistant, 'async function beginDragFlight(', "ch.addEventListener('pointerdown'"), ctx);
  const pending = ctx.beginDragFlight(ctx.drag);
  ctx.drag = null;
  resolveStart({ id: 7, x: 200 });
  assert.equal(await pending, null);
  assert.deepEqual(ended, [[7, 200]], 'releasing the mouse before flyStart resolves must clean up the pending flight');
  console.log('PASS: flight bounds at DPI 100/125/150%, moving dock, DPI resize during flight, stale sessions, physics landing, caught throws, async mouse release.');
})().catch((error) => { console.error(error); process.exitCode = 1; });
