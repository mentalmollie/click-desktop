(() => {
  const el = (id) => document.getElementById(id);
  const visible = () => !el('page-weather').classList.contains('hidden');
  let requestId = 0, cityKey = '';
  async function refresh(force = false) {
    const id = ++requestId;
    el('weatherTest').disabled = true;
    el('weatherConnection').classList.remove('update-error'); el('weatherConnection').textContent = 'Проверяем Open-Meteo…';
    try {
      const result = await dock.weather(force);
      if (id !== requestId) return;
      el('weatherConnection').textContent = result.ok ? `Подключено · сейчас ${Math.round(result.data.current.temperature_2m)}° · ${weatherText(result.data.current.weather_code)}. Данные Open-Meteo.` : result.message;
      el('weatherConnection').classList.toggle('update-error', !result.ok);
    } catch {
      if (id === requestId) { el('weatherConnection').textContent = 'Не удалось проверить Open-Meteo. Попробуйте ещё раз.'; el('weatherConnection').classList.add('update-error'); }
    } finally { if (id === requestId) el('weatherTest').disabled = false; }
  }
  el('weatherTest').addEventListener('click', () => refresh(true));
  el('weatherWebsite').addEventListener('click', () => dock.weatherWebsite());
  document.querySelector('[data-page="weather"]').addEventListener('click', () => refresh());
  dock.onConfig((cfg) => {
    const next = JSON.stringify([cfg.weather.gismeteoId || '', cfg.weather.city, cfg.weather.region, cfg.weather.lat, cfg.weather.lon]);
    if (next !== cityKey) { cityKey = next; requestId++; if (visible()) refresh(); }
  });
})();
