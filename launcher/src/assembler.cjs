'use strict';
// A server package without game data (2.8 onwards) is "assembled" on the player's PC by Assembler/coa_assemble.py:
// game tables, terrain and vmaps extracted from the player's own client, the database built from the public SQL,
// then the bots' navigation maps (mmaps) generated in the background, map by map. Nothing of the game is hosted by us.
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const SCRIPT = 'Assembler/coa_assemble.py';
const PYTHON = 'Runtime/python/python.exe';
const STEPS = ['dbc', 'maps', 'vmaps', 'sql', 'db'];
// Folders being assembled by this launcher right now (data, then bots, then the start of the mmaps).
const busy = new Set();

const readJson = file => { try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')); } catch { return null; } };

function pidAlive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; }
}

function workTiles(folder) {
  try { return fs.readdirSync(path.join(folder, 'Data', '.work-mmaps', 'mmaps')).filter(name => name.endsWith('.mmtile')).length; } catch { return 0; }
}

// What is left to do in this folder (read from .state/assemble.json, no process started).
function state(folder) {
  if (!folder || !fs.existsSync(path.join(folder, SCRIPT))) return { applies: false };
  const saved = readJson(path.join(folder, '.state', 'assemble.json')) || {};
  const steps = saved.steps || {};
  const database = fs.existsSync(path.join(folder, 'mysql', 'data', 'mysql'));
  // A repack the player already had (Jealous's, with its Data and its database): nothing to assemble, its files are
  // kept as they are; only a folder without them is assembled from the client.
  const existing = !saved.steps && database && fs.existsSync(path.join(folder, 'Data', 'dbc', 'Map.dbc')) && fs.existsSync(path.join(folder, 'Data', 'maps'));
  // A database build that was cut (launcher closed, PC off, MySQL stuck) leaves mysql/data and its marker: it is not
  // a database yet, the next run builds it again from the start.
  const cut = !steps.db && fs.existsSync(path.join(folder, '.state', 'assemble-db-started'));
  const missing = existing ? [] : STEPS.filter(step => !steps[step] && !(step === 'db' && database && !cut));
  const mm = saved.mmaps || {};
  const total = mm.total || 0;
  const done = Object.keys(mm.maps || {}).length;
  return {
    applies: true,
    // Still at work (bots being installed after the data): the server is not offered yet.
    needed: missing.length > 0 || busy.has(path.resolve(folder)),
    running: busy.has(path.resolve(folder)),
    missing,
    client: saved.client?.path || '',
    // Game tables extracted by the launcher from this client (a repack brought with its own data has none).
    extracted: !!steps.dbc?.fingerprint,
    skipped: saved.db?.skipped || [],
    // Progress in tiles while the current map is built (its finished tiles are counted in the work folder).
    mmaps: { done, total, tiles: (mm.tilesDone || 0) + workTiles(folder), tilesTotal: mm.tilesTotal || 0, running: !!mm.running && pidAlive(mm.pid), paused: !!mm.paused && !(mm.running && pidAlive(mm.pid)), current: mm.current ?? null, published: mm.published || '', complete: (total > 0 && done >= total) || (existing && fs.existsSync(path.join(folder, 'Data', 'mmaps'))) },
  };
}

// Runs the assembler with --json; each line it prints is an event ({ event, step, done, total, text, message }).
function run(folder, args, onEvent = () => {}, { detached = false } = {}) {
  const exe = path.join(folder, PYTHON);
  const child = spawn(exe, ['-B', SCRIPT, '--json', ...args], { cwd: folder, windowsHide: true, detached, stdio: detached ? 'ignore' : ['ignore', 'pipe', 'pipe'] });
  if (detached) { child.unref(); return Promise.resolve({ pid: child.pid }); }
  return new Promise((resolve, reject) => {
    let buffer = '';
    let failure = '';
    let tail = '';
    const read = chunk => {
      buffer += chunk;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        let event = null;
        try { event = JSON.parse(line); } catch { tail = line; continue; }
        if (event.event === 'error') failure = event.message || 'The assembly failed.';
        onEvent(event);
      }
    };
    child.stdout.on('data', read);
    child.stderr.on('data', chunk => { tail = String(chunk).trim().split(/\r?\n/).pop() || tail; });
    child.once('error', reject);
    child.once('exit', code => (code === 0 ? resolve() : reject(new Error(failure || tail || `The assembler stopped (code ${code}).`))));
  });
}

// The whole first assembly, or only some steps (after a client patch: dbc,maps,vmaps).
const assemble = (folder, client, onEvent, steps) => run(folder, ['run', '--client', client, ...(steps ? ['--steps', steps.join(',')] : [])], onEvent);

// The navigation maps keep being generated when the launcher closes; the next start reads their progress.
const mmapsStarted = new Map();
function startMmaps(folder, threads) {
  const current = state(folder);
  // A second click before the tool has written its state would start a second build: one per minute at most.
  const last = mmapsStarted.get(path.resolve(folder)) || 0;
  if (current.mmaps.running || Date.now() - last < 60000) return Promise.resolve({ pid: null, already: true });
  mmapsStarted.set(path.resolve(folder), Date.now());
  return run(folder, ['mmaps', ...(threads ? ['--threads', String(threads)] : [])], undefined, { detached: true });
}

// Pause: the build is stopped (its process tree: the tool and mmaps_generator); the maps already finished stay,
// the map in progress is done again when it goes on (startMmaps).
function stopMmaps(folder) {
  const file = path.join(folder, '.state', 'assemble.json');
  const saved = readJson(file) || {};
  const pid = saved.mmaps?.pid;
  if (pid && pidAlive(pid)) {
    try { require('node:child_process').execFileSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); } catch {}
  }
  if (saved.mmaps) {
    saved.mmaps.running = false;
    saved.mmaps.paused = true;
    fs.writeFileSync(file, JSON.stringify(saved, null, 1));
  }
  fs.rmSync(path.join(folder, '.state', 'mmaps.lock'), { force: true });
  mmapsStarted.delete(path.resolve(folder));
  return state(folder);
}

// Every map built again from the start (asked from Verification when bots walk oddly). The maps in place stay in use
// until each one is replaced.
function rebuildMmaps(folder) {
  stopMmaps(folder);
  const file = path.join(folder, '.state', 'assemble.json');
  const saved = readJson(file) || {};
  saved.mmaps = { maps: {}, tilesDone: 0 };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(saved, null, 1));
  mmapsStarted.delete(path.resolve(folder));
  return startMmaps(folder);
}

// Our navigation maps, downloaded instead of built: the assembler takes only the maps whose maps/vmaps here are those
// they were built from (the others are built as before). The manifest was checked against its signature first.
function fetchMmaps(folder, manifestFile, base, onEvent) {
  return run(folder, ['mmaps-fetch', '--manifest', manifestFile, '--base', base], onEvent);
}

// The world package is imported by Jealous's tool, which says little: its progress is read in MySQL itself
// (tables of acore_world so far, of the tables the package lists). null when MySQL does not answer.
function worldImport(folder) {
  let total = 0;
  try { total = Object.keys(readJson(path.join(folder, 'Source', 'sql-tree', 'data', 'coa-world', 'baseline.json'))?.tables || {}).length; } catch {}
  return new Promise(resolve => require('node:child_process').execFile(path.join(folder, 'mysql', 'bin', 'mysql.exe'),
    [`--defaults-file=${path.join(folder, 'mysql', 'admin-client.ini')}`, '-N', '-B', '-e', "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='acore_world'"],
    { windowsHide: true, timeout: 20000 }, (error, out) => resolve(error ? null : { done: Number(String(out).trim()) || 0, total })));
}

// Has the client changed (a new CoA patch) since its game tables were extracted? Then they are extracted again.
function clientChanged(folder, client) {
  let answer = null;
  return new Promise(resolve => {
    const child = spawn(path.join(folder, PYTHON), ['-B', SCRIPT, 'client-changed', '--client', client], { cwd: folder, windowsHide: true });
    let out = '';
    child.stdout.on('data', chunk => { out += chunk; });
    child.once('exit', () => { try { answer = JSON.parse(out.trim().split(/\r?\n/).pop()); } catch {} resolve(!!answer?.changed); });
    child.once('error', () => resolve(false));
  });
}

// The game files as the player kept them ("Keep my modified files"): names, sizes and dates of its archives, read by
// the launcher itself (any package version). The banner comes back only when they change again.
const KEPT = '.coa-launcher/client-kept.json';
function clientPrint(client) {
  const hash = require('node:crypto').createHash('sha256');
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (/\.mpq$/i.test(entry.name)) { const stat = fs.statSync(file); hash.update(`${path.relative(client, file).toLowerCase()}|${stat.size}|${Math.floor(stat.mtimeMs / 1000)}\n`); }
    }
  };
  try { walk(path.join(client, 'Data')); } catch { return ''; }
  return hash.digest('hex');
}
function keepClient(folder, client) {
  fs.mkdirSync(path.join(folder, '.coa-launcher'), { recursive: true });
  fs.writeFileSync(path.join(folder, KEPT), JSON.stringify({ client: path.resolve(client), fingerprint: clientPrint(client), at: new Date().toISOString() }, null, 2));
}
function clientKept(folder, client) {
  try {
    const kept = JSON.parse(fs.readFileSync(path.join(folder, KEPT), 'utf8'));
    return kept.client.toLowerCase() === path.resolve(client).toLowerCase() && !!kept.fingerprint && kept.fingerprint === clientPrint(client);
  } catch { return false; }
}
function forgetKept(folder) { try { fs.rmSync(path.join(folder, KEPT), { force: true }); } catch {} }

module.exports = { state, assemble, startMmaps, stopMmaps, rebuildMmaps, clientChanged, keepClient, clientKept, forgetKept, clientPrint, worldImport, fetchMmaps, STEPS, busy };
