(() => {
  const el = (id) => document.getElementById(id);
  const megabytes = (bytes) => (bytes / 1048576).toFixed(1) + ' МБ';
  function render(state) {
    const busy = ['checking', 'downloading', 'installing'].includes(state.phase);
    el('updateCurrentVersion').textContent = 'Версия ' + state.currentVersion;
    el('updateMessage').classList.toggle('hidden', state.phase === 'idle');
    if (el('updateMessage').textContent !== state.message) el('updateMessage').textContent = state.message;
    el('updateCheck').disabled = busy;
    el('updateCheck').textContent = state.phase === 'checking' ? 'Проверяем…' : 'Проверить сейчас';
    el('updateDownload').classList.toggle('hidden', !state.canDownload);
    el('updateInstall').classList.toggle('hidden', !state.canInstall);
    el('updateCancel').classList.toggle('hidden', state.phase !== 'downloading');
    el('updateActions').classList.toggle('hidden', !state.canDownload && !state.canInstall && state.phase !== 'downloading');
    el('updateProgressWrap').classList.toggle('hidden', state.phase !== 'downloading');
    el('updateProgress').value = state.progress;
    el('updateProgressText').textContent = `${state.progress}% · ${megabytes(state.received)} из ${megabytes(state.total)}`;
    el('updateNotes').classList.toggle('hidden', !state.notes);
    el('updateNotes').textContent = state.notes ? 'Что нового в версии ' + state.availableVersion + '\n' + state.notes : '';
    el('updateMessage').classList.toggle('update-error', state.phase === 'error');
  }
  async function perform(method) {
    try { render(await dock[method]()); }
    catch { el('updateMessage').textContent = 'Не удалось выполнить действие. Попробуйте ещё раз.'; el('updateMessage').classList.remove('hidden'); }
  }
  el('updateCheck').addEventListener('click', () => { perform('updateCheck'); history(true); });
  el('updateDownload').addEventListener('click', () => perform('updateDownload'));
  el('updateInstall').addEventListener('click', () => perform('updateInstall'));
  el('updateCancel').addEventListener('click', () => dock.updateCancel());
  el('updateReleases').addEventListener('click', () => dock.updateReleases());
  let historyBusy = false, historyLoadedAt = 0;
  async function history(force = false) {
    if (historyBusy || (!force && historyLoadedAt && Date.now() - historyLoadedAt < 5 * 60 * 1000)) return;
    historyBusy = true;
    try {
      const result = await dock.updateHistory();
      el('releaseHistoryStatus').textContent = result.offline ? 'Нет связи с GitHub. Изменения установленной версии доступны ниже.' : '';
      el('releaseHistoryStatus').classList.toggle('hidden', !result.offline);
      const expanded = new Set([...el('releaseHistory').querySelectorAll('details[open]')].map((d) => d.dataset.version));
      const entries = [];
      for (const r of result.releases.slice(0, 3)) {
        const card = document.createElement('details'); card.className = 'release-entry';
        card.dataset.version = r.version; card.open = expanded.has(r.version);
        const title = document.createElement('summary'); title.textContent = 'Версия ' + r.version;
        const notes = document.createElement('div'); notes.className = 'release-body'; notes.textContent = r.notes || 'Описание этой версии пока не добавлено.';
        card.append(title, notes); entries.push(card);
      }
      el('releaseHistory').replaceChildren(...entries);
      if (!result.offline) historyLoadedAt = Date.now();
    } catch { el('releaseHistoryStatus').textContent = 'Не удалось загрузить историю версий. Нажмите «Проверить сейчас», чтобы повторить.'; el('releaseHistoryStatus').classList.remove('hidden'); }
    finally { historyBusy = false; }
  }
  document.querySelector('[data-page="updates"]').addEventListener('click', () => history());
  let autoCheck = true, setting = false;
  async function loadPreferences() {
    try {
      autoCheck = (await dock.updatePreferences()).autoCheck;
      el('updateAutoCheck').checked = autoCheck;
      el('updateAutoCheck').disabled = false;
    } catch { el('updateMessage').textContent = 'Не удалось загрузить настройки автопроверки.'; el('updateMessage').classList.remove('hidden'); }
  }
  el('updateAutoCheck').addEventListener('change', async () => {
    const input = el('updateAutoCheck');
    setting = true; input.disabled = true;
    try { autoCheck = (await dock.updateSetAutoCheck(input.checked)).autoCheck; }
    catch { el('updateMessage').textContent = 'Не удалось сохранить настройку автопроверки.'; el('updateMessage').classList.remove('hidden'); }
    finally { input.checked = autoCheck; input.disabled = false; setting = false; }
  });
  dock.onConfig((cfg) => {
    if (!setting) { autoCheck = cfg.updates?.autoCheck !== false; el('updateAutoCheck').checked = autoCheck; }
  });
  dock.onUpdateStatus(render);
  loadPreferences();
  perform('updateStatus');
})();
