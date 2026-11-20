// Delegation keeps targets current when dock icons are rebuilt. Native file drag stays native.
function installFileDrop(document, dock, timers = globalThis) {
  let target = null, hoverTimer = null, expiry = null, leaseAt = 0;
  const filesDrag = event => Array.from(event.dataTransfer?.types || []).includes('Files');
  const clear = () => {
    timers.clearTimeout(hoverTimer); timers.clearTimeout(expiry);
    if (target) target.classList.remove('file-drop-over');
    target = null;
    dock.fileDrag(false);
  };
  const select = button => {
    if (button === target) return;
    timers.clearTimeout(hoverTimer);
    if (target) target.classList.remove('file-drop-over');
    target = button;
    if (!target) return;
    target.classList.add('file-drop-over');
    const selected = target;
    hoverTimer = timers.setTimeout(() => {
      if (target === selected && selected.isConnected) dock.fileHover(JSON.parse(selected.dataset.fileTarget)).catch(() => {});
    }, 650);
  };
  document.addEventListener('dragover', event => {
    if (!filesDrag(event)) return;
    event.preventDefault(); // Prevent Chromium from navigating to a dropped document.
    const button = event.target.closest?.('[data-file-target]') || null;
    event.dataTransfer.dropEffect = button ? 'copy' : 'none';
    select(button);
    if (!leaseAt || Date.now() - leaseAt > 400) { dock.fileDrag(true); leaseAt = Date.now(); }
    timers.clearTimeout(expiry);
    expiry = timers.setTimeout(clear, 1500);
  });
  document.addEventListener('dragleave', event => {
    if (!event.relatedTarget || !document.documentElement.contains(event.relatedTarget)) clear();
  });
  document.addEventListener('drop', async event => {
    if (!filesDrag(event)) return;
    event.preventDefault();
    const button = event.target.closest?.('[data-file-target]');
    const destination = button?.dataset.fileTarget;
    const files = Array.from(event.dataTransfer.files || []);
    clear();
    if (!destination || !files.length) return;
    try {
      const result = await dock.dropFiles(JSON.parse(destination), files);
      if (result.ok && button.isConnected) {
        button.classList.add('file-drop-sent');
        timers.setTimeout(() => button.classList.remove('file-drop-sent'), 1000);
      }
    } catch { /* Main process reports a handoff failure to the user. */ }
  });
  document.addEventListener('dragend', clear);
  document.defaultView?.addEventListener('pagehide', clear);
  return { clear };
}
if (typeof module !== 'undefined') module.exports = { installFileDrop };
