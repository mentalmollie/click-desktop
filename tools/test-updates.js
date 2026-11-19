const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { createUpdater, validateManifest, newer, fileHash } = require('../updates');
const { createRelease } = require('./create-release');
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const base = 'https://updates.example.test/updates/latest.json';

(async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'click-updates-test-'));
  try {
    const bytes = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(250000, 91)]);
    const pieces = [bytes.subarray(0, 50000), bytes.subarray(50000, 170000), bytes.subarray(170000)];
    const manifest = { version: '1.0.10', platform: 'win32', arch: 'x64', size: bytes.length, sha256: sha(bytes), notes: 'Новое обновление',
      files: pieces.map((p, i) => ({ url: `./1.0.10/part-${i}.bin`, size: p.length, sha256: sha(p) })) };
    assert.equal(newer('1.0.10', '1.0.9'), true);
    assert.equal(newer('1.0.9', '1.0.10'), false);
    assert.equal(newer('1.0.9', '1.0.9'), false);
    assert.throws(() => newer('../9', '1.0.0'));
    assert.throws(() => validateManifest({ ...manifest, files: [{ ...manifest.files[0], url: 'https://evil.test/a.exe' }] }, base));
    assert.throws(() => validateManifest({ ...manifest, files: [{ ...manifest.files[0], url: 'http://updates.example.test/a' }] }, base));
    assert.throws(() => validateManifest({ ...manifest, size: bytes.length - 1 }, base));
    assert.throws(() => validateManifest({ ...manifest, sha256: 'not-a-hash' }, base));
    assert.throws(() => validateManifest({ ...manifest, platform: 'darwin' }, base));
    let mode = 'normal', requests = 0, launchCount = 0, updater;
    const states = [];
    const fetchImpl = async (url) => {
      requests++;
      if (mode === 'offline') throw new TypeError('fetch failed');
      if (url === base) return new Response(mode === 'html' ? '<html>Sign in</html>' : JSON.stringify(manifest));
      const index = Number(new URL(url).pathname.match(/part-(\d+)\.bin$/)?.[1]);
      if (!Number.isInteger(index)) return new Response('missing', { status: 404 });
      return new Response(mode === 'corrupt' && index === 1 ? Buffer.alloc(pieces[index].length, 0) : pieces[index]);
    };
    updater = createUpdater({ currentVersion: '1.0.9', feedUrl: base, websiteUrl: 'https://updates.example.test', directory, fetchImpl,
      launch: async (filename) => { assert.equal(await fileHash(filename), manifest.sha256); launchCount++; },
      onChange: (s) => { states.push(s); if (mode === 'cancel' && s.phase === 'downloading' && s.received > 0) updater.cancel(); },
    });
    const check = updater.check(); assert.equal(updater.check(), check, 'concurrent checks must share a single request');
    assert.equal((await check).phase, 'available');
    assert.equal(requests, 1);
    assert.equal(updater.status().canDownload, true);
    assert.equal((await updater.install()).phase, 'error');
    assert.equal(launchCount, 0, 'install before download must not launch a process');
    mode = 'corrupt';
    assert.equal((await updater.download()).phase, 'error');
    assert.equal(updater.status().canInstall, false);
    assert.deepEqual((await fs.readdir(directory)).filter((f) => f.endsWith('.part') || f.endsWith('.exe')), []);
    mode = 'cancel';
    assert.equal((await updater.download()).phase, 'available');
    assert.deepEqual((await fs.readdir(directory)).filter((f) => f.endsWith('.part')), []);
    mode = 'normal';
    const downloaded = await updater.download();
    assert.equal(downloaded.phase, 'ready');
    assert.equal(downloaded.progress, 100);
    assert.equal(downloaded.received, bytes.length);
    assert.equal(downloaded.canInstall, true);
    assert.deepEqual(await fs.readFile(path.join(directory, 'Click-Setup-1.0.10.exe')), bytes, 'parts must concatenate in exact installer order');
    assert.equal((await updater.check()).phase, 'ready', 'checking again must preserve a verified download');
    assert.equal((await updater.install()).phase, 'installing'); assert.equal(launchCount, 1);
    await fs.appendFile(path.join(directory, 'Click-Setup-1.0.10.exe'), 'tampered');
    assert.equal((await updater.install()).phase, 'error'); assert.equal(launchCount, 1, 'changed installer must never launch');
    assert.equal(updater.status().canDownload, true);
    mode = 'html'; assert.equal((await updater.check()).phase, 'error');
    mode = 'offline'; assert.equal((await updater.check()).phase, 'error');
    assert.match(updater.status().message, /интернет/);
    mode = 'normal';
    const current = createUpdater({ currentVersion: '2.0.0', feedUrl: base, directory, fetchImpl, launch: () => { throw new Error('must not launch'); } });
    assert.equal((await current.check()).phase, 'current');
    assert.equal(current.status().canDownload, false, 'older release must not be offered');
    const setup = path.join(directory, 'test.exe'); await fs.writeFile(setup, bytes);
    const generated = await createRelease(setup, path.join(directory, 'release'), '1.0.10', 'Test');
    assert.equal(generated.sha256, sha(bytes));
    assert.equal(validateManifest(generated, base).version, '1.0.10');
    assert.ok(states.some((s) => s.phase === 'downloading' && s.received > 0));
    console.log('PASS: version comparison, trusted URLs, multipart installer integrity, progress, cancellation, retry, concurrent checks, offline errors, downgrade prevention and install re-verification.');
  } finally {
    assert.equal(path.dirname(directory), path.resolve(os.tmpdir()));
    await fs.rm(directory, { recursive: true, force: true });
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
