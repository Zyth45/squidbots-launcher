'use strict';
// Server modules the player can switch: SquidBots (start with or without the bots) and Multirace (the added
// playable races). A switch only writes the two keys of the module's .conf (a .bak is kept) and says what must
// follow (purge of the random bots); the server must be stopped. The game client is only looked at, except on an
// explicit click that renames its race patch files to .disabled (and back).
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const ahSettings = require('./ahbot-settings.cjs');

const RACES_CONF = 'CoA-Bots/Core/configs/modules/coa_custom_races.conf';
const RACES_DBC = 'Data/dbc_races';
const RACES_DBC_COUNT = 23;
const CORE_MARK = 'CoACustomRaces.Enable';
// The race patch files of the client, by exact name. patch-T.MPQ and patch-Z.MPQ are NOT in the list: the
// official CoA client has its own files under those names, renaming them would break the game. dinput8.dll is
// left alone too (other tools use the same hook).
const RACE_MPQS = ['ZE1', 'ZE2', 'ZE3', 'ZE5', 'ZE6', 'ZE7', 'ZE8', 'ZE9', 'ZEA', 'ZG', 'ZH', 'ZHA', 'ZHM', 'ZM', 'ZVU', 'ZES', 'ZJ', 'ZZE', 'ZZR', 'ZZS', 'ZZT', 'ZZU', 'ZZV', 'ZZW'].map(id => `Data/patch-${id}.MPQ`);
const CLIENT_FILES = [...RACE_MPQS, 'EsteriaAppearance.dll'];
const DEFAULT_CONF = '[worldserver]\n\n# Added playable races (DBC data, character creation, appearances). 0 = off, 1 = on.\nCoACustomRaces.Enable = 0\n\n# Random bots may also be of the added races. 0 = off, 1 = on.\nCoACustomRaces.BotsEnable = 0\n';

const confValue = (text, key) => new RegExp(`^[ \\t]*${key.replace(/\./g, '\\.')}[ \\t]*=[ \\t]*"?([^"\\r\\n#]*)"?`, 'm').exec(text || '')?.[1]?.trim();

// Does this worldserver know the switch? Its own config keys are plain text inside the executable.
const coreCache = new Map();
async function coreSupports(exe, mark = CORE_MARK) {
  const stat = await fsp.stat(exe).catch(() => null);
  if (!stat) return false;
  const key = `${exe}|${stat.size}|${stat.mtimeMs}|${mark}`;
  if (coreCache.has(key)) return coreCache.get(key);
  const needle = Buffer.from(mark, 'latin1');
  let found = false;
  let tail = Buffer.alloc(0);
  for await (const chunk of fs.createReadStream(exe, { highWaterMark: 4 << 20 })) {
    const block = Buffer.concat([tail, chunk]);
    if (block.includes(needle)) { found = true; break; }
    tail = block.subarray(Math.max(0, block.length - needle.length));
  }
  coreCache.set(key, found);
  return found;
}

function clientPatch(client) {
  if (!client || !fs.existsSync(client)) return { state: 'unknown', active: [], disabled: [] };
  const active = CLIENT_FILES.filter(rel => fs.existsSync(path.join(client, rel)));
  const disabled = CLIENT_FILES.filter(rel => !fs.existsSync(path.join(client, rel)) && fs.existsSync(path.join(client, `${rel}.disabled`)));
  const mpqs = active.filter(rel => rel.endsWith('.MPQ')).length;
  const state = mpqs === 0 ? (disabled.length ? 'disabled' : 'no') : mpqs === RACE_MPQS.length && active.includes('EsteriaAppearance.dll') ? 'yes' : 'partial';
  return { state, active, disabled };
}

async function status(root, { squidbots = true, client = '' } = {}) {
  const conf = await fsp.readFile(path.join(root, RACES_CONF), 'utf8').catch(() => null);
  const dist = fs.existsSync(path.join(root, `${RACES_CONF}.dist`));
  const dbc = (await fsp.readdir(path.join(root, RACES_DBC)).catch(() => [])).filter(name => /\.dbc$/i.test(name)).length;
  return {
    squidbots: { installed: fs.existsSync(path.join(root, 'CoA-Bots', 'coa_bots.py')), enabled: squidbots !== false },
    ahbot: await ahbotStatus(root),
    dungeonclear: await dungeonStatus(root),
    enchanter: await enchanterStatus(root),
    manastorm: await manastormStatus(root),
    mythicplus: await mythicPlusStatus(root),
    rotation: await rotationStatus(root),
    multirace: {
      enabled: confValue(conf, 'CoACustomRaces.Enable') === '1',
      bots: confValue(conf, 'CoACustomRaces.BotsEnable') === '1',
      conf: conf !== null, dist, dbc, dbcNeeded: RACES_DBC_COUNT,
      core: await coreSupports(path.join(root, 'CoA-Bots', 'Core', 'worldserver.exe')),
      client: clientPatch(client),
    },
  };
}

// What stops the switch to ON (nothing is written then).
async function multiraceBlockers(root) {
  const s = (await status(root)).multirace;
  const out = [];
  if (!s.core) out.push('core');
  if (s.dbc < RACES_DBC_COUNT) out.push('dbc');
  return out;
}

async function setKey(text, key, value) {
  const pattern = new RegExp(`^([ \\t]*${key.replace(/\./g, '\\.')}[ \\t]*=)([ \\t]*).*$`, 'm');
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  return pattern.test(text) ? text.replace(pattern, (_, head, space) => `${head}${space || ' '}${value}`) : `${text.replace(/\s*$/, '')}${eol}${key} = ${value}${eol}`;
}

// Writes Enable / BotsEnable. The caller purges the random bots afterwards (both ways).
async function setMultirace(root, on, { bots = true } = {}) {
  if (on) {
    const blockers = await multiraceBlockers(root);
    if (blockers.length) throw Object.assign(new Error(`Multirace cannot be switched on: ${blockers.join(', ')}.`), { blockers });
  }
  const file = path.join(root, RACES_CONF);
  let text = await fsp.readFile(file, 'utf8').catch(() => null);
  if (text === null) {
    text = await fsp.readFile(`${file}.dist`, 'utf8').catch(() => DEFAULT_CONF);
  } else {
    await fsp.copyFile(file, `${file}.bak-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  }
  text = await setKey(text, 'CoACustomRaces.Enable', on ? '1' : '0');
  text = await setKey(text, 'CoACustomRaces.BotsEnable', on && bots ? '1' : '0');
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, text);
  return (await status(root)).multirace;
}

// The client's race patch files renamed to .disabled (off) or back (on). Nothing else in the game is touched.
async function setClientPatch(client, on) {
  const current = clientPatch(client);
  const list = on ? current.disabled : current.active;
  for (const rel of list) {
    const active = path.join(client, rel);
    if (on) await fsp.rename(`${active}.disabled`, active);
    else await fsp.rename(active, `${active}.disabled`);
  }
  return clientPatch(client);
}

// A module switch kept in a .conf of the server's modules (with or without bots). Without a .conf the server reads
// the .dist, so its value is the one in force; the first switch creates the .conf from the .dist.
const MODULE_DIRS = ['CoA-Bots/Core/configs/modules', 'Core/configs/modules'];
async function moduleConf(root, name) {
  for (const dir of MODULE_DIRS) {
    const file = path.join(root, dir, name);
    const conf = await fsp.readFile(file, 'utf8').catch(() => null);
    if (conf !== null) return conf;
    const dist = await fsp.readFile(`${file}.dist`, 'utf8').catch(() => null);
    if (dist !== null) return dist;
  }
  return null;
}
async function setModuleKeys(root, name, keys, missing) {
  let written = 0;
  for (const dir of MODULE_DIRS) {
    const file = path.join(root, dir, name);
    let text = await fsp.readFile(file, 'utf8').catch(() => null);
    if (text === null) {
      text = await fsp.readFile(`${file}.dist`, 'utf8').catch(() => null);
      if (text === null) continue;
    } else await fsp.copyFile(file, `${file}.bak-${new Date().toISOString().replace(/[:.]/g, '-')}`);
    for (const [key, value] of Object.entries(keys)) text = await setKey(text, key, value);
    await fsp.writeFile(file, text);
    written++;
  }
  if (!written) throw new Error(missing);
}
const isOn = value => /^(1|true)$/i.test(value || '');

// The auction house bot (from CoA Bots 2.5, on by default): one key, a restart, nothing to purge. Its own account
// (AHBOT) is not a random bot account, so purges never touch it.
const AHBOT = 'mod_ahbot.conf';
// SquidBots-AH (CoA Bots 3.0): the auction house bot merged into SquidBots replaces mod-ah-bot-plus, which leaves the
// core. Its switch is AiPlayerbot.CoaEconomy.AHBot.Enable (playerbots.conf); its settings stay the AuctionHouseBot.* keys
// of mod_ahbot.conf (same file, same values: what the player set before carries over). Told apart by the worldserver:
// mod-ah-bot-plus registers AHBot_WorldScript. A core that still has it keeps the old card, so the two never run at once.
const AH_SWITCH = 'AiPlayerbot.CoaEconomy.AHBot.Enable';
const AH_LEGACY_MARK = 'AHBot_WorldScript';
async function ahbotKind(root) {
  const exe = path.join(root, 'CoA-Bots', 'Core', 'worldserver.exe');
  if (await coreSupports(exe, AH_LEGACY_MARK).catch(() => false)) return 'legacy';
  return (await coreSupports(exe, AH_SWITCH).catch(() => false)) ? 'squidbots' : 'legacy';
}
async function ahbotStatus(root) {
  const conf = await moduleConf(root, AHBOT);
  if ((await ahbotKind(root)) === 'squidbots') {
    const bots = await moduleConf(root, 'playerbots.conf');
    return { kind: 'squidbots', available: conf !== null && bots !== null, enabled: isOn(confValue(bots, AH_SWITCH)) && isOn(confValue(conf, 'AuctionHouseBot.Enable')) };
  }
  return { available: conf !== null, enabled: isOn(confValue(conf, 'AuctionHouseBot.Enable')) };
}
// The instant payout exists from CoA Bots 2.8: shown only when the installed .dist knows its key.
async function ahbotInstantKnown(root) {
  for (const dir of MODULE_DIRS) {
    const dist = await fsp.readFile(path.join(root, dir, `${AHBOT}.dist`), 'utf8').catch(() => '');
    if (/^[ \t]*AuctionHouseBot\.Buyer\.InstantBids[ \t]*=/m.test(dist)) return true;
  }
  return false;
}
async function ahbotSettings(root) {
  const conf = await moduleConf(root, AHBOT);
  if (conf === null) throw new Error('The auction house bot comes with CoA Bots 2.5.');
  return { values: ahSettings.read(conf), instantKnown: await ahbotInstantKnown(root) };
}
async function setAhbotSettings(root, values) {
  await setModuleKeys(root, AHBOT, ahSettings.keys(values, { instantKnown: await ahbotInstantKnown(root) }), 'The auction house bot comes with CoA Bots 2.5.');
  return ahbotSettings(root);
}
// Dungeon Clear (from CoA Bots 2.8, on by default): the bots of your group clear the dungeon on their own, started
// from the SquidBots Lite addon. Shown only when its .conf.dist is installed.
const DUNGEON = 'mod_dungeon_clear.conf';
async function dungeonStatus(root) {
  const conf = await moduleConf(root, DUNGEON);
  const allowed = String(confValue(conf, 'DungeonClear.AllowedDifficulties') || 'normal,heroic,mythic').toLowerCase().split(',').map(item => item.trim()).filter(item => DIFFICULTIES.includes(item));
  return { available: conf !== null, enabled: isOn(confValue(conf, 'DungeonClear.Enable')), difficulties: allowed.length ? allowed : [...DIFFICULTIES], difficultyKnown: await dungeonDifficultyKnown(root) };
}
// The difficulties a run may use (DungeonClear.AllowedDifficulties, a quoted list): shown only when the installed .dist
// knows the key.
const DIFFICULTIES = ['normal', 'heroic', 'mythic'];
async function dungeonDifficultyKnown(root) {
  for (const dir of MODULE_DIRS) {
    const dist = await fsp.readFile(path.join(root, dir, `${DUNGEON}.dist`), 'utf8').catch(() => '');
    if (/^[ \t]*DungeonClear\.AllowedDifficulties[ \t]*=/m.test(dist)) return true;
  }
  return false;
}
async function setDungeonDifficulties(root, list) {
  const wanted = DIFFICULTIES.filter(item => (list || []).includes(item));
  if (!wanted.length) throw new Error('Keep at least one difficulty.');
  await setModuleKeys(root, DUNGEON, { 'DungeonClear.AllowedDifficulties': `"${wanted.join(',')}"` }, 'Dungeon Clear comes with CoA Bots 2.8.');
  return dungeonStatus(root);
}
async function setDungeon(root, on) {
  await setModuleKeys(root, DUNGEON, { 'DungeonClear.Enable': on ? '1' : '0' }, 'Dungeon Clear comes with CoA Bots 2.8.');
  return dungeonStatus(root);
}

// The Enchanter NPC (from CoA Bots 2.8.4, off by default): enchantments up to the tiers allowed, each at its price in
// gold. Shown working only when its .conf.dist is installed; before, a "coming soon" card.
const ENCHANTER = 'npc_enchanter.conf';
const TIERS = ['60', '70', '80'];
const ENCHANTER_MISSING = 'The Enchanter NPC comes with CoA Bots 2.8.4.';
async function enchanterStatus(root) {
  const conf = await moduleConf(root, ENCHANTER);
  const tiers = String(confValue(conf, 'EnchanterNpc.AllowedTiers') || '60').split(',').map(item => item.trim()).filter(item => TIERS.includes(item));
  const costs = Object.fromEntries(TIERS.map((tier, i) => [tier, (value => (value === undefined || value === '' || !Number.isFinite(Number(value)) ? [1, 5, 10][i] : Number(value)))(confValue(conf, `EnchanterNpc.CostGold${tier}`))]));
  return { available: conf !== null, enabled: isOn(confValue(conf, 'EnchanterNpc.Enable')), tiers: tiers.length ? tiers : ['60'], costs };
}
async function setEnchanter(root, on) {
  await setModuleKeys(root, ENCHANTER, { 'EnchanterNpc.Enable': on ? '1' : '0' }, ENCHANTER_MISSING);
  return enchanterStatus(root);
}
// Level 60 stays allowed: a higher tier adds to it.
async function setEnchanterTiers(root, list) {
  const wanted = TIERS.filter(tier => tier === '60' || (list || []).includes(tier));
  await setModuleKeys(root, ENCHANTER, { 'EnchanterNpc.AllowedTiers': `"${wanted.join(',')}"` }, ENCHANTER_MISSING);
  return enchanterStatus(root);
}
async function setEnchanterCost(root, tier, gold) {
  if (!TIERS.includes(tier)) throw new Error('Unknown enchantment level.');
  const value = Math.round(Number(gold));
  if (!Number.isFinite(value) || value < 0 || value > 100000) throw new Error('Give a price between 0 and 100000 gold.');
  await setModuleKeys(root, ENCHANTER, { [`EnchanterNpc.CostGold${tier}`]: String(value) }, ENCHANTER_MISSING);
  return enchanterStatus(root);
}
async function setAhbot(root, on) {
  // SquidBots-AH: its own switch, and the master key of mod_ahbot.conf on with it (a player who had switched the old bot
  // off asks for it again by this click). Off: only its switch, mod_ahbot.conf stays as the player left it.
  if ((await ahbotKind(root)) === 'squidbots') {
    await setModuleKeys(root, 'playerbots.conf', { [AH_SWITCH]: on ? '1' : '0' }, 'SquidBots-AH comes with CoA Bots 3.0.');
    if (on) await setModuleKeys(root, AHBOT, { 'AuctionHouseBot.Enable': 'true' }, 'SquidBots-AH comes with CoA Bots 3.0.');
    return ahbotStatus(root);
  }
  await setModuleKeys(root, AHBOT, { 'AuctionHouseBot.Enable': on ? 'true' : 'false' }, 'The auction house bot comes with CoA Bots 2.5.');
  return ahbotStatus(root);
}

// Manastorm Endless (core of CoA, from CoA Bots 2.5): off by default. Its tables are always there (the server needs
// them to start); the switch only sets Enable, with ClientMode 2 (the native window of the patched client).
// Mythic+ keystone runs (from CoA Bots 2.9): read at each run, so a .reload config applies it at once.
const MYTHICPLUS = 'mod_coa_mythic_plus.conf';
async function mythicPlusStatus(root) {
  const conf = await moduleConf(root, MYTHICPLUS);
  return { available: conf !== null, enabled: conf !== null && !/^(0|false)$/i.test(confValue(conf, 'MythicPlus.Enable') || '') };
}
async function setMythicPlus(root, on) {
  await setModuleKeys(root, MYTHICPLUS, { 'MythicPlus.Enable': on ? '1' : '0' }, 'Mythic+ comes with CoA Bots 2.9.');
}

const MANASTORM = 'manastorm-endless.conf';
async function manastormStatus(root) {
  const conf = await moduleConf(root, MANASTORM);
  return { available: conf !== null, enabled: isOn(confValue(conf, 'Manastorm.Enable')) };
}
async function setManastorm(root, on) {
  await setModuleKeys(root, MANASTORM, { 'Manastorm.Enable': on ? '1' : '0', 'Manastorm.ClientMode': '2' }, 'Manastorm comes with CoA Bots 2.5.');
  return manastormStatus(root);
}

// The one-button rotation assistant (core of CoA): off in CoA Bots. The core turns it ON when its key is missing,
// so the key is always written (0 when absent, see keepRotationOff). manage.py writes Core\configs\modules\coa.conf
// from Settings\coa.conf.template at every start: the template is the setting, the copies follow it.
const ROTATION_KEY = 'CoA.RotationAssist.Enable';
const ROTATION_FILES = ['Settings/coa.conf.template', 'CoA-Bots/Core/configs/modules/coa.conf', 'Core/configs/modules/coa.conf'];
async function rotationStatus(root) {
  const template = await fsp.readFile(path.join(root, ROTATION_FILES[0]), 'utf8').catch(() => null);
  const known = await coreSupports(path.join(root, 'CoA-Bots', 'Core', 'worldserver.exe'), ROTATION_KEY);
  const value = confValue(template, ROTATION_KEY);
  return { available: template !== null && known, enabled: value === undefined ? known : isOn(value), missing: value === undefined };
}
async function writeRotation(root, value, onlyWhenMissing) {
  let written = 0;
  for (const rel of ROTATION_FILES) {
    const file = path.join(root, rel);
    const text = await fsp.readFile(file, 'utf8').catch(() => null);
    if (text === null || (onlyWhenMissing && confValue(text, ROTATION_KEY) !== undefined)) continue;
    await fsp.writeFile(file, await setKey(text, ROTATION_KEY, value));
    written++;
  }
  return written;
}
async function setRotation(root, on) {
  if (!(await rotationStatus(root)).available) throw new Error('The rotation assistant comes with CoA Bots 2.5.');
  await writeRotation(root, on ? '1' : '0', false);
  return rotationStatus(root);
}
// Before every start: a missing key is written as 0 (never changes a value the player chose).
async function keepRotationOff(root) {
  if (!(await coreSupports(path.join(root, 'CoA-Bots', 'Core', 'worldserver.exe'), ROTATION_KEY).catch(() => false))) return 0;
  return writeRotation(root, '0', true).catch(() => 0);
}

// The repack's own switch (CoA-Bots\coa_multirace.py, from CoA Bots 2.4): it also moves the players' characters of
// an added race to a base race of their side (kept aside, given back at ON) and purges the random bots.
// Run first without --apply (what it would do), then with --apply, server stopped.
const SCRIPT = 'CoA-Bots/coa_multirace.py';
const hasScript = root => fs.existsSync(path.join(root, SCRIPT));

function runScript(root, command, apply) {
  const { execFile } = require('node:child_process');
  const python = path.join(root, 'Runtime', 'python', 'python.exe');
  const args = ['-B', '-X', 'utf8', path.join(root, SCRIPT), command, '--json', '--repack', root, ...(apply ? ['--apply'] : [])];
  return new Promise((resolve, reject) => execFile(python, args, { cwd: path.join(root, 'CoA-Bots'), windowsHide: true, timeout: 30 * 60 * 1000, maxBuffer: 16 << 20, env: { ...process.env, PYTHONIOENCODING: 'utf-8' } }, (error, stdout, stderr) => {
    const last = String(stdout || '').trim().split(/\r?\n/).reverse().find(line => line.startsWith('{'));
    let data = null;
    try { data = last ? JSON.parse(last) : null; } catch {}
    if (data && !data.error && !error) return resolve(data);
    reject(Object.assign(new Error(data?.error?.text || String(stderr || error?.message || 'The multirace switch failed.').trim().split(/\r?\n/).slice(-3).join(' ')), { data }));
  }));
}

module.exports = { dungeonStatus, setDungeon, setDungeonDifficulties, enchanterStatus, setEnchanter, setEnchanterTiers, setEnchanterCost, ahbotStatus, ahbotKind, setAhbot, ahbotSettings, setAhbotSettings, ahbotInstantKnown, manastormStatus, setManastorm, mythicPlusStatus, setMythicPlus, rotationStatus, setRotation, keepRotationOff, hasScript, runScript, status, setMultirace, setClientPatch, clientPatch, coreSupports, multiraceBlockers, RACES_CONF, RACES_DBC_COUNT };
