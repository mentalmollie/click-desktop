// Verify the real public update feed and download without credentials; never run the EXE.
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createUpdater, fileHash } = require('../updates');
const channel = require('../update-channel.json');
(async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'click-public-update-'));
  let last = '';
  try {
    const updater = createUpdater({ currentVersion: '1.0.4', ...channel, directory,
      launch: () => { throw new Error('The verification must never launch the installer'); },
      onChange: (state) => {
        const label = state.phase + (state.phase === 'downloading' ? ':' + Math.floor(state.progress / 25) * 25 : '');
        if (label !== last) { last = label; console.log(label + ': ' + state.message); }
      },
    });
    const checked = await updater.check();
    assert.equal(checked.phase, 'available', checked.message);
    const result = await updater.download();
    assert.equal(result.phase, 'ready', result.message);
    const downloaded = path.join(directory, `Click-Setup-${result.availableVersion}.exe`);
    const original = path.join(__dirname, '..', 'dist', `Click-Setup-${result.availableVersion}.exe`);
    assert.equal(await fileHash(downloaded), await fileHash(original));
    console.log(`PASS: public feed and complete installer ${result.availableVersion} downloaded without login and matched the original build.`);
  } finally {
    assert.equal(path.dirname(directory), path.resolve(os.tmpdir()));
    await fs.rm(directory, { recursive: true, force: true });
  }
})().catch((e) => { console.error(e.message); process.exitCode = 1; });
