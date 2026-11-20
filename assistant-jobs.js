const { randomUUID } = require('node:crypto');
const formatDuration = (seconds) => {
  const n = Math.max(0, Math.ceil(seconds)), parts = [];
  if (n >= 3600) parts.push(`${Math.floor(n / 3600)} ч`);
  if (n % 3600 >= 60) parts.push(`${Math.floor(n % 3600 / 60)} мин`);
  if (n % 60 || !parts.length) parts.push(`${n % 60} сек`);
  return parts.join(' ');
};
// Выключение живёт только в этом запуске Click. Таймеры хранятся как напоминания.
function createAssistantJobs({ getReminders, saveReminders, confirmShutdown, shutdown, notify, now = Date.now }) {
  let pending = null, confirming = false, executing = false;
  const timers = () => getReminders().filter((r) => r.kind === 'timer' && r.at > now());
  async function act(name, args = {}) {
    const seconds = args.seconds;
    switch (name) {
      case 'start_timer': {
        if (!Number.isInteger(seconds) || seconds < 1 || seconds > 86400) return { ok: false, text: 'Таймер можно поставить от 1 секунды до 24 часов.' };
        if (timers().length >= 10) return { ok: false, text: 'Уже запущено 10 таймеров. Сначала отмени один из них.' };
        const label = formatDuration(seconds);
        saveReminders([...getReminders(), { id: randomUUID(), kind: 'timer', createdAt: now(), at: now() + seconds * 1000, text: `Таймер на ${label} завершён.` }].sort((a, b) => a.at - b.at));
        return { ok: true, text: `Таймер на ${label} запущен. Скажи «сколько осталось» или «отмени таймер».` };
      }
      case 'list_timers': {
        const list = timers();
        return { ok: true, text: list.length ? list.map((r, i) => `Таймер ${i + 1}: осталось ${formatDuration((r.at - now()) / 1000)}.`).join('\n') : 'Активных таймеров нет.' };
      }
      case 'cancel_timer': {
        const list = timers();
        if (!list.length) return { ok: true, text: 'Активных таймеров нет.' };
        const id = list.reduce((last, r) => (r.createdAt || 0) >= (last.createdAt || 0) ? r : last).id;
        saveReminders(getReminders().filter((r) => args.all === true ? r.kind !== 'timer' : r.id !== id));
        return { ok: true, text: args.all === true ? 'Все таймеры отменены.' : 'Таймер отменён.' };
      }
      case 'schedule_shutdown': {
        if (!Number.isInteger(seconds) || seconds < 0 || seconds > 86400) return { ok: false, text: 'Выключение можно запланировать не больше чем через 24 часа.' };
        if (confirming || executing) return { ok: false, text: 'Сначала закончи подтверждение выключения.' };
        confirming = true;
        let approved;
        try { approved = await confirmShutdown(seconds); } finally { confirming = false; }
        if (!approved) return { ok: true, text: 'Выключение не запланировано.' };
        pending = { at: now() + seconds * 1000, warned: false };
        return { ok: true, text: seconds ? `Компьютер выключится через ${formatDuration(seconds)}. Для отмены скажи «отмени выключение». Click должен оставаться запущенным.` : 'Выключаю компьютер.' };
      }
      case 'cancel_shutdown': {
        const had = !!pending; pending = null;
        return { ok: true, text: had ? 'Запланированное выключение отменено.' : 'Выключение не запланировано.' };
      }
      case 'shutdown_status': return { ok: true, text: pending ? `До выключения ${formatDuration((pending.at - now()) / 1000)}. Можно сказать «отмени выключение».` : 'Выключение не запланировано.' };
      default: return { ok: false, text: 'Неизвестная команда таймера.' };
    }
  }
  async function tick() {
    if (!pending || executing) return;
    const left = pending.at - now();
    if (left > 0) {
      if (left <= 30000 && !pending.warned) { pending.warned = true; notify('До выключения компьютера осталось меньше 30 секунд. Скажи «отмени выключение», чтобы отменить.'); }
      return;
    }
    pending = null;
    // Не выключаем внезапно после сна компьютера или долгой блокировки главного процесса.
    if (left < -30000) { notify('Пропущенное во время сна выключение отменено.'); return; }
    executing = true;
    try { await shutdown(); } catch { notify('Windows не смогла выключить компьютер. Попробуй через меню «Пуск».'); }
    finally { executing = false; }
  }
  return { act, tick, status: () => ({ shutdownAt: pending?.at ?? null, timers: timers().map((r) => ({ id: r.id, at: r.at, text: r.text })) }), stop: () => { pending = null; } };
}
module.exports = { createAssistantJobs, formatDuration };
