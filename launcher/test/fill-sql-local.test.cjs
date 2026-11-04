'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { fillSqlLocal } = require('../src/repack-update.cjs');

const sha = text => crypto.createHash('sha256').update(text).digest('hex');
const COMMIT = 'a'.repeat(40);

// A repack with one SQL already there, and a package listing it, one overlay file, one archived (empty) and others to fetch.
function setup(fetchCount = 1) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fillsql-'));
  const write = (rel, text) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), text); };
  write('Source/sql-tree/data/sql/updates/db_world/old.sql', 'old');
  write('CoA-Update-9/payload/Assembler/overlay/data/sql/custom/ours.sql', 'ours');
  write('CoA-Update-9/payload/Assembler/assemble.json', JSON.stringify({ sql: { repo: 'Owner/core', commit: COMMIT } }));
  const files = {
    'Source/sql-tree/data/sql/updates/db_world/old.sql': { sha256: sha('old') },
    'Source/sql-tree/data/sql/custom/ours.sql': { sha256: sha('ours') },
    'Source/sql-tree/data/sql/archive/gone.sql': { sha256: sha('') },
    'Core/worldserver.exe': { sha256: sha('exe') },
  };
  for (let i = 0; i < fetchCount; i++) files[`Source/sql-tree/data/sql/updates/db_world/new${i}.sql`] = { sha256: sha(`new${i}`) };
  write('CoA-Update-9/update/manifest.json', JSON.stringify({ files }));
  return root;
}
const reply = (status, body = '') => ({ ok: status === 200, status, headers: { get: () => null }, arrayBuffer: async () => Buffer.from(body) });

test('the SQL already in the repack are copied, the overlay and archived ones laid, the rest fetched by the commit', async () => {
  const root = setup(2);
  const urls = [];
  let busy = 0;
  const fetchImpl = async url => { urls.push(url); busy++; const name = /(new\d)\.sql$/.exec(url)[1]; busy--; return urls.filter(u => u === url).length === 1 && name === 'new0' ? reply(503) : reply(200, name); };
  const stats = await fillSqlLocal(root, 'CoA-Update-9', { fetchImpl, wait: async () => {} });
  assert.deepEqual({ ...stats, bytes: undefined }, { total: 5, copied: 3, fetched: 2, bytes: undefined });
  assert.ok(urls.every(url => url.startsWith(`https://raw.githubusercontent.com/Owner/core/${COMMIT}/data/sql/updates/db_world/`)));
  const tree = path.join(root, 'CoA-Update-9', 'payload', 'Source', 'sql-tree');
  assert.equal(fs.readFileSync(path.join(tree, 'data/sql/updates/db_world/new0.sql'), 'utf8'), 'new0');
  assert.equal(fs.readFileSync(path.join(tree, 'data/sql/custom/ours.sql'), 'utf8'), 'ours');
  assert.equal(fs.statSync(path.join(tree, 'data/sql/archive/gone.sql')).size, 0);
  assert.ok(!fs.existsSync(path.join(root, 'CoA-Update-9', 'payload', 'Core')));
});

test('a file that is not the expected one, a 404 or too many missing files leave it to the archive', async () => {
  assert.equal(await fillSqlLocal(setup(1), 'CoA-Update-9', { fetchImpl: async () => reply(200, 'changed'), wait: async () => {} }), null);
  assert.equal(await fillSqlLocal(setup(1), 'CoA-Update-9', { fetchImpl: async () => reply(404), wait: async () => {} }), null);
  let asked = 0;
  assert.equal(await fillSqlLocal(setup(1), 'CoA-Update-9', { fetchImpl: async () => { asked++; return reply(429); }, wait: async () => {} }), null);
  assert.equal(asked, 4);
  let called = false;
  assert.equal(await fillSqlLocal(setup(301), 'CoA-Update-9', { fetchImpl: async () => { called = true; return reply(404); } }), null);
  assert.equal(called, false);
});

test('never more than four downloads at a time', async () => {
  let busy = 0, most = 0;
  const fetchImpl = async url => { busy++; most = Math.max(most, busy); await new Promise(resolve => setTimeout(resolve, 5)); busy--; return reply(200, /(new\d+)\.sql$/.exec(url)[1]); };
  const stats = await fillSqlLocal(setup(12), 'CoA-Update-9', { fetchImpl });
  assert.equal(stats.fetched, 12);
  assert.equal(most, 4);
});
