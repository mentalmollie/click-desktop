(() => {
  const el = (id) => document.getElementById(id);
  async function render() {
    try {
      const s = await dock.weatherStatus();
      el('weatherKeyState').textContent = s.hasKey ? 'Ключ сохранён на этом компьютере.' : 'Добавьте ключ, чтобы видеть прогноз в Click.';
      el('weatherKeyDelete').classList.toggle('hidden', !s.hasKey);
      el('weatherKeySave').disabled = !s.encryptionAvailable;
      if (!s.encryptionAvailable) el('weatherConnection').textContent = 'Хранилище ключей Windows недоступно. Перезапустите Click.';
    } catch { el('weatherKeyState').textContent = 'Не удалось проверить подключение.'; }
  }
  async function test() {
    el('weatherTest').disabled = true;
    el('weatherConnection').textContent = 'Проверяем Яндекс Погоду…';
    try {
      const result = await dock.weather();
      el('weatherConnection').textContent = result.ok ? `Подключено · сейчас ${Math.round(result.data.current.temperature_2m)}°` : result.message;
    } catch { el('weatherConnection').textContent = 'Не удалось проверить подключение.'; }
    finally { el('weatherTest').disabled = false; }
  }
  el('weatherKeySave').addEventListener('click', async () => {
    const key = el('weatherKey').value.trim();
    if (!key) return;
    try {
      await dock.weatherSetKey(key);
      el('weatherKey').value = '';
      await render(); await test();
    } catch { el('weatherConnection').textContent = 'Не удалось сохранить ключ. Проверьте хранилище Windows.'; }
  });
  el('weatherKeyDelete').addEventListener('click', async () => {
    try { await dock.weatherSetKey(''); el('weatherKey').value = ''; el('weatherConnection').textContent = 'Ключ удалён.'; await render(); }
    catch { el('weatherConnection').textContent = 'Не удалось удалить ключ.'; }
  });
  el('weatherTest').addEventListener('click', test);
  el('weatherPortal').addEventListener('click', () => dock.weatherPortal());
  render();
})();
