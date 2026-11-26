'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { sanitize } = require('../src/settings.cjs');

test('dawnriseAsked: kept once true (« Turn on Dawnrise Island? » never asked twice), false by default', () => {
  assert.strictEqual(sanitize({}).dawnriseAsked, false);
  assert.strictEqual(sanitize({ dawnriseAsked: true }).dawnriseAsked, true);
  assert.strictEqual(sanitize({ dawnriseAsked: 'yes' }).dawnriseAsked, false);
});
