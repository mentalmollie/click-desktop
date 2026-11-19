// Яндекс Погода v3. Ключ и сетевые запросы остаются в главном процессе.
const fs = require('node:fs');
const CODES = { CLEAR: 0, PARTLY_CLOUDY: 1, CLOUDY: 2, OVERCAST: 3, LIGHT_RAIN: 61, RAIN: 63,
  HEAVY_RAIN: 65, SHOWERS: 82, SLEET: 71, LIGHT_SNOW: 71, SNOW: 73, SNOWFALL: 75,
  HAIL: 77, THUNDERSTORM: 95, THUNDERSTORM_WITH_RAIN: 95, THUNDERSTORM_WITH_HAIL: 99 };
const QUERY = `query ClickWeather($point: PointInput!) {
  weatherByPoint(request: $point, language: RU) {
    now { temperature(unit: CELSIUS) condition daytime humidity windSpeed(unit: KILOMETERS_PER_HOUR) }
    forecast { days(limit: 7) { time
      summary { day { minTemperature(unit: CELSIUS) maxTemperature(unit: CELSIUS) condition } }
      hours { time temperature(unit: CELSIUS) condition icon(format: CODE) }
    } }
  }
}`;
const numeric = (n) => typeof n === 'number' && Number.isFinite(n);
function normalizeWeather(raw) {
  const w = raw?.data?.weatherByPoint, n = w?.now;
  if (!numeric(n?.temperature) || !(n.condition in CODES)) throw new Error('Яндекс Погода вернула неполные данные.');
  const days = (w.forecast?.days || []).filter((d) => numeric(d.summary?.day?.minTemperature) && numeric(d.summary?.day?.maxTemperature) && /^\d{4}-\d\d-\d\dT/.test(d.time));
  const hours = days.flatMap((d) => d.hours || []).filter((h) => numeric(h.temperature) && /^\d{4}-\d\d-\d\dT/.test(h.time)).sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
  return { source: 'Яндекс Погода', current: { temperature_2m: n.temperature, apparent_temperature: null,
    weather_code: CODES[n.condition], is_day: n.daytime === 'DAY' ? 1 : 0,
    relative_humidity_2m: numeric(n.humidity) ? n.humidity : null, wind_speed_10m: numeric(n.windSpeed) ? n.windSpeed : null },
    hourly: { time: hours.map((h) => h.time), temperature_2m: hours.map((h) => h.temperature),
      weather_code: hours.map((h) => CODES[h.condition] ?? 3), is_day: hours.map((h) => /_n(?:$|_)/.test(h.icon || '') ? 0 : 1) },
    daily: { time: days.map((d) => d.time.slice(0, 10)), temperature_2m_min: days.map((d) => d.summary.day.minTemperature),
      temperature_2m_max: days.map((d) => d.summary.day.maxTemperature), weather_code: days.map((d) => CODES[d.summary.day.condition] ?? 3) } };
}
function createWeather({ keyPath, safeStorage, config, fetchImpl = fetch, now = Date.now }) {
  let cached = null, pending = null, revision = 0;
  function key() { try { return safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(fs.readFileSync(keyPath)) : ''; } catch { return ''; } }
  function status() { return { hasKey: !!key(), encryptionAvailable: safeStorage.isEncryptionAvailable() }; }
  function setKey(value) {
    const input = String(value || '').trim();
    if (input && (!safeStorage.isEncryptionAvailable() || /[\r\n]/.test(input) || input.length > 512)) throw new Error('Не удалось сохранить ключ Яндекс Погоды.');
    if (input) fs.writeFileSync(keyPath, safeStorage.encryptString(input));
    else fs.rmSync(keyPath, { force: true });
    revision++; cached = null;
    return status();
  }
  async function get() {
    const w = config(), apiKey = key();
    if (!apiKey) throw new Error('Подключите Яндекс Погоду в настройках: добавьте API-ключ.');
    if (!numeric(w.lat) || !numeric(w.lon) || Math.abs(w.lat) > 90 || Math.abs(w.lon) > 180) throw new Error('Выберите город в настройках погоды.');
    const cacheKey = `${revision}:${w.lat},${w.lon}`;
    if (cached?.key === cacheKey && now() - cached.at < 15 * 60 * 1000) return cached.data;
    if (pending?.key === cacheKey) return pending.promise;
    const promise = (async () => {
      let response;
      try { response = await fetchImpl('https://api.weather.yandex.ru/graphql/query', {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(20000),
        headers: { 'Content-Type': 'application/json', 'X-Yandex-Weather-Key': apiKey },
        body: JSON.stringify({ query: QUERY, variables: { point: { lat: w.lat, lon: w.lon } } }),
      }); } catch { throw new Error('Нет связи с Яндекс Погодой. Попробуйте позже.'); }
      if ([401, 403].includes(response.status)) throw new Error('Проверьте ключ и тариф Яндекс Погоды в настройках.');
      if (response.status === 429) throw new Error('Достигнут лимит запросов Яндекс Погоды. Попробуйте позже.');
      if (!response.ok) throw new Error('Яндекс Погода временно недоступна.');
      const bytes = []; let size = 0;
      for await (const chunk of response.body) { size += chunk.length; if (size > 1024 * 1024) throw new Error('Некорректный ответ Яндекс Погоды.'); bytes.push(Buffer.from(chunk)); }
      let raw; try { raw = JSON.parse(Buffer.concat(bytes).toString('utf8')); } catch { throw new Error('Некорректный ответ Яндекс Погоды.'); }
      if (raw.errors?.length) throw new Error('Яндекс Погода не предоставила прогноз. Проверьте ключ и доступные данные тарифа.');
      const data = normalizeWeather(raw);
      if (cacheKey === `${revision}:${config().lat},${config().lon}`) cached = { key: cacheKey, at: now(), data };
      return data;
    })();
    pending = { key: cacheKey, promise };
    try { return await promise; } finally { if (pending?.promise === promise) pending = null; }
  }
  return { get, status, setKey };
}
module.exports = { createWeather, normalizeWeather, QUERY };
