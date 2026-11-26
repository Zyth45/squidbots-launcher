'use strict';
// "Stop all" with extra realms alive (bench 26/11, 3 realms: a realm still loading lost its shutdown, MySQL was then
// stopped under a realm and its world ended in ABORT [2003]). The worlds here are small Node processes: a port that
// opens after a load time, and a remote console (RA) that obeys "server shutdown", the first ones lost if asked.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const realms = require('../src/realms.cjs');

const WORLD = `
const net = require('net'); const fs = require('fs'); const path = require('path');
const [worldPort, raPort, openAfter, lost, logs] = process.argv.slice(2);
let ignore = Number(lost);
fs.mkdirSync(logs, { recursive: true });
setInterval(() => fs.appendFileSync(path.join(logs, 'world-console.log'), '.'), 100);
if (Number(openAfter) >= 0) setTimeout(() => {
  net.createServer(() => {}).listen(Number(worldPort), '127.0.0.1');
  net.createServer(socket => {
    let step = 0;
    socket.on('error', () => {});
    socket.write('Username:');
    socket.on('data', data => {
      const text = data.toString();
      if (step === 0) { step = 1; socket.write('Password:'); }
      else if (step === 1) { step = 2; socket.write('AC>'); }
      else if (/server shutdown/.test(text)) {
        if (ignore-- > 0) { socket.write('AC>'); return; }
        socket.write('Shutdown in 1s\\r\\nAC>');
        setTimeout(() => process.exit(0), 200);
      } else socket.write('AC>');
    });
  }).listen(Number(raPort), '127.0.0.1');
}, Number(openAfter));
`;

const freePort = () => new Promise(resolve => { const server = net.createServer().listen(0, '127.0.0.1', () => { const { port } = server.address(); server.close(() => resolve(port)); }); });
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };

function repack() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'coa-stop-'));
  fs.mkdirSync(path.join(root, 'Royaumes'), { recursive: true });
  fs.mkdirSync(path.join(root, 'Settings'), { recursive: true });
  fs.writeFileSync(path.join(root, 'Settings', 'repack.json'), JSON.stringify({ raUsername: 'local', raPassword: 'local' }));
  fs.writeFileSync(path.join(root, 'world.js'), WORLD);
  return root;
}
// A realm and its world: openAfter ms of load (-1: never opens), `lost` shutdown orders ignored.
async function realm(root, key, name, { openAfter = 0, lost = 0 } = {}) {
  const dir = path.join(root, 'Royaumes', key);
  fs.mkdirSync(dir, { recursive: true });
  const worldPort = await freePort();
  const raPort = await freePort();
  fs.writeFileSync(path.join(dir, 'realm.json'), JSON.stringify({ key, id: { wildcard: 2, reborn: 3, living: 5 }[key], name, worldPort, raPort }));
  const child = spawn(process.execPath, [path.join(root, 'world.js'), worldPort, raPort, openAfter, lost, path.join(dir, 'Logs')], { stdio: 'ignore' });
  fs.writeFileSync(path.join(dir, '.state.json'), JSON.stringify({ pid: child.pid }));
  return child;
}
const fast = () => Object.assign(realms.stopTiming, { load: 8000, save: 8000, resend: 400, poll: 100 });
const ended = child => (child.exitCode !== null ? Promise.resolve() : new Promise(resolve => child.once('exit', resolve)));

test('stop all: a realm still loading is waited for and stopped, a lost shutdown is asked again; the base stops last', async () => {
  fast();
  const root = repack();
  const running = await realm(root, 'wildcard', 'Wildcard', { lost: 1 });
  const loading = await realm(root, 'reborn', 'Reborn', { openAfter: 1500 });
  await new Promise(resolve => setTimeout(resolve, 300));
  const order = [];
  const t0 = Date.now();
  await realms.stopServer(root, { worldsLeft: async () => { order.push('check'); return realms.worldsRunning(root); }, stopBase: async () => { order.push('base'); } });
  await Promise.all([ended(running), ended(loading)]);
  assert.ok(!alive(running.pid) && !alive(loading.pid), 'both worlds ended');
  assert.deepStrictEqual(order, ['check', 'base'], 'MySQL (the base) only after every realm ended');
  assert.ok(Date.now() - t0 < 8000, 'no long wait');
  assert.deepStrictEqual(await realms.worldsRunning(root), []);
});

test('stop all: an extra realm still alive at the end (stuck loading) keeps MySQL on and is named', async () => {
  fast();
  realms.stopTiming.load = 1200;
  const root = repack();
  const stuck = await realm(root, 'reborn', 'Warcraft Reborn', { openAfter: -1 });
  await new Promise(resolve => setTimeout(resolve, 300));
  let base = false;
  try {
    await assert.rejects(realms.stopServer(root, { worldsLeft: () => realms.worldsRunning(root), stopBase: async () => { base = true; } }), error => error.code === 'REALM_SAVING' && /Warcraft Reborn is still loading/.test(error.message));
    assert.strictEqual(base, false, 'MySQL never stopped under a living realm');
    assert.ok(alive(stuck.pid), 'a loading world is never killed while its logs move');
  } finally { stuck.kill(); await ended(stuck); }
});

test('stop all: a worldserver of the repack that no realm knows keeps MySQL on (main.cjs counts them)', async () => {
  fast();
  const root = repack();
  let base = false;
  await assert.rejects(realms.stopServer(root, { worldsLeft: async () => ['worldserver.exe (pid 3900)'], stopBase: async () => { base = true; } }), /Still running: worldserver\.exe \(pid 3900\)\. MySQL stays on/);
  assert.strictEqual(base, false);
});

test('stop all: no realm starts while it runs (the queue of "Start all", a restart after a crash)', async () => {
  fast();
  const root = repack();
  const world = await realm(root, 'wildcard', 'Wildcard', { openAfter: 600 });
  const stopping = realms.stopAll(root);
  assert.strictEqual(realms.halted(), true);
  await assert.rejects(realms.start(root, 'wildcard'), /The server is stopping/);
  await stopping;
  await ended(world);
  assert.strictEqual(realms.halted(), false);
  assert.ok(realms.stoppedOnPurpose('wildcard'), 'not taken for a crash');
});
