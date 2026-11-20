const keyOf = (exe) => typeof exe === 'string' ? exe.toLowerCase() : '';
function createTrayManager({ readItems, endTask, ownExecutable, onUpdated = () => {}, now = Date.now, ttl = 1500 }) {
  let items = [], loadedAt = null, pending = null, signature = '';
  const closing = new Set();
  async function list(force = false) {
    if (pending) return pending;
    if (!force && loadedAt !== null && now() - loadedAt < ttl) return items;
    const work = (async () => {
      const raw = await readItems();
      if (!Array.isArray(raw)) throw new Error('Не удалось обновить скрытые значки.');
      const seen = new Set();
      const next = raw.filter((item) => {
        const key = keyOf(item?.exe);
        if (!key || key === keyOf(ownExecutable) || seen.has(key)) return false;
        seen.add(key); return true;
      });
      const nextSignature = JSON.stringify(next);
      items = next; loadedAt = now();
      if (signature !== nextSignature) { signature = nextSignature; onUpdated(items); }
      return items;
    })();
    pending = work;
    try { return await work; } finally { if (pending === work) pending = null; }
  }
  async function close(exe) {
    const key = keyOf(exe);
    if (!key || key === keyOf(ownExecutable)) return { ok: false, text: 'Эту задачу нельзя завершить из скрытых значков.' };
    if (closing.has(key)) return { ok: false, text: 'Задача уже завершается.' };
    closing.add(key);
    try {
      const fresh = await list(true), item = fresh.find((i) => keyOf(i.exe) === key);
      if (!item) return { ok: false, text: 'Приложение уже закрыто или значок больше недоступен.' };
      const result = await endTask(item.exe);
      // Завершающийся старый запрос не должен вернуть уже закрытое приложение в список.
      if (pending) await pending.catch(() => {});
      loadedAt = null;
      try { await list(true); } catch { /* Следующее автообновление повторит чтение. */ }
      return result?.ok ? { ok: true, text: `Задача «${item.name || 'Приложение'}» завершена.` }
        : { ok: false, text: result?.text || 'Не удалось завершить задачу. Возможно, нужны права администратора.' };
    } catch { return { ok: false, text: 'Не удалось завершить задачу. Попробуй ещё раз.' }; }
    finally { closing.delete(key); }
  }
  return { list, close, current: () => items };
}
module.exports = { createTrayManager };
