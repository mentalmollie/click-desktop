// Помощники PowerShell (winkey, keys, media, mediactl, windows, appbar) — в одном процессе host.ps1.
// helperProc(name) отдаёт объект, похожий на дочерний процесс: stdout ('data' — строки с \n),
// stdin.write / stdin.end, kill(), событие 'exit'. Так main.js почти не меняется.
// Отдельно остаётся только taskbar.ps1: он должен вернуть панель задач, даже если упадёт всё остальное.
const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const path = require('path');

let host = null;
const live = new Map();       // имя → объект помощника
const stopping = new Set();   // остановлены, но хозяин ещё не подтвердил (!exit)
const pending = new Set();    // запустить сразу после подтверждения остановки

function send(line) {
  const h = ensureHost();
  try { h.stdin.write(line + '\n'); } catch {}
}

function ensureHost() {
  if (host) return host;
  const h = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'host.ps1')], { windowsHide: true });
  host = h;
  h.stdout.setEncoding('utf8');
  let buf = '';
  h.stdout.on('data', (chunk) => {
    buf += chunk;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).replace(/\r$/, '');
      buf = buf.slice(i + 1);
      const sp = line.indexOf(' ');
      if (sp < 0) continue;
      const name = line.slice(0, sp), rest = line.slice(sp + 1);
      if (rest === '!exit') {
        if (stopping.delete(name)) {
          if (pending.delete(name)) send('+' + name);
          continue;
        }
        const p = live.get(name);
        live.delete(name);
        if (p) p.emit('exit', 1);
        continue;
      }
      if (rest.startsWith('!err ')) { console.warn(`[${name}]`, rest.slice(5)); continue; }
      if (stopping.has(name)) continue;
      const p = live.get(name);
      if (p) p.stdout.emit('data', rest + '\n');
    }
  });
  h.stderr.on('data', (d) => console.warn('[host]', String(d).trim().slice(0, 300)));
  h.stdin.on('error', () => {});
  h.on('exit', () => {
    if (host === h) host = null;
    stopping.clear();
    pending.clear();
    const all = [...live.values()];
    live.clear();
    for (const p of all) p.emit('exit', 1);
  });
  return h;
}

function helperProc(name) {
  const p = new EventEmitter();
  p.stdout = new EventEmitter();
  p.stdout.setEncoding = () => {};
  p.stderr = new EventEmitter();
  p.stderr.setEncoding = () => {};
  let dead = false;
  const stop = () => {
    if (dead) return;
    dead = true;
    if (live.get(name) === p) live.delete(name);
    stopping.add(name);
    send('-' + name);
  };
  p.stdin = {
    write: (s) => {
      if (dead) return false;
      for (const line of String(s).split(/\r?\n/)) if (line !== '') send(`${name} ${line}`);
      return true;
    },
    end: stop,
    on: () => {},
  };
  p.kill = stop;
  // Прошлый такой же помощник ещё останавливается — запустим этот сразу после него
  const prev = live.get(name);
  if (prev) prev.kill();
  live.set(name, p);
  if (stopping.has(name)) pending.add(name);
  else send('+' + name);
  return p;
}

module.exports = { helperProc };
