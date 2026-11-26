'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const dawnrise = require('../src/dawnrise.cjs');

const tar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'dawnrise-'));
function write(root, files) { for (const [file, text] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); fs.writeFileSync(path.join(root, file), text); } }
const M = dawnrise.MODULE_DIR;
const SERVER = {
  'CoA-Bots/Core/configs/modules/mod_ale.conf.dist': '[worldserver]\nALE.Enabled = 0\nALE.ScriptPath = "lua_scripts"\n',
  'CoA-Bots/release.json': JSON.stringify({ version: '3.3.1' }),
  'Data/vmaps/909.vmtree': 'ours',
  'Data/mmaps/9093150.mmtile': 'ours',
};
// The component's files, version v; `install` lets a test break the install SQL.
const componentFiles = (v, install = `INSERT island ${v};`) => ({
  VERSION: `${v}\n`,
  'sql/world/dawnrise-install.sql': `USE acore_world;\n${install}\n`,
  'sql/world/dawnrise-uninstall.sql': `USE acore_world;\nDELETE island ${v};\n`,
  'sql/characters/dawnrise-evacuate.sql': 'USE acore_characters;\nUPDATE characters;\n',
  'lua_scripts/dawnrise/azzar-duck-hunt.lua': `-- duck ${v}`,
  'maps/vmaps/909.vmtree': 'theirs',
  'maps/vmaps/Azzar.vmo': 'new',
  'maps/mmaps/9093150.mmtile': 'better',
  'maps/mmaps/9603030.mmtile': 'added',
  'client/patch-ZZZT.MPQ': `t${v}`,
  'client/patch-ZZZW.MPQ': `w${v}`,
});
function zipOf(files) {
  const src = tmp();
  write(src, files);
  const zip = path.join(tmp(), 'dawnrise.zip');
  execFileSync(tar, ['-a', '-cf', zip, '-C', src, 'VERSION', 'sql', 'lua_scripts', 'maps', 'client']);
  return zip;
}
function serve(file) {
  return new Promise(resolve => { const server = http.createServer((req, res) => { const data = fs.readFileSync(file); res.writeHead(200, { 'Content-Length': data.length }); res.end(data); }).listen(0, '127.0.0.1', () => resolve(server)); });
}
async function offerOf(version, files) {
  const zip = zipOf(files || componentFiles(version));
  const server = await serve(zip);
  const data = fs.readFileSync(zip);
  return { server, offer: { name: 'dawnrise', version, url: `http://127.0.0.1:${server.address().port}/dawnrise-${version}.zip`, sha256: crypto.createHash('sha256').update(data).digest('hex'), size: data.length, minBots: '3.3.1' } };
}

// A stand-in for the repack's mysql.exe: node writes what it receives to a log, one file per call. The island is
// « in the world » while the last world file run was an install that is not BROKEN.
function fakeBackup(root) {
  const log = path.join(root, 'mysql-log');
  fs.mkdirSync(log, { recursive: true });
  const script = path.join(root, 'fake-mysql.cjs');
  let n = 0;
  fs.writeFileSync(script, `let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{require('fs').writeFileSync(process.argv[2],s);});`);
  const runs = () => fs.readdirSync(log).sort().map(name => fs.readFileSync(path.join(log, name), 'utf8'));
  return {
    runs,
    client: (tool, args) => [process.execPath, [script, path.join(log, `${String(++n).padStart(4, '0')}.sql`), ...args]],
    ready: async () => {},
    create: async ({ label, includeWorld }) => ({ name: `${label}-${includeWorld ? 'world' : 'chars'}` }),
    databases: async () => ['acore_auth', 'acore_characters', 'acore_world', 'acore_characters_reborn', 'acore_playerbots_reborn'],
    query: async () => { const last = runs().filter(sql => /acore_world/.test(sql)).pop() || ''; return [String(/INSERT island/.test(last) && !/BROKEN/.test(last) ? 1 : 0)]; },
  };
}
const body = sql => sql.split('\n')[1];

test('Dawnrise never downloaded: offline it cannot go on, the size of the last list is shown', async () => {
  const root = tmp();
  write(root, SERVER);
  let s = await dawnrise.status(root);
  assert.deepEqual([s.available, s.enabled, s.offline, s.download, s.size], [false, false, true, null, 0]);
  s = await dawnrise.status(root, { offer: { version: '1.0', size: 72000000 }, offline: true });
  assert.deepEqual([s.offline, s.download, s.size], [true, null, 72000000]);
  const backup = fakeBackup(root);
  await assert.rejects(dawnrise.enable(root, backup), /connect to the Internet/);
  assert.equal(backup.runs().length, 0);
});

test('Dawnrise: downloaded at the first « On », then off and on again offline from the local copy', async () => {
  const root = tmp();
  const client = tmp();
  write(root, SERVER);
  write(client, { 'Data/patch-A.MPQ': 'x' });
  const { server, offer } = await offerOf('1.0');
  const backup = fakeBackup(root);
  try {
    assert.deepEqual((await dawnrise.status(root, { offer })).download, { version: '1.0', size: offer.size });
    const on = await dawnrise.enable(root, backup, { offer, cacheDir: tmp(), fetchImpl: fetch, client });
    assert.deepEqual([on.version, on.updated, on.game], ['1.0', false, 'yes']);
  } finally { server.close(); }
  assert.deepEqual(backup.runs().map(body), ['INSERT island 1.0;']);
  assert.match(backup.runs()[0], /^USE `acore_world`;/);
  assert.equal(fs.readFileSync(path.join(root, 'Data/vmaps/909.vmtree'), 'utf8'), 'ours', 'our vmaps are never replaced');
  assert.equal(fs.readFileSync(path.join(root, 'Data/vmaps/Azzar.vmo'), 'utf8'), 'new');
  assert.equal(fs.readFileSync(path.join(root, 'Data/mmaps/9093150.mmtile'), 'utf8'), 'better');
  assert.equal(fs.readFileSync(path.join(client, 'Data/patch-ZZZT.MPQ'), 'utf8'), 't1.0');
  let s = await dawnrise.status(root, { offer, client });
  assert.deepEqual([s.available, s.version, s.enabled, s.lua, s.ale, s.download, s.client], [true, '1.0', true, true, true, null, 'yes']);

  const off = await dawnrise.disable(root, backup, { client });
  assert.deepEqual(off.evacuated, ['acore_characters', 'acore_characters_reborn']);
  assert.deepEqual(backup.runs().slice(1).map(sql => sql.split('\n')[0]), ['USE `acore_characters`;', 'USE `acore_characters_reborn`;', 'USE `acore_world`;']);
  assert.equal(body(backup.runs()[3]), 'DELETE island 1.0;');
  assert.equal(off.game, 'disabled', 'the game files are renamed, not deleted');
  assert.ok(fs.existsSync(path.join(client, 'Data/patch-ZZZT.MPQ.disabled')));
  s = await dawnrise.status(root, { client });
  assert.deepEqual([s.available, s.enabled, s.lua, s.ale], [true, false, false, false]);
  assert.ok(fs.existsSync(path.join(root, M, 'lua_scripts/dawnrise/azzar-duck-hunt.lua')), 'the component keeps its own scripts');
  assert.equal(fs.readFileSync(path.join(root, 'Data/mmaps/9093150.mmtile'), 'utf8'), 'ours', 'the repack mmaps are back');
  assert.ok(!fs.existsSync(path.join(root, 'Data/mmaps/9603030.mmtile')), 'the mmaps the island added are gone');
  assert.ok(!fs.existsSync(path.join(root, dawnrise.MMAPS_KEEP)));

  // Offline (no list): on again from the local copy, the game files back.
  const again = await dawnrise.enable(root, backup, { client });
  assert.deepEqual([again.version, again.game], ['1.0', 'yes']);
  assert.ok(!fs.existsSync(path.join(client, 'Data/patch-ZZZT.MPQ.disabled')));
});

test('Dawnrise: a broken download or a wrong fingerprint installs nothing, and can be tried again', async () => {
  const root = tmp();
  write(root, SERVER);
  const { server, offer } = await offerOf('1.0');
  const backup = fakeBackup(root);
  const cacheDir = tmp();
  try {
    await assert.rejects(dawnrise.enable(root, backup, { offer: { ...offer, sha256: 'b'.repeat(64) }, cacheDir, fetchImpl: fetch }), /could not be downloaded.*Nothing was changed; try again/);
    assert.equal(backup.runs().length, 0);
    assert.ok(!fs.existsSync(path.join(root, M)));
    await assert.rejects(dawnrise.enable(root, backup, { offer, cacheDir, fetchImpl: () => Promise.reject(new Error('offline')) }), /could not be downloaded/);
    assert.equal((await dawnrise.enable(root, backup, { offer, cacheDir, fetchImpl: fetch })).version, '1.0');
  } finally { server.close(); }
  // A zip without its files is refused too, before anything is run.
  const bad = await offerOf('2.0', { VERSION: '2.0\n', 'sql/world/dawnrise-install.sql': 'x', 'lua_scripts/x.txt': '', 'maps/a': '', 'client/b': '' });
  const before = backup.runs().length;
  try { await assert.rejects(dawnrise.enable(root, backup, { offer: bad.offer, cacheDir, fetchImpl: fetch }), /not version 2\.0 with all its files/); } finally { bad.server.close(); }
  assert.equal(backup.runs().length, before);
  assert.equal((await dawnrise.status(root)).version, '1.0');
});

test('Dawnrise: a newer version while the island is on runs the OLD uninstall, then the new install', async () => {
  const root = tmp();
  write(root, SERVER);
  const backup = fakeBackup(root);
  const v1 = await offerOf('1.0');
  try { await dawnrise.enable(root, backup, { offer: v1.offer, cacheDir: tmp(), fetchImpl: fetch }); } finally { v1.server.close(); }
  const v2 = await offerOf('1.1');
  let result;
  try {
    assert.deepEqual((await dawnrise.status(root, { offer: v2.offer })).download?.version, '1.1');
    result = await dawnrise.enable(root, backup, { offer: v2.offer, cacheDir: tmp(), fetchImpl: fetch });
  } finally { v2.server.close(); }
  assert.deepEqual([result.version, result.updated], ['1.1', true]);
  assert.equal(fs.readFileSync(path.join(root, dawnrise.MMAPS_KEEP, '9093150.mmtile'), 'utf8'), 'ours', 'a newer island never keeps the old one as the repack file');
  assert.deepEqual(backup.runs().map(body), ['INSERT island 1.0;', 'DELETE island 1.0;', 'INSERT island 1.1;']);
  assert.ok(!fs.existsSync(path.join(root, `${M}.old`)), 'the old copy goes once the new one is in');
  assert.equal(fs.readFileSync(path.join(root, dawnrise.LUA_TARGET, 'azzar-duck-hunt.lua'), 'utf8'), '-- duck 1.1');
});

test('Dawnrise: a new version whose install fails puts the old one back, on as before', async () => {
  const root = tmp();
  write(root, SERVER);
  const backup = fakeBackup(root);
  const v1 = await offerOf('1.0');
  try { await dawnrise.enable(root, backup, { offer: v1.offer, cacheDir: tmp(), fetchImpl: fetch }); } finally { v1.server.close(); }
  const v2 = await offerOf('1.1', componentFiles('1.1', 'INSERT island BROKEN;'));
  try { await assert.rejects(dawnrise.enable(root, backup, { offer: v2.offer, cacheDir: tmp(), fetchImpl: fetch }), /put back as it was.*before-dawnrise-on-world/); } finally { v2.server.close(); }
  assert.deepEqual(backup.runs().map(body), ['INSERT island 1.0;', 'DELETE island 1.0;', 'INSERT island BROKEN;', 'INSERT island 1.0;']);
  const s = await dawnrise.status(root);
  assert.deepEqual([s.version, s.enabled], ['1.0', true]);
  assert.ok(!fs.existsSync(path.join(root, `${M}.old`)));
});

test('Dawnrise off keeps ALE on when other Lua scripts are left', async () => {
  const root = tmp();
  write(root, { ...SERVER, 'CoA-Bots/Core/lua_scripts/other/mine.lua': '-- not ours' });
  const backup = fakeBackup(root);
  const v1 = await offerOf('1.0');
  try { await dawnrise.enable(root, backup, { offer: v1.offer, cacheDir: tmp(), fetchImpl: fetch }); } finally { v1.server.close(); }
  await dawnrise.disable(root, backup);
  assert.equal((await dawnrise.status(root)).ale, true);
  assert.ok(fs.existsSync(path.join(root, 'CoA-Bots/Core/lua_scripts/other/mine.lua')));
});
