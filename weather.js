// Open-Meteo: текущая погода, почасовой прогноз и поиск городов без ключа.
const numeric = (v) => typeof v === 'number' && Number.isFinite(v);
const validCoords = (w) => numeric(w?.lat) && numeric(w?.lon) && Math.abs(w.lat) <= 90 && Math.abs(w.lon) <= 180;
function weatherUrl(w) {
  if (!validCoords(w)) throw new Error('Выберите город в настройках погоды.');
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.search = new URLSearchParams({ latitude: w.lat, longitude: w.lon,
    current: 'temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code,is_day',
    hourly: 'temperature_2m,weather_code,is_day', daily: 'weather_code,temperature_2m_max,temperature_2m_min',
    timezone: 'auto', timeformat: 'unixtime', forecast_days: '7', temperature_unit: 'celsius', wind_speed_unit: 'kmh' });
  return url.href;
}
function normalizeWeather(raw) {
  const c = raw?.current, h = raw?.hourly, d = raw?.daily;
  let formatter;
  try { if (typeof raw?.timezone !== 'string') throw new Error(); formatter = new Intl.DateTimeFormat('en-CA', { timeZone: raw.timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }); }
  catch { throw new Error('Open-Meteo вернул неверный часовой пояс.'); }
  const localTime = (epoch) => {
    if (!numeric(epoch)) throw new Error('Open-Meteo вернул неверное время прогноза.');
    const p = Object.fromEntries(formatter.formatToParts(epoch * 1000).map((v) => [v.type, v.value]));
    const time = `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`;
    const offset = Math.round((Date.parse(time + 'Z') / 1000 - epoch) / 60), abs = Math.abs(offset);
    return time + `${offset < 0 ? '-' : '+'}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
  };
  const code = (v) => Number.isInteger(v) && v >= 0 && v <= 99;
  const isDay = (v) => v === 0 || v === 1;
  if (!numeric(c?.temperature_2m) || !code(c?.weather_code) || !isDay(c?.is_day)) throw new Error('Open-Meteo вернул неполные данные о текущей погоде.');
  const hourly = { time: [], temperature_2m: [], weather_code: [], is_day: [] };
  for (let i = 0; i < Math.min(h?.time?.length || 0, 192); i++) {
    if (!numeric(h.temperature_2m?.[i]) || !code(h.weather_code?.[i]) || !isDay(h.is_day?.[i])) continue;
    hourly.time.push(localTime(h.time[i])); hourly.temperature_2m.push(h.temperature_2m[i]);
    hourly.weather_code.push(h.weather_code[i]); hourly.is_day.push(h.is_day[i]);
  }
  const daily = { time: [], temperature_2m_min: [], temperature_2m_max: [], weather_code: [] };
  for (let i = 0; i < Math.min(d?.time?.length || 0, 7); i++) {
    const min = d.temperature_2m_min?.[i], max = d.temperature_2m_max?.[i];
    if (!numeric(min) || !numeric(max) || min > max || !code(d.weather_code?.[i])) continue;
    daily.time.push(localTime(d.time[i]).slice(0, 10)); daily.temperature_2m_min.push(min);
    daily.temperature_2m_max.push(max); daily.weather_code.push(d.weather_code[i]);
  }
  if (!hourly.time.length || !daily.time.length) throw new Error('Open-Meteo не предоставил прогноз. Попробуйте позже.');
  return { source: 'Open-Meteo', sourceUrl: 'https://open-meteo.com/', hourlyStep: 1,
    current: { time: localTime(c.time), temperature_2m: c.temperature_2m, weather_code: c.weather_code, is_day: c.is_day,
      apparent_temperature: numeric(c.apparent_temperature) ? c.apparent_temperature : null,
      relative_humidity_2m: numeric(c.relative_humidity_2m) && c.relative_humidity_2m >= 0 && c.relative_humidity_2m <= 100 ? c.relative_humidity_2m : null,
      wind_speed_10m: numeric(c.wind_speed_10m) ? c.wind_speed_10m : null }, hourly, daily };
}
function createWeather({ config, fetchImpl = fetch, now = Date.now }) {
  let cached = null, pending = null;
  const locations = new Map();
  const keyOf = (w) => JSON.stringify([w.gismeteoId || '', w.city || '', w.region || '', w.lat, w.lon]);
  async function request(url) {
    let response;
    try { response = await fetchImpl(url, { headers: { Accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(20000) }); }
    catch { throw new Error('Нет связи с Open-Meteo. Проверьте интернет и попробуйте ещё раз.'); }
    if (response.status === 429) throw new Error('Достигнут лимит запросов Open-Meteo. Попробуйте позже.');
    if (!response.ok) throw new Error('Open-Meteo временно недоступен. Попробуйте позже.');
    const chunks = []; let size = 0;
    try { for await (const chunk of response.body) { size += chunk.length; if (size > 1024 * 1024) throw new Error('large'); chunks.push(Buffer.from(chunk)); } }
    catch { throw new Error('Не удалось прочитать данные Open-Meteo. Попробуйте позже.'); }
    let raw; try { raw = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new Error('Open-Meteo вернул неверный ответ.'); }
    if (raw?.error) throw new Error('Open-Meteo не смог обработать запрос. Проверьте выбранный город.');
    return raw;
  }
  async function search(query) {
    if (typeof query !== 'string' || query.trim().length < 2 || query.length > 120) return [];
    const url = new URL('https://geocoding-api.open-meteo.com/v1/search');
    url.search = new URLSearchParams({ name: query.trim(), count: '8', language: 'ru', format: 'json' });
    const data = await request(url.href);
    if (data?.results != null && !Array.isArray(data.results)) throw new Error('Open-Meteo вернул неверный список городов.');
    return (data?.results || []).filter((r) => r && typeof r.name === 'string' && validCoords({ lat: r.latitude, lon: r.longitude })).slice(0, 8).map((r) => ({
      name: r.name.slice(0, 100), lat: r.latitude, lon: r.longitude,
      region: typeof r.admin1 === 'string' ? r.admin1.slice(0, 100) : '', country: typeof r.country === 'string' ? r.country.slice(0, 100) : '',
    }));
  }
  async function location(w) {
    // Gismeteo сохранял ID без координат. Не используем старые координаты другого города.
    if (!w.gismeteoId) return w;
    const key = keyOf(w);
    if (locations.has(key)) return locations.get(key);
    const candidates = await search(w.city);
    const exact = candidates.filter((r) => r.name.toLocaleLowerCase('ru') === String(w.city).toLocaleLowerCase('ru'));
    const match = exact.find((r) => w.region && r.region.toLocaleLowerCase('ru') === String(w.region).toLocaleLowerCase('ru')) || (exact.length === 1 ? exact[0] : null);
    if (!match) throw new Error('Выберите город заново в настройках погоды для подключения Open-Meteo.');
    locations.set(key, match); return match;
  }
  async function get(force = false) {
    const w = { ...config() }, key = keyOf(w);
    if (!force && cached?.key === key && now() - cached.at < 15 * 60 * 1000) return cached.data;
    if (pending?.key === key) return pending.promise;
    const promise = (async () => {
      const place = await location(w);
      const data = normalizeWeather(await request(weatherUrl(place)));
      if (key === keyOf(config())) cached = { key, data, at: now() };
      return data;
    })();
    pending = { key, promise };
    try { return await promise; } finally { if (pending?.promise === promise) pending = null; }
  }
  return { get, search, status: () => ({ source: 'Open-Meteo', requiresKey: false, updatedAt: cached?.at ?? null }) };
}
module.exports = { createWeather, normalizeWeather, weatherUrl };
