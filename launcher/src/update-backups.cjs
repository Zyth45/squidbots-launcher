'use strict';
// The backups made by the update tool, one per server update: <repack>/Backups/<version>-<yyyymmdd>-<hhmmss>, about 15 GB
// each (the database copied cold, the files replaced, CoA-Bots). Nothing deleted them: the laptop held 6 (67 GB) and an
// update stopped on code 17 for want of space. The launcher only uses the newest one (Undo the update).
// User's rule, 20/11 (« OUI »): before an update only the newest is kept, so two remain after it. Never touched:
// - a folder without its backup.json (not a backup of the tool, or one still being made: .partial);
// - a backup holding an after-* folder (what was played after an update, set aside by its undo);
// - the daily and manual backups of the launcher (<stamp>.sql.gz files, not folders of this form).
const fs = require('node:fs');
const path = require('node:path');

const NAME = /^\d+(?:\.\d+)*[\w.-]*-(\d{8})-(\d{6})$/;
const sizes = new Map();

function folderBytes(dir) {
  let sum = 0;
  const walk = folder => {
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      const file = path.join(folder, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) walk(file);
      else try { sum += fs.statSync(file).size; } catch {}
    }
  };
  try { walk(dir); } catch {}
  return sum;
}

// Every update backup, oldest first.
function list(folder) {
  const root = path.join(folder, 'Backups');
  let names = [];
  try { names = fs.readdirSync(root); } catch { return []; }
  return names.filter(name => NAME.test(name)).map(name => {
    const dir = path.join(root, name);
    let info;
    try { info = fs.lstatSync(dir); } catch { return null; }
    if (!info.isDirectory() || info.isSymbolicLink() || !fs.existsSync(path.join(dir, 'backup.json'))) return null;
    let holdsPlay = true;
    try { holdsPlay = fs.readdirSync(dir).some(entry => /^after-/i.test(entry)); } catch {}
    const [, day, time] = NAME.exec(name);
    return { name, dir, stamp: day + time, holdsPlay };
  }).filter(Boolean).sort((a, b) => a.stamp.localeCompare(b.stamp) || a.name.localeCompare(b.name));
}

// The backups an update deletes first: all but the newest, never one that holds play set aside.
function older(folder) {
  const all = list(folder);
  return all.slice(0, -1).filter(backup => !backup.holdsPlay).map(backup => {
    if (!sizes.has(backup.dir)) sizes.set(backup.dir, folderBytes(backup.dir));
    return { name: backup.name, bytes: sizes.get(backup.dir) };
  });
}

function summary(folder) {
  const found = older(folder);
  return { count: found.length, bytes: found.reduce((sum, backup) => sum + backup.bytes, 0), names: found.map(backup => backup.name) };
}

// Each one is renamed first (no longer a backup for anyone), then deleted: one cut half-way stays aside as
// <name>.deleting, never a half backup under its own name. Written in logs/launcher-backups.log.
async function removeOlder(folder) {
  const removed = [];
  const log = path.join(folder, 'logs', 'launcher-backups.log');
  for (const backup of older(folder)) {
    const dir = path.join(folder, 'Backups', backup.name);
    const doomed = `${dir}.deleting`;
    try {
      await fs.promises.rename(dir, doomed);
      await fs.promises.rm(doomed, { recursive: true, force: true });
      sizes.delete(dir);
      removed.push(backup);
      await fs.promises.mkdir(path.dirname(log), { recursive: true }).catch(() => {});
      await fs.promises.appendFile(log, `${new Date().toISOString()} older update backup deleted: ${backup.name} (${Math.round(backup.bytes / 1048576)} MB)\n`).catch(() => {});
    } catch {}
  }
  return removed;
}

// The play set aside by an undone update (3.2.1, Builder and Pilote 21/11): Backups\<backup>\after-<v>-<date>-<time>,
// what was played after that update, database included (about 3 GB or more). Listed with its size on the Backups
// page; only the player deletes one, by clicking and confirming. Never deleted by the launcher on its own.
const AFTER = /^after-(\d+(?:\.\d+)*[\w.-]*)-(\d{8})-(\d{6})$/i;
function playSaved(folder) {
  const out = [];
  for (const backup of list(folder)) {
    let entries = [];
    try { entries = fs.readdirSync(backup.dir, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      const match = AFTER.exec(entry.name);
      if (!match || !entry.isDirectory() || entry.isSymbolicLink()) continue;
      const dir = path.join(backup.dir, entry.name);
      if (!sizes.has(dir)) sizes.set(dir, folderBytes(dir));
      const [, version, day, time] = match;
      out.push({ backup: backup.name, name: entry.name, version, at: `${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6)}T${time.slice(0, 2)}:${time.slice(2, 4)}:${time.slice(4)}`, bytes: sizes.get(dir) });
    }
  }
  return out.sort((a, b) => b.at.localeCompare(a.at));
}

// Deletes one of them, named by the page (both names checked against the list: nothing else can be reached). Renamed
// first, as an older backup, then deleted; written in logs/launcher-backups.log.
async function removePlay(folder, backupName, name) {
  const item = playSaved(folder).find(entry => entry.backup === backupName && entry.name === name);
  if (!item) throw new Error('This saved play is no longer there.');
  const dir = path.join(folder, 'Backups', item.backup, item.name);
  const doomed = `${dir}.deleting`;
  await fs.promises.rename(dir, doomed);
  await fs.promises.rm(doomed, { recursive: true, force: true });
  sizes.delete(dir);
  const log = path.join(folder, 'logs', 'launcher-backups.log');
  await fs.promises.mkdir(path.dirname(log), { recursive: true }).catch(() => {});
  await fs.promises.appendFile(log, `${new Date().toISOString()} play saved after an undone update deleted by the player: ${item.backup}\\${item.name} (${Math.round(item.bytes / 1048576)} MB)\n`).catch(() => {});
  return item;
}

module.exports = { list, older, summary, removeOlder, playSaved, removePlay, NAME };
