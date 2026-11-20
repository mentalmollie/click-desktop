const UPDATE_INTERVAL = 6 * 60 * 60 * 1000;

// Проверяем только сведения о версии. Загрузка и установка остаются ручными.
function createUpdateScheduler({ check, now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout, startupDelay = 5000 }) {
  let enabled = false, stopped = false, timer = null, lastAttempt = null, pending = false;
  function clear() { if (timer !== null) clearTimer(timer); timer = null; }
  function schedule(delay) {
    clear();
    if (enabled && !stopped) { timer = setTimer(tick, delay); timer?.unref?.(); }
  }
  async function tick() {
    if (!enabled || stopped || pending) return;
    clear(); pending = true; lastAttempt = now();
    try { await check(); } catch { /* Статус сетевой ошибки показывает updater. */ }
    finally { pending = false; schedule(Math.max(0, UPDATE_INTERVAL - (now() - lastAttempt))); }
  }
  return {
    setEnabled(value) {
      const next = value === true;
      if (enabled === next || stopped) return;
      enabled = next;
      if (enabled) schedule(lastAttempt === null ? startupDelay : Math.max(0, UPDATE_INTERVAL - (now() - lastAttempt)));
      else clear();
    },
    resume() {
      if (!enabled || stopped || pending) return;
      if (lastAttempt !== null && now() - lastAttempt >= UPDATE_INTERVAL) tick();
    },
    stop() { stopped = true; enabled = false; clear(); },
  };
}
module.exports = { createUpdateScheduler, UPDATE_INTERVAL };
