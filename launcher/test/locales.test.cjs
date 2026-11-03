'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', 'public');
const holes = text => new Set(String(text).match(/\{\w+\}/g) || []);

// Every t('key', 'English text') of the window: a translation uses only the {names} the English text gives.
const defaults = new Map();
for (const file of fs.readdirSync(path.join(root, 'js')).filter(name => name.endsWith('.js'))) {
  const source = fs.readFileSync(path.join(root, 'js', file), 'utf8');
  for (const [, key, text] of source.matchAll(/\bt\('([\w.-]+)', '((?:[^'\\]|\\.)*)'/g)) defaults.set(key, text);
}

for (const lang of ['fr', 'ru', 'zh']) {
  test(`${lang}: the translations use the placeholders of the English text`, () => {
    const strings = JSON.parse(fs.readFileSync(path.join(root, 'locales', `${lang}.json`), 'utf8'));
    const wrong = Object.entries(strings).filter(([key, text]) => defaults.has(key) && [...holes(text)].some(hole => !holes(defaults.get(key)).has(hole))).map(([key]) => key);
    assert.deepEqual(wrong, []);
  });
}

test('the launcher and server update labels are translated in every language', () => {
  const keys = ['settings.launcherLineReady', 'settings.launcherLineChecking', 'settings.launcherLineDownloading', 'settings.launcherLineDownloaded', 'settings.launcherLine', 'settings.launcherUpToDateServer', 'update.serverTitle'];
  for (const lang of ['fr', 'ru', 'zh']) {
    const strings = JSON.parse(fs.readFileSync(path.join(root, 'locales', `${lang}.json`), 'utf8'));
    assert.deepEqual(keys.filter(key => !strings[key]), [], lang);
    assert.ok(defaults.has('update.serverTitle'));
  }
});
