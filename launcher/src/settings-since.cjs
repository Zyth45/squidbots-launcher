'use strict';
// The settings new or changed since the player's previous launcher (3.2, the What's new tab). The table comes from
// scripts/settings-since.cjs (data/settings-since.json); the previous version is the one the player saw before this
// launcher (settings.previousVersion, written once per launcher update). Display only: nothing is ever written.
const crypto = require('node:crypto');

function compareVersions(a, b) {
  const pa = String(a).split('.').map(Number), pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  return 0;
}
const asText = value => (value === true ? '1' : value === false ? '0' : value === undefined || value === null ? '' : String(value));

// file|key → default, for the settings of a catalog (server-settings.json) and the options of a manifest (living-world.json).
function entriesOf(base, living) {
  const map = new Map();
  for (const setting of base?.settings || []) if (setting?.key && setting?.file) map.set(`${setting.file}|${setting.key}`, asText(setting.default));
  for (const option of living?.options || []) if (option?.key && option?.file && !map.has(`${option.file}|${option.key}`)) map.set(`${option.file}|${option.key}`, asText(option.default));
  return map;
}
// What the table was made from: a stale table (a key or a default changed since) fails the test.
function signature(base, living) {
  const lines = [...entriesOf(base, living)].map(([id, value]) => `${id}=${value}`).sort();
  return crypto.createHash('sha256').update(lines.join('\n')).digest('hex').slice(0, 16);
}

// The settings added or whose default changed after `previous` (a version), newest first, as
// { file, key, version, kind: 'new' | 'default', from, to }. Nothing without a previous version (a fresh install).
function since(table, previous) {
  if (!table?.keys || !/^\d+\.\d+\.\d+$/.test(String(previous || ''))) return [];
  const out = [];
  for (const [id, entry] of Object.entries(table.keys)) {
    const at = id.indexOf('|');
    const file = id.slice(0, at), key = id.slice(at + 1);
    if (entry.added && compareVersions(entry.added, previous) > 0) { out.push({ file, key, version: entry.added, kind: 'new' }); continue; }
    const changes = (entry.defaults || []).filter(([version]) => compareVersions(version, previous) > 0);
    // Several changes since: the first « from » and the last « to ».
    if (changes.length && changes[0][1] !== changes[changes.length - 1][2]) out.push({ file, key, version: changes[changes.length - 1][0], kind: 'default', from: changes[0][1], to: changes[changes.length - 1][2] });
  }
  return out.sort((a, b) => compareVersions(b.version, a.version));
}

// The version to compare with, at a launcher start: the one seen before this launcher, kept until the next update.
// Returns the settings to write, or null when nothing changes.
function previousOnStart(settings, current, firstRun) {
  if (firstRun || settings.previousFor === current) return null;
  const seen = settings.lastSeenVersion;
  if (!/^\d+\.\d+\.\d+$/.test(String(seen || '')) || compareVersions(seen, current) >= 0) return null;
  return { ...settings, previousVersion: seen, previousFor: current };
}

module.exports = { compareVersions, entriesOf, signature, since, previousOnStart };
