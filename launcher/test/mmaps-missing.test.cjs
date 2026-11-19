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

// SupportDesk, 19/11: a work link of Data/.work-mmaps left by a moved or copied repack led to an empty folder and every
// map failed. Before each build the launcher removes a link that leads elsewhere (the link only: its target keeps its
// files), keeps a good one, and sets a real folder aside instead of deleting it.
test('work links of the navigation maps: one leading elsewhere is removed, never its target; a good one is kept', () => {
  const { checkWorkLinks } = require('../src/assembler.cjs');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mmaps-links-'));
  const put = (file, text = 'x') => { fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); fs.writeFileSync(path.join(root, file), text); };
  put('Data/maps/0473131.map');
  put('Data/vmaps/047.vmtree');
  put('old/Data/maps/witness.txt', 'keep me');
  const work = path.join(root, 'Data', '.work-mmaps');
  fs.mkdirSync(work, { recursive: true });
  fs.symlinkSync(path.join(root, 'old', 'Data', 'maps'), path.join(work, 'maps'), 'junction');
  fs.symlinkSync(path.join(root, 'Data', 'vmaps'), path.join(work, 'vmaps'), 'junction');
  assert.deepEqual(checkWorkLinks(root), ['maps']);
  assert.equal(fs.existsSync(path.join(work, 'maps')), false);
  assert.equal(fs.readFileSync(path.join(root, 'old/Data/maps/witness.txt'), 'utf8'), 'keep me');
  assert.equal(fs.realpathSync.native(path.join(work, 'vmaps')).toLowerCase(), fs.realpathSync.native(path.join(root, 'Data', 'vmaps')).toLowerCase());
  // A real (empty) folder where the link should be: set aside, not deleted.
  fs.mkdirSync(path.join(work, 'maps'));
  assert.deepEqual(checkWorkLinks(root), ['maps']);
  assert.equal(fs.readdirSync(work).filter(name => name.startsWith('maps-set-aside-')).length, 1);
  assert.deepEqual(checkWorkLinks(root), []);
  fs.rmSync(root, { recursive: true, force: true });
});
