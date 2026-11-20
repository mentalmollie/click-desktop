const assert = require('node:assert/strict');
const { createUpdateScheduler, UPDATE_INTERVAL } = require('../update-scheduler');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
(async () => {
  let time = 0, id = 0, checks = 0, release;
  const timers = new Map();
  const scheduler = createUpdateScheduler({ now: () => time,
    setTimer: (fn, delay) => { const key = ++id; timers.set(key, { fn, at: time + delay }); return key; },
    clearTimer: (key) => timers.delete(key),
    check: () => { checks++; return new Promise((resolve) => { release = resolve; }); },
  });
  const fire = async (advance) => {
    time += advance;
    const due = [...timers].filter(([, v]) => v.at <= time);
    for (const [key, value] of due) { timers.delete(key); value.fn(); }
    await Promise.resolve();
  };
  scheduler.setEnabled(false); await fire(UPDATE_INTERVAL); assert.equal(checks, 0);
  scheduler.setEnabled(true); await fire(4999); assert.equal(checks, 0);
  await fire(1); assert.equal(checks, 1, 'startup check');
  scheduler.resume(); assert.equal(checks, 1, 'must not overlap pending checks');
  release(); await Promise.resolve();
  scheduler.setEnabled(true);
  await fire(UPDATE_INTERVAL - 1); assert.equal(checks, 1);
  await fire(1); assert.equal(checks, 2, 'check every six hours');
  scheduler.setEnabled(false); release(); await Promise.resolve();
  assert.equal(timers.size, 0, 'disabling during a check must prevent subsequent checks');
  await fire(UPDATE_INTERVAL * 2); scheduler.resume(); assert.equal(checks, 2);
  scheduler.setEnabled(true); await fire(0); assert.equal(checks, 3, 'overdue checks resume when enabled');
  release(); await Promise.resolve();
  time += UPDATE_INTERVAL; scheduler.resume(); assert.equal(checks, 4, 'check after waking from sleep');
  scheduler.stop(); release(); await Promise.resolve(); assert.equal(timers.size, 0);
  scheduler.setEnabled(true); await fire(UPDATE_INTERVAL); assert.equal(checks, 4, 'quit stops timers');
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  const shared = require('../shared');
  let stored = '{}';
  const context = vm.createContext({ ...shared, MusicServices: require('../music-service'), CONFIG_PATH: 'test-config.json', detectApps: () => [],
    fs: { readFileSync: () => stored, writeFileSync: (_p, bytes) => { stored = bytes; } },
  });
  vm.runInContext(main.slice(main.indexOf('const DEFAULTS ='), main.indexOf('let win =')) +
    main.slice(main.indexOf('function loadConfig()'), main.indexOf('function removeLegacyIntegrations(')) +
    main.slice(main.indexOf('function removeLegacyIntegrations('), main.indexOf('\nconst weather =')), context);
  assert.equal(vm.runInContext('loadConfig().updates.autoCheck', context), true, 'existing installs enable startup checks by default');
  const previous = JSON.parse(stored); previous.updates.autoCheck = false; previous.weather.city = 'Казань'; stored = JSON.stringify(previous);
  assert.equal(vm.runInContext('loadConfig().updates.autoCheck', context), false, 'disabled preference survives restart');
  assert.equal(JSON.parse(stored).weather.city, 'Казань', 'other settings survive migration');
  console.log('PASS: startup/six-hour checks, saved toggle behavior, no overlapping checks, sleep recovery and shutdown.');
})().catch((e) => { console.error(e); process.exitCode = 1; });
