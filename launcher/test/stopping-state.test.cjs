'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { ServerControl } = require('../src/server-control.cjs');

// Bug seen in 0.4.1-beta.9: Stop on the CoA realm card showed « Starting… ». The world closes its port, then saves its
// bots for a while: its process alive with the port closed read as a world still loading.
const freePort = () => new Promise(resolve => { const server = net.createServer().listen(0, '127.0.0.1', () => { const { port } = server.address(); server.close(() => resolve(port)); }); });
async function control() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stopping-'));
  const world = { id: 'world', name: 'Worldserver', port: await freePort(), start: { exe: 'x.exe', args: [] } };
  const item = new ServerControl({ root, services: [world], commands: {} });
  item.alive = true;
  item.processAlive = async () => item.alive;
  return item;
}
const stateOf = async item => (await item.status())[0].state;

test('a world asked to stop, still saving after its port closed, is « stopping », during and after the stop', async () => {
  const item = await control();
  let during;
  await item.stopping('world', async () => { during = await stateOf(item); });
  assert.equal(during, 'stopping');
  assert.equal(await stateOf(item), 'stopping');
  item.alive = false;
  assert.equal(await stateOf(item), 'stopped');
  // Once it is gone, a process alive again with its port closed is a new start loading.
  item.alive = true;
  assert.equal(await stateOf(item), 'starting');
});

test('a world never asked to stop, its process alive and its port closed, is loading: « starting »', async () => {
  assert.equal(await stateOf(await control()), 'starting');
});
