'use strict';
// Dawnrise Island / Azzar Faire (created by Nightlund, shared with permission; 3.3.1): extra content in
// the CoA world (maps 909 and 960, portal tents in Stormwind and Orgrimmar, the Faire mini-games), switched on and off
// from Modules, off by default. It is a component of its own (release "components", signed dawnrise.json, minBots
// 3.3.1), downloaded only when the player switches the island on, kept in CoA-Bots/Modules/dawnrise:
//   VERSION, sql/world/dawnrise-install.sql, sql/world/dawnrise-uninstall.sql (acore_world, both idempotent),
//   sql/characters/dawnrise-evacuate.sql (each characters database: everyone left on 909/960 back to its hearthstone),
//   lua_scripts/dawnrise/ (the mini-games, run by ALE), maps/vmaps and maps/mmaps (909/960), client/*.MPQ (the game).
// On: install SQL, maps into Data, Lua into Core/lua_scripts/dawnrise, ALE.Enabled = 1. Off: evacuate every characters
// database, uninstall SQL, Lua copy removed, ALE.Enabled = 0 unless other Lua scripts are left. A newer component while
// the island is on: the OLD copy's uninstall, then the new one's install (the old copy kept until it is done, put back
// if the new install fails). The world server is stopped (MySQL running); a backup of the databases comes first.
const { spawn, execFile } = require('node:child_process');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { downloadObject } = require('./downloader.cjs');
const { compareVersions } = require('./repack-update.cjs');

const MODULE_DIR = 'CoA-Bots/Modules/dawnrise';
const FILES = { install: 'sql/world/dawnrise-install.sql', uninstall: 'sql/world/dawnrise-uninstall.sql', evacuate: 'sql/characters/dawnrise-evacuate.sql', lua: 'lua_scripts/dawnrise' };
const LUA_TARGET = 'CoA-Bots/Core/lua_scripts/dawnrise';
// The repack's own mmaps of 909/960 that the island's replace (it ships both maps): kept here while the island is on,
// put back when it is switched off, with the files it added removed (added.json).
const MMAPS_KEEP = 'CoA-Bots/Modules/dawnrise-mmaps-repack';
const ALE_CONF = 'CoA-Bots/Core/configs/modules/mod_ale.conf';
const CLIENT_MPQS = ['patch-ZZZT.MPQ', 'patch-ZZZW.MPQ'];
// A quest the install adds (its range is Dawnrise's own): tells whether the world database has the island.
const MARK_QUEST = 1650201;
const tar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');

const confValue = (text, key) => new RegExp(`^[ \\t]*${key.replace(/\./g, '\\.')}[ \\t]*=[ \\t]*"?([^"\\r\\n#]*)"?`, 'm').exec(text || '')?.[1]?.trim();
function setKey(text, key, value) {
  const pattern = new RegExp(`^([ \\t]*${key.replace(/\./g, '\\.')}[ \\t]*=)([ \\t]*).*$`, 'm');
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  return pattern.test(text) ? text.replace(pattern, (_, head, space) => `${head}${space || ' '}${value}`) : `${text.replace(/\s*$/, '')}${eol}${key} = ${value}${eol}`;
}
const exists = file => fs.existsSync(file);
const luaFiles = dir => { try { return fs.readdirSync(dir, { recursive: true }).filter(name => /\.lua$/i.test(String(name))); } catch { return []; } };
const complete = dir => Object.values(FILES).every(rel => exists(path.join(dir, rel)));
const versionOf = dir => { try { return fs.readFileSync(path.join(dir, 'VERSION'), 'utf8').trim(); } catch { return ''; } };

// root given: a file of the game with the same name but another size is not ours (a patch it had before).
function clientState(client, root = '') {
  if (!client || !exists(path.join(client, 'Data'))) return 'unknown';
  const size = file => { try { return fs.statSync(file).size; } catch { return -1; } };
  const ours = name => { if (!root) return true; const own = size(path.join(root, MODULE_DIR, 'client', name)); return own < 0 || own === size(path.join(client, 'Data', name)); };
  const present = CLIENT_MPQS.filter(name => exists(path.join(client, 'Data', name)) && ours(name)).length;
  if (present === CLIENT_MPQS.length) return 'yes';
  if (present) return 'partial';
  return CLIENT_MPQS.some(name => exists(path.join(client, 'Data', `${name}.disabled`))) ? 'disabled' : 'no';
}

// offer: the signed dawnrise.json (cleaned), or the last one seen when offline (size only), or null.
async function status(root, { client = '', offer = null, offline = false } = {}) {
  const dir = path.join(root, MODULE_DIR);
  const available = complete(dir);
  const version = available ? versionOf(dir) : '';
  const ale = await fsp.readFile(path.join(root, ALE_CONF), 'utf8').catch(() => fsp.readFile(path.join(root, `${ALE_CONF}.dist`), 'utf8').catch(() => null));
  const lua = luaFiles(path.join(root, LUA_TARGET)).length > 0;
  const aleOn = confValue(ale, 'ALE.Enabled') === '1';
  const newer = !!(offer && !offline && (!available || compareVersions(offer.version, version || '0') > 0));
  return {
    available, version, enabled: available && lua && aleOn, lua, ale: ale === null ? null : aleOn,
    client: clientState(client, root), clientPath: client || '', clientSource: path.join(root, MODULE_DIR, 'client'), clientNames: CLIENT_MPQS, clientFiles: available && CLIENT_MPQS.every(name => exists(path.join(dir, 'client', name))),
    // What a click on « On » would download (none when the local copy is the newest), and whether it can.
    download: newer ? { version: offer.version, size: offer.size } : null,
    offline: !available && !(offer && !offline), size: offer?.size || 0,
  };
}

// Runs one SQL file through the repack's mysql.exe; `database` replaces the file's own USE line (the characters
// file says acore_characters: the extra realms have acore_characters_<key>).
function runFile(backup, file, database) {
  const [exe, args] = backup.client('mysql.exe', ['--default-character-set=utf8mb4']);
  return new Promise((resolve, reject) => {
    const child = spawn(exe, args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', chunk => { out += chunk; });
    child.stderr.on('data', chunk => { err += chunk; });
    child.once('error', reject);
    child.once('exit', code => (code === 0 ? resolve(out) : reject(new Error(`${path.basename(file)} on ${database}: ${err.trim().split(/\r?\n/).pop() || 'MySQL refused it.'}`))));
    let sql = fs.readFileSync(file, 'utf8');
    if (database) sql = sql.replace(/^USE\s+`?acore_[a-z_]+`?\s*;/im, `USE \`${database}\`;`);
    child.stdin.end(sql);
  });
}

async function worldHasIsland(backup) {
  const [count] = await backup.query(`SELECT COUNT(*) FROM acore_world.quest_template WHERE ID = ${MARK_QUEST}`);
  return Number(count) > 0;
}

async function setAle(root, on) {
  const file = path.join(root, ALE_CONF);
  let text = await fsp.readFile(file, 'utf8').catch(() => null);
  if (text === null) text = await fsp.readFile(`${file}.dist`, 'utf8').catch(() => '[worldserver]\n');
  else await fsp.copyFile(file, `${file}.bak-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  await fsp.writeFile(file, setKey(text, 'ALE.Enabled', on ? '1' : '0'));
}

// Copies a folder; `overwrite` false keeps the files already there (the vmaps of our maps are never replaced).
async function copyTree(from, to, overwrite) {
  if (!exists(from)) return 0;
  let copied = 0;
  for (const entry of await fsp.readdir(from, { withFileTypes: true })) {
    const source = path.join(from, entry.name);
    const target = path.join(to, entry.name);
    if (entry.isDirectory()) { copied += await copyTree(source, target, overwrite); continue; }
    if (!overwrite && exists(target)) continue;
    await fsp.mkdir(to, { recursive: true });
    await fsp.copyFile(source, target);
    copied++;
  }
  return copied;
}

// The component's zip: downloaded (size and sha256 checked, a broken download leaves only its .part, resumed next
// time), unpacked into a folder of its own, checked. Nothing of the server is touched here.
async function fetchComponent(offer, { cacheDir, fetchImpl, signal = AbortSignal.timeout(60 * 60 * 1000) }) {
  await fsp.mkdir(cacheDir, { recursive: true });
  const zip = path.join(cacheDir, `${offer.sha256}.zip`);
  try { await downloadObject({ url: new URL(offer.url), size: offer.size, sha256: offer.sha256, destination: zip, signal, fetchImpl, redirect: 'follow' }); }
  catch (error) { throw new Error(`Dawnrise could not be downloaded: ${error.message} Nothing was changed; try again.`); }
  const stage = await fsp.mkdtemp(path.join(cacheDir, 'dawnrise-'));
  try {
    await new Promise((resolve, reject) => execFile(tar, ['-xf', zip, '-C', stage], { windowsHide: true, maxBuffer: 1 << 20 }, error => (error ? reject(new Error(`The Dawnrise file could not be unpacked: ${error.message}`)) : resolve())));
    if (!complete(stage) || versionOf(stage) !== offer.version) throw new Error(`The Dawnrise file is not version ${offer.version} with all its files. Nothing was changed.`);
    return stage;
  } catch (error) { await fsp.rm(stage, { recursive: true, force: true }); throw error; }
}

// The game's two patch files, copied into its Data (game closed): at each new version of the island.
// A file of the game with the same name that is not ours (another patch): kept once as .before-dawnrise, put back
// when the island goes off.
const KEPT = '.before-dawnrise';
const sameFile = async (a, b) => {
  try {
    const [x, y] = await Promise.all([fsp.stat(a), fsp.stat(b)]);
    if (x.size !== y.size) return false;
    const hash = async file => require('node:crypto').createHash('sha256').update(await fsp.readFile(file)).digest('hex');
    return (await hash(a)) === (await hash(b));
  } catch { return false; }
};
async function installClient(root, client) {
  if (!client || !exists(path.join(client, 'Data'))) throw new Error('Choose your game folder first.');
  for (const name of CLIENT_MPQS) {
    const ours = path.join(root, MODULE_DIR, 'client', name);
    const file = path.join(client, 'Data', name);
    if (exists(file) && !exists(`${file}${KEPT}`) && !(await sameFile(file, ours))) await fsp.copyFile(file, `${file}${KEPT}`);
    await fsp.rm(`${file}.disabled`, { force: true });
    await fsp.copyFile(ours, file);
  }
  return clientState(client, root);
}
// Island off: the two files renamed to .disabled (nothing deleted; they replace whole files of the CoA game, which
// they would otherwise hide after an update of the game). Back at the next « On ». A file of the game they had
// replaced comes back.
async function disableClient(client) {
  if (clientState(client) === 'unknown') return 'unknown';
  for (const name of CLIENT_MPQS) {
    const file = path.join(client, 'Data', name);
    if (exists(file)) {
      await fsp.rm(`${file}.disabled`, { force: true });
      await fsp.rename(file, `${file}.disabled`);
    }
    if (exists(`${file}${KEPT}`)) await fsp.rename(`${file}${KEPT}`, file);
  }
  return clientState(client);
}

// Before the island's mmaps go into Data/mmaps: each repack file it replaces is kept once (a newer island while on
// never keeps the old island's file as the repack's), each file it adds is listed.
async function keepRepackMmaps(root, dir) {
  const from = path.join(dir, 'maps', 'mmaps');
  if (!exists(from)) return;
  const keep = path.join(root, MMAPS_KEEP);
  const list = path.join(keep, 'added.json');
  let added = [];
  try { added = JSON.parse(await fsp.readFile(list, 'utf8')); } catch { /* none yet */ }
  await fsp.mkdir(keep, { recursive: true });
  for (const name of await fsp.readdir(from)) {
    const data = path.join(root, 'Data', 'mmaps', name);
    if (added.includes(name) || exists(path.join(keep, name))) continue;
    if (exists(data)) await fsp.copyFile(data, path.join(keep, name));
    else added.push(name);
  }
  await fsp.writeFile(list, JSON.stringify(added));
}
async function restoreRepackMmaps(root) {
  const keep = path.join(root, MMAPS_KEEP);
  if (!exists(keep)) return;
  let added = [];
  try { added = JSON.parse(await fsp.readFile(path.join(keep, 'added.json'), 'utf8')); } catch { /* none */ }
  for (const name of added) await fsp.rm(path.join(root, 'Data', 'mmaps', path.basename(name)), { force: true });
  for (const name of await fsp.readdir(keep)) if (name !== 'added.json') await fsp.copyFile(path.join(keep, name), path.join(root, 'Data', 'mmaps', name));
  await fsp.rm(keep, { recursive: true, force: true });
}

async function applyOn(root, backup, dir) {
  await runFile(backup, path.join(dir, FILES.install), 'acore_world');
  if (!(await worldHasIsland(backup))) throw new Error('The island is not in the world database after its install.');
  await keepRepackMmaps(root, dir);
  const maps = (await copyTree(path.join(dir, 'maps', 'vmaps'), path.join(root, 'Data', 'vmaps'), false)) + (await copyTree(path.join(dir, 'maps', 'mmaps'), path.join(root, 'Data', 'mmaps'), true));
  await fsp.rm(path.join(root, LUA_TARGET), { recursive: true, force: true });
  await copyTree(path.join(dir, FILES.lua), path.join(root, LUA_TARGET), true);
  await setAle(root, true);
  return maps;
}

// On (or a newer version while on). options: { offer, cacheDir, fetchImpl, client, gameRunning }.
async function enable(root, backup, { offer = null, cacheDir = '', fetchImpl, client = '', gameRunning = false } = {}) {
  const target = path.join(root, MODULE_DIR);
  const before = await status(root, { offer });
  if (!before.available && !before.download) throw new Error(offer ? 'Dawnrise could not be read.' : 'Dawnrise is downloaded when you switch it on: connect to the Internet and try again.');
  // 1. The download first: a failure here changes nothing.
  const stage = before.download ? await fetchComponent(offer, { cacheDir, fetchImpl }) : null;
  const old = `${target}.old`;
  let swapped = false;
  try {
    await backup.ready();
    const safety = await backup.create({ label: 'before-dawnrise-on', reason: 'automatic', includeWorld: true });
    // 2. A newer copy while the island is on: the old copy's uninstall first (rows the new version no longer has).
    const wasOn = before.available && (await worldHasIsland(backup));
    if (stage && wasOn) await runFile(backup, path.join(target, FILES.uninstall), 'acore_world');
    if (stage) {
      await fsp.rm(old, { recursive: true, force: true });
      if (exists(target)) await fsp.rename(target, old);
      await fsp.mkdir(path.dirname(target), { recursive: true });
      await fsp.cp(stage, target, { recursive: true });
      swapped = true;
    }
    let maps;
    try { maps = await applyOn(root, backup, target); }
    catch (error) {
      // 3. The new install failed: the old copy back in place, its install run again when the island was on.
      if (swapped) {
        await fsp.rm(target, { recursive: true, force: true });
        if (exists(old)) { await fsp.rename(old, target); if (wasOn) await applyOn(root, backup, target).catch(() => {}); }
      }
      throw new Error(`${error.message} The island was put back as it was. Backup: ${safety.name}.`);
    }
    await fsp.rm(old, { recursive: true, force: true });
    const game = !client ? 'unknown' : gameRunning ? 'running' : await installClient(root, client).catch(() => 'failed');
    return { backup: safety.name, maps, version: versionOf(target), updated: !!(stage && wasOn), game };
  } finally { if (stage) await fsp.rm(stage, { recursive: true, force: true }); }
}

async function disable(root, backup, { client = '', gameRunning = false } = {}) {
  if (!(await status(root)).available) throw new Error('Dawnrise is not on this server.');
  await backup.ready();
  const safety = await backup.create({ label: 'before-dawnrise-off', reason: 'automatic', includeWorld: true });
  const dir = path.join(root, MODULE_DIR);
  const characters = (await backup.databases(false)).filter(name => /^acore_characters(_[a-z]+)?$/.test(name));
  for (const database of characters) await runFile(backup, path.join(dir, FILES.evacuate), database);
  await runFile(backup, path.join(dir, FILES.uninstall), 'acore_world');
  if (await worldHasIsland(backup)) throw new Error(`The island is still in the world database after its uninstall. Backup: ${safety.name}.`);
  // Only our own copy goes: the component's folder in CoA-Bots/Modules keeps the scripts (switching back on works offline).
  await fsp.rm(path.join(root, LUA_TARGET), { recursive: true, force: true });
  await restoreRepackMmaps(root);
  if (!luaFiles(path.join(root, 'CoA-Bots', 'Core', 'lua_scripts')).length) await setAle(root, false);
  const game = !client ? 'unknown' : gameRunning ? 'running' : await disableClient(client).catch(() => 'failed');
  return { backup: safety.name, evacuated: characters, game };
}

module.exports = { status, enable, disable, installClient, disableClient, clientState, fetchComponent, runFile, MODULE_DIR, LUA_TARGET, MMAPS_KEEP, ALE_CONF, CLIENT_MPQS, MARK_QUEST };
