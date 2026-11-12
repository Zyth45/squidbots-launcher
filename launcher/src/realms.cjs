'use strict';
// Extra realms of a local server: Wildcard (Darkmoon), Warcraft Reborn (Bronzebeard) and Free Pick (Dawnrise) beside the
// CoA realm (id 1).
// A realm is a folder Royaumes/<key> with its own configs\ (on Windows the worldserver reads the configs of its
// modules in configs\ of its working folder), the same bot-enabled worldserver, its own databases
// acore_characters_<key> and acore_playerbots_<key>, and one line of acore_auth.realmlist. The CoA realm keeps
// running through the repack's own scripts; MySQL and the authserver are shared.
//
// The settings of a realm are built again before every start, in three layers (each one wins over the previous):
//   1. the CoA bot server's settings of the moment (CoA-Bots\Core\configs), never changed by a realm;
//   2. the realm's own values, only the keys the player changed for it (Royaumes\<key>\settings.json);
//   3. what the mode and the realm impose (classes of the mode, ports, databases, bot account prefix).
// A realm never writes a file or a database of the CoA realm.
const { spawn, execFile } = require('node:child_process');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { portOpen } = require('./server-control.cjs');
const { validate } = require('./server-config.cjs');
const CATALOG = require('./catalog.cjs');
const live = require('./live.cjs');
const eco = require('./eco.cjs');
const os = require('node:os');

// Keys by settings file (the file names of the Server settings page).
const MODES = {
  wildcard: {
    id: 2, name: 'Darkmoon (Wildcard)', prefix: 'rndwc', step: 1,
    keys: {
      'mod-coa-challenges.conf': { 'CoAChallenges.GameModes.Realm': 'WildCard' },
      // Dungeon Clear stays on the CoA realm only (not made for these modes yet).
      'mod_dungeon_clear.conf': { 'DungeonClear.Enable': '0' },
      'coa.conf': { 'CoA.GameModeMask': '64', 'CoA.ClassModel': '"hero"', 'CoA.RealmType': '"live seasonal"', 'CoA.MapClass10ToWarrior': '0', 'CoA.ClientBooleanConfigs': '"CONFIG_LEGACY_CHARACTER_ADVANCEMENT_ENABLED=0"' },
      // Only the Hero class (10) can be created.
      'worldserver.conf': { 'PlayerStart.CustomSpells': '1', 'AlwaysMaxSkillForLevel': '1', 'CharacterCreating.Disabled.ClassMask': '4294966783' },
    },
  },
  reborn: {
    id: 3, name: 'Bronzebeard (Reborn)', prefix: 'rndwr', step: 2,
    keys: {
      // Dungeon Clear stays on the CoA realm only (not made for these modes yet).
      'mod_dungeon_clear.conf': { 'DungeonClear.Enable': '0' },
      'coa.conf': { 'CoA.ClassModel': '"wcr"' },
      'playerbots.conf': { 'AiPlayerbot.CoaClassesOnly': '0' },
      // The ten classes of the original game only: 0xFFFFFA00 closes class 10 (bit 9) and classes 12 and up.
      'worldserver.conf': { 'CharacterCreating.Disabled.ClassMask': '4294965760' },
    },
  },
  // Season 10 Free Pick, as Ascension's Dawnrise: the Hero of the Wildcard realm without the Wildcard mode, so every
  // spell and talent is chosen in the Character Advancement window (the core's AscensionFreepick, ClassModel "hero"
  // without GameModeMask 64). RealmType "live seasonal" picks the seasonal rows of CharacterAdvancement.dbc, as Darkmoon.
  dawnrise: {
    id: 4, name: 'Dawnrise (Free Pick)', prefix: 'rndfp', step: 3,
    // Experimental: made without bots, they cannot play the Free Pick Hero yet (the player can raise the count later).
    bots: 0,
    keys: {
      // No challenge mode is imposed on every character (the CoA realm's empty value, written so a change there never leaks in).
      'mod-coa-challenges.conf': { 'CoAChallenges.GameModes.Realm': '' },
      // Dungeon Clear stays on the CoA realm only (not made for these modes yet).
      'mod_dungeon_clear.conf': { 'DungeonClear.Enable': '0' },
      'coa.conf': { 'CoA.GameModeMask': '0', 'CoA.ClassModel': '"hero"', 'CoA.RealmType': '"live seasonal"', 'CoA.MapClass10ToWarrior': '0', 'CoA.ClientBooleanConfigs': '"CONFIG_LEGACY_CHARACTER_ADVANCEMENT_ENABLED=0"' },
      // Only the Hero class (10) can be created.
      'worldserver.conf': { 'PlayerStart.CustomSpells': '1', 'AlwaysMaxSkillForLevel': '1', 'CharacterCreating.Disabled.ClassMask': '4294966783' },
    },
  },
  // 3.0 "New living server": a CoA realm opening like an official server (docs/LIVING-WORLDS-3.0.md). Its characters
  // database starts empty (no character, no auction); the launch mode and the auction house launch curve are imposed,
  // the rest (Solo self-found, the Living pack, the economy) is written once as the realm's own values.
  living: {
    id: 5, name: 'Malfurion', prefix: 'rndlv', step: 4,
    keys: {
      'playerbots.conf': { 'AiPlayerbot.CoaFreshStart.Enable': '1', 'AiPlayerbot.CoaEconomy.LaunchCurve.Enable': '1' },
    },
  },
};
// Tables the new characters database needs filled (the world fails or misbehaves without them).
// The per-realm state of acore_playerbots, emptied in a new realm's copy (see create).
const REALM_STATE_TABLES = ['playerbots_random_bots', 'playerbots_coa_brain_usage', 'playerbots_account_type', 'playerbots_coa_soul', 'playerbots_db_store',
  'playerbots_guild_tasks', 'playerbots_preferred_mounts', 'coa_world_server_first', 'coa_world_guild_log', 'coa_economy_clock', 'coa_economy_market', 'coa_economy_orders'];
const SEED_TABLES = ['updates', 'updates_include', 'worldstates', 'active_arena_season', 'playerbots_names', 'playerbots_guild_names',
  'playerbots_arena_team_names', 'coa_build_creator', 'coa_build_creator_enchant', 'coa_build_creator_item_type', 'coa_build_creator_spell',
  'instance_reset', 'pool_quest_save'];
// Wildcard and Reborn start with 500 bots (user, 11/11): only a realm being created; one made before keeps its count.
const DEFAULT_BOTS = 500;
// The Squid World realm (user's decision, 11/11): 1000 bots, editable like any realm's count.
const LIVING_BOTS = 1000;
const KEY = /^[a-z]{3,12}$/;
const CONF_KEY = /^[A-Za-z][A-Za-z0-9_.-]{0,99}$/;
const FILE_ID = /^[A-Za-z0-9_.-]{1,60}\.conf$/;
const BOT_COUNT = ['AiPlayerbot.MinRandomBots', 'AiPlayerbot.MaxRandomBots'];

const dirOf = (root, key) => path.join(root, 'Royaumes', key);
const BOTS_CONFIGS = root => path.join(root, 'CoA-Bots', 'Core', 'configs');
const worldExe = root => path.join(root, 'CoA-Bots', 'Core', 'worldserver.exe');
// Where a settings file of the page is, inside configs\ of a realm.
const relOf = fileId => (/^(worldserver|authserver)\.conf$/.test(fileId) ? fileId : `modules/${fileId}`);

function mode(key) {
  if (!KEY.test(String(key)) || !MODES[key]) throw new Error('Unknown realm.');
  return MODES[key];
}

const confValue = (text, key) => new RegExp(`^[ \\t]*${key.replace(/\./g, '\\.')}[ \\t]*=[ \\t]*"?([^"\\r\\n#]*)"?`, 'm').exec(text || '')?.[1]?.trim();

// Sets every line of the key, or adds it at the end.
function setKey(text, key, value) {
  const pattern = new RegExp(`^[ \\t]*${key.replace(/\./g, '\\.')}[ \\t]*=.*$`, 'gm');
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  return pattern.test(text) ? text.replace(pattern, () => `${key} = ${value}`) : `${text.replace(/\s*$/, '')}${eol}${key} = ${value}${eol}`;
}

async function readJson(file) { try { return JSON.parse((await fsp.readFile(file, 'utf8')).replace(/^﻿/, '')); } catch { return null; } }
async function repackSettings(root) { return (await readJson(path.join(root, 'Settings', 'repack.json'))) || {}; }

// ---------------------------------------------------------------- MySQL of the repack
function mysqlArgs(root) { return [`--defaults-file=${path.join(root, 'mysql', 'admin-client.ini')}`]; }
function sql(root, query) {
  return new Promise((resolve, reject) => execFile(path.join(root, 'mysql', 'bin', 'mysql.exe'), [...mysqlArgs(root), '-N', '-B', '-e', query],
    { windowsHide: true, timeout: 120000, maxBuffer: 16 << 20 }, (error, stdout, stderr) => error ? reject(new Error(String(stderr || error.message).trim().split(/\r?\n/).pop())) : resolve(String(stdout).trim())));
}
// mysqldump of a database (or some of its tables) poured straight into another database.
function copyDump(root, args, target) {
  return new Promise((resolve, reject) => {
    const dump = spawn(path.join(root, 'mysql', 'bin', 'mysqldump.exe'), [...mysqlArgs(root), ...args], { windowsHide: true });
    const load = spawn(path.join(root, 'mysql', 'bin', 'mysql.exe'), [...mysqlArgs(root), target], { windowsHide: true });
    let errors = '';
    dump.stderr.on('data', chunk => { errors += chunk; });
    load.stderr.on('data', chunk => { errors += chunk; });
    dump.stdout.pipe(load.stdin);
    let left = 2;
    const codes = [];
    const end = code => { codes.push(code); if (--left === 0) codes.some(Boolean) ? reject(new Error(`Copy into ${target} failed: ${errors.trim().split(/\r?\n/).pop() || codes.join(',')}`)) : resolve(); };
    dump.once('exit', end);
    load.once('exit', end);
    dump.once('error', reject);
    load.once('error', reject);
  });
}

// ---------------------------------------------------------------- realm files
// The values the player changed for a realm (the number on its Settings button): on the living server, those written
// at its creation and left as they were are its starting values, not changes (0.4.1-beta.9 showed « 101 » on a realm
// nobody had touched).
function changedCount(key, own) {
  const start = key === 'living' ? livingOwn() : {};
  return Object.entries(own).reduce((sum, [file, keys]) => sum + Object.entries(keys).filter(([name, value]) => String(value) !== start[file]?.[name]).length, 0);
}
async function realmFile(root, key) { return readJson(path.join(dirOf(root, key), 'realm.json')); }
async function ownSettings(root, key) {
  const own = (await readJson(path.join(dirOf(root, key), 'settings.json'))) || {};
  // Realms made by the first beta kept their number of bots in realm.json.
  const saved = await realmFile(root, key);
  if (saved?.bots !== undefined && !own['playerbots.conf']?.[BOT_COUNT[1]]) own['playerbots.conf'] = { ...own['playerbots.conf'], [BOT_COUNT[0]]: String(saved.bots), [BOT_COUNT[1]]: String(saved.bots) };
  return own;
}
async function writeOwn(root, key, own) {
  for (const file of Object.keys(own)) if (!Object.keys(own[file]).length) delete own[file];
  await fsp.writeFile(path.join(dirOf(root, key), 'settings.json'), JSON.stringify(own, null, 2));
  const saved = await realmFile(root, key);
  if (saved && saved.bots !== undefined) { delete saved.bots; await fsp.writeFile(path.join(dirOf(root, key), 'realm.json'), JSON.stringify(saved, null, 2)); }
}

// World and RA ports of a realm: kept from its creation; new ones are those of the CoA realm + 100 per step
// (side-by-side servers of the launcher take +1, +2…, so they never meet).
async function ports(root, key) {
  const saved = await realmFile(root, key);
  if (saved?.worldPort && saved?.raPort) return { worldPort: saved.worldPort, raPort: saved.raPort };
  const s = await repackSettings(root);
  const step = mode(key).step * 100;
  return { worldPort: (Number(s.worldPort) || 8085) + step, raPort: (Number(s.raPort) || 3443) + step };
}

function pidAlive(pid) { try { process.kill(Number(pid), 0); return true; } catch { return false; } }

async function processOf(root, key) {
  const state = await readJson(path.join(dirOf(root, key), '.state.json'));
  return state?.pid && pidAlive(state.pid) ? Number(state.pid) : 0;
}

// What the realm imposes, with what depends on the installed core: on a core that still has mod-ah-bot-plus, the new
// living server keeps the old AH bot off (it would fill the auction house with epics on day 1). On a core with
// SquidBots-AH nothing is forced: that master key also drives the merged bot.
async function imposedNow(root, key, saved) {
  const out = imposed(key, saved);
  if (key === 'living' && (await require('./modules.cjs').ahbotKind(root)) !== 'squidbots') out['mod_ahbot.conf'] = { ...out['mod_ahbot.conf'], 'AuctionHouseBot.Enable': '0' };
  return out;
}

// What the realm imposes (layer 3), by settings file: the keys of its mode and those that make it a realm of its own.
function imposed(key, saved) {
  const m = mode(key);
  const out = {};
  for (const [file, keys] of Object.entries(m.keys)) out[file] = { ...keys };
  // Its own world and console ports; SOAP and the bots' command server (8888) off: a realm never takes a port of CoA.
  out['worldserver.conf'] = { ...out['worldserver.conf'], RealmID: String(saved?.id ?? m.id), WorldServerPort: String(saved?.worldPort ?? ''), 'Ra.Port': String(saved?.raPort ?? ''), 'Ra.IP': '127.0.0.1', 'SOAP.Enabled': '0' };
  // What a mode does not have (checked in the core 2.6): the rotation assistant only knows the CoA specializations;
  // Manastorm has rules for Wildcard but nothing for Reborn; the added races are not made for these class models.
  // The auction house bot works everywhere: it makes its seller in each realm's characters database (AHBOT account).
  out['coa.conf'] = { ...out['coa.conf'], 'CoA.RotationAssist.Enable': '0' };
  if (key === 'reborn') {
    out['coa.conf']['Ascension.Manastorm.Enable'] = '0';
    out['manastorm-endless.conf'] = { 'Manastorm.Enable': '0' };
  }
  out['coa_custom_races.conf'] = { 'CoACustomRaces.Enable': '0', 'CoACustomRaces.BotsEnable': '0' };
  // CoA tells its random bots from alts by this prefix: it must be the realm's bot prefix (else its bots count as alts).
  out['coa.conf'] = { ...out['coa.conf'], 'CoA.RandomBotAccountPrefix': `"${m.prefix}"` };
  out['playerbots.conf'] = { ...out['playerbots.conf'], 'AiPlayerbot.RandomBotAccountPrefix': `"${m.prefix}"`, 'AiPlayerbot.CoaStatusFile': '"Logs/bot-status.json"', 'AiPlayerbot.CommandServerPort': '0' };
  // The bots' data files (world.json for the dashboard) in the realm's own Logs/squidbot: a folder the player set on CoA
  // is never copied, or two worlds would write the same files.
  out['playerbots.conf']['AiPlayerbot.CoaDataDir'] = '""';
  return out;
}

// The repack's update tool refuses a mysql\data with databases it does not know (code 15): a realm is only offered when
// the installed CoA Bots tools list the realm databases, so a realm can never block an update of CoA.
function updaterKnows(root, key) {
  try { return fs.readFileSync(path.join(root, 'CoA-Bots', 'coa_common.py'), 'utf8').includes(`acore_characters_${key}`); } catch { return false; }
}

// The realms come with CoA Bots 2.6: before it the launcher shows nothing of them (the tab is hidden), so nobody gets
// the realm options on a server we have not validated for them.
const REALMS_FROM = [2, 6];
function botsVersion(root) {
  try { return String(JSON.parse(fs.readFileSync(path.join(root, 'CoA-Bots', 'release.json'), 'utf8').replace(/^﻿/, '')).version || ''); } catch { return ''; }
}
function versionReady(version) {
  const [major, minor] = (/^(\d+)\.(\d+)/.exec(String(version)) || []).slice(1).map(Number);
  return Number.isFinite(major) && (major > REALMS_FROM[0] || (major === REALMS_FROM[0] && minor >= REALMS_FROM[1]));
}

async function status(root, { live: withLive = true } = {}) {
  const version = botsVersion(root);
  const supported = fs.existsSync(worldExe(root)) && versionReady(version);
  const list = [];
  for (const [key, m] of Object.entries(MODES)) {
    const saved = await realmFile(root, key);
    const created = !!saved && fs.existsSync(path.join(dirOf(root, key), 'configs', 'worldserver.conf'));
    if (!created) { list.push({ key, id: m.id, name: m.name, state: 'absent', autostart: false, ready: updaterKnows(root, key) }); continue; }
    const p = await ports(root, key);
    const open = await portOpen(p.worldPort);
    const pid = await processOf(root, key);
    const own = await ownSettings(root, key);
    const changed = changedCount(key, own);
    let bots = Number(own['playerbots.conf']?.[BOT_COUNT[1]]);
    if (!Number.isFinite(bots)) bots = Number(confValue(await fsp.readFile(path.join(BOTS_CONFIGS(root), 'modules', 'playerbots.conf'), 'utf8').catch(() => ''), BOT_COUNT[1])) || null;
    let info = null;
    if (open && withLive && !live.raBusy(root, p.raPort)) info = await live.raCommand(root, 'server info', 6000, p.raPort).then(live.parseInfo).catch(() => null);
    const queued = !open && !pid && !saved.disabled && queue.waiting.includes(key);
    list.push({
      key, id: saved.id, name: saved.name || m.name,
      // A world being stopped still has its process (its port may already be closed): it is « stopping », not « starting ».
      state: stopping.has(key) && (open || pid) ? 'stopping' : open ? 'running' : pid ? 'starting' : saved.disabled ? 'disabled' : queued ? 'queued' : 'stopped',
      after: queued ? queue.current : '', skipped: !open && !pid ? skipped.get(key) || null : null,
      firstStart: !saved.startedOnce, worldPort: p.worldPort, raPort: p.raPort, bots, online: open ? botsOnline(root, key) : null,
      changed, autostart: saved.autostart === true, players: info?.players ?? null, characters: info?.characters ?? null, uptime: info?.uptime || '',
      tick: info?.tick ?? null, tickMean: info?.tickMean ?? null, pid: pid || null,
    });
  }
  // Realms made before (a beta) stay reachable even on an older CoA Bots, to stop or remove them.
  return { supported, available: supported || list.some(realm => realm.state !== 'absent'), version, realms: list };
}

// ---------------------------------------------------------------- configs
// The bot server's configs written again from the repack's templates and Settings/repack.json (what CoA Bots does
// at each start of the CoA realm), so a realm never copies ports or paths older than the server's.
const REFRESH = "import importlib.util, sys\ns = importlib.util.spec_from_file_location('coa_bots', sys.argv[1])\nm = importlib.util.module_from_spec(s)\ns.loader.exec_module(m)\nm.bots_configuration(m.manage.settings(0))\n";
function refreshBotConfigs(root) {
  const python = path.join(root, 'Runtime', 'python', 'python.exe');
  const script = path.join(root, 'CoA-Bots', 'coa_bots.py');
  if (!fs.existsSync(python) || !fs.existsSync(script)) return Promise.resolve(false);
  return new Promise(resolve => execFile(python, ['-B', '-X', 'utf8', '-c', REFRESH, script], { cwd: path.join(root, 'CoA-Bots'), windowsHide: true, timeout: 120000 }, error => resolve(!error)));
}

// configs\ of the realm = layer 1 (copy), then 2 (its own values), then 3 (imposed), written before every start.
async function writeConfigs(root, key, saved) {
  const dir = dirOf(root, key);
  const target = path.join(dir, 'configs');
  await fsp.rm(target, { recursive: true, force: true });
  await fsp.cp(BOTS_CONFIGS(root), target, { recursive: true });
  const edits = new Map();
  const add = (fileId, keys) => edits.set(fileId, { ...edits.get(fileId), ...keys });
  for (const [fileId, keys] of Object.entries(await ownSettings(root, key))) add(fileId, keys);
  for (const [fileId, keys] of Object.entries(await imposedNow(root, key, saved))) add(fileId, keys);
  const ws = await fsp.readFile(path.join(target, 'worldserver.conf'), 'utf8');
  const chars = confValue(ws, 'CharacterDatabaseInfo') || '';
  if (chars.split(';').length < 5) throw new Error('CharacterDatabaseInfo cannot be read in worldserver.conf.');
  const prefix = chars.split(';').slice(0, 4).join(';');
  // LogsDir is the launcher's own value, written again before every start: relative to the realm's folder (its
  // worldserver runs there), it stays right when the server is moved to another drive or folder.
  add('worldserver.conf', { CharacterDatabaseInfo: `"${prefix};acore_characters_${key}"`, LogsDir: '"Logs"' });
  add('playerbots.conf', { PlayerbotsDatabaseInfo: `"${prefix};acore_playerbots_${key}"` });
  // CoA in its eco time: the realm copies the player's value of CoA, not the eco one.
  const coaEco = await eco.activeRecord(root, 'coa');
  if (coaEco) { const file = path.join(target, 'modules', 'playerbots.conf'); const text = await fsp.readFile(file, 'utf8').catch(() => null); if (text !== null) await fsp.writeFile(file, eco.restoreText(text, coaEco.original)); }
  for (const [fileId, keys] of edits) {
    if (!FILE_ID.test(fileId)) continue;
    const file = path.join(target, relOf(fileId));
    let text = await fsp.readFile(file, 'utf8').catch(() => null);
    if (text === null) text = await fsp.readFile(`${file}.dist`, 'utf8').catch(() => null);
    // A module without its .conf runs with its defaults (Manastorm: on): the realm's keys are written in a new one.
    if (text === null) { await fsp.mkdir(path.dirname(file), { recursive: true }); text = ''; }
    for (const [k, v] of Object.entries(keys)) if (CONF_KEY.test(k)) text = setKey(text, k, v);
    await fsp.writeFile(file, text);
  }
}

// ---------------------------------------------------------------- settings page
// The CoA settings (overview of the Server settings page) seen from a realm: each value is inherited from CoA, the
// realm's own, or imposed by its mode.
async function settingsOf(root, key, overview) {
  const saved = await realmFile(root, key);
  if (!saved) throw new Error('Create the realm first.');
  const own = await ownSettings(root, key);
  const lock = await imposedNow(root, key, saved);
  const unquote = (setting, value) => (setting.kind === 'quoted' ? String(value).replace(/^"|"$/g, '') : String(value));
  const settings = overview.settings.map(setting => {
    const locked = lock[setting.file]?.[setting.key];
    const mine = own[setting.file]?.[setting.key];
    if (locked !== undefined) return { ...setting, coaValue: setting.value, value: unquote(setting, locked), origin: 'mode' };
    if (mine !== undefined) return { ...setting, coaValue: setting.value, value: unquote(setting, mine), origin: 'own' };
    return { ...setting, coaValue: setting.value, origin: 'coa' };
  });
  return { ...overview, settings, realm: { key, id: saved.id, name: saved.name } };
}

// changes: [{ file, key, value }] or { file, key, reset: true } to follow CoA again. Saved only if all are valid.
async function saveSettings(root, key, changes) {
  const saved = await realmFile(root, key);
  if (!saved) throw new Error('Create the realm first.');
  if (!Array.isArray(changes) || !changes.length || changes.length > 200) throw new Error('Nothing to save.');
  const own = await ownSettings(root, key);
  const lock = await imposedNow(root, key, saved);
  const errors = {};
  for (const change of changes) {
    if (lock[change?.file]?.[change?.key] !== undefined) { errors[change.key] = 'Set by the game mode of this realm.'; continue; }
    const setting = CATALOG.settings.find(item => item.file === change?.file && item.key === change?.key);
    if (!setting) { errors[change?.key || '?'] = 'Unknown setting.'; continue; }
    if (change.reset) { if (own[setting.file]) delete own[setting.file][setting.key]; continue; }
    const text = String(change.value ?? '').trim();
    const problem = validate(setting.kind || 'text', text, setting.choices);
    if (problem) { errors[setting.key] = problem; continue; }
    own[setting.file] = { ...own[setting.file], [setting.key]: setting.kind === 'quoted' ? `"${text}"` : text };
  }
  if (Object.keys(errors).length) throw Object.assign(new Error(`Some values were refused: ${Object.entries(errors).map(([k, m]) => `${k}: ${m}`).join(' ')}`), { fields: errors });
  await writeOwn(root, key, own);
  // A running world reads its own configs again on ".reload config": they are written now (before, only at its next
  // start, so a reload read the old values: the Bot chat switch of a running realm did nothing until a restart).
  const running = await portOpen(saved.worldPort);
  if (running) await writeConfigs(root, key, saved);
  return { written: [saved.name], backup: null, running };
}

// ---------------------------------------------------------------- modules of a realm
// A module of a realm is one or two keys of a module .conf, in the same three layers as the settings: as CoA (no own
// value), on or off for this realm (its own values), or set by the realm (imposed). Only the modules the CoA bot server
// has (its .conf or .conf.dist) are shown.
const isOn = value => /^(1|true)$/i.test(String(value ?? '').replace(/"/g, '').trim());
const ahSettings = require('./ahbot-settings.cjs');
const MODULE_KEYS = {
  bots: { file: 'playerbots.conf', key: 'AiPlayerbot.Enabled', on: { 'AiPlayerbot.Enabled': '1' }, off: { 'AiPlayerbot.Enabled': '0' } },
  ahbot: { file: 'mod_ahbot.conf', key: 'AuctionHouseBot.Enable', on: { 'AuctionHouseBot.Enable': 'true' }, off: { 'AuctionHouseBot.Enable': 'false' } },
  manastorm: { file: 'manastorm-endless.conf', key: 'Manastorm.Enable', on: { 'Manastorm.Enable': '1', 'Manastorm.ClientMode': '2' }, off: { 'Manastorm.Enable': '0' } },
  rotation: { file: 'coa.conf', key: 'CoA.RotationAssist.Enable', on: { 'CoA.RotationAssist.Enable': '1' }, off: { 'CoA.RotationAssist.Enable': '0' } },
  multirace: { file: 'coa_custom_races.conf', key: 'CoACustomRaces.Enable', on: { 'CoACustomRaces.Enable': '1' }, off: { 'CoACustomRaces.Enable': '0', 'CoACustomRaces.BotsEnable': '0' } },
};
// SquidBots-AH (CoA Bots 3.0, mod-ah-bot-plus out of the core): its own switch in playerbots.conf, and the master key of
// mod_ahbot.conf put on with it (`also`), since the merged bot still reads it.
const AH_SWITCH = 'AiPlayerbot.CoaEconomy.AHBot.Enable';
const AH_MERGED = { file: 'playerbots.conf', key: AH_SWITCH, on: { [AH_SWITCH]: '1' }, off: { [AH_SWITCH]: '0' }, also: { file: 'mod_ahbot.conf', on: { 'AuctionHouseBot.Enable': 'true' } } };
async function moduleKeysOf(root) {
  // The old mod-ah-bot-plus is no longer shown by the launcher (user's decision, 09/11): only SquidBots-AH has a switch.
  if ((await require('./modules.cjs').ahbotKind(root)) === 'squidbots') return { ...MODULE_KEYS, ahbot: AH_MERGED };
  const { ahbot, ...rest } = MODULE_KEYS;
  return rest;
}

async function coaModuleText(root, fileId) {
  const file = path.join(BOTS_CONFIGS(root), relOf(fileId));
  return (await fsp.readFile(file, 'utf8').catch(() => null)) ?? fsp.readFile(`${file}.dist`, 'utf8').catch(() => null);
}

async function modulesOf(root, key) {
  const saved = await realmFile(root, key);
  if (!saved) throw new Error('Create the realm first.');
  const own = await ownSettings(root, key);
  const lock = await imposedNow(root, key, saved);
  const list = [];
  for (const [id, module] of Object.entries(await moduleKeysOf(root))) {
    const text = await coaModuleText(root, module.file);
    if (text === null) continue;
    const coaOn = isOn(confValue(text, module.key));
    const locked = lock[module.file]?.[module.key];
    const mine = own[module.file]?.[module.key];
    if (locked !== undefined) list.push({ id, origin: 'mode', on: isOn(locked), coaOn });
    else if (mine !== undefined) list.push({ id, origin: 'own', on: isOn(mine), coaOn });
    else list.push({ id, origin: 'coa', on: coaOn, coaOn });
  }
  return list;
}

// state: 'on', 'off', or 'coa' (follow Conquest of Azeroth again). The realm must be stopped: modules are read at start.
async function setModule(root, key, id, state) {
  const module = (await moduleKeysOf(root))[id];
  if (!module || !['on', 'off', 'coa'].includes(state)) throw new Error('Unknown module.');
  const saved = await realmFile(root, key);
  if (!saved) throw new Error('Create the realm first.');
  if ((await imposedNow(root, key, saved))[module.file]?.[module.key] !== undefined) throw new Error('Set by the game mode of this realm.');
  if (await portOpen(saved.worldPort) || await processOf(root, key)) throw new Error('Stop this realm first: its modules are read when it starts.');
  const own = await ownSettings(root, key);
  const keys = { ...module.on, ...module.off };
  own[module.file] = { ...own[module.file] };
  for (const name of Object.keys(keys)) delete own[module.file][name];
  if (state !== 'coa') Object.assign(own[module.file], module[state]);
  if (module.also) {
    own[module.also.file] = { ...own[module.also.file] };
    for (const name of Object.keys(module.also.on)) delete own[module.also.file][name];
    if (state === 'on') Object.assign(own[module.also.file], module.also.on);
  }
  await writeOwn(root, key, own);
  return modulesOf(root, key);
}

// The auction house settings of a realm: CoA's, with what this realm changed for itself on top.
async function ahbotSettingsOf(root, key, { instantKnown = false } = {}) {
  if (!(await realmFile(root, key))) throw new Error('Create the realm first.');
  const coaText = (await coaModuleText(root, 'mod_ahbot.conf')) || '';
  const own = (await ownSettings(root, key))['mod_ahbot.conf'] || {};
  const get = name => own[name] ?? confValue(coaText, name);
  return { values: ahSettings.read(get), coa: ahSettings.read(coaText), own: Object.keys(own).some(name => ahSettings.ALL_KEYS.includes(name)), instantKnown };
}
// Writes only the values that differ from CoA (the rest follows CoA); a running realm gets its files at once.
async function setAhbotSettingsOf(root, key, values, { instantKnown = false } = {}) {
  const saved = await realmFile(root, key);
  if (!saved) throw new Error('Create the realm first.');
  const coaText = (await coaModuleText(root, 'mod_ahbot.conf')) || '';
  const own = await ownSettings(root, key);
  const mine = { ...own['mod_ahbot.conf'] };
  for (const name of ahSettings.ALL_KEYS) delete mine[name];
  for (const [name, value] of Object.entries(ahSettings.keys(values, { instantKnown }))) if (String(confValue(coaText, name) ?? '') !== value) mine[name] = value;
  own['mod_ahbot.conf'] = mine;
  await writeOwn(root, key, own);
  const running = await portOpen(saved.worldPort);
  if (running) await writeConfigs(root, key, saved);
  return { running, raPort: saved.raPort };
}

// Whether "Start all" starts the CoA world too (Royaumes\coa.json). Off only counts when a realm starts with the
// server: a server never starts with nothing.
async function coaAutostart(root) {
  const value = await readJson(path.join(root, 'Royaumes', 'coa.json'));
  return value?.autostart !== false;
}
async function setCoaAutostart(root, on) {
  await fsp.mkdir(path.join(root, 'Royaumes'), { recursive: true });
  const saved = (await readJson(path.join(root, 'Royaumes', 'coa.json'))) || {};
  await fsp.writeFile(path.join(root, 'Royaumes', 'coa.json'), JSON.stringify({ ...saved, autostart: on === true }, null, 2));
}
async function skipCoaAtStart(root) {
  if (await coaAutostart(root)) return false;
  for (const key of Object.keys(MODES)) { const saved = await realmFile(root, key); if (saved?.autostart && !saved.disabled) return true; }
  return false;
}

// ---------------------------------------------------------------- create
// MySQL must run. Never touches a database that already exists (a realm removed by hand and created again keeps
// its characters).
// db: the MySQL calls (tests give their own, to check what is written where).
async function create(root, key, { bots = key === 'living' ? LIVING_BOTS : DEFAULT_BOTS, notify = () => {}, name, db = { sql, copyDump } } = {}) {
  const m = mode(key);
  const run = { sql: (_root, query) => db.sql(root, query), copyDump: (_root, args, target) => db.copyDump(root, args, target) };
  const exists = async database => (await run.sql(root, `SHOW DATABASES LIKE '${database}'`)) === database;
  // The new living server takes the name the player gave it (letters, digits, spaces, ' and -).
  const realmName = key === 'living' && typeof name === 'string' && /^[\p{L}\p{N} '-]{2,32}$/u.test(name.trim()) ? name.trim() : m.name;
  if (!fs.existsSync(worldExe(root))) throw new Error('The realms need CoA Bots installed in this server.');
  if (!versionReady(botsVersion(root)) || !updaterKnows(root, key)) throw new Error('This realm needs a newer CoA Bots: its update tool must know the realm databases.');
  await refreshBotConfigs(root);
  const dir = dirOf(root, key);
  await fsp.mkdir(path.join(dir, 'Logs'), { recursive: true });
  const p = await ports(root, key);
  for (const port of [p.worldPort, p.raPort]) if (await portOpen(port) && !(await processOf(root, key))) throw new Error(`Port ${port} is already used by another program.`);

  // The realm id: the usual one, unless another realm of this server already has it.
  const rows = (await run.sql(root, 'SELECT id, name FROM acore_auth.realmlist')).split(/\r?\n/).filter(Boolean).map(line => line.split('\t'));
  let id = m.id;
  const same = rows.find(([, listed]) => listed === realmName);
  if (same) id = Number(same[0]);
  else if (rows.some(([rid]) => Number(rid) === id)) id = Math.max(...rows.map(([rid]) => Number(rid))) + 1;

  const chars = `acore_characters_${key}`;
  const botsDb = `acore_playerbots_${key}`;
  if (!(await exists(chars))) {
    notify(`Creating ${chars}…`);
    await run.sql(root, `CREATE DATABASE ${chars} DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    await run.copyDump(root, ['--no-data', '--skip-triggers', 'acore_characters'], chars);
    const present = new Set((await run.sql(root, "SELECT table_name FROM information_schema.tables WHERE table_schema = 'acore_characters'")).split(/\r?\n/));
    const seed = SEED_TABLES.filter(table => present.has(table));
    if (seed.length) await run.copyDump(root, ['--no-create-info', 'acore_characters', ...seed], chars);
  }
  if (!(await exists(botsDb))) {
    notify(`Creating ${botsDb}…`);
    await run.sql(root, `CREATE DATABASE ${botsDb} DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    await run.copyDump(root, ['acore_playerbots'], botsDb);
    // The bot state of the CoA realm is not this realm's: its bots are made again with their own prefix, and the state
    // the modules keep per character or per realm starts empty (listed by SquidBot, Monde and Economie, 13/11: souls,
    // stored values, guild tasks, mounts, server firsts, guild logs, learned prices, the auction clock, artisans' orders).
    // The data tables (texts, names, caches, travel nodes, rotations...) stay as copied.
    const present = new Set((await run.sql(root, `SELECT table_name FROM information_schema.tables WHERE table_schema = '${botsDb}'`)).split(/\r?\n/));
    for (const table of REALM_STATE_TABLES) if (present.has(table)) await run.sql(root, `TRUNCATE ${botsDb}.${table}`);
    // The players' own strategies of the CoA realm (owner <> 0); the factory rotations (owner 0) stay.
    if (present.has('playerbots_custom_strategy')) await run.sql(root, `DELETE FROM ${botsDb}.playerbots_custom_strategy WHERE owner <> 0`);
  }
  // The worldserver logs in as the user of its DatabaseInfo, which only has rights on the repack's own databases.
  const ws = await fsp.readFile(path.join(BOTS_CONFIGS(root), 'worldserver.conf'), 'utf8');
  const user = ((confValue(ws, 'CharacterDatabaseInfo') || '').split(';')[2] || 'acore').replace(/'/g, '');
  const hosts = (await run.sql(root, `SELECT host FROM mysql.user WHERE user = '${user}'`)).split(/\r?\n/).filter(Boolean);
  for (const host of hosts) for (const database of [chars, botsDb]) await run.sql(root, `GRANT ALL PRIVILEGES ON ${database}.* TO '${user}'@'${host.replace(/'/g, '')}'`);
  await listRealm(root, { id, name: realmName, worldPort: p.worldPort }, run.sql);

  const saved = { key, id, name: realmName, worldPort: p.worldPort, raPort: p.raPort, autostart: true, created: new Date().toISOString() };
  await fsp.writeFile(path.join(dir, 'realm.json'), JSON.stringify(saved, null, 2));
  // A new realm starts with fewer bots than most CoA realms: one more world costs memory.
  const own = await ownSettings(root, key);
  let changed = false;
  if (!own['playerbots.conf']?.[BOT_COUNT[1]]) {
    const count = String(Math.max(0, Math.min(2000, m.bots ?? (Number(bots) || DEFAULT_BOTS))));
    own['playerbots.conf'] = { ...own['playerbots.conf'], [BOT_COUNT[0]]: count, [BOT_COUNT[1]]: count };
    changed = true;
  }
  // The new living server: its own values written once (a value the player already set for this realm stays).
  if (key === 'living') {
    const ahMerged = (await require('./modules.cjs').ahbotKind(root)) === 'squidbots';
    for (const [file, keys] of Object.entries(livingOwn({ ahMerged }))) own[file] = { ...keys, ...own[file] };
    changed = true;
  }
  if (changed) await writeOwn(root, key, own);
  await writeConfigs(root, key, saved);
  return saved;
}

// The own values of the new living server (docs/LIVING-WORLDS-3.0.md), written once at its creation; the player changes
// them later like any realm setting. Solo self-found as it is, the Living pack, the server firsts, and the economy of
// CoA Economie: an auction house that fills up gradually from the start, never empty, with no epics at first.
function livingOwn({ ahMerged = true } = {}) {
  const own = {};
  const fileOf = key => CATALOG.settings.find(setting => setting.key === key)?.file;
  const put = (file, key, value) => { if (file) own[file] = { ...own[file], [key]: String(value) }; };
  for (const [key, value] of Object.entries(CATALOG.recipes.find(recipe => recipe.id === 'self-found-world')?.changes || {})) put(fileOf(key), key, value);
  for (const [key, value] of Object.entries(CATALOG.packs.find(pack => pack.id === 'living')?.changes || {})) if (ahMerged || key !== 'AiPlayerbot.CoaEconomy.AHBot.Enable') put(fileOf(key), key, value);
  const E = 'AiPlayerbot.CoaEconomy.';
  // A realm that opens like a new official server (Pilote, 11/11): fresh start, launch curve, server firsts, self-loot,
  // bot chat on. Written on this new realm only; an existing realm keeps the core's defaults.
  put('playerbots.conf', 'AiPlayerbot.CoaWorld.ServerFirst.Enable', 1);
  put('playerbots.conf', 'AiPlayerbot.CoaFreshStart.Enable', 1);
  put('playerbots.conf', `${E}LaunchCurve.Enable`, 1);
  put('playerbots.conf', 'AiPlayerbot.CoaSelfFound', 1);
  put('playerbots.conf', 'AiPlayerbot.CoaLive.Chat.Enable', 1);
  // Bots need items: Need on real upgrades (user, 11/11); the other realms keep Greed.
  put('playerbots.conf', 'AiPlayerbot.LootNeedRollLevel', 2);
  for (const part of ['Filter', 'Buyer', 'Market', 'Rarity']) put('playerbots.conf', `${E}${part}.Enable`, 1);
  put('playerbots.conf', `${E}LaunchCurve.LevelMargin`, 5);
  put('playerbots.conf', `${E}LaunchCurve.StartStockPercent`, 15);
  put('playerbots.conf', `${E}LaunchCurve.LaunchPremiumPercent`, 100);
  // SquidBots-AH, only on a core without mod-ah-bot-plus: on a core that still has it, the master key of mod_ahbot.conf
  // would start the old bot too (an auction house full of epics on day 1). Nothing of the AH is written there.
  if (ahMerged) {
    put('playerbots.conf', `${E}AHBot.Enable`, 1);
    for (const key of ['AuctionHouseBot.Enable', 'AuctionHouseBot.EnableSeller', 'AuctionHouseBot.Buyer.Enabled']) put('mod_ahbot.conf', key, 1);
  }
  return own;
}

// Its line of the realm list, made from the CoA one (address, flags, build).
function listRealm(root, { id, name, worldPort }, runSql = sql) {
  return runSql(root, `REPLACE INTO acore_auth.realmlist (id,name,address,localAddress,localSubnetMask,port,icon,flag,timezone,allowedSecurityLevel,population,gamebuild) SELECT ${Number(id)},'${String(name).replace(/'/g, '')}',address,localAddress,localSubnetMask,${Number(worldPort)},icon,flag,timezone,allowedSecurityLevel,0,gamebuild FROM acore_auth.realmlist WHERE id=1`);
}

// The name of a realm in the game's realm list (its card): kept in realm.json, written to the list now when MySQL
// runs, otherwise at its next start.
async function setRealmName(root, key, name) {
  const file = path.join(dirOf(root, key), 'realm.json');
  const saved = await readJson(file);
  if (!saved || !name) return;
  if (saved.name !== name) { saved.name = name; await fsp.writeFile(file, JSON.stringify(saved, null, 2)); }
  await sql(root, `UPDATE acore_auth.realmlist SET name = '${String(name).replace(/'/g, '')}' WHERE id = ${Number(saved.id)}`).catch(() => {});
}

// Off: stopped and out of the realm list, everything else kept (characters, bots, settings). On: back as it was.
async function setDisabled(root, key, off) {
  mode(key);
  const file = path.join(dirOf(root, key), 'realm.json');
  const saved = await readJson(file);
  if (!saved) throw new Error('Create the realm first.');
  if (off) {
    await stop(root, key);
    if (await processOf(root, key)) throw new Error('The world of this realm is still running.');
    if (Number(saved.id) !== 1) await sql(root, `DELETE FROM acore_auth.realmlist WHERE id = ${Number(saved.id)}`);
  } else await listRealm(root, saved);
  saved.disabled = off === true;
  await fsp.writeFile(file, JSON.stringify(saved, null, 2));
  return saved;
}

// ---------------------------------------------------------------- start / stop
// The bot tables CoA Bots ships (CoA-Bots/Database/playerbots/custom: rotations, Reborn builds and mystic enchants):
// a CoA Bots update imports them into acore_playerbots only, so a realm made before it misses a new table (the
// Reborn mystic enchants of 2.7: its world stops at start) or keeps old rows. Before a realm starts, each of these
// tables that is missing or differs from acore_playerbots is copied over from it (structure and rows).
const KEEP_ROWS = new Set(['playerbots_custom_strategy']);
function shippedTables(root) {
  const dir = path.join(root, 'CoA-Bots', 'Database', 'playerbots', 'custom');
  const names = new Set();
  for (const file of fs.existsSync(dir) ? fs.readdirSync(dir).filter(name => name.endsWith('.sql')) : []) {
    const text = fs.readFileSync(path.join(dir, file), 'utf8');
    for (const m of text.matchAll(/\b(?:CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?|INSERT(?:\s+IGNORE)?\s+INTO|REPLACE\s+INTO|UPDATE|DELETE\s+FROM)\s+`?([A-Za-z_][\w]*)`?/gi)) {
      const table = m[1].toLowerCase();
      if (table.startsWith('playerbots_') && !/_bak_/.test(table)) names.add(table);
    }
  }
  return [...names];
}
async function syncShippedTables(root, key) {
  const botsDb = `acore_playerbots_${key}`;
  const wanted = shippedTables(root);
  if (!wanted.length) return [];
  const list = names => names.map(name => `'${name}'`).join(',');
  const inCoa = new Set((await sql(root, `SELECT table_name FROM information_schema.tables WHERE table_schema = 'acore_playerbots' AND table_name IN (${list(wanted)})`)).split(/\r?\n/).filter(Boolean));
  const tables = wanted.filter(name => inCoa.has(name));
  if (!tables.length) return [];
  const sums = async db => new Map((await sql(root, `CHECKSUM TABLE ${tables.map(name => `${db}.${name}`).join(', ')}`).catch(() => '')).split(/\r?\n/).filter(Boolean).map(line => line.split('\t')).map(([name, sum]) => [name.split('.').pop(), sum]));
  const theirs = await sums('acore_playerbots');
  const mine = await sums(botsDb);
  // The strategies a player made with `cs` live in playerbots_custom_strategy, per realm: that table is only made when
  // it is missing, never copied over; the data tables (Reborn builds, mystic enchants) follow acore_playerbots.
  const missing = name => !mine.get(name) || mine.get(name) === 'NULL';
  const stale = tables.filter(name => missing(name) || (!KEEP_ROWS.has(name) && mine.get(name) !== theirs.get(name)));
  if (stale.length) await copyDump(root, ['--skip-triggers', 'acore_playerbots', ...stale], botsDb);
  // The factory rotations (owner 0) of that kept table still follow CoA: every rotation fix of an update only lands in
  // acore_playerbots. The players' own strategies (owner <> 0) stay; new rows get new ids (no clash with theirs).
  const kept = tables.filter(name => KEEP_ROWS.has(name) && !stale.includes(name));
  for (const name of kept) {
    const print = db => sql(root, `SELECT COUNT(*), COALESCE(BIT_XOR(CRC32(CONCAT_WS('|', name, idx, action_line))), 0) FROM ${db}.${name} WHERE owner = 0`).catch(() => '');
    if (await print('acore_playerbots') === await print(botsDb)) continue;
    await sql(root, `START TRANSACTION; DELETE FROM ${botsDb}.${name} WHERE owner = 0; INSERT INTO ${botsDb}.${name} (name, idx, owner, action_line) SELECT name, idx, owner, action_line FROM acore_playerbots.${name} WHERE owner = 0; COMMIT`);
    stale.push(`${name} (factory rows)`);
  }
  return stale;
}

async function start(root, key, { timeout = 1200 } = {}) {
  const saved = await realmFile(root, key);
  if (!saved) throw new Error('Create the realm first.');
  if (saved.disabled) throw new Error('This realm is switched off: switch it on first.');
  if (await portOpen(saved.worldPort)) return;
  if (await processOf(root, key)) throw new Error(`${saved.name} is still starting or stopping.`);
  if (await portOpen(saved.raPort)) throw new Error(`Port ${saved.raPort} is already used by another program.`);
  if (await anotherStarting(root, key)) throw new Error('Another realm is starting: wait until it runs (two worlds must never apply their updates at the same time).');
  await eco.wakeStopped(root, key);
  await refreshBotConfigs(root);
  await syncShippedTables(root, key);
  await writeConfigs(root, key, saved);
  // The realmlist follows the port (the address follows the CoA realm, set by the network choice).
  await sql(root, `UPDATE acore_auth.realmlist r JOIN acore_auth.realmlist c ON c.id = 1 SET r.name = '${String(saved.name || MODES[key].name).replace(/'/g, '')}', r.port = ${saved.worldPort}, r.address = c.address, r.localAddress = c.localAddress WHERE r.id = ${saved.id}`).catch(() => {});
  const child = launch(root, key, 'started by the launcher');
  skipped.delete(key);
  starting.add(key);
  try { await waitOpen(root, key, saved, child, timeout); } finally { starting.delete(key); }
}
const starting = new Set();
async function waitOpen(root, key, saved, child, timeout) {
  // The first start after an update may apply thousands of SQL files on a busy PC: the world is waited for as long
  // as its logs grow, and given up only after `timeout` seconds without a new line (or 3 hours in all).
  const end = Date.now() + 3 * 3600 * 1000;
  let size = logsSize(root, key);
  let moved = Date.now();
  while (Date.now() < end && Date.now() - moved < timeout * 1000) {
    if (await portOpen(saved.worldPort)) { await markStarted(root, key); return; }
    if (!pidAlive(child.pid)) throw new Error(`${saved.name} stopped while starting. Look at Royaumes\\${key}\\Logs.`);
    await new Promise(resolve => setTimeout(resolve, 2000));
    const now = logsSize(root, key);
    if (now !== size) { size = now; moved = Date.now(); }
  }
  if (await portOpen(saved.worldPort)) { await markStarted(root, key); return; }
  // Stuck before its port opened (no player could be in it): stopped, so no world of this repack is left running
  // unknown to its scripts (the next update would refuse, code 13).
  await new Promise(resolve => execFile('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, () => resolve()));
  await fsp.rm(path.join(dirOf(root, key), '.state.json'), { force: true });
  throw new Error(`${saved.name} did not open port ${saved.worldPort}: its logs had not moved for ${Math.round(timeout / 60)} minutes, it was stopped. Look at Royaumes\\${key}\\Logs.`);
}
// When the logs of a realm last changed (0: no logs).
const STUCK_AFTER = 20 * 60 * 1000;
function logsChanged(root, key) {
  const dir = path.join(dirOf(root, key), 'Logs');
  try { return fs.readdirSync(dir).reduce((last, name) => { try { return Math.max(last, fs.statSync(path.join(dir, name)).mtimeMs); } catch { return last; } }, 0); } catch { return 0; }
}
// Bytes written to the logs of a realm: they grow while its world applies its updates and loads.
function logsSize(root, key) {
  const dir = path.join(dirOf(root, key), 'Logs');
  try { return fs.readdirSync(dir).reduce((sum, name) => { try { return sum + fs.statSync(path.join(dir, name)).size; } catch { return sum; } }, 0); } catch { return 0; }
}

// The launcher's NUMA pinning (src/numa.cjs), set by main.cjs: a realm's world joins the node of the others.
let pinWorld = null;
function setPinner(fn) { pinWorld = typeof fn === 'function' ? fn : null; }

function launch(root, key, why, env) {
  const dir = dirOf(root, key);
  fs.mkdirSync(path.join(dir, 'Logs'), { recursive: true });
  const log = fs.openSync(path.join(dir, 'Logs', 'world-console.log'), 'a');
  fs.writeSync(log, `\n==== ${new Date().toISOString()} ${why} ====\n`);
  // The core's SQL updater writes the MySQL password to %TEMP%\mysql_ac.conf, a fixed name: one temp folder per
  // realm, so two worlds applying their updates at once never remove each other's file (ERROR 1045).
  const tmp = path.join(dir, 'tmp');
  fs.mkdirSync(tmp, { recursive: true });
  fs.rmSync(path.join(dir, 'Logs', '.exit.json'), { force: true });
  const child = spawn(worldExe(root), ['-c', 'configs\\worldserver.conf'], { cwd: dir, windowsHide: true, detached: !env, stdio: ['ignore', log, log], env: { ...process.env, ...env, TEMP: tmp, TMP: tmp } });
  fs.closeSync(log);
  fs.writeFileSync(path.join(dir, '.state.json'), JSON.stringify({ pid: child.pid, exe: worldExe(root), started: new Date().toISOString() }));
  // Its exit code, while the launcher runs: 0 a clean stop, 2 a GM's .server restart, anything else a crash.
  child.on('exit', code => { try { fs.writeFileSync(path.join(dir, 'Logs', '.exit.json'), JSON.stringify({ code, at: new Date().toISOString() })); } catch {} });
  pinWorld?.(child.pid, `worldserver (${key})`).catch(() => {});
  if (!env) child.unref();
  return child;
}

// A realm whose world process is there but not yet open: it may be applying its database updates (the core's SQL
// updater writes a temporary file with a fixed name, so two worlds must never start at the same time).
async function anotherStarting(root, except) {
  for (const key of Object.keys(MODES)) {
    if (key === except) continue;
    const saved = await realmFile(root, key);
    if (saved && await processOf(root, key) && !(await portOpen(saved.worldPort))) return key;
  }
  return '';
}

// How a world ended. 'shutdown': exit 0 (a GM's .server shutdown or exit), or, with no exit code known (the launcher
// was closed, or the repack's supervisor started it), "Halting process" among the last lines of its console log.
// 'restart': exit 2 (a GM's .server restart). 'crash': any other code, a process killed, or no clean end in its log.
function endKind({ code, log = '' } = {}) {
  if (code === 0) return 'shutdown';
  if (code === 2) return 'restart';
  if (code !== undefined) return 'crash';
  const last = String(log).split(/\r?\n/).filter(line => line.trim()).slice(-15).join('\n');
  return /Halting process/i.test(last) ? 'shutdown' : 'crash';
}
async function logTail(file, bytes = 8192) {
  const handle = await fsp.open(file, 'r').catch(() => null);
  if (!handle) return '';
  try {
    const { size } = await handle.stat();
    const buffer = Buffer.alloc(Math.min(bytes, size));
    await handle.read(buffer, 0, buffer.length, size - buffer.length);
    return buffer.toString('utf8');
  } finally { await handle.close(); }
}
// The last "WORLD_EXIT code=<n> at=<YYYY-MM-DDTHH:MM:SS>" of a supervisor log, if it is recent (local time).
function lastWorldExit(log, now = Date.now(), within = 10 * 60 * 1000) {
  const all = [...String(log).matchAll(/WORLD_EXIT code=(-?\d+) at=(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)/g)];
  const last = all[all.length - 1];
  if (!last) return undefined;
  const at = new Date(last[2]).getTime();
  return Number.isFinite(at) && now - at < within && at - now < 60000 ? Number(last[1]) : undefined;
}
async function realmEnd(root, key) {
  const exit = await readJson(path.join(dirOf(root, key), 'Logs', '.exit.json'));
  return endKind({ code: exit && 'code' in exit ? exit.code : undefined, log: await logTail(path.join(dirOf(root, key), 'Logs', 'world-console.log')) });
}

const stopping = new Set();
// When the launcher last stopped each realm: a world that ends without it is a crash (restarted if the player wants).
const stoppedAt = new Map();
const stoppedOnPurpose = (key, within = 5 * 60 * 1000) => Date.now() - (stoppedAt.get(key) || 0) < within;
async function stop(root, key) {
  const saved = await realmFile(root, key);
  if (!saved) return;
  const pid = await processOf(root, key);
  if (!pid && !(await portOpen(saved.worldPort))) return;
  stopping.add(key);
  stoppedAt.set(key, Date.now());
  try { await stopWorld(root, key, saved, pid); } finally { stopping.delete(key); stoppedAt.set(key, Date.now()); }
}
async function stopWorld(root, key, saved, pid) {
  // A world whose port never opened, not being started now (left by a start given up, or by an older launcher): no
  // player can be in it. Stopped at once when its logs have not moved for 20 minutes (stuck), so nothing of this repack
  // runs unknown to its scripts (code 13); one still writing them may be applying its SQL updates: never killed then.
  if (pid && !starting.has(key) && !(await portOpen(saved.worldPort))) {
    if (Date.now() - logsChanged(root, key) < STUCK_AFTER) throw Object.assign(new Error(`${saved.name} is still starting (updates of its database): try again in a few minutes.`), { code: 'REALM_SAVING' });
    await new Promise(resolve => execFile('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, () => resolve()));
    await fsp.rm(path.join(dirOf(root, key), '.state.json'), { force: true });
    return;
  }
  // The repack's RA account (Settings/repack.json) is an account of the shared auth database: valid on every realm.
  await live.raCommand(root, 'server shutdown 1s 0', 20000, saved.raPort).catch(() => {});
  // A world is never killed: one still saving its players would lose them. MySQL stays up for it (the callers stop).
  const up = async () => (pid ? pidAlive(pid) : await portOpen(saved.worldPort));
  const deadline = Date.now() + STOP_WAIT;
  while (Date.now() < deadline && await up()) await new Promise(resolve => setTimeout(resolve, 1000));
  if (await up()) throw Object.assign(new Error(`${saved.name} is still saving: it was left running, and MySQL with it. Press Stop again in a few minutes.`), { code: 'REALM_SAVING' });
  await fsp.rm(path.join(dirOf(root, key), '.state.json'), { force: true });
}
const STOP_WAIT = 300 * 1000;

// Every realm is asked to stop; one still running after the wait fails the whole stop, so nothing stops MySQL under it.
async function stopAll(root) {
  if (!root || !fs.existsSync(path.join(root, 'Royaumes'))) return;
  const results = await Promise.allSettled(Object.keys(MODES).map(key => stop(root, key)));
  const failed = results.filter(result => result.status === 'rejected').map(result => result.reason);
  if (failed.length) throw Object.assign(new Error(failed.map(error => error.message).join(' ')), { code: 'REALM_SAVING' });
}

// ---------------------------------------------------------------- queue, memory, bots in game
// The realms waiting their turn after "Start all" (they start one after the other, CoA first): shown on their card.
const queue = { waiting: [], current: '' };
// Realms "Start all" left stopped, and why (not enough free memory).
const skipped = new Map();

async function markedRealms(root) {
  const keys = [];
  for (const key of Object.keys(MODES)) { const saved = await realmFile(root, key); if (saved?.autostart && !saved.disabled) keys.push(key); }
  return keys;
}
// Called before the CoA world starts, so the cards say they wait for it.
async function queueMarked(root) {
  queue.waiting = await markedRealms(root);
  queue.current = 'coa';
}

// Memory a world needs, from the number of its bots. Measured on the LAPTOP (15 GB): a world with its maps ≈ 4.5 to
// 5.8 GB before any bot, CoA with 300 bots ≈ 6.6 GB, Malfurion (3.0) 5.9 GB at 6 min and 6.5 GB steady with 1000 bots
// online. So about 5.5 GB plus 1.5 MB per bot (1000 bots ≈ 7 GB, a little above what was measured). The old 7 MB per
// bot asked 11+ GB for 1000 bots and left Malfurion stopped with 9.4 GB free. Free memory is what Windows reports now.
const neededMb = bots => Math.round(5500 + 1.5 * Math.max(0, Number(bots) || 0));
async function memoryFor(root, key) {
  const realm = (await status(root, { live: false })).realms.find(item => item.key === key);
  if (!realm) throw new Error('Unknown realm.');
  const need = neededMb(realm.bots);
  const free = Math.round(os.freemem() / 1048576);
  return { need, free, enough: free >= need };
}

async function markStarted(root, key) {
  const file = path.join(dirOf(root, key), 'realm.json');
  const saved = await readJson(file);
  if (saved && !saved.startedOnce) { saved.startedOnce = true; await fsp.writeFile(file, JSON.stringify(saved, null, 2)); }
}

// The bots of a realm in game, from the status file its bots module writes (Logs/bot-status.json in its folder).
function botsOnline(root, key) {
  try {
    const data = JSON.parse(fs.readFileSync(path.join(dirOf(root, key), 'Logs', 'bot-status.json'), 'utf8'));
    if (!Array.isArray(data.bots) || (data.at && Date.now() / 1000 - Number(data.at) > 300)) return null;
    return data.bots.length;
  } catch { return null; }
}

// Realms marked to start with the server, one after the other. A realm is left stopped when the free memory is
// clearly too low for it (it would make the whole PC swap); its card says so.
async function startMarked(root, { freeMb = () => os.freemem() / 1048576 } = {}) {
  const failed = [];
  queue.waiting = await markedRealms(root);
  try {
    for (const key of [...queue.waiting]) {
      queue.current = key;
      queue.waiting = queue.waiting.filter(item => item !== key);
      const realm = (await status(root, { live: false })).realms.find(item => item.key === key);
      if (realm && realm.state === 'stopped' && freeMb() < neededMb(realm.bots)) {
        skipped.set(key, { reason: 'memory', need: neededMb(realm.bots), free: Math.round(freeMb()) });
        failed.push({ key, error: 'memory' });
        continue;
      }
      await start(root, key).catch(error => failed.push({ key, error: error.message }));
    }
  } finally { queue.waiting = []; queue.current = ''; }
  return failed;
}

// The auctions of the bots of a realm, removed with them: those of its random bots (its account prefix), those whose
// seller no longer exists (left by an earlier purge), and with house, those of the SquidBots-AH seller (AHBOT).
// A player's auction is never touched. A player who bid on one of them gets the bid back by mail, the way the core
// does when an auction is cancelled (auction mail from its house, subject item:0:4 = "cancelled", money = the bid).
// One transaction; the realm is stopped. Returns SQL that ends with: removed auctions, refunds, refunded copper.
function auctionPurgeSql(key, { house = true } = {}) {
  const m = mode(key);
  const c = `acore_characters_${key}`;
  const prefix = m.prefix.toUpperCase();
  if (!/^[A-Z]+$/.test(prefix) || !/^[a-z]+$/.test(key)) throw new Error('Unknown realm.');
  const seller = `o.guid IS NULL OR oa.id IS NULL OR oa.username LIKE '${prefix}%'${house ? " OR oa.username = 'AHBOT'" : ''}`;
  return [
    'START TRANSACTION',
    'DROP TEMPORARY TABLE IF EXISTS purge_ah',
    `CREATE TEMPORARY TABLE purge_ah AS SELECT ah.id, ah.houseid, ah.itemguid, ah.itemowner, ah.buyguid, ah.lastbid, ah.buyoutprice, ah.deposit FROM ${c}.auctionhouse ah LEFT JOIN ${c}.characters o ON o.guid = ah.itemowner LEFT JOIN acore_auth.account oa ON oa.id = o.account WHERE ${seller}`,
    'DROP TEMPORARY TABLE IF EXISTS purge_refund',
    `CREATE TEMPORARY TABLE purge_refund AS SELECT p.id, p.houseid, p.itemowner, p.buyguid, p.lastbid, p.buyoutprice, p.deposit, ii.itemEntry, ii.randomPropertyId, ii.count FROM purge_ah p JOIN ${c}.characters b ON b.guid = p.buyguid JOIN acore_auth.account ba ON ba.id = b.account LEFT JOIN ${c}.item_instance ii ON ii.guid = p.itemguid WHERE p.buyguid <> 0 AND p.lastbid > 0 AND ba.username NOT LIKE '${prefix}%' AND ba.username <> 'AHBOT'`,
    `SET @base = (SELECT COALESCE(MAX(id), 0) FROM ${c}.mail)`,
    `INSERT INTO ${c}.mail (id, messageType, stationery, mailTemplateId, sender, receiver, subject, body, has_items, expire_time, deliver_time, money, cod, checked) SELECT @base + ROW_NUMBER() OVER (ORDER BY id), 2, 62, 0, houseid, buyguid, CONCAT(COALESCE(itemEntry, 0), ':', COALESCE(randomPropertyId, 0), ':4:', id, ':', COALESCE(count, 1)), CONCAT(LPAD(HEX(itemowner), 16, '0'), ':', lastbid, ':', buyoutprice, ':', deposit, ':0'), 0, UNIX_TIMESTAMP() + 2592000, UNIX_TIMESTAMP(), lastbid, 0, 4 FROM purge_refund`,
    `DELETE ii FROM ${c}.item_instance ii JOIN purge_ah p ON p.itemguid = ii.guid`,
    `DELETE ah FROM ${c}.auctionhouse ah JOIN purge_ah p ON p.id = ah.id`,
    'COMMIT',
    'SELECT (SELECT COUNT(*) FROM purge_ah), (SELECT COUNT(*) FROM purge_refund), (SELECT COALESCE(SUM(lastbid), 0) FROM purge_refund)',
  ].join(';\n') + ';';
}

// The random bots of this realm only (its own account prefix), the way CoA Bots purges those of CoA: the realm's
// worldserver runs once with the module's delete option given through the environment, deletes and stops. Their
// auctions go first (while their accounts still tell them apart), and with house, those of the auction house bot.
async function purgeBots(root, key, { house = true, runSql = sql } = {}) {
  const saved = await realmFile(root, key);
  if (!saved) throw new Error('Create the realm first.');
  if (await portOpen(saved.worldPort) || await processOf(root, key)) throw new Error('Stop this realm first.');
  const [auctions = 0, refunds = 0, refunded = 0] = String(await runSql(root, auctionPurgeSql(key, { house }))).trim().split(/\s+/).map(Number);
  await refreshBotConfigs(root);
  await writeConfigs(root, key, saved);
  const child = launch(root, key, 'deleting the random bots of this realm', { AC_AI_PLAYERBOT_DELETE_RANDOM_BOT_ACCOUNTS: '1' });
  const code = await new Promise(resolve => { const timer = setTimeout(() => { child.kill(); resolve(-1); }, 3600 * 1000); child.once('exit', value => { clearTimeout(timer); resolve(value); }); });
  await fsp.rm(path.join(dirOf(root, key), '.state.json'), { force: true });
  const left = Number(await sql(root, `SELECT COUNT(*) FROM acore_auth.account WHERE username LIKE '${mode(key).prefix.toUpperCase()}%'`).catch(() => '-1'));
  if (left > 0) throw new Error(`${left} bot account(s) of this realm are still there (exit ${code}); see Royaumes\\${key}\\Logs.`);
  return { deleted: true, auctions, refunds, refunded };
}

async function setOptions(root, key, { autostart } = {}) {
  mode(key);
  const file = path.join(dirOf(root, key), 'realm.json');
  const saved = await readJson(file);
  if (!saved) throw new Error('Create the realm first.');
  if (autostart !== undefined) saved.autostart = autostart === true;
  await fsp.writeFile(file, JSON.stringify(saved, null, 2));
  return saved;
}

// The authserver marks every realm offline when it starts (flag | 2); a world puts its own line back only at its next
// periodic update (about 10 minutes). The worlds start before the authserver (CoA Bots 2.6), so right after the
// authserver is up, the realms whose world port answers are put back online at once.
async function onlineRunning(root) {
  const rows = (await sql(root, 'SELECT id, port FROM acore_auth.realmlist WHERE flag & 2')).split(/\r?\n/).filter(Boolean).map(line => line.split('\t').map(Number));
  const up = [];
  for (const [id, port] of rows) if (port && (await listening(port))) up.push(id);
  if (up.length) await sql(root, `UPDATE acore_auth.realmlist SET flag = flag & ~2 WHERE id IN (${up.join(',')})`);
  return up;
}
const listening = port => portOpen(port);

// The authserver marks every realm offline (flag bit 2) when it starts; a world clears that bit only at its own start,
// then every UpdateUptimeInterval. Cleared again for the worlds already running, so they do not show Offline for minutes.
async function clearOffline(root, { coa = false } = {}) {
  const ids = (await status(root, { live: false })).realms.filter(realm => realm.state === 'running').map(realm => Number(realm.id)).filter(Number.isInteger);
  if (coa) ids.push(1);
  if (ids.length) await sql(root, `UPDATE acore_auth.realmlist SET flag = flag & ~2 WHERE id IN (${ids.join(',')})`);
  return ids;
}
// ---------------------------------------------------------------- reset the world (Squid World only)
// A completely new run of the living server: its two databases are saved whole, dropped, and made again the way a new
// realm is created (bots, auction house and its seller, mail, guilds, the players' characters of THIS realm,
// achievements, server firsts, learned prices, guild logs: all of it lives in acore_characters_<key> and
// acore_playerbots_<key>; asked to SquidBot, Monde and Economie, 13/11). Game accounts (acore_auth) and the realm's
// settings (settings.json: LaunchCurve.*, AuctionHouseBot.*, the player's choices) are kept. The state files the
// modules and the dashboard write for this realm go too; they are made again at its start. Nothing is lost for good:
// the saved copy (Backups\<key>-reset-<date>) can be put back by restoreRealm.
const RESETTABLE = new Set(['living']);
const realmDbs = key => [`acore_characters_${key}`, `acore_playerbots_${key}`];
// Relative to Royaumes\<key>: written by the modules (Logs\squidbot: events, monde, economy, watch) and the launcher.
const RESET_STATE = ['.state.json', path.join('Logs', 'bot-status.json'), path.join('Logs', 'squidbot')];
const stampOf = (now = new Date()) => `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;

function dumpTo(root, database, file) {
  return new Promise((resolve, reject) => execFile(path.join(root, 'mysql', 'bin', 'mysqldump.exe'), [...mysqlArgs(root), '--single-transaction', '--routines', '--triggers', `--result-file=${file}`, '--databases', database],
    { windowsHide: true, timeout: 3600 * 1000, maxBuffer: 16 << 20 }, (error, stdout, stderr) => error ? reject(new Error(`Saving ${database} failed: ${String(stderr || error.message).trim().split(/\r?\n/).pop()}`)) : resolve()));
}
function loadFrom(root, file) {
  return new Promise((resolve, reject) => {
    const load = spawn(path.join(root, 'mysql', 'bin', 'mysql.exe'), mysqlArgs(root), { windowsHide: true });
    let errors = '';
    load.stderr.on('data', chunk => { errors += chunk; });
    load.once('error', reject);
    load.once('exit', code => (code ? reject(new Error(`Restoring ${path.basename(file)} failed: ${errors.trim().split(/\r?\n/).pop() || code}`)) : resolve()));
    fs.createReadStream(file).on('error', reject).pipe(load.stdin);
  });
}
const realIo = () => ({ sql, dumpTo, loadFrom, create });

// What a reset would erase, to show before it is confirmed: the players' characters of this realm (name, level), and
// how many bots, guilds, auctions, mails and achievements.
async function worldPreview(root, key, { io = realIo() } = {}) {
  if (!RESETTABLE.has(key)) throw new Error('Only Squid World can be reset.');
  const prefix = mode(key).prefix.toUpperCase();
  const c = `acore_characters_${key}`;
  const rows = (await io.sql(root, `SELECT c.name, c.level FROM ${c}.characters c JOIN acore_auth.account a ON a.id = c.account WHERE a.username NOT LIKE '${prefix}%' AND a.username NOT IN ('AHBOT', 'DCDRIVER') ORDER BY c.level DESC, c.name`))
    .split(/\r?\n/).filter(Boolean).map(line => { const [name, level] = line.split('\t'); return { name, level: Number(level) }; });
  const counts = (await io.sql(root, `SELECT (SELECT COUNT(*) FROM ${c}.characters c JOIN acore_auth.account a ON a.id = c.account WHERE a.username LIKE '${prefix}%'), (SELECT COUNT(*) FROM ${c}.guild), (SELECT COUNT(*) FROM ${c}.auctionhouse), (SELECT COUNT(*) FROM ${c}.mail), (SELECT COUNT(*) FROM ${c}.character_achievement)`))
    .split('\t').map(Number);
  const [bots = 0, guilds = 0, auctions = 0, mails = 0, achievements = 0] = counts;
  return { players: rows, bots, guilds, auctions, mails, achievements };
}

async function stoppedRealm(root, key) {
  const saved = await realmFile(root, key);
  if (!saved) throw new Error('Create the realm first.');
  if (await portOpen(saved.worldPort) || await processOf(root, key)) throw new Error('Stop this realm first.');
  return saved;
}

// The whole realm saved in Backups\<key>-<label>-<date>: its two databases (mysqldump) and its folder.
async function backupRealm(root, key, { label = 'reset', io = realIo(), now = new Date(), preview = null } = {}) {
  const saved = await realmFile(root, key);
  const dir = path.join(root, 'Backups', `${key}-${label}-${stampOf(now)}`);
  await fsp.mkdir(dir, { recursive: true });
  const files = [];
  for (const database of realmDbs(key)) {
    const file = path.join(dir, `${database}.sql`);
    await io.dumpTo(root, database, file);
    files.push(path.basename(file));
  }
  await fsp.cp(dirOf(root, key), path.join(dir, 'Royaumes', key), { recursive: true });
  const info = { kind: 'realm', key, name: saved?.name || key, label, at: now.toISOString(), files, preview };
  await fsp.writeFile(path.join(dir, 'backup.json'), JSON.stringify(info, null, 2));
  return { dir, ...info };
}

// The reset itself: the player retyped the realm's name; saved first, then made new.
async function resetWorld(root, key, { confirmName, io = realIo(), now = new Date() } = {}) {
  if (!RESETTABLE.has(key)) throw new Error('Only Squid World can be reset.');
  const saved = await stoppedRealm(root, key);
  if (String(confirmName || '').trim().toLowerCase() !== String(saved.name).trim().toLowerCase()) throw new Error('Type the name of the realm to confirm.');
  const preview = await worldPreview(root, key, { io });
  const backup = await backupRealm(root, key, { label: 'reset', io, now, preview });
  for (const database of realmDbs(key)) await io.sql(root, `DROP DATABASE IF EXISTS ${database}`);
  await io.sql(root, `DELETE FROM acore_auth.realmcharacters WHERE realmid = ${Number(saved.id)}`);
  for (const rel of RESET_STATE) await fsp.rm(path.join(dirOf(root, key), rel), { recursive: true, force: true });
  // Made again as a new realm, with its name, ports and settings (create keeps the values the player set).
  await io.create(root, key, { name: saved.name });
  const fresh = await realmFile(root, key);
  if (fresh) {
    fresh.autostart = saved.autostart !== false;
    if (saved.disabled) fresh.disabled = saved.disabled;
    await fsp.writeFile(path.join(dirOf(root, key), 'realm.json'), JSON.stringify(fresh, null, 2));
  }
  return { backup: backup.dir, preview };
}

// The saved copies of a realm (newest first), for the Restore button.
async function realmBackups(root, key) {
  const base = path.join(root, 'Backups');
  const out = [];
  for (const name of await fsp.readdir(base).catch(() => [])) {
    const info = await readJson(path.join(base, name, 'backup.json'));
    if (info?.kind === 'realm' && info.key === key) out.push({ id: name, at: info.at, label: info.label, name: info.name, players: info.preview?.players?.length ?? null });
  }
  return out.sort((a, b) => String(b.at).localeCompare(String(a.at)));
}

// A saved copy put back: the realm as it is now is saved first (label before-restore), then its databases and its
// folder are replaced by the copy's.
async function restoreRealm(root, key, id, { io = realIo(), now = new Date() } = {}) {
  if (!RESETTABLE.has(key)) throw new Error('Only Squid World can be reset.');
  if (!/^[A-Za-z0-9_.-]+$/.test(String(id || ''))) throw new Error('Unknown backup.');
  const dir = path.join(root, 'Backups', id);
  const info = await readJson(path.join(dir, 'backup.json'));
  if (info?.kind !== 'realm' || info.key !== key) throw new Error('Unknown backup.');
  for (const database of realmDbs(key)) if (!fs.existsSync(path.join(dir, `${database}.sql`))) throw new Error(`The backup has no copy of ${database}.`);
  await stoppedRealm(root, key);
  const before = await backupRealm(root, key, { label: 'before-restore', io, now });
  for (const database of realmDbs(key)) await io.sql(root, `DROP DATABASE IF EXISTS ${database}`);
  for (const database of realmDbs(key)) await io.loadFrom(root, path.join(dir, `${database}.sql`));
  const folder = path.join(dir, 'Royaumes', key);
  if (fs.existsSync(folder)) {
    for (const rel of RESET_STATE) await fsp.rm(path.join(dirOf(root, key), rel), { recursive: true, force: true });
    await fsp.cp(folder, dirOf(root, key), { recursive: true, force: true });
  }
  return { restored: id, before: before.dir };
}

module.exports = { RESETTABLE, worldPreview, backupRealm, resetWorld, realmBackups, restoreRealm, auctionPurgeSql, changedCount, imposedNow, lastWorldExit, endKind, logTail, realmEnd, stoppedOnPurpose, setPinner, livingOwn, clearOffline, setRealmName, ahbotSettingsOf, setAhbotSettingsOf, onlineRunning, shippedTables, syncShippedTables, MODES, queueMarked, memoryFor, neededMb, botsOnline, setDisabled, versionReady, modulesOf, setModule, coaAutostart, setCoaAutostart, skipCoaAtStart, anotherStarting, refreshBotConfigs, status, create, start, stop, stopAll, startMarked, setOptions, settingsOf, saveSettings, purgeBots, writeConfigs, setKey };
