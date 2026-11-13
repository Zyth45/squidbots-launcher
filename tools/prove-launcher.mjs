#!/usr/bin/env node
// Proves that a launcher installer works before it is published (user's rule, 13/11/2026: "always test before
// pushing a launcher"). Windows only.
//   node tools/prove-launcher.mjs <Setup.exe> --dir <empty install folder> [--previous <app.asar>] [--port 9334]
// 1. Installs the EXACT installer silently in its own folder (never the player's).
// 2. Checks the installed app.asar: every package it ships has its dependencies inside it, every bare require of
//    src/ resolves (the 0.4.1 installer lacked fs-extra and 13 more and could not start). With --previous, the
//    package list is compared with the published version's: a package that disappears refuses the proof.
// 3. Starts the installed launcher with a profile of its own and reads its page over CDP until the home screen
//    shows. An error box ("The launcher could not start") keeps the process alive but has no page: refused.
// Writes <Setup.exe>.proof.json (SHA-512 of the installer, version, packages, home text). publish-launcher.mjs
// publishes nothing without a proof of the same installer.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire, builtinModules } from 'node:module';
import { fileURLToPath } from 'node:url';
import { parseArgs } from './lib.mjs';

const args = parseArgs(process.argv.slice(2));
const [setup] = args._;
const port = Number(args.port || 9334);
if (!setup || !args.dir || !fs.existsSync(setup)) {
  console.log('Usage: node tools/prove-launcher.mjs <Setup.exe> --dir <empty install folder> [--previous <app.asar>] [--port 9334]');
  process.exit(1);
}
const here = path.dirname(fileURLToPath(import.meta.url));
const asar = createRequire(path.join(here, '..', 'launcher', 'package.json'))('@electron/asar');
const fail = message => { console.error(`REFUSED: ${message}`); process.exit(2); };
const dir = path.resolve(args.dir);
if (fs.existsSync(dir) && fs.readdirSync(dir).length) fail(`${dir} is not empty: give a new folder.`);

const sha512 = crypto.createHash('sha512').update(fs.readFileSync(setup)).digest('base64');

// 1. Silent install (NSIS: /D= last, unquoted).
const installed = spawnSync(path.resolve(setup), ['/S', `/D=${dir}`], { stdio: 'inherit' });
if (installed.status !== 0) fail(`the installer exited with ${installed.status}.`);
const exe = fs.readdirSync(dir).find(name => name.endsWith('.exe') && !/^uninstall/i.test(name));
const archive = path.join(dir, 'resources', 'app.asar');
if (!exe || !fs.existsSync(archive)) fail('no launcher or app.asar in the installed folder.');

// 2. The packages of the asar and their dependencies.
const files = asar.listPackage(archive).map(file => file.replace(/\\/g, '/'));
const packagesOf = list => [...new Set(list.map(file => /^\/node_modules\/((?:@[^/]+\/)?[^/]+)/.exec(file)?.[1]).filter(Boolean))].sort();
const packages = packagesOf(files);
const read = file => asar.extractFile(archive, file.replace(/^\//, '').replace(/\//g, path.sep)).toString();
const missing = [];
for (const file of files.filter(file => /^\/node_modules\/(?:.*\/node_modules\/)?(?:@[^/]+\/)?[^/]+\/package\.json$/.test(file))) {
  const base = file.slice(0, -'/package.json'.length);
  const name = JSON.parse(read(file)).name;
  if (!base.endsWith(`/${name}`)) continue;
  for (const dep of Object.keys(JSON.parse(read(file)).dependencies || {})) {
    // Node looks in base/node_modules, then up the tree.
    const parts = base.split('/node_modules/');
    let found = false;
    for (let i = parts.length; i >= 1 && !found; i--) found = files.includes(`${parts.slice(0, i).join('/node_modules/')}/node_modules/${dep}/package.json`);
    if (!found) missing.push(`${name} needs ${dep}`);
  }
}
const builtins = new Set([...builtinModules, 'electron', 'original-fs']);
for (const file of files.filter(file => /^\/src\/.*\.(c?js|mjs)$/.test(file))) {
  for (const match of read(file).matchAll(/require\(\s*['"]([^'"./][^'"]*)['"]\s*\)/g)) {
    const name = match[1].startsWith('@') ? match[1].split('/').slice(0, 2).join('/') : match[1].split('/')[0];
    if (!name.startsWith('node:') && !builtins.has(name) && !packages.includes(name)) missing.push(`${file} requires ${name}`);
  }
}
if (missing.length) fail(`missing in app.asar:\n  ${missing.join('\n  ')}`);
let removed = [];
if (args.previous) {
  const before = packagesOf(asar.listPackage(args.previous).map(file => file.replace(/\\/g, '/')));
  removed = before.filter(name => !packages.includes(name));
  const added = packages.filter(name => !before.includes(name));
  console.log(`packages: ${before.length} before, ${packages.length} now${added.length ? `; added ${added.join(', ')}` : ''}${removed.length ? `; REMOVED ${removed.join(', ')}` : ''}`);
  if (removed.length && !args['allow-removed']) fail(`packages removed since the previous version: ${removed.join(', ')} (--allow-removed if meant).`);
}

// 3. A real start, with a profile of its own, up to the home screen.
const profile = path.join(dir, '..', `${path.basename(dir)}-profile`);
fs.mkdirSync(profile, { recursive: true });
const child = spawn(path.join(dir, exe), [`--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1'], { env: { ...process.env, COA_LAUNCHER_PROFILE: profile }, detached: true, stdio: 'ignore' });
const stop = () => spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
let home = null;
for (let i = 0; i < 60 && !home; i++) {
  await new Promise(resolve => setTimeout(resolve, 1000));
  const page = await fetch(`http://127.0.0.1:${port}/json`).then(r => r.json()).then(list => list.find(item => item.type === 'page')).catch(() => null);
  if (!page) continue;
  home = await new Promise(resolve => {
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    ws.onerror = () => resolve(null);
    ws.onopen = () => ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: "typeof App === 'object' && document.querySelector('nav, header') ? document.body.innerText.slice(0, 200) : ''", returnByValue: true } }));
    ws.onmessage = message => { const data = JSON.parse(message.data); if (data.id === 1) { ws.close(); resolve(data.result?.result?.value || null); } };
  });
}
stop();
if (!home) fail('the installed launcher did not reach its home screen within 60 s (no page: an error box?).');

const version = /"version"\s*:\s*"([^"]+)"/.exec(read('/package.json'))?.[1];
const proof = { installer: path.basename(setup), sha512, version, packages, removed, home: home.replace(/\s+/g, ' ').trim(), at: new Date().toISOString() };
fs.writeFileSync(`${setup}.proof.json`, JSON.stringify(proof, null, 1));
console.log(`PROVED ${proof.installer} ${version}: ${packages.length} packages, all dependencies in place; home screen reached.`);
