'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { missingMmaps, mapHash } = require('../src/assembler.cjs');

test('maps new in the game are the only ones without navigation; the hash is the one of coa_assemble.py', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mmaps-missing-'));
  const put = (file, size) => { fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); fs.writeFileSync(path.join(root, file), Buffer.alloc(size)); };
  put('Data/maps/0133131.map', 10);
  put('Data/vmaps/013.vmtree', 4);
  put('Data/vmaps/013_31_31.vmtile', 7);
  put('Data/maps/0333131.map', 5);
  put('Data/vmaps/937.vmtree', 3);
  put('Data/maps/0403131.map', 2);
  put('Data/maps/1731000.map', 2);
  put('Data/mmaps/013.mmap', 28);
  put('.state/assemble.json', 0);
  // 13 has its navigation, 173 was built without a file: not missing. 40 could not be built: missing, so that « Add
  // missing » tries it again (SupportDesk, 19/11: maps in failed were never built again).
  fs.writeFileSync(path.join(root, '.state/assemble.json'), JSON.stringify({ mmaps: { maps: { 13: 'old', 173: 'x' }, failed: { 40: 'crash' } } }));
  assert.deepEqual(missingMmaps(root), [33, 40, 937]);
  const expected = crypto.createHash('sha256').update('0133131.map|10\n013.vmtree|4\n013_31_31.vmtile|7\n').digest('hex');
  assert.equal(mapHash(root, 13), expected);
  fs.rmSync(root, { recursive: true, force: true });
});
