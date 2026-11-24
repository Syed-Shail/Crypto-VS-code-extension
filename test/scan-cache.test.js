// Unit tests for the scan cache and the concurrent folder scan (no VS Code needed).
//   npm run compile && npm run test:unit
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const engine = require('../out/core/scan-engine');
const { ScanCache } = require('../out/core/scan-cache');

const quiet = async fn => { const log = console.log; console.log = () => {}; try { return await fn(); } finally { console.log = log; } };

function workspace() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crypto-detector-test-'));
  fs.writeFileSync(path.join(dir, 'a.py'), 'import hashlib\nh = hashlib.md5(b"x")\n');
  fs.writeFileSync(path.join(dir, 'b.js'), 'const c = require("crypto");\nc.createHash("sha256");\n');
  fs.mkdirSync(path.join(dir, 'node_modules'));
  fs.writeFileSync(path.join(dir, 'node_modules', 'skip.js'), 'require("crypto").createHash("md5");\n');
  return dir;
}

const names = assets => assets.map(a => `${a.name}@${path.basename(a.source)}:${a.line}`).sort();

test('cached scans return exactly the same findings as an uncached scan', async () => {
  const dir = workspace();
  const cacheFile = path.join(dir, '..', `${path.basename(dir)}.cache.json`);
  const fresh = await quiet(() => engine.scanFolder(dir, { cacheFile: false }));
  const cold = await quiet(() => engine.scanFolder(dir, { cacheFile }));
  const warm = await quiet(() => engine.scanFolder(dir, { cacheFile }));
  assert.ok(fresh.length > 0);
  assert.deepStrictEqual(names(cold), names(fresh));
  assert.deepStrictEqual(names(warm), names(fresh));
  assert.strictEqual(engine.lastScanStats.cacheHits, 2);
  assert.strictEqual(engine.lastScanStats.cacheMisses, 0);
});

test('a changed file is re-analysed and its new findings are reported', async () => {
  const dir = workspace();
  const cacheFile = path.join(dir, '..', `${path.basename(dir)}.cache.json`);
  await quiet(() => engine.scanFolder(dir, { cacheFile }));
  fs.writeFileSync(path.join(dir, 'a.py'), 'import hashlib\nh = hashlib.sha1(b"x")\nfrom Crypto.Cipher import AES\n');
  const after = await quiet(() => engine.scanFolder(dir, { cacheFile }));
  assert.strictEqual(engine.lastScanStats.cacheMisses, 1);
  assert.strictEqual(engine.lastScanStats.cacheHits, 1);
  assert.ok(!names(after).some(n => n.startsWith('MD5@a.py')), 'old MD5 finding must disappear');
});

test('excluded folders such as node_modules are never scanned', async () => {
  const assets = await quiet(() => engine.scanFolder(workspace(), { cacheFile: false }));
  assert.ok(assets.every(a => !a.source.includes('node_modules')));
});

test('a different analysis version or a corrupt file starts an empty cache', async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cd-cache-')), 'c.json');
  const cache = await ScanCache.open(file, 'v1');
  cache.store('/x.py', { size: 1, mtimeMs: 1 }, 'h', [{ name: 'MD5' }]);
  await cache.save();
  assert.ok((await ScanCache.open(file, 'v1')).byStat('/x.py', { size: 1, mtimeMs: 1 }));
  assert.strictEqual((await ScanCache.open(file, 'v2')).byStat('/x.py', { size: 1, mtimeMs: 1 }), undefined);
  fs.writeFileSync(file, '{not json');
  assert.strictEqual((await ScanCache.open(file, 'v1')).byStat('/x.py', { size: 1, mtimeMs: 1 }), undefined);
});

test('content-identical files with a new timestamp are reused, not re-analysed', async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cd-cache-')), 'c.json');
  const cache = await ScanCache.open(file, 'v1');
  cache.store('/x.py', { size: 3, mtimeMs: 1 }, ScanCache.hash('abc'), [{ name: 'AES' }]);
  assert.strictEqual(cache.byStat('/x.py', { size: 3, mtimeMs: 2 }), undefined);
  assert.deepStrictEqual(cache.byHash('/x.py', ScanCache.hash('abc'), { size: 3, mtimeMs: 2 }), [{ name: 'AES' }]);
});
