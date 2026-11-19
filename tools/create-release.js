const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { version: defaultVersion } = require('../package.json');
const digest = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

async function createRelease(setupPath, directory, version = defaultVersion, notes = '') {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Invalid release version');
  const bytes = await fs.readFile(setupPath);
  if (bytes.subarray(0, 2).toString('ascii') !== 'MZ') throw new Error('Expected a Windows installer');
  const output = path.join(directory, version);
  await fs.mkdir(output, { recursive: true });
  const files = [], partSize = 20 * 1024 * 1024;
  for (let offset = 0, index = 0; offset < bytes.length; offset += partSize, index++) {
    const chunk = bytes.subarray(offset, Math.min(bytes.length, offset + partSize));
    const filename = `part-${String(index).padStart(2, '0')}.bin`;
    await fs.writeFile(path.join(output, filename), chunk);
    files.push({ url: `./${version}/${filename}`, size: chunk.length, sha256: digest(chunk) });
  }
  const manifest = { version, platform: 'win32', arch: 'x64', size: bytes.length, sha256: digest(bytes), notes, files };
  const temporary = path.join(directory, 'latest.json.tmp');
  await fs.writeFile(temporary, JSON.stringify(manifest, null, 2) + '\n');
  await fs.rename(temporary, path.join(directory, 'latest.json'));
  return manifest;
}
module.exports = { createRelease };
if (require.main === module) createRelease(process.argv[2], process.argv[3], process.argv[4] || defaultVersion,
  require('../release-notes.json').notes).then((r) => console.log(`Release ${r.version}: ${r.files.length} files, ${r.size} bytes.`))
  .catch((error) => { console.error(error.message); process.exitCode = 1; });
