'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { updateAllowed } = require('../src/repack-update.cjs');
const { ServerControl } = require('../src/server-control.cjs');

// 12/11: a MAJ-TEST launcher updated the player's own server. A test launcher (COA_UPDATE_ONLY_UNDER) updates only
// its copy; a normal launcher (unset) is not limited.
test('a test launcher updates only the folder under its limit', () => {
  assert.equal(updateAllowed('C:\\SquidBots-MAJ30\\CoA-Repack', 'C:\\SquidBots-MAJ30'), true);
  assert.equal(updateAllowed('c:\\squidbots-maj30\\CoA-Repack\\', 'C:\\SquidBots-MAJ30'), true);
  assert.equal(updateAllowed('C:\\CoAserver', 'C:\\SquidBots-MAJ30'), false);
  assert.equal(updateAllowed('C:\\SquidBots-MAJ30-autre', 'C:\\SquidBots-MAJ30'), false);
  assert.equal(updateAllowed('C:\\SquidBots-MAJ30', 'C:\\SquidBots-MAJ30'), false);
  assert.equal(updateAllowed('', 'C:\\SquidBots-MAJ30'), false);
  assert.equal(updateAllowed('C:\\CoAserver', ''), true);
});

// The original running beside its copy: the copy's scripts would take its MySQL for their own.
test('the ports of a server held by another folder\'s programs are named, its own are not', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'guard-'));
  const services = [{ id: 'mysql', name: 'MySQL', port: 3307 }, { id: 'auth', name: 'Authserver', port: 3724 }, { id: 'world', name: 'Worldserver', port: 8085 }];
  const control = new ServerControl({ root, services });
  const owners = { 3307: 'C:\\CoAserver\\mysql\\bin\\mysqld.exe', 3724: path.join(root, 'Core', 'authserver.exe') };
  control.portOwner = async port => (owners[port] ? { pid: 1, file: owners[port], inside: control.inside(owners[port]) } : null);
  assert.deepEqual(await control.foreignListeners(), [{ name: 'MySQL', port: 3307, file: 'C:\\CoAserver\\mysql\\bin\\mysqld.exe' }]);
  delete owners[3307];
  assert.deepEqual(await control.foreignListeners(), []);
});
