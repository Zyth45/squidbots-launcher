'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Dashboard } = require('../src/dashboard.cjs');

// Bench 24/11: the 3.2.2 dashboard's CHANGELOG still starts at 3.1.0; its VERSION file (what the components update
// writes and compares) is the version shown.
test('the dashboard version is its VERSION file, else the first entry of its CHANGELOG', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dash-'));
  const dir = path.join(root, 'CoA-Bots', 'Tools', 'Dashboard');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'squidbots.py'), '');
  fs.writeFileSync(path.join(dir, 'CHANGELOG.md'), '# Changelog\n\n## 3.1.0\n');
  assert.equal((await new Dashboard().status(root)).version, '3.1.0');
  fs.writeFileSync(path.join(dir, 'VERSION'), '3.2.2\r\n');
  assert.equal((await new Dashboard().status(root)).version, '3.2.2');
});
