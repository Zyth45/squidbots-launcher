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

test('the living server opens on the Malfurion background; an untouched card of version 1 moves to it, a changed one stays', async () => {
  assert.equal(cards.DEFAULTS.realms.living.image, 'Malfurion');
  assert.ok(cards.IMAGES.find(image => image.id === 'Malfurion').title);
  assert.deepEqual(['wildcard', 'reborn', 'dawnrise'].map(key => cards.DEFAULTS.realms[key].image), ['Darkmoon', 'Bronzebeard', 'Dawnrise']);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cards-v1-'));
  const write = living => { fs.mkdirSync(path.join(root, 'Settings'), { recursive: true }); fs.writeFileSync(path.join(root, cards.FILE), JSON.stringify({ version: 1, expansion: 0, realms: { living } })); };
  write({ mode: 11, image: 'Thrall1', description: 13977864, name: '', subtitle: 'New server' });
  assert.equal((await cards.read(root)).realms.living.image, 'Malfurion');
  write({ mode: 11, image: 'Thrall1', description: 13977864, name: 'Mon serveur', subtitle: 'New server' });
  assert.equal((await cards.read(root)).realms.living.image, 'Thrall1');
  write({ mode: 11, image: 'Elune', description: 13977864, name: '', subtitle: 'New server' });
  assert.equal((await cards.read(root)).realms.living.image, 'Elune');
  // Renaming the realm keeps its background (the image is chosen per realm, not from its name).
  const saved = await cards.save(root, { ...(await cards.read(root)), realms: { living: { mode: 11, image: 'Malfurion', description: 13977864, name: 'Azeroth Neuf', subtitle: '' } } });
  assert.equal(cards.configLines(saved, { living: 5 }, { perRealm: true })['RealmCards.Realm.5.Image'], '"Malfurion"');
  assert.equal(saved.version, cards.VERSION);
});

test('the live authserver config is reported changed when a card changes, and only then (the launcher restarts the authserver on it)', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cards-live-'));
  fs.mkdirSync(path.join(root, 'Core', 'configs'), { recursive: true });
  fs.writeFileSync(path.join(root, 'Core', 'configs', 'authserver.conf'), CONF);
  // A core that reads the per-realm image and description.
  fs.writeFileSync(path.join(root, 'Core', 'authserver.exe'), 'RealmCards.Realm.%u.DescriptionSpell');
  await cards.save(root, cards.DEFAULTS);
  assert.deepEqual(await cards.apply(root, { coa: 1, living: 5 }), ['Core/configs/authserver.conf']);
  assert.deepEqual(await cards.apply(root, { coa: 1, living: 5 }), []);
  await cards.save(root, { ...cards.DEFAULTS, realms: { ...cards.DEFAULTS.realms, living: { ...cards.DEFAULTS.realms.living, image: 'Elune' } } });
  assert.deepEqual(await cards.apply(root, { coa: 1, living: 5 }), ['Core/configs/authserver.conf']);
});

// 13/11: « Élune du Soir » was saved as an empty name while the card said « Saved »: now refused with a reason.
test('a realm name the list cannot take is refused with a reason, not dropped', async () => {
  const fsx = require('node:fs');
  const os = require('node:os');
  const pathx = require('node:path');
  const cardsModule = require('../src/realm-cards.cjs');
  const root = fsx.mkdtempSync(pathx.join(os.tmpdir(), 'cards-'));
  await assert.rejects(cardsModule.save(root, { realms: { living: { name: 'Élune du Soir' } } }), /cannot be a realm name/);
  await assert.rejects(cardsModule.save(root, { realms: { living: { name: 'Elune - du Soir' } } }), /cannot be a realm name/);
  const saved = await cardsModule.save(root, { realms: { living: { name: 'Elune du Soir' } } });
  assert.equal(saved.realms.living.name, 'Elune du Soir');
});
