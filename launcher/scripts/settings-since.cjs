#!/usr/bin/env node
'use strict';
// The « since » table of the settings (3.2, the What's new tab): for each setting of the catalog, the launcher version
// that added it or changed its default (before → after), read from the catalog of each release tag of the public
// repository, and from this working tree for the next version. Written to src/data/settings-since.json, shipped in the
// asar: nothing is read on the player's machine. Run it before each launcher build (the test says when it is stale).
// Usage: node scripts/settings-since.cjs <public repository> [next version]
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { signature, entriesOf, compareVersions } = require('../src/settings-since.cjs');

const repo = process.argv[2];
if (!repo || !fs.existsSync(path.join(repo, '.git'))) { console.error('Usage: node scripts/settings-since.cjs <public repository> [next version]'); process.exit(2); }
const here = path.join(__dirname, '..');
const git = (...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', maxBuffer: 64 << 20 });
const tags = git('tag', '--list').split(/\r?\n/).filter(tag => /^\d+\.\d+\.\d+$/.test(tag)).sort(compareVersions);
const read = (tag, file) => { try { return JSON.parse(execFileSync('git', ['-C', repo, 'show', `refs/tags/${tag}:launcher/src/data/${file}`], { encoding: 'utf8', maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'ignore'] }).replace(/^﻿/, '')); } catch { return null; } };
const version = JSON.parse(fs.readFileSync(path.join(here, 'package.json'), 'utf8')).version;
// The next version: given, or the package's when it is not released yet, or the patch after it.
const next = process.argv[3] || (tags.includes(version) ? version.replace(/(\d+)$/, n => String(Number(n) + 1)) : version);
if (tags.includes(next)) { console.error(`${next} is already a tag.`); process.exit(2); }

const steps = tags.map(tag => ({ version: tag, entries: entriesOf(read(tag, 'server-settings.json'), read(tag, 'living-world.json')) }));
const base = JSON.parse(fs.readFileSync(path.join(here, 'src/data/server-settings.json'), 'utf8'));
const living = JSON.parse(fs.readFileSync(path.join(here, 'src/data/living-world.json'), 'utf8'));
steps.push({ version: next, entries: entriesOf(base, living) });

const keys = {};
for (let i = 1; i < steps.length; i++) {
  const before = steps[i - 1].entries;
  for (const [id, value] of steps[i].entries) {
    if (!before.has(id)) { keys[id] = { added: steps[i].version }; continue; }
    const old = before.get(id);
    if (old !== '' && value !== '' && old !== value) (keys[id] ||= {}).defaults = [...(keys[id]?.defaults || []), [steps[i].version, old, value]];
  }
}
const out = { from: tags[0], next, catalog: signature(base, living), keys };
fs.writeFileSync(path.join(here, 'src/data/settings-since.json'), `${JSON.stringify(out, null, 1)}\n`);
const added = Object.values(keys).filter(entry => entry.added === next).length;
const changed = Object.values(keys).filter(entry => entry.defaults?.some(([at]) => at === next)).length;
console.log(`${tags.join(' ')} + ${next}: ${Object.keys(keys).length} entries; in ${next}: ${added} added, ${changed} default(s) changed.`);
