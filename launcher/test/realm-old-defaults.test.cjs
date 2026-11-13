'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const realms = require('../src/realms.cjs');

const KEY = 'AiPlayerbot.CoaEconomy.LaunchCurve.LaunchPremiumPercent';
function realm(value) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'old-defaults-'));
  const dir = path.join(root, 'Royaumes', 'living');
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(dir, 'configs'));
  fs.writeFileSync(path.join(dir, 'configs', 'worldserver.conf'), '');
  fs.writeFileSync(path.join(dir, 'realm.json'), JSON.stringify({ key: 'living', id: 5, name: 'Malfurion', worldPort: 8485, raPort: 3843 }));
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ 'playerbots.conf': { [KEY]: value, 'AiPlayerbot.CoaEconomy.LaunchCurve.LevelMargin': '5' } }));
  return { root, dir };
}

// Economie, 13/11: a Squid World made before 0.4.3 kept LaunchPremiumPercent 100 (0.4.0) or 150 (first betas) in its
// own settings, written into its configs at each start. It moves to 0 once; any other value is the player's.
test('an old launch premium of a Squid World moves to 0 once; another value, and a value set afterwards, stay', async () => {
  for (const [before, after] of [['100', '0'], ['150', '0'], ['75', '75'], ['0', '0']]) {
    const { root, dir } = realm(before);
    const read = JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8'));
    assert.equal(read['playerbots.conf'][KEY], before);
    // Any read of the realm's own settings applies it (status, start, settings page).
    await realms.status(root, { live: false }).catch(() => null);
    const changed = JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8'));
    assert.equal(changed['playerbots.conf'][KEY], after, `${before} -> ${after}`);
    assert.equal(changed['playerbots.conf']['AiPlayerbot.CoaEconomy.LaunchCurve.LevelMargin'], '5');
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'realm.json'), 'utf8')).moved, ['launch-premium-0']);
    // The player sets 100 again afterwards: kept.
    changed['playerbots.conf'][KEY] = '100';
    fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify(changed));
    await realms.status(root, { live: false }).catch(() => null);
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8'))['playerbots.conf'][KEY], '100');
  }
});
