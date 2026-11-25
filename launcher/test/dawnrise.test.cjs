'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const dawnrise = require('../src/dawnrise.cjs');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'dawnrise-'));
function write(root, files) { for (const [file, text] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); fs.writeFileSync(path.join(root, file), text); } }
const M = dawnrise.MODULE_DIR;
const moduleFiles = {
  [`${M}/sql/world/dawnrise-install.sql`]: 'USE acore_world;\nINSERT island;\n',
  [`${M}/sql/world/dawnrise-uninstall.sql`]: 'USE acore_world;\nDELETE island;\n',
  [`${M}/sql/characters/dawnrise-evacuate.sql`]: 'USE acore_characters;\nUPDATE characters;\n',
  [`${M}/lua_scripts/dawnrise/azzar-duck-hunt.lua`]: '-- duck',
  [`${M}/maps/vmaps/909.vmtree`]: 'theirs',
  [`${M}/maps/vmaps/Azzar.vmo`]: 'new',
  [`${M}/maps/mmaps/9093150.mmtile`]: 'better',
  [`${M}/client/patch-ZZZT.MPQ`]: 't',
  [`${M}/client/patch-ZZZW.MPQ`]: 'w',
  'CoA-Bots/Core/configs/modules/mod_ale.conf.dist': '[worldserver]\nALE.Enabled = 0\nALE.ScriptPath = "lua_scripts"\n',
  'Data/vmaps/909.vmtree': 'ours',
  'Data/mmaps/9093150.mmtile': 'ours',
};

// A stand-in for the repack's mysql.exe: node writes what it receives to a log, one file per call; the island is
// « in the world » while the last world file run was the install.
function fakeBackup(root) {
  const log = path.join(root, 'mysql-log');
  fs.mkdirSync(log, { recursive: true });
  const script = path.join(root, 'fake-mysql.cjs');
  fs.writeFileSync(script, `let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{require('fs').writeFileSync(require('path').join(${JSON.stringify(log)},Date.now()+'-'+Math.random()+'.sql'),s);});`);
  const runs = () => fs.readdirSync(log).sort().map(name => fs.readFileSync(path.join(log, name), 'utf8'));
  return {
    runs,
    calls: [],
    client: (tool, args) => [process.execPath, [script, ...args]],
    ready: async () => {},
    create: async ({ label, includeWorld }) => ({ name: `${label}-${includeWorld ? 'world' : 'chars'}` }),
    databases: async () => ['acore_auth', 'acore_characters', 'acore_world', 'acore_characters_reborn', 'acore_playerbots_reborn'],
    query: async () => [String(runs().filter(sql => /acore_world/.test(sql)).pop()?.includes('INSERT') ? 1 : 0)],
  };
}

test('Dawnrise: absent before CoA Bots 3.3.1, off by default once its files are there', async () => {
  const root = tmp();
  assert.deepEqual([(await dawnrise.status(root)).available, (await dawnrise.status(root)).enabled], [false, false]);
  await assert.rejects(dawnrise.enable(root, fakeBackup(root)), /3\.3\.1/);
  write(root, moduleFiles);
  const s = await dawnrise.status(root);
  assert.deepEqual([s.available, s.enabled, s.lua, s.ale, s.clientFiles], [true, false, false, false, true]);
});

test('Dawnrise on, then off: SQL on the right databases, maps never replace our vmaps, Lua and ALE follow', async () => {
  const root = tmp();
  write(root, moduleFiles);
  const backup = fakeBackup(root);
  const on = await dawnrise.enable(root, backup);
  assert.equal(on.backup, 'before-dawnrise-on-world');
  assert.equal(backup.runs().length, 1);
  assert.match(backup.runs()[0], /^USE `acore_world`;\nINSERT island;/);
  assert.equal(fs.readFileSync(path.join(root, 'Data/vmaps/909.vmtree'), 'utf8'), 'ours');
  assert.equal(fs.readFileSync(path.join(root, 'Data/vmaps/Azzar.vmo'), 'utf8'), 'new');
  assert.equal(fs.readFileSync(path.join(root, 'Data/mmaps/9093150.mmtile'), 'utf8'), 'better');
  assert.ok(fs.existsSync(path.join(root, dawnrise.LUA_TARGET, 'azzar-duck-hunt.lua')));
  let s = await dawnrise.status(root);
  assert.deepEqual([s.enabled, s.lua, s.ale], [true, true, true]);
  // On twice: same result (the install is idempotent, the Lua copy is replaced).
  await dawnrise.enable(root, backup);
  assert.equal((await dawnrise.status(root)).enabled, true);

  const off = await dawnrise.disable(root, backup);
  assert.deepEqual(off.evacuated, ['acore_characters', 'acore_characters_reborn']);
  const runs = backup.runs().slice(2);
  assert.deepEqual(runs.map(sql => sql.split('\n')[0]), ['USE `acore_characters`;', 'USE `acore_characters_reborn`;', 'USE `acore_world`;']);
  assert.match(runs[2], /DELETE island/);
  assert.ok(!fs.existsSync(path.join(root, dawnrise.LUA_TARGET)));
  assert.ok(fs.existsSync(path.join(root, M, 'lua_scripts/dawnrise/azzar-duck-hunt.lua')), 'the module keeps its own scripts');
  s = await dawnrise.status(root);
  assert.deepEqual([s.enabled, s.lua, s.ale], [false, false, false]);
  // The maps may stay: they only serve the maps 909/960.
  assert.equal(fs.readFileSync(path.join(root, 'Data/vmaps/Azzar.vmo'), 'utf8'), 'new');
});

test('Dawnrise off keeps ALE on when other Lua scripts are left', async () => {
  const root = tmp();
  write(root, { ...moduleFiles, 'CoA-Bots/Core/lua_scripts/other/mine.lua': '-- not ours' });
  const backup = fakeBackup(root);
  await dawnrise.enable(root, backup);
  await dawnrise.disable(root, backup);
  assert.equal((await dawnrise.status(root)).ale, true);
  assert.ok(fs.existsSync(path.join(root, 'CoA-Bots/Core/lua_scripts/other/mine.lua')));
});

test('Dawnrise refuses to go on when the island is not in the world database after its install', async () => {
  const root = tmp();
  write(root, moduleFiles);
  const backup = { ...fakeBackup(root), query: async () => ['0'] };
  await assert.rejects(dawnrise.enable(root, backup), /not in the world database.*before-dawnrise-on-world/);
  assert.equal((await dawnrise.status(root)).ale, false, 'ALE is not switched on');
});

test('Dawnrise game files: copied into the game Data, the state follows', async () => {
  const root = tmp();
  const client = tmp();
  write(root, moduleFiles);
  write(client, { 'Data/patch-A.MPQ': 'x' });
  assert.equal(dawnrise.clientState(client), 'no');
  assert.equal(await dawnrise.installClient(root, client), 'yes');
  assert.equal(fs.readFileSync(path.join(client, 'Data/patch-ZZZT.MPQ'), 'utf8'), 't');
  await assert.rejects(dawnrise.installClient(root, ''), /game folder/);
});
