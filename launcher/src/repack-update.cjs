'use strict';
// Updates of the repack (core, CoA Bots, addon, dashboard) from the releases of squidbots-updates.
// The launcher does not copy a single file of the repack itself: it downloads the signed update package, checks
// its fingerprint, puts its folder in the repack, then runs the package's own tool (coa_update.py) with --json:
// checks, backup, clean stop, files, bot database, test start, undo and the finishing of a cut update all stay
// in that tool, the same one a player runs by hand and the one every release is tested with.
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const { spawn, execFile } = require('node:child_process');
const { downloadObject } = require('./downloader.cjs');
const { fixManage, fixUpdateTool } = require('./manage-fix.cjs');

const text = (value, max) => String(value ?? '').slice(0, max);
const RELEASE = /^main-\d{8}-[0-9a-f]{7,40}$/;
const FOLDER = /^CoA-Update-[0-9A-Za-z.-]{1,20}$/;

// Versions like 2.4, 2.5-beta.1, 3.0-test-a57, 2.5: number by number, then a stable version above a beta or test
// build of the same number (a server on 3.0-test-a57 is offered 3.0).
function compareVersions(a, b) {
  const key = value => {
    const match = /^(\d+(?:\.\d+)*)(.*)$/.exec(String(value || '').trim()) || [null, '0', ''];
    return { nums: match[1].split('.').map(Number), beta: /alpha|beta|rc|pre|test|dev/i.test(match[2]), step: Number(/(\d+)/.exec(match[2])?.[1] || 0) };
  };
  const x = key(a), y = key(b);
  for (let i = 0; i < Math.max(x.nums.length, y.nums.length); i++) if ((x.nums[i] || 0) !== (y.nums[i] || 0)) return (x.nums[i] || 0) - (y.nums[i] || 0);
  if (x.beta !== y.beta) return x.beta ? -1 : 1;
  return x.step - y.step;
}

// The manifest (update.json + update.json.sig): what the latest update is and which releases it updates.
function cleanManifest(data) {
  if (!data || typeof data !== 'object') throw new Error('The update list is malformed.');
  const pkg = data.package || {};
  if (!RELEASE.test(data.release || '')) throw new Error('The update list has no valid release.');
  if (!/^[0-9a-f]{64}$/.test(pkg.sha256 || '') || !(pkg.size > 0) || !FOLDER.test(pkg.folder || '') || !/^(https:\/\/|http:\/\/(127\.0\.0\.1|localhost)[:/])/.test(pkg.url || '')) {
    throw new Error('The update list has no valid package.');
  }
  // More zips when the package is too big for one file (each one holds the same CoA-Update-x folder).
  const parts = (Array.isArray(pkg.parts) ? pkg.parts : []).slice(0, 8).map(part => {
    if (!/^[0-9a-f]{64}$/.test(part?.sha256 || '') || !(part.size > 0) || !/^(https:\/\/|http:\/\/(127\.0\.0\.1|localhost)[:/])/.test(part.url || '')) throw new Error('The update list has an invalid package part.');
    // A part can say which installed releases need it (the maps of 2.5: only for a server older than 2.5).
    const from = Array.isArray(part.from) ? part.from.filter(item => RELEASE.test(item)) : null;
    return { url: part.url, sha256: part.sha256, size: Number(part.size), ...(from ? { from } : {}) };
  });
  return {
    version: text(data.version, 20),
    // A beta is signed as such: a launcher that does not take betas never installs it.
    channel: data.channel === 'beta' ? 'beta' : 'stable',
    release: data.release,
    from: (Array.isArray(data.from) ? data.from : []).filter(item => RELEASE.test(item)),
    publishedAt: text(data.publishedAt, 40),
    notes: text(data.notes, 60000),
    // The same notes in French and Russian, when the release has them.
    notesI18n: Object.fromEntries(['fr', 'ru', 'zh'].filter(lang => typeof data.notesI18n?.[lang] === 'string').map(lang => [lang, text(data.notesI18n[lang], 60000)])),
    notice: typeof data.notice === 'string' ? { en: text(data.notice, 600) } : data.notice && typeof data.notice === 'object' ? Object.fromEntries(['en', 'fr', 'ru', 'zh'].filter(lang => typeof data.notice[lang] === 'string').map(lang => [lang, text(data.notice[lang], 600)])) : null,
    diskBytes: Number.isSafeInteger(data.diskBytes) && data.diskBytes > 0 ? data.diskBytes : 0,
    minLauncher: /^\d+(\.\d+){0,3}$/.test(data.minLauncher || '') ? data.minLauncher : '',
    package: { url: pkg.url, sha256: pkg.sha256, size: Number(pkg.size), folder: pkg.folder, parts },
  };
}

// What is installed in a repack folder.
function installed(folder) {
  const read = file => { try { return JSON.parse(fsSync.readFileSync(path.join(folder, file), 'utf8').replace(/^\uFEFF/, '')); } catch { return null; } };
  return {
    release: read('RELEASE.json')?.releaseId || null,
    bots: read('CoA-Bots/release.json')?.version || null,
    // coa_update.py leaves this file while an update runs: present at start = an update was cut.
    cut: fsSync.existsSync(path.join(folder, 'Backups', 'update-in-progress.json')),
  };
}

// current | available | unsupported (a release this update does not take) | cut | none (no list read yet).
function status(folder, manifest) {
  const here = installed(folder);
  if (here.cut) return { state: 'cut', here, manifest };
  if (!manifest) return { state: 'none', here, manifest };
  if (here.release === manifest.release) return { state: 'current', here, manifest };
  if (manifest.from.includes(here.release)) return { state: 'available', here, manifest: forRelease(manifest, here.release) };
  // A tester on a beta newer than the stable version offered: nothing to do until a newer one comes.
  if (here.bots && compareVersions(here.bots, manifest.version) > 0) return { state: 'current', ahead: true, here, manifest };
  return { state: 'unsupported', here, manifest };
}

// The update package: downloaded once into the launcher's cache, its fingerprint checked, then unpacked into the
// repack (the zip holds one CoA-Update-x folder). An older copy of that folder is replaced.
// The update as this server takes it: the parts it already has (listed for other releases only) are left out.
function forRelease(manifest, release) {
  if (!manifest?.package?.parts?.length) return manifest;
  return { ...manifest, package: { ...manifest.package, parts: manifest.package.parts.filter(part => !part.from || part.from.includes(release)) } };
}

// The whole download (main zip and its parts), for the progress bar and the big update notice.
const packageSize = manifest => manifest.package.size + (manifest.package.parts || []).reduce((sum, part) => sum + part.size, 0);

async function fetchPackage(manifest, cacheDir, { fetchImpl, signal, onBytes }) {
  const files = [{ url: manifest.package.url, sha256: manifest.package.sha256, size: manifest.package.size }, ...(manifest.package.parts || [])];
  const zips = [];
  let before = 0;
  for (const file of files) {
    const zip = path.join(cacheDir, `${file.sha256}.zip`);
    // GitHub serves release files through a redirect; the fingerprint is checked whatever the host.
    await downloadObject({ url: new URL(file.url), size: file.size, sha256: file.sha256, destination: zip, signal, fetchImpl, onBytes: have => onBytes?.(before + have), redirect: 'follow' });
    before += file.size;
    zips.push(zip);
  }
  return zips;
}

async function unpack(zips, folder, packageFolder, onZip = () => {}) {
  const target = path.join(folder, packageFolder);
  await fs.rm(target, { recursive: true, force: true });
  const tar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
  const list = [].concat(zips);
  for (const [index, zip] of list.entries()) {
    onZip(index + 1, list.length);
    await new Promise((resolve, reject) => execFile(tar, ['-xf', zip, '-C', folder], { windowsHide: true, maxBuffer: 1 << 20 }, error => (error ? reject(new Error(`The update could not be unpacked: ${error.message}`)) : resolve())));
  }
  if (!fsSync.existsSync(path.join(target, 'update', 'coa_update.py'))) throw new Error('The update package does not hold its update tool.');
  return target;
}

// Runs the package's tool. Every line it prints is one JSON event; the last error event carries the code.
function runTool(folder, packageFolder, command, extra, onEvent) {
  const python = path.join(folder, 'Runtime', 'python', 'python.exe');
  const tool = path.join(folder, packageFolder, 'update', 'coa_update.py');
  const args = ['-B', '-X', 'utf8', tool, command, '--json', '--yes', '--repack', folder, ...extra];
  // A launcher installed inside the repack is not « a program of the repack still running » (code 13).
  // The files of a package before 2.9 bring back the manage.py and coa_common.py that Windows 26H2 stops (code 50
  // at the test start): fixed again as soon as they are laid, while the installer runs.
  const refix = () => fixManage(folder).catch(() => false);
  return Promise.all([fixUpdateTool(path.join(folder, packageFolder)).catch(() => false), refix()]).then(() => new Promise(resolve => {
    const child = spawn(python, args, { cwd: path.join(folder, packageFolder), windowsHide: true, env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
    // Decoded as a stream: a character cut between two chunks is not broken.
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    const result = { code: null, error: null, details: [], log: [] };
    let buffer = '';
    const line = raw => {
      const value = raw.trim();
      if (!value) return;
      let event;
      try { event = JSON.parse(value); } catch { event = { event: 'info', text: value }; }
      result.log.push(`${event.time || ''} [${event.event}] ${event.text || ''}`.trim());
      if (result.log.length > 400) result.log.shift();
      if (event.event === 'error') { result.error = { code: Number(event.code) || 0, text: text(event.text, 2000) }; result.details = []; }
      if (event.event === 'detail' && result.error) result.details.push(text(event.text, 500));
      if (/^files laid/.test(event.text || '')) refix();
      onEvent(event);
    };
    child.stdout.on('data', chunk => { buffer += chunk; const lines = buffer.split(/\r?\n/); buffer = lines.pop(); lines.forEach(line); });
    child.stderr.on('data', chunk => chunk.split(/\r?\n/).forEach(raw => raw.trim() && result.log.push(`[stderr] ${raw.trim()}`)));
    child.on('error', error => { result.error = { code: 1, text: `The update tool could not be started: ${error.message}` }; });
    child.on('close', code => { if (buffer) line(buffer); result.code = result.error && code === 0 ? result.error.code : code; resolve(result); });
  }));
}

// An update without game data (2.8 onwards) does not carry the core's public SQL: its manifest lists them with their
// SHA-256, and they are taken here from the public archive at the release commit (coa_assemble.py fill-sql), before
// coa_update.py checks and applies the package as usual. Returns false for a package that carries its SQL.
// The public SQL of a package without game data, without the whole archive of the core (334 MB for 2.9.2): nearly all
// of them are already in the repack (same sha256), the package's own ones are in its Assembler/overlay, and the few
// left are taken one by one from the public repository at the release commit. Each file is checked by its sha256
// (coa_update.py checks them again). Returns null when the archive is still needed: too many files missing, a
// repository not named in assemble.json, or a file that could not be taken.
const SQL_TREE = 'Source/sql-tree/';
const SQL_MAX_FETCH = 300;
const sha256Of = bytes => require('node:crypto').createHash('sha256').update(bytes).digest('hex');

async function fillSqlLocal(folder, packageFolder, { fetchImpl = fetch, onEvent = () => {}, wait = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  const base = path.join(folder, packageFolder);
  let files, sql;
  try {
    files = JSON.parse(await fs.readFile(path.join(base, 'update', 'manifest.json'), 'utf8')).files;
    sql = JSON.parse(await fs.readFile(path.join(base, 'payload', 'Assembler', 'assemble.json'), 'utf8')).sql;
  } catch { return null; }
  if (!/^[\w.-]+\/[\w.-]+$/.test(sql?.repo || '') || !/^[0-9a-f]{40}$/.test(sql?.commit || '')) return null;
  const wanted = Object.entries(files || {}).filter(([name, info]) => name.startsWith(SQL_TREE) && /^[0-9a-f]{64}$/.test(info?.sha256 || ''))
    .map(([name, info]) => ({ name, rel: name.slice(SQL_TREE.length), sha256: info.sha256 }))
    .filter(file => file.rel && !file.rel.split('/').some(part => !part || part === '..') && !/^[A-Za-z]:/.test(file.rel));
  const stats = { total: wanted.length, copied: 0, fetched: 0, bytes: 0 };
  const lay = async (file, bytes) => {
    const target = path.join(base, 'payload', ...file.name.split('/'));
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, bytes);
  };
  const report = () => onEvent({ event: 'sql', local: true, done: stats.copied + stats.fetched, ...stats });
  const missing = [];
  // Sixteen local files at a time (read, hashed, laid): the disk, not the network.
  const local = async file => {
    let found = null;
    // Already in the package, in the repack, in the package's overlay, or an archived update (laid empty).
    for (const source of [path.join(base, 'payload', ...file.name.split('/')), path.join(folder, ...file.name.split('/')), path.join(base, 'payload', 'Assembler', 'overlay', ...file.rel.split('/'))]) {
      const bytes = await fs.readFile(source).catch(() => null);
      if (bytes && sha256Of(bytes) === file.sha256) { found = bytes; break; }
    }
    if (!found && sha256Of(Buffer.alloc(0)) === file.sha256) found = Buffer.alloc(0);
    if (found) { await lay(file, found); stats.copied++; if (stats.copied % 250 === 0) report(); } else missing.push(file);
  };
  const pending = [...wanted];
  await Promise.all(Array.from({ length: Math.min(16, pending.length) }, async () => { while (pending.length) await local(pending.shift()); }));
  report();
  if (missing.length > SQL_MAX_FETCH) return null;
  // Four at a time; a 429 or a 5xx is tried again after a pause, then the archive takes over.
  const take = async file => {
    const url = `https://raw.githubusercontent.com/${sql.repo}/${sql.commit}/${file.rel.split('/').map(encodeURIComponent).join('/')}`;
    for (let attempt = 0; attempt < 4; attempt++) {
      let response = null;
      try { response = await fetchImpl(url, { redirect: 'follow', signal: AbortSignal.timeout(60000) }); } catch {}
      if (response?.ok) {
        const bytes = Buffer.from(await response.arrayBuffer());
        if (sha256Of(bytes) !== file.sha256) return false;
        await lay(file, bytes);
        stats.fetched++;
        stats.bytes += bytes.length;
        report();
        return true;
      }
      if (response && response.status !== 429 && response.status < 500) return false;
      const later = Number(response?.headers?.get?.('retry-after'));
      await wait(Number.isFinite(later) && later > 0 && later <= 30 ? later * 1000 : [2000, 5000, 10000][attempt] || 10000);
    }
    return false;
  };
  const queue = [...missing];
  let failed = false;
  await Promise.all(Array.from({ length: Math.min(4, queue.length) }, async () => {
    while (queue.length && !failed) if (!(await take(queue.shift()))) failed = true;
  }));
  return failed ? null : stats;
}

async function fillSql(folder, packageFolder, onEvent = () => {}, options = {}) {
  const marker = path.join(folder, packageFolder, 'update', 'sql-source.json');
  if (!fsSync.existsSync(marker)) return false;
  const local = await fillSqlLocal(folder, packageFolder, { ...options, onEvent }).catch(() => null);
  if (local) { onEvent({ event: 'sql', local: true, finished: true, ...local, done: local.total }); return local; }
  const tool = path.join(folder, packageFolder, 'payload', 'Assembler', 'coa_assemble.py');
  const python = path.join(folder, 'Runtime', 'python', 'python.exe');
  const args = ['-B', '-X', 'utf8', tool, '--json', 'fill-sql', '--into', path.join(folder, packageFolder, 'payload'), '--manifest', path.join(folder, packageFolder, 'update', 'manifest.json')];
  await new Promise((resolve, reject) => {
    const child = spawn(python, args, { cwd: path.join(folder, packageFolder), windowsHide: true, env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
    let buffer = '';
    let failure = '';
    child.stdout.on('data', chunk => {
      buffer += chunk.toString('utf8');
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop();
      for (const raw of lines) {
        let event = null;
        try { event = JSON.parse(raw); } catch { continue; }
        if (event.event === 'error') failure = event.message;
        // The public SQL of the core (a few hundred MB from GitHub): its bytes, then the files taken out of it.
        else if (event.event === 'step') onEvent({ event: 'sql', done: 0 });
        else if (event.event === 'progress') onEvent({ event: 'sql', done: Number(event.done) || 0, unpacking: event.text === 'unpacking' });
      }
    });
    child.once('error', reject);
    child.once('close', code => (code === 0 ? resolve() : reject(new Error(failure || `The public SQL could not be prepared (code ${code}).`))));
  });
  return true;
}

module.exports = { cleanManifest, compareVersions, forRelease, packageSize, installed, status, fetchPackage, unpack, runTool, fillSql, fillSqlLocal };
