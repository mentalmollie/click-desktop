const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createWeather, normalizeWeather } = require('../weather');
const day = { time: '2026-11-19T00:00:00+03:00', summary: { day: { minTemperature: -3, maxTemperature: 2, condition: 'SNOW' } }, hours: [
  { time: '2026-11-19T12:00:00+03:00', temperature: 1, condition: 'SNOW', icon: 'sn_d' }] };
const raw = { data: { weatherByPoint: { now: { temperature: 0, condition: 'SNOW', daytime: 'DAY', humidity: 80, windSpeed: 18 }, forecast: { days: [day] } } } };
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'click-weather-test-'));
  try {
    let requests = 0, mode = 'normal', time = 0;
    const cfg = { lat: 55.75, lon: 37.62 };
    const keyPath = path.join(dir, 'weather.key');
    const safeStorage = { isEncryptionAvailable: () => true, encryptString: (s) => Buffer.from(s).map((b) => b ^ 42), decryptString: (b) => b.map((v) => v ^ 42).toString() };
    const service = createWeather({ keyPath, safeStorage, config: () => cfg, now: () => time, fetchImpl: async (url, opts) => {
      requests++;
      assert.equal(url, 'https://api.weather.yandex.ru/graphql/query');
      assert.equal(opts.redirect, 'error');
      assert.equal(opts.headers['X-Yandex-Weather-Key'], 'test-dummy-key');
      assert.equal(JSON.parse(opts.body).variables.point.lat, cfg.lat);
      if (mode === 'denied') return new Response('', { status: 403 });
      if (mode === 'offline') throw new Error('fetch failed');
      return new Response(JSON.stringify(mode === 'graphql' ? { errors: [{ message: 'denied' }] } : raw));
    } });
    await assert.rejects(service.get(), /API-ключ/); assert.equal(requests, 0);
    service.setKey('test-dummy-key'); assert.equal(service.status().hasKey, true);
    assert.ok(!fs.readFileSync(keyPath).includes(Buffer.from('test-dummy-key')));
    const [a, b] = await Promise.all([service.get(), service.get()]);
    assert.equal(requests, 1); assert.deepEqual(a, b);
    assert.equal(a.current.temperature_2m, 0); assert.equal(a.current.apparent_temperature, null);
    assert.equal(a.daily.temperature_2m_min[0], -3); assert.equal(a.hourly.is_day[0], 1);
    await service.get(); assert.equal(requests, 1);
    cfg.lat = 59.93; await service.get(); assert.equal(requests, 2);
    time += 16 * 60 * 1000; mode = 'denied'; await assert.rejects(service.get(), /ключ и тариф/);
    mode = 'graphql'; await assert.rejects(service.get(), /доступные данные/);
    mode = 'offline'; await assert.rejects(service.get(), /Нет связи/);
    service.setKey(''); await assert.rejects(service.get(), /API-ключ/);
    assert.equal(service.status().hasKey, false);
    assert.throws(() => normalizeWeather({}), /неполные/);
    const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
    const start = main.indexOf('function removeLegacyIntegrations('), end = main.indexOf('\nconst weather =', start);
    const cfgOld = { widgets: { island: true, clock: true }, island: { path: 'legacy' }, widgetOpts: { island: {}, clock: {} }, widgetOrder: ['island', 'clock'], layoutZones: { island: 'R', clock: 'R' }, assistant: { brain: { provider: 'anthropic', model: 'legacy', models: { groq: 'keep', anthropic: 'remove' } } } };
    vm.runInNewContext(main.slice(start, end) + '\nremoveLegacyIntegrations(cfg);', { cfg: cfgOld });
    assert.equal(cfgOld.assistant.brain.provider, 'gemini'); assert.equal(cfgOld.assistant.brain.models.groq, 'keep');
    assert.deepEqual(cfgOld.widgetOrder, ['clock']); assert.equal(cfgOld.island, undefined); assert.equal(cfgOld.widgets.clock, true);
    console.log('PASS: encrypted weather key, missing key, cache/concurrency, city changes, Yandex data mapping and errors, legacy config migration.');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
})().catch((e) => { console.error(e); process.exitCode = 1; });
