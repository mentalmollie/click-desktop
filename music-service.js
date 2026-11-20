// Выбор сервиса одинаков для команд, нейросети и настроек.
(function (root) {
  const selected = (cfg) => cfg?.assistant?.musicService === 'yandex_music' ? 'yandex_music' : 'spotify';
  const servicePattern = '(?:яндекс[ .-]*(?:музык[а-я]*|music)|yandex[ .-]*music|спотифай|spotify|youtube[ .-]*music|ютуб[ .-]*музык[а-я]*)';
  function explicit(text) {
    const s = String(text || '').toLowerCase().replace(/ё/g, 'е');
    if (/(?:яндекс[ .-]*(?:музык|music)|yandex[ .-]*music)/.test(s)) return 'yandex_music';
    if (/(?:спотифай|spotify)/.test(s)) return 'spotify';
    if (/(?:youtube[ .-]*music|ютуб[ .-]*музык)/.test(s)) return 'youtube_music';
    return null;
  }
  const forText = (text, cfg) => explicit(text) || selected(cfg);
  function parse(text, preferred = 'spotify') {
    const s = String(text || '').trim().replace(/[.!?,]+$/, '').replace(/^(?:а|пожалуйста)[,\s]+/i, '');
    const open = s.match(new RegExp('^(?:открой|запусти|включи)\\s+(?:мне\\s+)?(' + servicePattern + ')$', 'i'));
    if (open) return explicit(open[1]) === 'yandex_music' ? { name: 'open_music', args: { service: 'yandex_music' } } : { name: 'open_website', args: { url: explicit(open[1]) === 'youtube_music' ? 'https://music.youtube.com/' : 'https://open.spotify.com/' } };
    const m = s.match(/^(?:включи|поставь|запусти|найди|поищи)(?:\s+мне)?\s+(.+)$/i);
    if (!m) return null;
    const named = explicit(s);
    if (!named && !/^(?:песню|трек|альбом|плейлист|любимые\s+треки|что-нибудь\s+из|что-то\s+из)\s*\S/i.test(m[1])) return null;
    const kind = /^альбом\s/i.test(m[1]) ? 'album' : /^плейлист\s/i.test(m[1]) ? 'playlist' : /^(?:что-нибудь|что-то)\s+из\s/i.test(m[1]) ? 'artist' : /^любимые\s+треки/i.test(m[1]) ? 'liked' : 'track';
    const query = m[1].replace(new RegExp('^(?:в|на)\\s+' + servicePattern + '\\s+', 'i'), '')
      .replace(new RegExp('\\s+(?:в|на)\\s+' + servicePattern + '$', 'i'), '')
      .replace(/^(?:песню|трек|альбом|плейлист|(?:что-нибудь|что-то)\s+из)\s+/i, '').trim();
    if (!query) return { text: 'Какую песню или исполнителя найти?' };
    return { name: 'play_media', args: { query, service: named || (preferred === 'yandex_music' ? 'yandex_music' : 'spotify'), kind } };
  }
  const api = { selected, explicit, forText, parse };
  if (typeof module !== 'undefined') module.exports = api;
  else root.MusicServices = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
