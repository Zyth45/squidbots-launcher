'use strict';
// Eco mode of a realm (CoA or an extra realm): with no player in its world for ECO_AFTER, its bots far from players
// mostly sleep (AiPlayerbot.BotActiveAlone = ECO_VALUE, written to its playerbots.conf and read again by
// .reload config, CoA Bots 2.9.1 and later); the player's own value comes back as soon as a player is there.
// The value of the player is kept in Royaumes\eco-state.json before anything is written, so a crash of the launcher
// or a PC switched off during the eco time never leaves it: it is put back before the world starts again.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');
const live = require('./live.cjs');

const KEY = 'AiPlayerbot.BotActiveAlone';
const ECO_VALUE = '1';
// COA_ECO_AFTER_MS: a shorter wait, for the tests on a real server only.
const ECO_AFTER = Number(process.env.COA_ECO_AFTER_MS) || 10 * 60 * 1000;
const SINCE = [2, 9, 1];
const REALM_KEYS = ['wildcard', 'reborn', 'dawnrise'];

const stateFile = root => path.join(root, 'Royaumes', 'eco-state.json');
const optionsFile = (root, key) => path.join(root, 'Royaumes', key === 'coa' ? 'coa.json' : path.join(key, 'realm.json'));
const confOf = (root, key) => (key === 'coa'
  ? path.join(root, 'CoA-Bots', 'Core', 'configs', 'modules', 'playerbots.conf')
  : path.join(root, 'Royaumes', key, 'configs', 'modules', 'playerbots.conf'));

const readJson = async file => { try { return JSON.parse((await fsp.readFile(file, 'utf8')).replace(/^﻿/, '')); } catch { return null; } };
const linePattern = () => new RegExp(`^[ \\t]*${KEY.replace(/\./g, '\\.')}[ \\t]*=.*(\\r?\\n)?`, 'gm');
const valueOf = text => new RegExp(`^[ \\t]*${KEY.replace(/\./g, '\\.')}[ \\t]*=[ \\t]*"?([^"\\r\\n#]*)"?`, 'm').exec(text || '')?.[1]?.trim() ?? null;

// The player's value back in a playerbots.conf (null: the key was not there, the line added for the eco time goes).
function restoreText(text, original) {
  if (original === null) return text.replace(linePattern(), '');
  return text.replace(linePattern(), (line, eol) => `${KEY} = ${original}${eol || ''}`);
}
function ecoText(text) {
  if (valueOf(text) !== null) return text.replace(linePattern(), (line, eol) => `${KEY} = ${ECO_VALUE}${eol || ''}`);
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  return `${text.replace(/\s*$/, '')}${eol}${KEY} = ${ECO_VALUE}${eol}`;
}

function botsVersion(root) {
  try { return String(JSON.parse(fs.readFileSync(path.join(root, 'CoA-Bots', 'release.json'), 'utf8').replace(/^﻿/, '')).version || ''); } catch { return ''; }
}
// CoA Bots 2.9.1 reads the activity of the bots again on .reload config; the realms run the same bot worldserver.
function supported(root) {
  const parts = (/^(\d+)\.(\d+)(?:\.(\d+))?/.exec(botsVersion(root)) || []).slice(1).map(value => Number(value || 0));
  if (!parts.length) return false;
  for (let i = 0; i < 3; i += 1) if (parts[i] !== SINCE[i]) return parts[i] > SINCE[i];
  return true;
}

async function records(root) { return (await readJson(stateFile(root))) || {}; }
async function saveRecords(root, all) {
  await fsp.mkdir(path.dirname(stateFile(root)), { recursive: true });
  if (!Object.keys(all).length) return fsp.rm(stateFile(root), { force: true });
  return fsp.writeFile(stateFile(root), JSON.stringify(all, null, 2));
}
async function activeRecord(root, key) { return (await records(root))[key] || null; }

async function enabled(root, key) { return (await readJson(optionsFile(root, key)))?.eco === true; }
async function keys(root) {
  const out = [];
  for (const key of ['coa', ...REALM_KEYS]) if (await enabled(root, key)) out.push(key);
  return out;
}

const probe = require('./probe.cjs');
async function ports(root, key) {
  if (key === 'coa') {
    const s = (await readJson(path.join(root, 'Settings', 'repack.json'))) || {};
    return { world: Number(s.worldPort) || 8085, ra: 0 };
  }
  const saved = await readJson(path.join(root, 'Royaumes', key, 'realm.json'));
  return { world: Number(saved?.worldPort) || 0, ra: Number(saved?.raPort) || 0 };
}
// The players of a world: its characters online whose account is not a random bot's, the Dungeon Clear driver's nor
// the auction house seller's. The alts of a player are online only with him.
function sql(root, query) {
  return new Promise((resolve, reject) => execFile(path.join(root, 'mysql', 'bin', 'mysql.exe'), [`--defaults-file=${path.join(root, 'mysql', 'admin-client.ini')}`, '-N', '-B', '-e', query],
    { windowsHide: true, timeout: 30000 }, (error, stdout) => (error ? reject(error) : resolve(String(stdout).trim()))));
}
const dbName = (text, key) => (new RegExp(`^[ \\t]*${key}[ \\t]*=[ \\t]*"?([^"\\r\\n]*)`, 'm').exec(text || '')?.[1] || '').split(';')[4]?.trim() || '';
const safe = name => /^[A-Za-z0-9_]{1,64}$/.test(name);
async function players(root, key) {
  const ws = await fsp.readFile(path.join(root, 'CoA-Bots', 'Core', 'configs', 'worldserver.conf'), 'utf8').catch(() => '');
  const auth = dbName(ws, 'LoginDatabaseInfo') || 'acore_auth';
  const chars = key === 'coa' ? dbName(ws, 'CharacterDatabaseInfo') || 'acore_characters' : `acore_characters_${key}`;
  const prefix = /^[ \t]*AiPlayerbot\.RandomBotAccountPrefix[ \t]*=[ \t]*"?([A-Za-z0-9_]*)/m.exec(await fsp.readFile(confOf(root, key), 'utf8').catch(() => ''))?.[1] || 'rndbot';
  if (!safe(auth) || !safe(chars) || !safe(prefix)) return null;
  const count = Number(await sql(root, `SELECT COUNT(*) FROM ${chars}.characters c JOIN ${auth}.account a ON a.id = c.account WHERE c.online = 1 AND a.username NOT LIKE '${prefix.toUpperCase()}%' AND a.username NOT IN ('DCDRIVER', 'AHBOT')`));
  return Number.isFinite(count) ? count : null;
}
const ra = (root, key, p, command, timeout) => live.raCommand(root, command, timeout, key === 'coa' ? 0 : p.ra);

// Eco time: the player's value recorded first, then the eco value written and read again by the world.
async function sleep(root, key, p) {
  const file = confOf(root, key);
  const text = await fsp.readFile(file, 'utf8').catch(() => null);
  if (text === null) return false;
  const original = valueOf(text);
  // A player who already keeps (almost) every bot asleep: nothing to save.
  if (original !== null && Number(original) <= Number(ECO_VALUE)) return false;
  const all = await records(root);
  all[key] = { original, at: new Date().toISOString() };
  await saveRecords(root, all);
  await fsp.writeFile(file, ecoText(text));
  await ra(root, key, p, 'reload config', 30000).catch(() => {});
  return true;
}

// The player's value back. When the file no longer has the eco value, the player changed it meanwhile: it is kept.
async function wake(root, key, { reload = false, p = null } = {}) {
  const all = await records(root);
  const record = all[key];
  if (!record) return false;
  const file = confOf(root, key);
  const text = await fsp.readFile(file, 'utf8').catch(() => null);
  if (text !== null && valueOf(text) === ECO_VALUE) await fsp.writeFile(file, restoreText(text, record.original));
  delete all[key];
  await saveRecords(root, all);
  if (reload) await ra(root, key, p || await ports(root, key), 'reload config', 30000).catch(() => {});
  return true;
}

// Before a world starts (and when the launcher opens): the player's value back for every world that does not run.
async function wakeStopped(root, only = null) {
  if (!root) return;
  for (const key of Object.keys(await records(root))) {
    if (only && key !== only) continue;
    const p = await ports(root, key);
    if (!(await probe.portOpen(p.world, root))) await wake(root, key).catch(() => {});
  }
}

// Every minute: the players of each world in eco mode. lastSeen: when a player was last there (or the watch began).
const lastSeen = new Map();
async function tick(root) {
  if (!root) return;
  await wakeStopped(root);
  const on = supported(root) ? await keys(root) : [];
  // Switched off (or a server older than 2.9.1): its value back at once, read again if the world runs.
  for (const key of Object.keys(await records(root))) if (!on.includes(key)) await wake(root, key, { reload: true }).catch(() => {});
  for (const key of on) {
    const p = await ports(root, key);
    if (!(await probe.portOpen(p.world, root))) { lastSeen.delete(key); continue; }
    const count = await players(root, key).catch(() => null);
    if (count === null) continue;
    const asleep = !!(await activeRecord(root, key));
    if (count > 0) {
      lastSeen.set(key, Date.now());
      if (asleep) await wake(root, key, { reload: true, p }).catch(() => {});
    } else {
      if (!lastSeen.has(key)) lastSeen.set(key, Date.now());
      if (!asleep && Date.now() - lastSeen.get(key) >= ECO_AFTER) await sleep(root, key, p).catch(() => {});
    }
  }
}

async function setEnabled(root, key, on) {
  if (key !== 'coa' && !REALM_KEYS.includes(key)) throw new Error('Unknown realm.');
  const file = optionsFile(root, key);
  const saved = (await readJson(file)) || (key === 'coa' ? {} : null);
  if (!saved) throw new Error('Create the realm first.');
  saved.eco = on === true;
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, JSON.stringify(saved, null, 2));
  lastSeen.delete(key);
  if (!saved.eco) await wake(root, key, { reload: true }).catch(() => {});
}

// For the cards: on, and asleep now.
async function status(root) {
  const all = await records(root);
  const out = { supported: supported(root), realms: {} };
  for (const key of ['coa', ...REALM_KEYS]) out.realms[key] = { on: await enabled(root, key), asleep: !!all[key] };
  return out;
}

module.exports = { players, tick, wake, wakeStopped, setEnabled, status, supported, restoreText, ecoText, activeRecord, ECO_VALUE, ECO_AFTER };
