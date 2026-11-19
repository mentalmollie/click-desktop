(() => {
  const el = (id) => document.getElementById(id);
  const megabytes = (bytes) => (bytes / 1048576).toFixed(1) + ' МБ';
  function render(state) {
    const busy = ['checking', 'downloading', 'installing'].includes(state.phase);
    el('updateCurrentVersion').textContent = 'Click ' + state.currentVersion;
    if (el('updateMessage').textContent !== state.message) el('updateMessage').textContent = state.message;
    el('updateCheck').disabled = busy;
    el('updateCheck').textContent = state.phase === 'checking' ? 'Проверяем…' : 'Проверить обновления';
    el('updateDownload').classList.toggle('hidden', !state.canDownload);
    el('updateInstall').classList.toggle('hidden', !state.canInstall);
    el('updateCancel').classList.toggle('hidden', state.phase !== 'downloading');
    el('updateProgressWrap').classList.toggle('hidden', state.phase !== 'downloading');
    el('updateProgress').value = state.progress;
    el('updateProgressText').textContent = `${state.progress}% · ${megabytes(state.received)} из ${megabytes(state.total)}`;
    el('updateNotes').classList.toggle('hidden', !state.notes);
    el('updateNotes').textContent = state.notes ? 'Что нового в версии ' + state.availableVersion + '\n' + state.notes : '';
    el('updateMessage').classList.toggle('update-error', state.phase === 'error');
  }
  async function perform(method) {
    try { render(await dock[method]()); }
    catch { el('updateMessage').textContent = 'Не удалось выполнить действие. Попробуйте ещё раз.'; }
  }
  el('updateCheck').addEventListener('click', () => perform('updateCheck'));
  el('updateDownload').addEventListener('click', () => perform('updateDownload'));
  el('updateInstall').addEventListener('click', () => perform('updateInstall'));
  el('updateCancel').addEventListener('click', () => dock.updateCancel());
  el('updateWebsite').addEventListener('click', () => dock.updateWebsite());
  el('updateGithub').addEventListener('click', () => dock.updateGithub());
  let historyBusy = false;
  async function history() {
    if (historyBusy) return;
    historyBusy = true;
    el('releaseHistoryRefresh').disabled = true;
    try {
      const result = await dock.updateHistory();
      el('releaseHistoryStatus').textContent = result.offline ? 'GitHub недоступен. Показаны изменения установленной версии.' : 'История версий из GitHub Releases.';
      el('releaseHistory').replaceChildren();
      for (const r of result.releases) {
        const card = document.createElement('article'); card.className = 'card release-card';
        const title = document.createElement('h2'); title.textContent = 'Click ' + r.version;
        const notes = document.createElement('div'); notes.className = 'release-body'; notes.textContent = r.notes || 'Описание этой версии пока не добавлено.';
        card.append(title);
        if (r.date && Number.isFinite(Date.parse(r.date))) { const date = document.createElement('p'); date.className = 'desc'; date.textContent = new Date(r.date).toLocaleDateString('ru-RU'); card.append(date); }
        card.append(notes); el('releaseHistory').append(card);
      }
    } catch { el('releaseHistoryStatus').textContent = 'Не удалось загрузить историю версий. Попробуйте ещё раз.'; }
    finally { historyBusy = false; el('releaseHistoryRefresh').disabled = false; }
  }
  el('releaseHistoryRefresh').addEventListener('click', history);
  document.querySelector('[data-page="whatsnew"]').addEventListener('click', history);
  dock.onUpdateStatus(render);
  perform('updateStatus');
})();
