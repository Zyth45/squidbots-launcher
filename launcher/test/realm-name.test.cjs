'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { sameRealmName } = require('../src/realms.cjs');

// 13/11 on the laptop: Squid World renamed « Malfurion » in its card; the page asked for « Squid World », the main
// process wanted « Malfurion », and the reset stopped before anything, with no message the player saw.
test('the reset confirms with the realm\'s own name: case and spaces do not count, accents do', () => {
  assert.equal(sameRealmName('Malfurion', 'Malfurion'), true);
  assert.equal(sameRealmName('  malfurion ', 'Malfurion'), true);
  assert.equal(sameRealmName('MALFURION', 'Malfurion'), true);
  assert.equal(sameRealmName('Squid World', 'Malfurion'), false);
  assert.equal(sameRealmName('Élune  du  Soir', 'élune du soir'), true);
  assert.equal(sameRealmName('Elune du Soir', 'Élune du Soir'), false);
  // The same letters typed composed or decomposed (NFC).
  assert.equal(sameRealmName('Élune', 'Élune'), true);
  assert.equal(sameRealmName('', ''), false);
  assert.equal(sameRealmName(undefined, 'Malfurion'), false);
});

// The page compares the same way as the main process: same rule, written twice (the page cannot require src/).
test('the page and the main process share one rule for the realm name', () => {
  const page = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'realms.js'), 'utf8');
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'realms.cjs'), 'utf8');
  const rule = "String(value || '').normalize('NFC').trim().replace(/\\s+/g, ' ').toLocaleLowerCase()";
  assert.ok(page.includes(rule), 'page rule');
  assert.ok(main.includes(rule), 'main rule');
  // The page asks for the realm's name in the game's list, not the title of its kind.
  assert.match(page, /const name = realmListName\(key\);/);
});
