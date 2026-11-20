(() => {
  const state = document.getElementById('asShutdownState'), cancel = document.getElementById('asShutdownCancel');
  const visible = () => !document.getElementById('page-assistant').classList.contains('hidden');
  let busy = false;
  async function refresh() {
    if (busy || !visible() || typeof dock.assistJobs !== 'function') return;
    try {
      const status = await dock.assistJobs();
      if (!status) return;
      for (const timer of status.timers || []) {
        const row = [...document.querySelectorAll('[data-timer-id]')].find((r) => r.dataset.timerId === timer.id);
        const seconds = Math.max(0, Math.ceil((timer.at - Date.now()) / 1000));
        if (row) row.querySelector('.name').textContent = `Таймер · осталось ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
      }
      const at = status.shutdownAt;
      cancel.classList.toggle('hidden', !at);
      state.textContent = at ? `Запланировано на ${new Date(at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })} · осталось ${Math.max(0, Math.ceil((at - Date.now()) / 1000))} сек` : 'Не запланировано';
    } catch { state.textContent = 'Не удалось проверить запланированное выключение'; }
  }
  cancel.addEventListener('click', async () => {
    busy = true; cancel.disabled = true;
    try { const result = await dock.assistAct('cancel_shutdown', {}); state.textContent = result.text; }
    catch { state.textContent = 'Не удалось отменить выключение. Попробуй ещё раз.'; }
    finally { busy = false; cancel.disabled = false; refresh(); }
  });
  document.querySelector('[data-page="assistant"]').addEventListener('click', refresh);
  setInterval(refresh, 1000);
})();
