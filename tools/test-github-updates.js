const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { createUpdater, validateGithubRelease } = require('../updates');
const repo = 'mentalmollie/click-desktop';
const bytes = Buffer.from('MZ-test-installation-data');
const digest = 'sha256:' + crypto.createHash('sha256').update(bytes).digest('hex');
const asset = { name: 'Click-Setup-1.0.6.exe', size: bytes.length, digest, state: 'uploaded', browser_download_url: `https://github.com/${repo}/releases/download/v1.0.6/Click-Setup-1.0.6.exe` };
const release = { tag_name: 'v1.0.6', draft: false, prerelease: false, body: 'Что нового', assets: [asset] };
(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'click-github-test-'));
  try {
    for (const bad of [{ ...release, draft: true }, { ...release, prerelease: true }, { ...release, tag_name: '../evil' }, { ...release, assets: [] },
      { ...release, assets: [{ ...asset, digest: null }] }, { ...release, assets: [{ ...asset, size: -1 }] },
      { ...release, assets: [{ ...asset, browser_download_url: 'https://evil.test/setup.exe' }] }]) assert.throws(() => validateGithubRelease(bad, repo));
    let launched = 0, corrupt = false;
    const updater = createUpdater({ currentVersion: '1.0.5', repository: repo, directory: dir, launch: () => { launched++; },
      fetchImpl: async (url) => url.endsWith('/releases/latest') ? new Response(JSON.stringify(release))
        : url.includes('/releases?') ? new Response(JSON.stringify([{ ...release, published_at: '2026-11-19' }, { ...release, draft: true }]))
        : new Response(corrupt ? Buffer.alloc(bytes.length) : bytes),
    });
    assert.equal((await updater.check()).phase, 'available');
    assert.equal((await updater.download()).phase, 'ready');
    assert.equal((await updater.history()).length, 1);
    assert.deepEqual(await fs.readFile(path.join(dir, asset.name)), bytes);
    await updater.install(); assert.equal(launched, 1);
    const fresh = createUpdater({ currentVersion: '1.0.6', repository: repo, directory: dir, fetchImpl: async () => new Response(JSON.stringify(release)) });
    assert.equal((await fresh.check()).phase, 'current');
    corrupt = true;
    assert.equal((await updater.download()).phase, 'error');
    assert.equal(updater.status().canInstall, false);
    console.log('PASS: GitHub release selection, trusted installer URL, required SHA256, verified download, history, current version and corruption rejection.');
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
})().catch((e) => { console.error(e); process.exitCode = 1; });
