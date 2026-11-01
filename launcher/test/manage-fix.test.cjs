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
