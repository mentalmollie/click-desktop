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
  dock.onUpdateStatus(render);
  perform('updateStatus');
})();
