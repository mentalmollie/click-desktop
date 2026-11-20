const assert = require('node:assert/strict');
const { createWeather, normalizeWeather, weatherUrl } = require('../weather');
const epoch = (s) => Date.parse(s) / 1000;
const raw = { timezone: 'Asia/Novosibirsk', current: { time: epoch('2026-11-19T00:00:00Z'), temperature_2m: 0, apparent_temperature: -4, weather_code: 73, is_day: 0, relative_humidity_2m: 80, wind_speed_10m: 18 },
  hourly: { time: [epoch('2026-11-19T00:00:00Z'), epoch('2026-11-19T01:00:00Z')], temperature_2m: [0, 1], weather_code: [73, 3], is_day: [0, 1] },
  daily: { time: [epoch('2026-11-18T17:00:00Z')], temperature_2m_min: [-5], temperature_2m_max: [1], weather_code: [73] } };
(async () => {
  let cfg = { lat: 55.02, lon: 82.93 }, requests = 0, time = 0, mode = 'ok', lastUrl;
  const service = createWeather({ config: () => cfg, now: () => time, fetchImpl: async (url, opts) => {
    requests++; lastUrl = new URL(url);
    assert.ok(['https://api.open-meteo.com', 'https://geocoding-api.open-meteo.com'].includes(lastUrl.origin));
    assert.deepEqual(opts.headers, { Accept: 'application/json' }); assert.equal(opts.redirect, 'error');
    assert.equal(lastUrl.searchParams.has('apikey'), false);
    if (mode === 'offline') throw new Error('offline');
    if (mode === 'limit') return new Response('', { status: 429 });
    if (mode === 'html') return new Response('<html>error</html>');
    if (mode === 'error') return new Response(JSON.stringify({ error: true, reason: 'bad' }));
    if (lastUrl.pathname.includes('search')) return new Response(JSON.stringify({ results: mode === 'empty' ? [] : [
      { name: 'Новосибирск', latitude: 55.02, longitude: 82.93, admin1: 'Новосибирская область', country: 'Россия' },
      { name: 'Invalid', latitude: 999, longitude: 82.93 }] }));
    return new Response(JSON.stringify(raw));
  } });
  assert.equal(service.status().requiresKey, false);
  const [a, b] = await Promise.all([service.get(), service.get()]); assert.equal(requests, 1); assert.deepEqual(a, b);
  assert.equal(a.current.temperature_2m, 0); assert.equal(a.current.apparent_temperature, -4); assert.equal(a.source, 'Open-Meteo');
  assert.equal(a.hourly.time[0], '2026-11-19T07:00:00+07:00'); assert.equal(a.daily.time[0], '2026-11-19'); assert.equal(a.hourlyStep, 1);
  await service.get(); assert.equal(requests, 1); await service.get(true); assert.equal(requests, 2);
  time += 16 * 60 * 1000; await service.get(); assert.equal(requests, 3);
  cfg = { lat: 55.75, lon: 37.62 }; await service.get(); assert.equal(requests, 4);
  assert.equal((await service.search('Новосибирск')).length, 1); assert.equal(lastUrl.searchParams.get('language'), 'ru');
  cfg = { city: 'Новосибирск', region: 'Новосибирская область', gismeteoId: 4690, lat: 55.75, lon: 37.62 };
  await service.get(); assert.equal(lastUrl.searchParams.get('longitude'), '82.93', 'resolve old Gismeteo city instead of using stale Moscow coordinates');
  mode = 'offline'; await assert.rejects(service.get(true), /Нет связи/);
  mode = 'limit'; await assert.rejects(service.get(true), /лимит/);
  mode = 'html'; await assert.rejects(service.get(true), /неверный ответ/);
  mode = 'error'; await assert.rejects(service.get(true), /обработать запрос/);
  cfg = { city: 'Неизвестный город', gismeteoId: 123 }; mode = 'empty'; await assert.rejects(service.get(), /Выберите город заново/);
  assert.throws(() => weatherUrl({ lat: 99, lon: 30 }), /Выберите город/);
  assert.throws(() => normalizeWeather({ ...raw, current: { ...raw.current, temperature_2m: null } }), /неполные/);
  assert.throws(() => normalizeWeather({ ...raw, hourly: {} }), /не предоставил/);
  const summer = normalizeWeather({ ...raw, timezone: 'Europe/London', hourly: { ...raw.hourly, time: [epoch('2026-10-25T00:00:00Z'), epoch('2026-10-25T01:00:00Z')] } });
  assert.equal(summer.hourly.time[0], '2026-10-25T01:00:00+01:00'); assert.equal(summer.hourly.time[1], '2026-10-25T01:00:00+00:00');
  console.log('PASS: Open-Meteo without keys, current/hourly/daily weather, local dates and DST, cache/manual refresh, city search, Gismeteo city migration and network errors.');
})().catch((e) => { console.error(e); process.exitCode = 1; });
