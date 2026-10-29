'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tempDir } = require('./helpers.cjs');
const assembler = require('../src/assembler.cjs');

test('kept game files stay accepted until they change again, and are forgotten after a data update', async () => {
  const server = await tempDir();
  const client = await tempDir();
  fs.mkdirSync(path.join(client, 'Data', 'frFR'), { recursive: true });
  fs.writeFileSync(path.join(client, 'Data', 'patch-Z.MPQ'), 'modified by the player');
  fs.writeFileSync(path.join(client, 'Data', 'frFR', 'locale-frFR.MPQ'), 'locale');
  assert.equal(assembler.clientKept(server, client), false);
  assembler.keepClient(server, client);
  assert.equal(assembler.clientKept(server, client), true);
  // Changed again: the banner comes back.
  fs.writeFileSync(path.join(client, 'Data', 'patch-Y.MPQ'), 'another change');
  assert.equal(assembler.clientKept(server, client), false);
  assembler.keepClient(server, client);
  assembler.forgetKept(server);
  assert.equal(assembler.clientKept(server, client), false);
});
