'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const net = require('node:net');
const path = require('node:path');
const probe = require('../src/probe.cjs');

test('a world bound to a precise address is seen open there', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'probe-'));
  fs.mkdirSync(path.join(root, 'Settings'));
  fs.writeFileSync(path.join(root, 'Settings', 'worldserver.conf.template'), 'BindIP = "127.0.0.2"\nRa.IP = "0.0.0.0"\n');
  assert.deepEqual(probe.hosts(root), ['127.0.0.2']);
  const server = net.createServer(socket => socket.destroy());
  await new Promise(resolve => server.listen(0, '127.0.0.2', resolve));
  const { port } = server.address();
  assert.equal(await probe.portOpen(port, root), true);
  assert.equal(await probe.hostOf(port, root), '127.0.0.2');
  await new Promise(resolve => server.close(resolve));
  assert.equal(await probe.portOpen(port, root), false);
  fs.rmSync(root, { recursive: true, force: true });
});
