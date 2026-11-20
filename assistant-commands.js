// Общий разбор быстрых команд для текста и голоса. Без вызовов нейросети и системных действий.
(function (root) {
  const Music = typeof module !== 'undefined' ? require('./music-service') : root.MusicServices;
  const normalize = (text) => String(text || '').toLowerCase().replace(/ё/g, 'е').replace(/[,.!?;:]+/g, ' ').replace(/\s+/g, ' ').trim();
  const numbers = { ноль: 0, один: 1, одну: 1, одна: 1, два: 2, две: 2, три: 3, четыре: 4, пять: 5, шесть: 6, семь: 7, восемь: 8, девять: 9, десять: 10, одиннадцать: 11, двенадцать: 12, тринадцать: 13, четырнадцать: 14, пятнадцать: 15, шестнадцать: 16, семнадцать: 17, восемнадцать: 18, девятнадцать: 19, двадцать: 20, тридцать: 30, сорок: 40, пятьдесят: 50, шестьдесят: 60, девяносто: 90 };
  function duration(text) {
    const s = normalize(text);
    if (/^(полчаса|пол часа)$/.test(s)) return 1800;
    if (/^(полтора часа|полторачаса)$/.test(s)) return 5400;
    let total = 0, matched = false;
    const rest = s.replace(/(?:(\d+(?:[.]\d+)?|[а-я]+(?:\s+[а-я]+)?)\s+)?(секунд[а-я]*|сек|минут[а-я]*|мин|час[а-я]*|ч)(?=\s|$)/g, (full, value, unit) => {
      let n = 1;
      if (value) {
        if (/^\d+$/.test(value)) n = Number(value);
        else {
          const words = value.split(' ');
          if (!words.every((w) => Object.hasOwn(numbers, w))) return full;
          n = words.reduce((sum, w) => sum + numbers[w], 0);
        }
      }
      matched = true; total += n * (/^ч/.test(unit) ? 3600 : /^м/.test(unit) ? 60 : 1); return '';
    }).replace(/\s+и\s+/g, ' ').trim();
    return matched && !rest && Number.isSafeInteger(total) && total > 0 && total <= 86400 ? total : null;
  }
  function parse(text, musicService = 'spotify') {
    const s = normalize(text).replace(/^(?:пожалуйста\s+|а\s+|ну\s+)+/, '').replace(/\s+пожалуйста$/, '');
    let m;
    if (/^(?:отмени|отменить|останови|убери)\s+(?:все\s+)?таймеры?$/.test(s)) return { name: 'cancel_timer', args: { all: /все/.test(s) } };
    if (/^(?:(?:мои|покажи)\s+)?таймеры$|^(?:сколько осталось|сколько времени осталось)(?:\s+(?:на таймере|до конца таймера))?$/.test(s)) return { name: 'list_timers', args: {} };
    if ((m = s.match(/^(?:(?:поставь|установи|запусти|включи|заведи)(?:\s+мне)?\s+)?таймер(?:\s+(?:на|через))?(?:\s+(.+))?$/))) {
      const seconds = duration(m[1]);
      return seconds ? { name: 'start_timer', args: { seconds } } : { text: 'Укажи время: «таймер на пять минут» или «таймер на 30 секунд».' };
    }
    if (/^(?:отмени|отменить|останови)\s+(?:запланированное\s+)?(?:выключение|отключение)(?:\s+(?:компьютера|ноутбука|пк))?$|^не выключай\s+(?:компьютер|ноутбук|пк)$/.test(s)) return { name: 'cancel_shutdown', args: {} };
    if (/^(?:когда|через сколько)\s+(?:выключится|отключится)\s+(?:компьютер|ноутбук|пк)$/.test(s)) return { name: 'shutdown_status', args: {} };
    if ((m = s.match(/^(?:выключи|отключи|выключить)\s+(?:компьютер|ноутбук|пк)(?:\s+через\s+(.+))?$/))) {
      const seconds = m[1] ? duration(m[1]) : 0;
      return seconds !== null ? { name: 'schedule_shutdown', args: { seconds } } : { text: 'Укажи время выключения: например, «выключи компьютер через десять минут».' };
    }
    if (/^(?:открой|покажи|включи)\s+(?:мне\s+)?погоду$/.test(s)) return { name: 'open_weather', args: {} };
    if (/^(?:открой|запусти|включи)\s+(?:мне\s+)?(?:сайт\s+)?(?:ютуб|ютюб|youtube)$/.test(s)) return { name: 'open_website', args: { url: 'https://www.youtube.com/' } };
    if ((m = s.match(/^(?:найди|поищи|ищи)(?:\s+мне)?\s+(?:на|в)\s+(?:ютубе|ютюбе|youtube)\s+(.+)$/)) || (m = s.match(/^(?:найди|поищи)(?:\s+мне)?\s+(.+)\s+(?:на|в)\s+(?:ютубе|ютюбе|youtube)$/))) {
      return { name: 'search_youtube', args: { query: m[1].replace(/^(?:песню|песня|видео|ролик)\s+/, '').trim() } };
    }
    return Music.parse(text, musicService);
  }
  const api = { parse, duration, normalize };
  if (typeof module !== 'undefined') module.exports = api;
  else root.AssistantCommands = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
