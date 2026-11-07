'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { tempDir } = require('./helpers.cjs');
const { ServerConfig } = require('../src/server-config.cjs');

const FIXTURE = path.join(__dirname, 'fixtures', 'repack');

async function copyRepack() {
  const root = await tempDir();
  await fsp.cp(FIXTURE, root, { recursive: true });
  return root;
}

test('settings files of a repack with CoA Bots are found, templates first', async () => {
  const config = new ServerConfig(await copyRepack());
  const files = await config.files();
  const world = files.find(file => file.id === 'worldserver.conf');
  assert.equal(world.path, 'Settings/worldserver.conf.template');
  assert.equal(world.dist, 'Core/configs/worldserver.conf.dist');
  assert.equal(files.find(file => file.id === 'playerbots.conf').scope, 'bots');
  const overview = await config.overview();
  const bots = overview.settings.find(setting => setting.key === 'AiPlayerbot.MaxRandomBots');
  assert.match(bots.value, /^\d+$/);
  assert.equal(overview.settings.find(setting => setting.key === 'AiPlayerbot.BroadcastWorldChannelName')?.value.includes('"'), false);
  assert.ok(overview.recipes.some(recipe => recipe.id === 'coa-recommended'));
});

test('details: documentation from the .dist, secrets never sent, managed keys locked', async () => {
  const config = new ServerConfig(await copyRepack());
  const world = await config.details('worldserver.conf');
  const kill = world.entries.find(entry => entry.key === 'Rate.XP.Kill');
  assert.match(kill.description, /Experience rates/);
  assert.equal(kill.default, '1');
  const login = world.entries.find(entry => entry.key === 'LoginDatabaseInfo');
  assert.equal(login.value, '');
  assert.equal(login.locked, 'secret');
  assert.match(world.entries.find(entry => entry.key === 'MapUpdate.Threads').locked, /CoA Bots/);
  const bots = await config.details('playerbots.conf');
  const secret = bots.entries.find(entry => entry.key === 'PlayerbotsDatabaseInfo');
  assert.equal(secret.value, '');
  assert.equal(JSON.stringify(bots).includes('FIXTURE-SECRET'), false);
  assert.match(bots.entries.find(entry => entry.key === 'AiPlayerbot.RandomBotAutologin').description, /randombot/i);
});

test('save changes one value in place, keeps a backup and records the change', async () => {
  const root = await copyRepack();
  const config = new ServerConfig(root);
  const file = path.join(root, 'CoA-Bots/Core/configs/modules/playerbots.conf');
  const before = fs.readFileSync(file, 'utf8');
  const result = await config.save([
    { file: 'playerbots.conf', key: 'AiPlayerbot.MaxRandomBots', value: '42' },
    { file: 'playerbots.conf', key: 'AiPlayerbot.BroadcastWorldChannelName', value: 'Ascension' },
  ]);
  assert.deepEqual(result.written, ['playerbots.conf']);
  const after = fs.readFileSync(file, 'utf8');
  assert.match(after, /^AiPlayerbot\.MaxRandomBots = 42$/m);
  assert.match(after, /^AiPlayerbot\.BroadcastWorldChannelName = "Ascension"$/m);
  assert.equal(after.split('\n').length, before.split('\n').length, 'no line added or removed');
  const backup = path.join(root, '.coa-launcher/config-backups', result.backup, 'CoA-Bots/Core/configs/modules/playerbots.conf');
  assert.equal(fs.readFileSync(backup, 'utf8'), before);
  const recorded = JSON.parse(fs.readFileSync(path.join(root, '.coa-launcher/config-changes.json'), 'utf8'));
  assert.equal(recorded['playerbots.conf|AiPlayerbot.MaxRandomBots'], '42');

  await config.restore(result.backup);
  assert.equal(fs.readFileSync(file, 'utf8'), before);
});

test('invalid, secret and managed values are refused and nothing is written', async () => {
  const root = await copyRepack();
  const config = new ServerConfig(root);
  const file = path.join(root, 'CoA-Bots/Core/configs/modules/playerbots.conf');
  const before = fs.readFileSync(file, 'utf8');
  for (const change of [
    { file: 'playerbots.conf', key: 'AiPlayerbot.Enabled', value: 'yes' },
    { file: 'playerbots.conf', key: 'AiPlayerbot.MaxRandomBots', value: '10\nAiPlayerbot.Enabled = 0' },
    { file: 'playerbots.conf', key: 'PlayerbotsDatabaseInfo', value: 'x' },
    { file: 'worldserver.conf', key: 'MapUpdate.Threads', value: '4' },
    { file: '../../evil.conf', key: 'A', value: '1' },
  ]) {
    await assert.rejects(config.save([{ file: 'playerbots.conf', key: 'AiPlayerbot.MaxRandomBots', value: '12' }, change]));
  }
  assert.equal(fs.readFileSync(file, 'utf8'), before);
});

test('recorded changes are carried to an upgraded repack', async () => {
  const oldRoot = await copyRepack();
  const newRoot = await copyRepack();
  await new ServerConfig(oldRoot).save([{ file: 'worldserver.conf', key: 'Rate.XP.Kill', value: '3' }, { file: 'playerbots.conf', key: 'AiPlayerbot.BroadcastWorldChannelName', value: 'Monde' }]);
  const result = await new ServerConfig(oldRoot).carryTo(newRoot);
  assert.deepEqual(result.applied.sort(), ['AiPlayerbot.BroadcastWorldChannelName', 'Rate.XP.Kill']);
  assert.match(fs.readFileSync(path.join(newRoot, 'Settings/worldserver.conf.template'), 'utf8'), /^Rate\.XP\.Kill\s*=\s*3$/m);
  assert.match(fs.readFileSync(path.join(newRoot, 'CoA-Bots/Core/configs/modules/playerbots.conf'), 'utf8'), /^AiPlayerbot\.BroadcastWorldChannelName = "Monde"$/m);
});

test('a reinstall carries the values changed by hand, never a shipped default nor a path of the old folder', async () => {
  const oldRoot = await copyRepack();
  const newRoot = await copyRepack();
  const bots = 'CoA-Bots/Core/configs/modules/playerbots.conf';
  const edit = (root, relative, from, to) => { const file = path.join(root, relative); fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(from, to)); };
  edit(oldRoot, bots, /^AiPlayerbot\.RandomBotAutologin = 1$/m, 'AiPlayerbot.RandomBotAutologin = 0');
  edit(oldRoot, 'Settings/worldserver.conf.template', /^Rate\.XP\.Kill\s*=\s*1$/m, 'Rate.XP.Kill = 5');
  edit(oldRoot, 'Settings/worldserver.conf.template', /^LogsDir = "@LOGS@"$/m, `LogsDir = "${oldRoot.split(path.sep).join('/')}/Logs"`);
  // A default the new version changed: the old file still has the old default, the new one keeps its own.
  edit(newRoot, bots, /^AiPlayerbot\.AddClassAccountPoolSize = 50$/m, 'AiPlayerbot.AddClassAccountPoolSize = 60');
  edit(newRoot, `${bots}.dist`, /^AiPlayerbot\.AddClassAccountPoolSize = 50$/m, 'AiPlayerbot.AddClassAccountPoolSize = 60');
  const other = await new ServerConfig(oldRoot).carryEdits(newRoot);
  assert.ok(other.applied.includes('AiPlayerbot.RandomBotAutologin'));
  assert.ok(!other.applied.includes('Rate.XP.Kill'), 'templates only between installs of the same release');
  const same = await new ServerConfig(oldRoot).carryEdits(newRoot, { sameRelease: true });
  assert.deepEqual(same.applied, ['Rate.XP.Kill']);
  const ws = fs.readFileSync(path.join(newRoot, 'Settings/worldserver.conf.template'), 'utf8');
  assert.match(ws, /^Rate\.XP\.Kill\s*=\s*5$/m);
  assert.match(ws, /^LogsDir = "@LOGS@"$/m);
  const pb = fs.readFileSync(path.join(newRoot, bots), 'utf8');
  assert.match(pb, /^AiPlayerbot\.RandomBotAutologin = 0$/m);
  assert.match(pb, /^AiPlayerbot\.AddClassAccountPoolSize = 60$/m);
  assert.ok(!fs.existsSync(path.join(newRoot, '.coa-launcher/config-changes.json')), 'hand edits are not recorded as launcher changes');
});

test('a newer setting absent from the file shows its default, and its line is written only when changed', async () => {
  const root = await copyRepack();
  const file = path.join(root, 'CoA-Bots', 'Core', 'configs', 'modules', 'playerbots.conf');
  const before = await fsp.readFile(file, 'utf8');
  const config = new ServerConfig(root);
  const overview = await config.overview();
  const percent = overview.settings.find(setting => setting.key === 'AiPlayerbot.RandomBotTransmogPercent');
  assert.equal(percent.value, '50');
  assert.deepEqual(percent.offWhen, { key: 'CoA.CollectionsForBots', values: ['2'] });
  assert.equal(await fsp.readFile(file, 'utf8'), before);
  await config.save([{ file: 'playerbots.conf', key: 'AiPlayerbot.RandomBotTransmogPercent', value: '30' }, { file: 'playerbots.conf', key: 'AiPlayerbot.MaxRandomBots', value: '77' }]);
  const after = await fsp.readFile(file, 'utf8');
  assert.equal(after.match(/^AiPlayerbot\.RandomBotTransmogPercent = 30$/gm).length, 1);
  assert.equal(after.includes('RandomBotTransmogCosmeticSets'), false);
  await config.save([{ file: 'playerbots.conf', key: 'AiPlayerbot.RandomBotTransmogPercent', value: '40' }]);
  assert.equal((await fsp.readFile(file, 'utf8')).match(/RandomBotTransmogPercent/g).length, 1);
  await assert.rejects(config.save([{ file: 'playerbots.conf', key: 'AiPlayerbot.NotInTheCatalog', value: '1' }]), /Not found/);
});

test('instances per hour: the value of worldserver.conf is shown, and only a change of the player writes it', async () => {
  const root = await copyRepack();
  const file = path.join(root, 'Settings', 'worldserver.conf.template');
  const before = await fsp.readFile(file, 'utf8');
  const config = new ServerConfig(root);
  const setting = (await config.overview()).settings.find(item => item.key === 'AccountInstancesPerHour');
  assert.equal(setting.value, '5');
  assert.equal(setting.absent, undefined);
  assert.equal(await fsp.readFile(file, 'utf8'), before);
  await config.save([{ file: 'worldserver.conf', key: 'AccountInstancesPerHour', value: '30' }]);
  const after = await fsp.readFile(file, 'utf8');
  assert.equal(after.match(/^AccountInstancesPerHour = 30$/gm).length, 1);
  assert.equal(after.replace('AccountInstancesPerHour = 30', 'AccountInstancesPerHour = 5'), before);
});

test('a UTF-8 BOM is removed from the .conf files only, bytes after it unchanged, a copy kept and logged', async () => {
  const root = await copyRepack();
  const file = path.join(root, 'Core', 'configs', 'modules', 'bom-test.conf');
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const body = Buffer.from('Some.Key = "été"\r\nOther = 1\r\n', 'utf8');
  await fsp.writeFile(file, Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), body]));
  const config = new ServerConfig(root);
  assert.deepEqual(await config.removeBoms(), ['Core/configs/modules/bom-test.conf']);
  assert.ok((await fsp.readFile(file)).equals(body));
  const backups = await fsp.readdir(path.join(root, '.coa-launcher', 'config-backups'));
  const kept = await fsp.readFile(path.join(root, '.coa-launcher', 'config-backups', backups[0], 'Core', 'configs', 'modules', 'bom-test.conf'));
  assert.equal(kept[0], 0xEF);
  assert.match(await fsp.readFile(path.join(root, 'logs', 'launcher-config.log'), 'utf8'), /BOM removed.*bom-test\.conf/);
  assert.deepEqual(await config.removeBoms(), []);
});
