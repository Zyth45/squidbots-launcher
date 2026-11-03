'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { preparedPorts, keepPorts } = require('../src/repack-import.cjs');

const ports = { mysqlPort: 13307, authPort: 3725, worldPort: 8095, raPort: 3444, raUsername: 'local', raPassword: 'local' };

function folder(files = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'coa-imp-'));
  for (const [name, text] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true }); fs.writeFileSync(path.join(root, name), text); }
  return root;
}

test('a folder made with other ports is installed there, its ports kept over the package', async () => {
  const root = folder({ 'Settings/repack.json': '﻿' + JSON.stringify(ports) });
  assert.deepEqual(await preparedPorts(root), ports);
  // The package brings its own repack.json (default ports, and a new option).
  fs.writeFileSync(path.join(root, 'Settings', 'repack.json'), JSON.stringify({ mysqlPort: 3306, authPort: 3724, worldPort: 8085, raPort: 3443, newOption: true }));
  await keepPorts(root, ports);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, 'Settings', 'repack.json'), 'utf8')), { ...ports, newOption: true });
});

test('any other folder is not taken for a prepared one', async () => {
  assert.equal(await preparedPorts(folder()), null);
  assert.equal(await preparedPorts(folder({ 'Settings/repack.json': JSON.stringify(ports), 'Core/worldserver.exe': '' })), null);
  assert.equal(await preparedPorts(folder({ 'Settings/repack.json': JSON.stringify(ports), 'Settings/other.json': '{}' })), null);
  assert.equal(await preparedPorts(folder({ 'Settings/repack.json': 'not json' })), null);
  assert.equal(await preparedPorts(path.join(os.tmpdir(), 'coa-imp-missing-folder')), null);
});
