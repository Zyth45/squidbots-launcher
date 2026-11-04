'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// toolLine and sqlLine of the update window, run apart with an English t() (the window's own scripts need a browser).
const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'update.js'), 'utf8').replace(/\r\n/g, '\n');
const pick = name => source.slice(source.indexOf(`function ${name}(`), source.indexOf('\n}\n', source.indexOf(`function ${name}(`)) + 2);
const context = { t: (key, text, vars = {}) => text.replace(/\{(\w+)\}/g, (_, name) => vars[name] ?? ''), formatNumber: String, formatBytes: n => `${Math.round(n / 1048576)} MB` };
vm.runInNewContext(`${pick('toolLine')}\n${pick('sqlLine')}\nthis.toolLine = toolLine; this.sqlLine = sqlLine;`, context);

test('the questions of coa_update.py answered by --yes are not shown as they are', () => {
  assert.equal(context.toolLine('Stop them now? -> yes (--yes)'), 'Stopping the programs of the server…');
  assert.equal(context.toolLine('CoA Bots is not installed in this repack. Install CoA Bots now? -> yes (--yes)'), 'Installing CoA Bots…');
  assert.equal(context.toolLine('Something else? -> yes (default, no console to ask on)'), null);
  assert.equal(context.toolLine('Servers of this repack are running: worldserver.exe'), 'Programs of the server still running (worldserver.exe): they are stopped first.');
  assert.equal(context.toolLine('Checks: 12 of 40'), 'Checks: 12 of 40');
});

test('the public SQL download tells its size and that it takes a while', () => {
  assert.match(context.sqlLine({ done: 0 }), /few minutes/);
  assert.match(context.sqlLine({ done: 120 * 1048576 }), /120 MB/);
  assert.match(context.sqlLine({ done: 1500, unpacking: true }), /1500 files/);
});
