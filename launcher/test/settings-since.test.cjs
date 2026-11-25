'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const since = require('../src/settings-since.cjs');
const TABLE = require('../src/data/settings-since.json');
const { sanitize } = require('../src/settings.cjs');

// What's new of the settings (3.2): the table shipped with the launcher, the previous version kept at its update.
test('the « since » table matches the catalog shipped (run scripts/settings-since.cjs after a manifest change)', () => {
  assert.equal(TABLE.catalog, since.signature(require('../src/data/server-settings.json'), require('../src/data/living-world.json')));
  // The 3.2 keys of the module came with 0.4.7, the 3.2.2 enchanting keys came with 0.5.0, the 3.3.1 gear history is new in the next launcher, the 3.1.6 combat defaults changed in 0.4.5.
  assert.equal(TABLE.keys['playerbots.conf|AiPlayerbot.CoaSelfFound.Rolls'].added, '0.4.7');
  assert.equal(TABLE.keys['playerbots.conf|AiPlayerbot.CoaEconomy.EnchantForSelf.PiecesPerStudy'].added, '0.5.0');
  assert.equal(TABLE.keys['playerbots.conf|AiPlayerbot.CoaWorld.ItemEvent.Enable'].added, TABLE.next);
  assert.deepEqual(TABLE.keys['playerbots.conf|AiPlayerbot.CoaCombat.LootNeedMinUpgradePct']?.defaults?.at(-1)?.slice(1), ['0', '10']);
});

test('since a previous launcher: the new settings and the changed defaults, nothing without a previous version', () => {
  const table = { keys: {
    'a.conf|Old': {},
    'a.conf|New': { added: '0.4.7' },
    'a.conf|Older': { added: '0.4.5' },
    'a.conf|Flip': { defaults: [['0.4.5', '0', '1']] },
    'a.conf|Twice': { defaults: [['0.4.6', '0', '1'], ['0.4.7', '1', '2']] },
    'a.conf|Back': { defaults: [['0.4.6', '0', '1'], ['0.4.7', '1', '0']] },
  } };
  assert.deepEqual(since.since(table, ''), []);
  assert.deepEqual(since.since(table, 'garbage'), []);
  const list = since.since(table, '0.4.5');
  assert.deepEqual(list.map(entry => entry.key).sort(), ['New', 'Twice']);
  assert.deepEqual(list.find(entry => entry.key === 'Twice'), { file: 'a.conf', key: 'Twice', version: '0.4.7', kind: 'default', from: '0', to: '2' });
  assert.deepEqual(since.since(table, '0.4.4').map(entry => entry.key).sort(), ['Flip', 'New', 'Older', 'Twice']);
  // The real table: from 0.4.6, the 19 keys of 3.2.
  assert.equal(since.since(TABLE, '0.4.6').filter(entry => entry.kind === 'new').length >= 19, true);
});

test('the previous version is kept once per launcher update, never on a fresh install or a downgrade', () => {
  assert.equal(since.previousOnStart({ lastSeenVersion: '0.4.6' }, '0.4.7', true), null);
  assert.deepEqual(since.previousOnStart({ lastSeenVersion: '0.4.6' }, '0.4.7', false), { lastSeenVersion: '0.4.6', previousVersion: '0.4.6', previousFor: '0.4.7' });
  // Already kept for this launcher (the notes seen since: lastSeenVersion is now 0.4.7): unchanged.
  assert.equal(since.previousOnStart({ lastSeenVersion: '0.4.7', previousVersion: '0.4.6', previousFor: '0.4.7' }, '0.4.7', false), null);
  assert.equal(since.previousOnStart({ lastSeenVersion: '0.4.8' }, '0.4.7', false), null);
  assert.equal(since.previousOnStart({ lastSeenVersion: '' }, '0.4.7', false), null);
  // The next update replaces it.
  assert.equal(since.previousOnStart({ lastSeenVersion: '0.4.7', previousVersion: '0.4.6', previousFor: '0.4.7' }, '0.4.8', false).previousVersion, '0.4.7');
  // The settings file keeps both, and only versions.
  assert.deepEqual([sanitize({ previousVersion: '0.4.6', previousFor: '0.4.7' }).previousVersion, sanitize({ previousVersion: 'x' }).previousVersion], ['0.4.6', '']);
});
