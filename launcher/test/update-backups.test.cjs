'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const backups = require('../src/update-backups.cjs');

// User's rule, 20/11: before an update only the newest update backup is kept (two after it). Never a folder without
// backup.json, never one holding play set aside by an undo (after-*), never the launcher's daily or manual backups.
function repack() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'update-backups-'));
  const put = (file, size = 10) => { fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); fs.writeFileSync(path.join(root, file), Buffer.alloc(size)); };
  put('Backups/3.1.3-20261110-101010/backup.json'); put('Backups/3.1.3-20261110-101010/mysql-data/a.ibd', 1000);
  put('Backups/3.1.4-20261114-101010/backup.json'); put('Backups/3.1.4-20261114-101010/files/Core/worldserver.exe', 500);
  put('Backups/3.1.4-20261115-090000/backup.json'); put('Backups/3.1.4-20261115-090000/after-3.1.4-20261116-120000/mysql-data/b.ibd', 50);
  put('Backups/3.1.5-20261116-101010/files/x.txt');
  put('Backups/3.1.5-20261117-101010.partial/backup.json');
  put('Backups/3.1.6-20261120-101010/backup.json');
  put('Backups/20261119-030000-daily.sql.gz'); put('Backups/20261119-030000-daily.json');
  return root;
}

test('older update backups: all but the newest, never one with after-*, without backup.json, partial or daily', async () => {
  const root = repack();
  assert.deepEqual(backups.list(root).map(b => b.name), ['3.1.3-20261110-101010', '3.1.4-20261114-101010', '3.1.4-20261115-090000', '3.1.6-20261120-101010']);
  const summary = backups.summary(root);
  assert.deepEqual(summary.names, ['3.1.3-20261110-101010', '3.1.4-20261114-101010']);
  assert.equal(summary.bytes, 1010 + 510);
  const removed = await backups.removeOlder(root);
  assert.deepEqual(removed.map(b => b.name), ['3.1.3-20261110-101010', '3.1.4-20261114-101010']);
  const left = fs.readdirSync(path.join(root, 'Backups')).sort();
  assert.deepEqual(left, ['20261119-030000-daily.json', '20261119-030000-daily.sql.gz', '3.1.4-20261115-090000', '3.1.5-20261116-101010', '3.1.5-20261117-101010.partial', '3.1.6-20261120-101010']);
  assert.ok(fs.existsSync(path.join(root, 'Backups/3.1.4-20261115-090000/after-3.1.4-20261116-120000/mysql-data/b.ibd')));
  assert.match(fs.readFileSync(path.join(root, 'logs/launcher-backups.log'), 'utf8'), /3\.1\.3-20261110-101010[\s\S]*3\.1\.4-20261114-101010/);
  // Again: nothing more to delete, the newest stays.
  assert.deepEqual(backups.summary(root), { count: 0, bytes: 0, names: [] });
  fs.rmSync(root, { recursive: true, force: true });
});

test('a single update backup, or none, is never deleted', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'update-backups-'));
  assert.deepEqual(backups.summary(root), { count: 0, bytes: 0, names: [] });
  fs.mkdirSync(path.join(root, 'Backups', '3.1.6-20261120-101010'), { recursive: true });
  fs.writeFileSync(path.join(root, 'Backups', '3.1.6-20261120-101010', 'backup.json'), '{}');
  assert.deepEqual(await backups.removeOlder(root), []);
  assert.ok(fs.existsSync(path.join(root, 'Backups', '3.1.6-20261120-101010', 'backup.json')));
  fs.rmSync(root, { recursive: true, force: true });
});
