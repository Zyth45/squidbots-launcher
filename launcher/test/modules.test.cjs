'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tempDir, write } = require('./helpers.cjs');
const modules = require('../src/modules.cjs');

async function repack({ core = true, dbc = 23, conf = null } = {}) {
  const root = await tempDir();
  const files = {
    'CoA-Bots/coa_bots.py': '',
    'CoA-Bots/Core/worldserver.exe': core ? 'MZ...CoACustomRaces.Enable...' : 'MZ...no races here...',
    'CoA-Bots/Core/configs/modules/coa_custom_races.conf.dist': '[worldserver]\nCoACustomRaces.Enable = 0\nCoACustomRaces.BotsEnable = 0\n',
  };
  for (let i = 0; i < dbc; i++) files[`Data/dbc_races/Race${i}.dbc`] = 'x';
  if (conf !== null) files['CoA-Bots/Core/configs/modules/coa_custom_races.conf'] = conf;
  await write(root, files);
  return root;
}

test('multirace: off by default, switched on from the .dist, then off with a .bak', async () => {
  const root = await repack();
  assert.equal((await modules.status(root)).multirace.enabled, false);
  const on = await modules.setMultirace(root, true, { bots: true });
  assert.equal(on.enabled, true);
  assert.equal(on.bots, true);
  const off = await modules.setMultirace(root, false);
  assert.equal(off.enabled, false);
  assert.equal(off.bots, false);
  const folder = path.join(root, 'CoA-Bots/Core/configs/modules');
  assert.ok(fs.readdirSync(folder).some(name => name.startsWith('coa_custom_races.conf.bak-')));
});

test('multirace: refused without the core switch or without the 23 race files; other keys kept', async () => {
  await assert.rejects(modules.setMultirace(await repack({ core: false }), true), /core/);
  await assert.rejects(modules.setMultirace(await repack({ dbc: 5 }), true), /dbc/);
  const root = await repack({ conf: 'Other.Key = 7\nCoACustomRaces.Enable = 0\n' });
  await modules.setMultirace(root, true, { bots: false });
  const text = fs.readFileSync(path.join(root, modules.RACES_CONF), 'utf8');
  assert.match(text, /^Other.Key = 7$/m);
  assert.match(text, /^CoACustomRaces.Enable = 1$/m);
  assert.match(text, /^CoACustomRaces.BotsEnable = 0$/m);
});

test('auction house bot: greyed until the package has it, then switched with a .bak', async () => {
  const root = await repack();
  assert.deepEqual(await modules.ahbotStatus(root), { available: false, enabled: false });
  await assert.rejects(modules.setAhbot(root, true), /2\.5/);
  await write(root, { 'CoA-Bots/Core/configs/modules/mod_ahbot.conf.dist': 'AuctionHouseBot.Enable = false\nAuctionHouseBot.Account = 0\n' });
  assert.equal((await modules.setAhbot(root, true)).enabled, true);
  assert.equal((await modules.setAhbot(root, false)).enabled, false);
  const text = fs.readFileSync(path.join(root, 'CoA-Bots/Core/configs/modules/mod_ahbot.conf'), 'utf8');
  assert.match(text, /^AuctionHouseBot.Account = 0$/m);
});

test('SquidBots-AH: on a core without mod-ah-bot-plus, its switch is in playerbots.conf and mod_ahbot.conf keeps its values', async () => {
  const root = await repack();
  await write(root, {
    'CoA-Bots/Core/worldserver.exe': 'MZ...AiPlayerbot.CoaEconomy.AHBot.Enable...CoaAhBotWorldHooks...',
    'CoA-Bots/Core/configs/modules/mod_ahbot.conf': 'AuctionHouseBot.Enable = false\nAuctionHouseBot.Alliance.MaxItems = 777\n',
    'CoA-Bots/Core/configs/modules/playerbots.conf.dist': 'AiPlayerbot.Enabled = 1\nAiPlayerbot.CoaEconomy.AHBot.Enable = 0\n',
  });
  assert.deepEqual(await modules.ahbotStatus(root), { kind: 'squidbots', available: true, enabled: false });
  // On: its switch, and the master key of mod_ahbot.conf with it; the player's other values stay.
  assert.equal((await modules.setAhbot(root, true)).enabled, true);
  const bots = fs.readFileSync(path.join(root, 'CoA-Bots/Core/configs/modules/playerbots.conf'), 'utf8');
  const ah = () => fs.readFileSync(path.join(root, 'CoA-Bots/Core/configs/modules/mod_ahbot.conf'), 'utf8');
  assert.match(bots, /^AiPlayerbot.CoaEconomy.AHBot.Enable = 1$/m);
  assert.match(ah(), /^AuctionHouseBot.Enable = true$/m);
  assert.match(ah(), /^AuctionHouseBot.Alliance.MaxItems = 777$/m);
  // Off: only its switch; mod_ahbot.conf stays as it is.
  assert.equal((await modules.setAhbot(root, false)).enabled, false);
  assert.match(ah(), /^AuctionHouseBot.Enable = true$/m);
  // A core that still has mod-ah-bot-plus keeps the old card (never both at once).
  await write(root, { 'CoA-Bots/Core/worldserver.exe': 'MZ...AiPlayerbot.CoaEconomy.AHBot.Enable...AHBot_WorldScript......' });
  assert.equal((await modules.ahbotStatus(root)).kind, undefined);
});

test('client patch: detected, switched off to .disabled and back', async () => {
  const client = await tempDir();
  const files = { 'Ascension.exe': '', 'dinput8.dll': '', 'EsteriaAppearance.dll': '', 'Data/patch-T.MPQ': '', 'Data/patch-Z.MPQ': '', 'Data/common.MPQ': '' };
  for (const id of ['ZE1', 'ZE2', 'ZE3', 'ZE5', 'ZE6', 'ZE7', 'ZE8', 'ZE9', 'ZEA', 'ZG', 'ZH', 'ZHA', 'ZHM', 'ZM', 'ZVU', 'ZES', 'ZJ', 'ZZE', 'ZZR', 'ZZS', 'ZZT', 'ZZU', 'ZZV']) files[`Data/patch-${id}.MPQ`] = '';
  await write(client, files);
  assert.equal(modules.clientPatch(client).state, 'partial', 'one race patch (ZZW) is missing');
  await write(client, { 'Data/patch-ZZW.MPQ': '' });
  assert.equal(modules.clientPatch(client).state, 'yes');
  assert.equal((await modules.setClientPatch(client, false)).state, 'disabled');
  assert.ok(fs.existsSync(path.join(client, 'Data/patch-ZE1.MPQ.disabled')));
  for (const kept of ['Data/patch-T.MPQ', 'Data/patch-Z.MPQ', 'dinput8.dll', 'Data/common.MPQ']) assert.ok(fs.existsSync(path.join(client, kept)), `${kept} is an official or shared file: untouched`);
  assert.equal((await modules.setClientPatch(client, true)).state, 'yes');
  assert.equal(modules.clientPatch('').state, 'unknown');
});

test('enchanter writes keep a CRLF config line by line', async () => {
  const root = await tempDir();
  const file = path.join(root, 'CoA-Bots', 'Core', 'configs', 'modules', 'npc_enchanter.conf');
  await write(root, { 'CoA-Bots/Core/configs/modules/npc_enchanter.conf': '# Enable\r\n#\r\nEnchanterNpc.Enable = 0\r\n#\r\nEnchanterNpc.AllowedTiers = "60"\r\nEnchanterNpc.CostGold70 =\r\nEnchanterNpc.CostGold80 = 10\r\n' });
  await modules.setEnchanter(root, true);
  await modules.setEnchanterTiers(root, ['70']);
  await modules.setEnchanterCost(root, '70', 3);
  assert.equal(fs.readFileSync(file, 'utf8'), '# Enable\r\n#\r\nEnchanterNpc.Enable = 1\r\n#\r\nEnchanterNpc.AllowedTiers = "60,70"\r\nEnchanterNpc.CostGold70 = 3\r\nEnchanterNpc.CostGold80 = 10\r\n');
});

// From Nightlund's PR #2 on squidbots-launcher: the spacing of the line is kept, a value with $ is written as is.
test('modules setKey keeps the spacing of the line and takes a value with $ as is', async () => {
  const root = await tempDir();
  const file = path.join(root, 'CoA-Bots', 'Core', 'configs', 'modules', 'npc_enchanter.conf');
  await write(root, { 'CoA-Bots/Core/configs/modules/npc_enchanter.conf': '# c\r\n  EnchanterNpc.Enable  =  0\r\n' });
  await modules.setEnchanter(root, true);
  assert.equal(fs.readFileSync(file, 'utf8'), '# c\r\n  EnchanterNpc.Enable  =  1\r\n');
});
