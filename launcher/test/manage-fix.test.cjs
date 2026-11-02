'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { fixText, OLD } = require('../src/manage-fix.cjs');

const shipped = eol => ['import socket', '', ...OLD, '', ''].join(eol);

test('manage.py: listeners() reads the listener table (26H2), CRLF kept, applied once', () => {
  for (const eol of ['\n', '\r\n']) {
    const fixed = fixText(shipped(eol));
    assert.match(fixed, /_listener_rows\(socket\.AF_INET6, 56, 20, 52\)/);
    assert.doesNotMatch(fixed, /row\[0\] == 2/);
    if (eol === '\r\n') assert.ok(!/[^\r]\n/.test(fixed), 'every line ends with CRLF');
    else assert.ok(!fixed.includes('\r'));
    assert.equal(fixText(fixed), fixed);
  }
});

test('manage.py written another way is left as it is', () => {
  const other = 'import socket\ndef listeners():\n    return []\n';
  assert.equal(fixText(other), other);
});

test('coa_common.py listeners() is fixed once, CRLF kept', () => {
  const { COMMON_OLD, COMMON_NEW } = require('../src/manage-fix.cjs');
  const text = `import os\r\n\r\n${COMMON_OLD.join('\r\n')}\r\n\r\n# ---\r\n`;
  const once = fixText(text, COMMON_OLD, COMMON_NEW);
  assert.ok(once.includes(COMMON_NEW.join('\r\n')));
  assert.ok(!/[^\r]\n/.test(once));
  assert.equal(fixText(once, COMMON_OLD, COMMON_NEW), once);
});

test('processes_under() skips every process of its parent exe, once', async () => {
  const fs = require('node:fs/promises');
  const os = require('node:os');
  const path = require('node:path');
  const { PROC_OLD, PROC_NEW, fixUpdateTool } = require('../src/manage-fix.cjs');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'coa-proc-'));
  const file = path.join(root, 'update', 'coa_common.py');
  await fs.mkdir(path.dirname(file));
  await fs.writeFile(file, `def processes_under(folder, names=None):\r\n${PROC_OLD.join('\r\n')}\r\n    return out\r\n`);
  assert.equal(await fixUpdateTool(root), true);
  const once = await fs.readFile(file, 'utf8');
  assert.ok(once.includes(PROC_NEW.join('\r\n')));
  assert.equal(await fixUpdateTool(root), false);
  await fs.rm(root, { recursive: true, force: true });
});
