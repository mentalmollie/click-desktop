const assert = require('node:assert/strict');
const { createWeather } = require('../weather');
(async () => {
  for (const [city, region] of [['Москва', 'Москва'], ['Новосибирск', 'Новосибирская область'], ['Владивосток', 'Приморский край']]) {
    let cfg = { city, region, gismeteoId: 1, lat: 55.75, lon: 37.62 };
    const service = createWeather({ config: () => cfg });
    const cities = await service.search(city);
    assert.ok(cities.length, city + ': city search failed');
    const result = await service.get();
    assert.equal(result.source, 'Open-Meteo'); assert.ok(result.hourly.time.length >= 24); assert.equal(result.daily.time.length, 7);
    console.log(`PASS ${city}: ${result.current.temperature_2m}°C; ${result.current.time}; hourly=${result.hourly.time.length}; daily=${result.daily.time.length}`);
  }
})().catch((e) => { console.error(e.message); process.exitCode = 1; });
