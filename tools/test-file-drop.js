const assert = require('node:assert/strict');
const { createFileDrop } = require('../file-drop');
const { installFileDrop } = require('../renderer-file-drop');
(async () => {
  const calls = [], activated = [];
  let target = { path: 'C:\\Apps\\Editor.exe', args: ['--new-window'], window: 123 };
  const manager = createFileDrop({ resolveTarget: x => x?.key === 'known' ? target : null,
    stat: async p => { if (p.includes('missing')) throw Object.assign(new Error('missing'), { code: 'ENOENT' }); return { isFile: () => true, isDirectory: () => false }; },
    launch: async (exe, args) => { calls.push({ exe, args }); }, activate: h => activated.push(h) });
  assert.deepEqual(await manager.hover({ key: 'known' }), { ok: true, activated: true });
  assert.deepEqual(activated, [123]); assert.equal(calls.length, 0, 'hover must not launch another instance');
  const files = ['C:\\Фото и документы\\тест & $(hello).txt', 'C:\\Images\\two.png'];
  assert.equal((await manager.drop({ key: 'known' }, [...files, files[0].toUpperCase()])).count, 2);
  assert.deepEqual(calls[0], { exe: target.path, args: ['--new-window', ...files] }, 'each filename is a separate argument, including spaces and shell characters');
  for (const input of [[], ['relative.txt'], ['https://example.org/file'], ['C:\\missing.txt'], ['\\\\.\\PhysicalDrive0'], ['C:\\bad\0.txt'], Array(101).fill(files[0])]) {
    assert.equal((await manager.drop({ key: 'known' }, input)).ok, false);
  }
  assert.equal((await manager.drop({ key: 'removed' }, files)).ok, false, 'stale/unknown destination cannot execute');
  target = { path: 'shell:AppsFolder\\Test!App', window: 456 };
  assert.equal((await manager.hover({ key: 'known' })).activated, true);
  assert.equal((await manager.drop({ key: 'known' }, files)).ok, false, 'Store app guides user to native window drop');
  target = { path: 'C:\\Apps\\Update.exe' };
  assert.equal((await manager.drop({ key: 'known' }, files)).ok, false, 'launcher cannot silently consume files');
  assert.equal(calls.length, 1);
  const events = {}, timers = new Map(), action = [], lease = [];
  let id = 0;
  const clock = { setTimeout: (fn, ms) => { timers.set(++id, { fn, ms }); return id; }, clearTimeout: id => timers.delete(id) };
  const doc = { addEventListener: (type, fn) => events[type] = fn, documentElement: { contains: x => !!x?.inside } };
  const button = () => { const classes = new Set(); return { dataset: { fileTarget: JSON.stringify({ key: 'known' }) }, isConnected: true, classes,
    classList: { add: c => classes.add(c), remove: c => classes.delete(c) } }; };
  const a = button(), b = button();
  installFileDrop(doc, { fileDrag: active => lease.push(active), fileHover: async x => action.push(['hover', x]), dropFiles: async (x, files) => { action.push(['drop', x, files]); return { ok: true }; } }, clock);
  const event = (button, files = [], types = ['Files']) => ({ dataTransfer: { types, files }, target: { closest: () => button }, preventDefault() { this.prevented = true; } });
  const fire = ms => { for (const [id, t] of [...timers]) if (t.ms === ms) { timers.delete(id); t.fn(); } };
  const over = event(a); events.dragover(over); assert.equal(over.prevented, true); assert.equal(over.dataTransfer.dropEffect, 'copy'); assert.ok(a.classes.has('file-drop-over'));
  events.dragover(event(b)); assert.ok(!a.classes.has('file-drop-over')); fire(650); await Promise.resolve();
  assert.equal(action.filter(x => x[0] === 'hover').length, 1, 'changing icons cancels old hover');
  events.dragover(event(a)); events.dragleave({ relatedTarget: null }); fire(650);
  assert.equal(action.length, 1, 'leaving cancels pending activation');
  const fakeFiles = [{ name: 'fixture.txt' }]; events.dragover(event(b)); await events.drop(event(b, fakeFiles));
  assert.deepEqual(action.at(-1), ['drop', { key: 'known' }, fakeFiles]); assert.equal(lease.at(-1), false); assert.ok(b.classes.has('file-drop-sent'));
  const text = event(a, [], ['text/plain']); events.dragover(text); assert.equal(text.prevented, undefined, 'text/internal icon drags are unaffected');
  const blank = event(null); events.dragover(blank); assert.equal(blank.dataTransfer.dropEffect, 'none'); fire(1500); assert.equal(lease.at(-1), false);
  const { fixture } = require('./test-dock');
  const dockFixture = fixture();
  dockFixture.run('placeWindow(900, 54, 900); fileDragUntil = Date.now() + 1600; hideAt = 1; autoHideTick()');
  assert.equal(dockFixture.ctx.dockShown, true, 'file drag lease prevents autohide');
  dockFixture.run('fileDragUntil = 0; hideAt = 1; autoHideTick()');
  assert.equal(dockFixture.ctx.dockShown, false, 'autohide resumes after drag ends');
  console.log('PASS: multi-file handoff, argument preservation, stale targets, invalid files, Store/launcher guidance, delayed hover, switching/cancel, feedback and drag lease cleanup.');
})().catch(error => { console.error(error); process.exitCode = 1; });
