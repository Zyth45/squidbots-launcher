'use strict';
// Dawnrise Island / Azzar Faire (content by Duskmere, The Venture Co, shared with permission; 3.3.1): extra content in
// the CoA world (maps 909 and 960, portal tents in Stormwind and Orgrimmar, the Faire mini-games), switched on and off
// from Modules, off by default. Its files come with CoA Bots in CoA-Bots/Modules/dawnrise:
//   sql/world/dawnrise-install.sql, sql/world/dawnrise-uninstall.sql (acore_world, both idempotent),
//   sql/characters/dawnrise-evacuate.sql (each characters database: everyone left on 909/960 back to its hearthstone),
//   lua_scripts/dawnrise/ (the mini-games, run by ALE), maps/vmaps and maps/mmaps (909/960), client/*.MPQ (the game).
// On: install SQL, maps into Data, Lua into Core/lua_scripts/dawnrise, ALE.Enabled = 1. Off: evacuate every characters
// database, uninstall SQL, Lua copy removed, ALE.Enabled = 0 unless other Lua scripts are left. The world server must be
// stopped (MySQL running); a backup of the databases comes first, the world one included.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

const MODULE_DIR = 'CoA-Bots/Modules/dawnrise';
const FILES = { install: 'sql/world/dawnrise-install.sql', uninstall: 'sql/world/dawnrise-uninstall.sql', evacuate: 'sql/characters/dawnrise-evacuate.sql', lua: 'lua_scripts/dawnrise' };
const LUA_TARGET = 'CoA-Bots/Core/lua_scripts/dawnrise';
const ALE_CONF = 'CoA-Bots/Core/configs/modules/mod_ale.conf';
const CLIENT_MPQS = ['patch-ZZZT.MPQ', 'patch-ZZZW.MPQ'];
// A quest the install adds (its range is Dawnrise's own): tells whether the world database has the island.
const MARK_QUEST = 1650201;

const confValue = (text, key) => new RegExp(`^[ \\t]*${key.replace(/\./g, '\\.')}[ \\t]*=[ \\t]*"?([^"\\r\\n#]*)"?`, 'm').exec(text || '')?.[1]?.trim();
function setKey(text, key, value) {
  const pattern = new RegExp(`^([ \\t]*${key.replace(/\./g, '\\.')}[ \\t]*=)([ \\t]*).*$`, 'm');
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  return pattern.test(text) ? text.replace(pattern, (_, head, space) => `${head}${space || ' '}${value}`) : `${text.replace(/\s*$/, '')}${eol}${key} = ${value}${eol}`;
}
const exists = file => fs.existsSync(file);
const luaFiles = dir => { try { return fs.readdirSync(dir, { recursive: true }).filter(name => /\.lua$/i.test(String(name))); } catch { return []; } };

function clientState(client) {
  if (!client || !exists(client)) return 'unknown';
  const present = CLIENT_MPQS.filter(name => exists(path.join(client, 'Data', name))).length;
  return present === CLIENT_MPQS.length ? 'yes' : present ? 'partial' : 'no';
}

async function status(root, { client = '' } = {}) {
  const dir = path.join(root, MODULE_DIR);
  const available = Object.values(FILES).every(rel => exists(path.join(dir, rel)));
  const ale = await fsp.readFile(path.join(root, ALE_CONF), 'utf8').catch(() => fsp.readFile(path.join(root, `${ALE_CONF}.dist`), 'utf8').catch(() => null));
  const lua = luaFiles(path.join(root, LUA_TARGET)).length > 0;
  const aleOn = confValue(ale, 'ALE.Enabled') === '1';
  return { available, enabled: available && lua && aleOn, lua, ale: ale === null ? null : aleOn, client: clientState(client), clientFiles: available && CLIENT_MPQS.every(name => exists(path.join(dir, 'client', name))) };
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

// The game's two patch files, copied into its Data (game closed). They may stay when the island is off.
async function installClient(root, client) {
  if (!client || !exists(path.join(client, 'Data'))) throw new Error('Choose your game folder first.');
  for (const name of CLIENT_MPQS) await fsp.copyFile(path.join(root, MODULE_DIR, 'client', name), path.join(client, 'Data', name));
  return clientState(client);
}

async function enable(root, backup) {
  if (!(await status(root)).available) throw new Error('Dawnrise comes with CoA Bots 3.3.1.');
  await backup.ready();
  const safety = await backup.create({ label: 'before-dawnrise-on', reason: 'automatic', includeWorld: true });
  const dir = path.join(root, MODULE_DIR);
  await runFile(backup, path.join(dir, FILES.install), 'acore_world');
  if (!(await worldHasIsland(backup))) throw new Error(`The island is not in the world database after its install. Backup: ${safety.name}.`);
  const maps = (await copyTree(path.join(dir, 'maps', 'vmaps'), path.join(root, 'Data', 'vmaps'), false)) + (await copyTree(path.join(dir, 'maps', 'mmaps'), path.join(root, 'Data', 'mmaps'), true));
  await fsp.rm(path.join(root, LUA_TARGET), { recursive: true, force: true });
  await copyTree(path.join(dir, FILES.lua), path.join(root, LUA_TARGET), true);
  await setAle(root, true);
  return { backup: safety.name, maps };
}

async function disable(root, backup) {
  if (!(await status(root)).available) throw new Error('Dawnrise comes with CoA Bots 3.3.1.');
  await backup.ready();
  const safety = await backup.create({ label: 'before-dawnrise-off', reason: 'automatic', includeWorld: true });
  const dir = path.join(root, MODULE_DIR);
  const characters = (await backup.databases(false)).filter(name => /^acore_characters(_[a-z]+)?$/.test(name));
  for (const database of characters) await runFile(backup, path.join(dir, FILES.evacuate), database);
  await runFile(backup, path.join(dir, FILES.uninstall), 'acore_world');
  if (await worldHasIsland(backup)) throw new Error(`The island is still in the world database after its uninstall. Backup: ${safety.name}.`);
  // Only our own copy goes: the module's folder in CoA-Bots/Modules keeps the scripts.
  await fsp.rm(path.join(root, LUA_TARGET), { recursive: true, force: true });
  if (!luaFiles(path.join(root, 'CoA-Bots', 'Core', 'lua_scripts')).length) await setAle(root, false);
  return { backup: safety.name, evacuated: characters };
}

module.exports = { status, enable, disable, installClient, clientState, runFile, MODULE_DIR, LUA_TARGET, ALE_CONF, CLIENT_MPQS, MARK_QUEST };
