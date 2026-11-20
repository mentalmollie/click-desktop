// Download the already-tested installer from Click's public site. Never execute it.
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const artifact = require('../release-artifact.json');
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
async function main() {
  assert.match(artifact.version, /^\d+\.\d+\.\d+$/);
  const feed = new URL(artifact.feed);
  assert.equal(feed.href, 'https://click-desktop.talldot1.chatgpt.site/updates/latest.json');
  const response = await fetch(feed, { redirect: 'error', signal: AbortSignal.timeout(60000) });
  assert.equal(response.status, 200, 'Release manifest unavailable');
  const manifest = await response.json();
  for (const key of ['version', 'size', 'sha256']) assert.equal(manifest[key], artifact[key], `Unexpected ${key}`);
  assert.ok(Array.isArray(manifest.files) && manifest.files.length > 0 && manifest.files.length < 100);
  const output = path.resolve('release-assets');
  await fs.mkdir(output, { recursive: true });
  const filename = `Click-Setup-${artifact.version}.exe`;
  const file = await fs.open(path.join(output, filename), 'w');
  const hash = crypto.createHash('sha256');
  let total = 0;
  try {
    for (const part of manifest.files) {
      const url = new URL(part.url, feed);
      assert.equal(url.origin, feed.origin);
      assert.ok(url.pathname.startsWith(`/updates/${artifact.version}/`));
      assert.ok(Number.isSafeInteger(part.size) && part.size > 0 && part.size <= 25 * 1024 * 1024);
      const res = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(120000) });
      assert.equal(res.status, 200, 'Installer part unavailable');
      const bytes = Buffer.from(await res.arrayBuffer());
      assert.equal(bytes.length, part.size);
      assert.equal(digest(bytes), part.sha256);
      total += bytes.length;
      assert.ok(total <= artifact.size);
      hash.update(bytes);
      await file.writeFile(bytes);
    }
  } finally { await file.close(); }
  assert.equal(total, artifact.size);
  assert.equal(hash.digest('hex'), artifact.sha256);
  await fs.writeFile(path.join(output, 'SHA256SUMS.txt'), `${artifact.sha256}  ${filename}\n`);
  await fs.writeFile(path.join(output, 'release-notes.md'), artifact.notes + '\n');
  console.log(`Verified installer ${artifact.version}: ${total} bytes, SHA256 ${artifact.sha256}`);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
