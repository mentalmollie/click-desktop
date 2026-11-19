// Prepare a separate, explicit allowlist of public source files. Never copy user data.
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const ROOT = path.resolve(__dirname, '..');
const JSON_FILES = new Set(['package.json', 'package-lock.json', 'update-channel.json', 'release-notes.json']);
const SOURCE_TYPES = new Set(['.js', '.html', '.css', '.ps1']);
const ASSET_TYPES = new Set(['.png', '.webp', '.ico', '.json']);
const BINARY_TYPES = new Set(['.png', '.webp', '.ico']);
const SECRET = /(?:sk-ant-[A-Za-z0-9_-]{20,}|gsk_[A-Za-z0-9]{24,}|github_pat_[A-Za-z0-9_]{30,}|gh[pousr]_[A-Za-z0-9]{30,}|AIza[A-Za-z0-9_-]{30,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)/;

async function exportGithub(destination) {
  destination = path.resolve(destination);
  if (destination === ROOT || destination.startsWith(ROOT + path.sep)) throw new Error('Use a separate source directory outside the application folder.');
  await fs.mkdir(destination, { recursive: true });
  if ((await fs.readdir(destination)).length) throw new Error('Export destination must be empty; existing files are preserved.');
  const exported = [];
  async function copy(relative) {
    const filename = path.join(ROOT, relative);
    const stat = await fs.lstat(filename);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Unexpected source entry: ' + relative);
    const bytes = await fs.readFile(filename);
    if (!BINARY_TYPES.has(path.extname(relative)) && SECRET.test(bytes.toString('utf8'))) throw new Error('Potential credential in source: ' + relative);
    const target = path.join(destination, relative);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, bytes);
    exported.push(relative.replace(/\\/g, '/'));
  }
  for (const entry of await fs.readdir(ROOT, { withFileTypes: true })) {
    if (entry.isFile() && (SOURCE_TYPES.has(path.extname(entry.name)) || JSON_FILES.has(entry.name))) await copy(entry.name);
  }
  async function walk(directory, allowed) {
    for (const entry of await fs.readdir(path.join(ROOT, directory), { withFileTypes: true })) {
      const relative = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error('Symbolic link excluded: ' + relative);
      if (entry.isDirectory()) await walk(relative, allowed);
      else if (allowed(relative)) await copy(relative);
    }
  }
  await walk('assets', (relative) => ASSET_TYPES.has(path.extname(relative)));
  await walk('tools', (relative) => ['.js', '.md', '.cs', '.manifest'].includes(path.extname(relative)));
  const prohibited = exported.filter((f) => /(?:^|\/)(?:config|todos|social|start-cache|start-icons)\.json$|\.key$|(?:^|\/)(?:node_modules|dist|whisper|\.git)(?:\/|$)/.test(f));
  if (prohibited.length) throw new Error('Unexpected private or generated files in export.');
  const version = require('../package.json').version;
  const checksum = crypto.createHash('sha256').update(await fs.readFile(path.join(ROOT, 'dist', `Click-Setup-${version}.exe`))).digest('hex');
  console.log(JSON.stringify({ directory: destination, files: exported.length, installerSha256: checksum }));
}
if (require.main === module) exportGithub(process.argv[2]).catch((error) => { console.error(error.message); process.exitCode = 1; });
module.exports = { exportGithub };
