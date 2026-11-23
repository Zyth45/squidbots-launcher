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
    mmaps: { done, total, tiles: (mm.tilesDone || 0) + workTiles(folder), tilesTotal: mm.tilesTotal || 0, running: !!mm.running && pidAlive(mm.pid), paused: !!mm.paused && !(mm.running && pidAlive(mm.pid)), current: mm.current ?? null, published: mm.published || '', error: mm.error || '', errorAt: mm.errorAt || 0, failed: Object.keys(mm.failed || {}).length, complete: (total > 0 && done >= total) || (existing && fs.existsSync(path.join(folder, 'Data', 'mmaps'))) },
  };
}

// The assembler of a 2.8.3 package downloads with Python's own certificates, which an antivirus that inspects HTTPS
// breaks: the one bundled here falls back on Windows's curl.exe. It replaces the package's copy (kept as .bak) only
// when that copy has no fallback and knows no command the bundled one lacks (a newer package keeps its own).
const BUNDLED = path.join(__dirname, 'data', 'coa_assemble.py');
const commands = text => [...text.matchAll(/add_parser\("([\w-]+)"/g)].map(match => match[1]);
function refreshScript(folder) {
  try {
    const file = path.join(folder, SCRIPT);
    const current = fs.readFileSync(file, 'utf8');
    if (current.includes('def curl_download(')) return;
    const bundled = fs.readFileSync(BUNDLED, 'utf8');
    if (!commands(current).every(name => commands(bundled).includes(name))) return;
    fs.copyFileSync(file, `${file}.bak`);
    fs.writeFileSync(file, bundled);
  } catch {}
}

// Runs the assembler with --json; each line it prints is an event ({ event, step, done, total, text, message }).
// Detached (the navigation maps, which outlive the launcher): what it prints goes to <log> instead of nowhere, and
// `exit` is filled when it ends while the launcher runs (what it said: error, already running, done).
function run(folder, args, onEvent = () => {}, { detached = false, log = '', onExit = null } = {}) {
  refreshScript(folder);
  const exe = path.join(folder, PYTHON);
  let out = 'ignore';
  if (detached && log) { try { fs.mkdirSync(path.dirname(log), { recursive: true }); out = fs.openSync(log, 'w'); } catch { out = 'ignore'; } }
  const child = spawn(exe, ['-B', '-X', 'utf8', SCRIPT, '--json', ...args], { cwd: folder, windowsHide: true, detached, env: { ...process.env, PYTHONIOENCODING: 'utf-8' }, stdio: detached ? ['ignore', out, out] : ['ignore', 'pipe', 'pipe'] });
  if (detached) {
    if (typeof out === 'number') try { fs.closeSync(out); } catch {}
    const info = { pid: child.pid, exit: null };
    child.once('error', error => { info.exit = { code: -1, error: error.message }; onExit?.(info.exit); });
    child.once('exit', code => { if (info.exit) return; info.exit = { code, ...readRunLog(log) }; onExit?.(info.exit); });
    child.unref();
    return Promise.resolve(info);
  }
  return new Promise((resolve, reject) => {
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
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

// The generator works in Data/.work-mmaps through two junctions to Data/maps and Data/vmaps. The script of a package
// (2.8.4 and later, never replaced by the launcher's copy) keeps a junction that exists, wherever it leads: one left by
// a moved or copied repack leads elsewhere and every map fails (SupportDesk, 19/11). Checked here before each build: a
// link that leads elsewhere is removed (the link only, never its target) and the script makes it again; a real folder
// in its place is set aside, never deleted.
function checkWorkLinks(folder) {
  const work = path.join(folder, 'Data', '.work-mmaps');
  const fixed = [];
  for (const name of ['maps', 'vmaps']) {
    const link = path.join(work, name);
    let info;
    try { info = fs.lstatSync(link); } catch { continue; }
    let leads = '';
    try { leads = fs.realpathSync.native(link); } catch {}
    let want = '';
    try { want = fs.realpathSync.native(path.join(folder, 'Data', name)); } catch {}
    if (leads && want && leads.toLowerCase() === want.toLowerCase()) continue;
    try {
      if (info.isSymbolicLink()) fs.rmdirSync(link);
      else fs.renameSync(link, `${link}-set-aside-${Date.now()}`);
      fixed.push(name);
    } catch {}
  }
  return fixed;
}

// The navigation maps keep being generated when the launcher closes; the next start reads their progress.
const mmapsStarted = new Map();
// What the detached build printed (one JSON event per line): its error, « already being built », done.
function readRunLog(log) {
  const said = { error: '', already: false, done: false, tail: '' };
  let text = '';
  try { text = log ? fs.readFileSync(log, 'utf8') : ''; } catch {}
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let event = null;
    try { event = JSON.parse(line); } catch { said.tail = line.trim(); continue; }
    if (event.event === 'error') said.error = event.message || 'The navigation maps stopped.';
    else if (event.event === 'done') said.done = true;
    else if (event.event === 'log' && /already being built/i.test(event.text || '')) said.already = true;
  }
  return said;
}

const runLog = folder => path.join(folder, 'Assembler', 'logs', 'mmaps-run.log');
const lockFile = folder => path.join(folder, '.state', 'mmaps.lock');
// Builds stopped by the launcher itself (Pause, an update): their end is not an error.
const mmapsStopped = new Map();

// The build ended while the launcher runs: a reason is kept in the state, so that the home page says it (the script
// of a package does not write it itself), unless another build has taken over since.
function mmapsExited(folder, pid, exit) {
  if (Date.now() - (mmapsStopped.get(path.resolve(folder)) || 0) < 120000) return;
  const reason = exit.error || (exit.code && !exit.done ? (exit.tail || `The navigation maps stopped (code ${exit.code}).`) : '');
  if (!reason) return;
  const file = path.join(folder, '.state', 'assemble.json');
  const saved = readJson(file) || {};
  const mm = saved.mmaps = saved.mmaps || {};
  if (mm.running && mm.pid !== pid && pidAlive(mm.pid)) return;
  Object.assign(mm, { running: false, error: String(reason).slice(0, 300), errorAt: Date.now() });
  try { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(saved, null, 1)); } catch {}
}

function startMmaps(folder, threads) {
  const current = state(folder);
  // A second click before the tool has written its state would start a second build: one per minute at most.
  const last = mmapsStarted.get(path.resolve(folder)) || 0;
  if (current.mmaps.running || Date.now() - last < 60000) return Promise.resolve({ pid: null, already: true });
  mmapsStarted.set(path.resolve(folder), Date.now());
  mmapsStopped.delete(path.resolve(folder));
  checkWorkLinks(folder);
  clearStaleLock(folder);
  // A reason given by a build before is no longer true once another one starts.
  const file = path.join(folder, '.state', 'assemble.json');
  const saved = readJson(file);
  if (saved?.mmaps && (saved.mmaps.error || saved.mmaps.errorAt)) {
    delete saved.mmaps.error;
    delete saved.mmaps.errorAt;
    try { fs.writeFileSync(file, JSON.stringify(saved, null, 1)); } catch {}
  }
  let info = null;
  return run(folder, ['mmaps', ...(threads ? ['--threads', String(threads)] : [])], undefined, { detached: true, log: runLog(folder), onExit: exit => mmapsExited(folder, info?.pid, exit) })
    .then(result => { info = result; return result; });
}

// Started, and seen at work: the build writes « running » with its pid once it has read the maps (a few seconds).
// Throws with its reason when it ends first without having built anything (refused, failed). An end with « done »
// before it was seen (nothing to build) is not an error.
async function mmapsStart(folder, threads, { wait = 60000 } = {}) {
  const started = await startMmaps(folder, threads);
  if (started.already) return { started: state(folder).mmaps.running, already: true };
  const begin = Date.now();
  while (Date.now() - begin < wait) {
    await new Promise(resolve => setTimeout(resolve, 1000));
    const saved = readJson(path.join(folder, '.state', 'assemble.json'))?.mmaps || {};
    if (saved.running && pidAlive(saved.pid)) return { started: true, pid: saved.pid };
    if (started.exit) {
      if (started.exit.error) throw new Error(started.exit.error);
      if (started.exit.already) return { started: state(folder).mmaps.running, already: true };
      if (started.exit.done) return { started: false, finished: true };
      throw new Error(started.exit.tail || `The navigation maps did not start (code ${started.exit.code}).`);
    }
  }
  return { started: pidAlive(started.pid), pid: started.pid };
}

// The processes of a build of this repack: the tool that builds the maps (python coa_assemble.py mmaps) and its
// mmaps_generator.
function mmapsProcesses(folder) {
  const dir = path.resolve(folder).replace(/'/g, "''");
  const script = `$dir = '${dir}\\'; Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($dir, [StringComparison]::OrdinalIgnoreCase) -and ($_.Name -eq 'mmaps_generator.exe' -or ($_.Name -eq 'python.exe' -and $_.CommandLine -match 'coa_assemble\\.py.* mmaps( |$)')) } | ForEach-Object { $_.ProcessId }`;
  try {
    return String(require('node:child_process').execFileSync('powershell.exe', ['-NoProfile', '-Command', script], { windowsHide: true, encoding: 'utf8', timeout: 30000 }))
      .split(/\s+/).filter(Boolean).map(Number).filter(Boolean);
  } catch { return []; }
}

// The lock of a build that was killed before it could remove it (an update stopped it in its first seconds, 22/11 on
// the user's PC): its pid is no build of this repack any more, maybe another program now. Removed, or the next build
// would stop at once on « already being built » without a word.
function clearStaleLock(folder, list = null) {
  let pid = 0;
  try { pid = Number(fs.readFileSync(lockFile(folder), 'utf8').trim()) || 0; } catch { return false; }
  if (pid && pidAlive(pid) && (list || mmapsProcesses(folder)).includes(pid)) return false;
  try { fs.rmSync(lockFile(folder), { force: true }); } catch {}
  return true;
}

// A generator left behind (its tool killed or crashed, the state not written): a program of the repack still running,
// which stops every update (code 13). Every mmaps_generator of this repack, and the tool that builds the maps. Returns
// how many were stopped.
function killStray(folder) {
  const pids = mmapsProcesses(folder);
  for (const pid of pids) { try { require('node:child_process').execFileSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); } catch {} }
  if (pids.length) mmapsStopped.set(path.resolve(folder), Date.now());
  return pids.length;
}

// Pause: the build is stopped (its process tree: the tool and mmaps_generator); the maps already finished stay,
// the map in progress is done again when it goes on (startMmaps).
function stopMmaps(folder) {
  const file = path.join(folder, '.state', 'assemble.json');
  const saved = readJson(file) || {};
  const pid = saved.mmaps?.pid;
  mmapsStopped.set(path.resolve(folder), Date.now());
  if (pid && pidAlive(pid)) {
    try { require('node:child_process').execFileSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); } catch {}
  }
  killStray(folder);
  if (saved.mmaps) {
    saved.mmaps.running = false;
    saved.mmaps.paused = true;
    fs.writeFileSync(file, JSON.stringify(saved, null, 1));
  }
  fs.rmSync(path.join(folder, '.state', 'mmaps.lock'), { force: true });
  mmapsStarted.delete(path.resolve(folder));
  return state(folder);
}

// Before an update of the server: the build is paused (its programs would stop the update, code 13); true when it
// ran, so that it goes on after the update.
function pauseForUpdate(folder) {
  const saved = readJson(path.join(folder, '.state', 'assemble.json')) || {};
  const running = !!(saved.mmaps?.running && pidAlive(saved.mmaps.pid));
  if (running) { stopMmaps(folder); return true; }
  // A build in its first seconds has not written « running » yet (it reads the maps first): stopped too, and it goes
  // on after the update like the others. Its lock goes with it (22/11: one left behind stopped the next build).
  const starting = killStray(folder) > 0;
  clearStaleLock(folder, []);
  return starting;
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

// The maps of the game here, counted as the assembler counts them (map_ids): terrain tiles or a vmaps tree.
function mapIds(folder) {
  const ids = new Set();
  const list = dir => { try { return fs.readdirSync(path.join(folder, 'Data', dir)); } catch { return []; } };
  for (const name of list('maps')) { const m = /^(\d{7,})\.map$/i.exec(name); if (m) ids.add(Number(m[1].slice(0, -4))); }
  for (const name of list('vmaps')) { const m = /^(\d+)\.vmtree$/i.exec(name); if (m) ids.add(Number(m[1])); }
  return ids;
}

// The fingerprint of the maps/vmaps a map's navigation is built from (map_hash of coa_assemble.py: names and sizes).
function mapHash(folder, id) {
  const prefix = String(id).padStart(3, '0');
  const files = [];
  for (const dir of ['maps', 'vmaps']) {
    let names = [];
    try { names = fs.readdirSync(path.join(folder, 'Data', dir)); } catch {}
    names = names.filter(name => (dir === 'maps' ? /\.map$/i.test(name) && name.slice(0, -4).slice(0, -4) === prefix : name.split('_')[0].split('.')[0] === prefix));
    names.sort((a, b) => (a.toLowerCase() < b.toLowerCase() ? -1 : a.toLowerCase() > b.toLowerCase() ? 1 : 0));
    for (const name of names) files.push(`${name}|${fs.statSync(path.join(folder, 'Data', dir, name)).size}\n`);
  }
  return require('node:crypto').createHash('sha256').update(files.join('')).digest('hex');
}

// Maps of the game with no navigation at all: new in the game (a client patch) and extracted by « Update the data »
// after the navigation maps were finished. A map the generator could not build is not counted again.
function missingMmaps(folder) {
  const mm = readJson(path.join(folder, '.state', 'assemble.json'))?.mmaps || {};
  let have = new Set();
  try { have = new Set(fs.readdirSync(path.join(folder, 'Data', 'mmaps')).map(name => /^(\d{3,})\.mmap$/i.exec(name)).filter(Boolean).map(m => Number(m[1]))); } catch {}
  // A map that could not be built is missing too: « Add missing » tries it again (SupportDesk, 19/11).
  return [...mapIds(folder)].filter(id => !have.has(id) && !(String(id) in (mm.maps || {}))).sort((a, b) => a - b);
}

// Only the maps without navigation are built: every other map here is taken as built from the data as they are now,
// so the generator leaves it as it is (even one whose data a client patch changed; Rebuild does every map again).
function buildMissingMmaps(folder) {
  const missing = new Set(missingMmaps(folder));
  if (!missing.size || state(folder).mmaps.running) return Promise.resolve({ started: state(folder).mmaps.running, already: true });
  const file = path.join(folder, '.state', 'assemble.json');
  const saved = readJson(file) || {};
  const mm = saved.mmaps = saved.mmaps || {};
  mm.maps = mm.maps || {};
  for (const id of mapIds(folder)) if (!missing.has(id) && !(String(id) in (mm.failed || {}))) mm.maps[String(id)] = mapHash(folder, id);
  for (const id of missing) if (mm.failed) delete mm.failed[String(id)];
  delete mm.paused;
  delete mm.error;
  delete mm.errorAt;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(saved, null, 1));
  mmapsStarted.delete(path.resolve(folder));
  // Said started only once the build is seen at work; its reason otherwise (22/11: « added » with nothing built).
  return mmapsStart(folder);
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

module.exports = { state, assemble, refreshScript, startMmaps, mmapsStart, clearStaleLock, readRunLog, stopMmaps, pauseForUpdate, rebuildMmaps, clientChanged, keepClient, clientKept, forgetKept, clientPrint, worldImport, fetchMmaps, missingMmaps, buildMissingMmaps, mapHash, checkWorkLinks, STEPS, busy };
