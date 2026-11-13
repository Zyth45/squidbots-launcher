'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { ServerControl } = require('../src/server-control.cjs');

// The world's start script of CoA 2.9.2 gave up after 20 s on a busy PC (exit 1) while its supervisor still started it.
const freePort = () => new Promise(resolve => { const server = net.createServer().listen(0, '127.0.0.1', () => { const { port } = server.address(); server.close(() => resolve(port)); }); });
function control(port, alive) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'late-'));
  const world = { id: 'world', name: 'Worldserver', port, startTimeout: 10, start: { exe: 'Runtime/python/python.exe', args: ['start-world'], timeout: 10 } };
  const item = new ServerControl({ root, services: [world], commands: {} });
  item.run = async () => { throw new Error('world stopped during startup'); };
  item.processAlive = async id => alive.has(id);
  item.lateDelay = 50;
  return item;
}

test('a world opening its port after the script gave up, its supervisor alive, is started', async () => {
  const port = await freePort();
  const item = control(port, new Set(['supervisor']));
  let server;
  setTimeout(() => { server = net.createServer().listen(port, '127.0.0.1'); }, 300);
  await item.start('world');
  server.close();
});

test('nothing of the world alive any more: the script\'s error is the answer', async () => {
  const item = control(await freePort(), new Set());
  await assert.rejects(item.start('world'), /stopped during startup/);
});

// A fresh 3.0.1 applies its SQL updates at its first start (402 s at Idle priority): past its own time, the world
// waits up to 20 minutes while its logs keep moving, and says so; logs silent for long, it fails at its own time.
test('past its own time, a world whose logs keep moving is still waited for, with « the database is being updated »', async () => {
  const port = await freePort();
  const item = control(port, new Set(['world']));
  item.services[0].startTimeout = 0.2;
  item.logsChanged = () => Date.now();
  const seen = [];
  item.notify = status => seen.push(status[0].updating);
  let server;
  setTimeout(() => { server = net.createServer().listen(port, '127.0.0.1'); }, 600);
  await item.start('world');
  server.close();
  assert.ok(seen.includes(true));
  assert.equal((await item.status())[0].updating, false);
});

test('past its own time, a world whose logs stay silent is stuck: the script\'s error is the answer', async () => {
  const item = control(await freePort(), new Set(['world']));
  item.services[0].startTimeout = 0.2;
  item.logsChanged = () => 0;
  const began = Date.now();
  await assert.rejects(item.start('world'), /stopped during startup/);
  assert.ok(Date.now() - began < 2000);
});
