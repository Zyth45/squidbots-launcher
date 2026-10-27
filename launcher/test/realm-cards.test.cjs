'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cards = require('../src/realm-cards.cjs');

const CONF = [
  'RealmCards.Enable = 1',
  'RealmCards.Category = 41',
  'RealmCards.Expansion = 2',
  'RealmCards.GameMode = 11',
  'RealmCards.Image = "Default"',
  'RealmCards.Realm.2.GameMode = 9',
  '',
  'Updates.EnableDatabases = 1',
  '',
].join('\r\n');

test('the defaults: Vanilla, and the official look of the three realms', () => {
  const lines = cards.configLines(cards.clean(cards.DEFAULTS), { coa: 1, wildcard: 2, reborn: 3 }, { perRealm: true });
  assert.equal(lines['RealmCards.Expansion'], '0');
  assert.equal(lines['RealmCards.Realm.1.GameMode'], '11');
  assert.equal(lines['RealmCards.Realm.2.GameMode'], '6');
  assert.equal(lines['RealmCards.Realm.3.GameMode'], '12');
  assert.equal(lines['RealmCards.Realm.2.Image'], '"Darkmoon"');
  assert.equal(lines['RealmCards.Realm.3.DescriptionSpell'], '1397607');
  assert.equal(cards.listName(cards.DEFAULTS.realms.reborn), 'Bronzebeard - Warcraft Reborn');
});

test('an older core gets only the game modes and the expansion', () => {
  const lines = cards.configLines(cards.clean(cards.DEFAULTS), { coa: 1, wildcard: 2 }, { perRealm: false });
  assert.deepEqual(Object.keys(lines).sort(), ['RealmCards.Expansion', 'RealmCards.Image', 'RealmCards.Realm.1.GameMode', 'RealmCards.Realm.2.GameMode']);
});

test('the config keeps its other lines; the per-realm lines are replaced, after RealmCards.Image', () => {
  const lines = cards.configLines(cards.clean(cards.DEFAULTS), { coa: 1, wildcard: 2 }, { perRealm: false });
  const out = cards.rewrite(CONF, lines);
  assert.match(out, /RealmCards\.Expansion = 0\r\n/);
  assert.match(out, /RealmCards\.Image = "Default"\r\nRealmCards\.Realm\.1\.GameMode = 11\r\nRealmCards\.Realm\.2\.GameMode = 6\r\n/);
  assert.ok(!out.includes('GameMode = 9'));
  assert.match(out, /Updates\.EnableDatabases = 1/);
  assert.equal(cards.rewrite(out, lines), out);
});

test('unknown choices fall back to the defaults; a name with "-" is refused', () => {
  const value = cards.clean({ expansion: 7, realms: { coa: { mode: 99, image: 'Nope', description: 5, name: 'My - Realm' } } });
  assert.equal(value.expansion, 0);
  assert.deepEqual(value.realms.coa, cards.DEFAULTS.realms.coa);
});

test('nothing is written before the choice exists, then the template follows it', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cards-'));
  fs.mkdirSync(path.join(root, 'Settings'));
  fs.writeFileSync(path.join(root, 'Settings', 'authserver.conf.template'), CONF);
  assert.deepEqual(await cards.apply(root, { coa: 1 }), []);
  await cards.save(root, cards.DEFAULTS);
  assert.deepEqual(await cards.apply(root, { coa: 1 }), ['Settings/authserver.conf.template']);
  assert.match(fs.readFileSync(path.join(root, 'Settings', 'authserver.conf.template'), 'utf8'), /RealmCards\.Realm\.1\.GameMode = 11/);
});
