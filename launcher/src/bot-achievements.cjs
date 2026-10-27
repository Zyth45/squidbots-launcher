'use strict';
// The achievement progress of the random bots (character_achievement_progress): older CoA Bots wrote millions of rows
// that nobody reads (11.7 M rows, 757 MB on DEV), which slow the backups, the world's stops and its queries. The bots
// of CoA Bots 2.8 no longer write them. Each characters database (CoA and the extra realms) is saved first (its two
// achievement tables), then the rows of the random bot accounts are deleted in batches; human accounts (the player's
// alts, AHBOT, tests) are never touched. Run with every world stopped; running it again does nothing once it is clean.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const zlib = require('node:zlib');
const { spawn } = require('node:child_process');
const { pipeline } = require('node:stream/promises');

const DB = /^[A-Za-z0-9_]{1,64}$/;
const BATCH = 50000;
const confValue = (text, key) => new RegExp(`^\\s*${key.replace(/\./g, '\\.')}\\s*=\\s*"?([^"\\r\\n#]*)"?`, 'm').exec(text || '')?.[1]?.trim();
const read = file => fsp.readFile(file, 'utf8').catch(() => '');
const dbOf = info => String(info || '').split(';')[4] || '';

// Every characters database of this server, with the auth database it belongs to: the CoA world's (from the bot
// server's config when the bots are installed), then each realm's own (Royaumes\<key>\configs).
async function targets(root) {
  const list = [];
  const coaConf = fs.existsSync(path.join(root, 'CoA-Bots', 'Core', 'configs', 'worldserver.conf')) ? path.join(root, 'CoA-Bots', 'Core', 'configs', 'worldserver.conf') : path.join(root, 'Core', 'configs', 'worldserver.conf');
  const confs = [coaConf];
  for (const key of await fsp.readdir(path.join(root, 'Royaumes')).catch(() => [])) confs.push(path.join(root, 'Royaumes', key, 'configs', 'worldserver.conf'));
  for (const file of confs) {
    const text = await read(file);
    const chars = dbOf(confValue(text, 'CharacterDatabaseInfo'));
    const auth = dbOf(confValue(text, 'LoginDatabaseInfo'));
    if (DB.test(chars) && DB.test(auth) && !list.some(item => item.chars === chars)) list.push({ chars, auth });
  }
  return list;
}

// The account prefix of the random bots (AiPlayerbot.RandomBotAccountPrefix, "rndbot" by default).
async function botPrefix(root) {
  const text = await read(path.join(root, 'CoA-Bots', 'Core', 'configs', 'modules', 'playerbots.conf'));
  const value = confValue(text, 'AiPlayerbot.RandomBotAccountPrefix') || 'rndbot';
  return /^[A-Za-z0-9_]{1,20}$/.test(value) ? value.toUpperCase() : 'RNDBOT';
}

// Size of the table in each characters database (MB), to tell the player whether it is worth it.
async function sizes(root, backup) {
  const list = await targets(root);
  if (!list.length) return [];
  const rows = await backup.query(`SELECT TABLE_SCHEMA, ROUND((DATA_LENGTH + INDEX_LENGTH) / 1048576) FROM information_schema.TABLES WHERE TABLE_NAME = 'character_achievement_progress' AND TABLE_SCHEMA IN (${list.map(item => `'${item.chars}'`).join(',')})`);
  return rows.map(row => { const [database, mb] = row.split('\t'); return { database, mb: Number(mb) || 0 }; });
}

// The two achievement tables of one database, gzipped into the repack's Backups folder.
async function saveTables(backup, database, folder) {
  await fsp.mkdir(folder, { recursive: true });
  // Local time, like the other backups of the folder.
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const target = path.join(folder, `${stamp}-achievements-${database}.sql.gz`);
  const [exe, args] = backup.client('mysqldump.exe', ['--single-transaction', '--quick', database, 'character_achievement_progress', 'character_achievement']);
  const child = spawn(exe, args, { windowsHide: true });
  let err = '';
  child.stderr.on('data', chunk => { err += chunk; });
  const exited = new Promise(resolve => child.once('exit', resolve));
  try {
    await pipeline(child.stdout, zlib.createGzip({ level: 6 }), fs.createWriteStream(`${target}.part`));
    const code = await exited;
    if (code !== 0) throw new Error(err.trim().split(/\r?\n/).pop() || `mysqldump failed (exit ${code}).`);
    await fsp.rename(`${target}.part`, target);
  } catch (error) {
    await fsp.rm(`${target}.part`, { force: true });
    throw error;
  }
  return target;
}

async function purge(root, backup, { notify = () => {} } = {}) {
  const prefix = await botPrefix(root);
  const done = [];
  for (const { chars, auth } of await targets(root)) {
    const started = Date.now();
    const exists = await backup.query(`SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = '${chars}' AND TABLE_NAME IN ('character_achievement_progress', 'characters')`);
    if (Number(exists[0]) < 2) continue;
    notify(`${chars}: saving the achievement tables…`);
    const saved = await saveTables(backup, chars, path.join(root, 'Backups'));
    await backup.query(`DROP TABLE IF EXISTS ${chars}.zz_purge_bots; CREATE TABLE ${chars}.zz_purge_bots (guid INT UNSIGNED PRIMARY KEY) SELECT c.guid FROM ${chars}.characters c JOIN ${auth}.account a ON a.id = c.account WHERE a.username LIKE '${prefix}%'`);
    let deleted = 0;
    try {
      for (;;) {
        const rows = await backup.query(`DELETE FROM ${chars}.character_achievement_progress WHERE guid IN (SELECT guid FROM ${chars}.zz_purge_bots) LIMIT ${BATCH}; SELECT ROW_COUNT()`);
        const count = Number(rows.at(-1)) || 0;
        deleted += count;
        notify(`${chars}: ${deleted.toLocaleString('en')} rows of bots deleted…`);
        if (count < BATCH) break;
      }
    } finally {
      await backup.query(`DROP TABLE IF EXISTS ${chars}.zz_purge_bots`).catch(() => {});
    }
    // The space comes back to the disk only once the table is rebuilt.
    if (deleted) { notify(`${chars}: giving the space back…`); await backup.query(`OPTIMIZE TABLE ${chars}.character_achievement_progress`).catch(() => {}); }
    done.push({ database: chars, deleted, seconds: Math.round((Date.now() - started) / 1000), backup: saved });
  }
  return done;
}

module.exports = { targets, botPrefix, sizes, purge };
