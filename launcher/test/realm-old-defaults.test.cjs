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
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'realm.json'), 'utf8')).moved, ['launch-premium-0', 'classic-pack-3.1']);
    // The player sets 100 again afterwards: kept.
    changed['playerbots.conf'][KEY] = '100';
    fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify(changed));
    await realms.status(root, { live: false }).catch(() => null);
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8'))['playerbots.conf'][KEY], '100');
  }
});

// Pilote, 14/11: the Classic pack of 0.4.2 wrote AHBot, Market... at 0 and BreathGuard at 0, Recovery 30. In a realm,
// they move to the 3.1 defaults once, only when the pack's trace lists them and the value is still the pack's.
function classicRealm(key, values, trace) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'classic-'));
  const dir = path.join(root, 'Royaumes', key);
  fs.mkdirSync(path.join(dir, 'configs'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'configs', 'worldserver.conf'), '');
  fs.writeFileSync(path.join(dir, 'realm.json'), JSON.stringify({ key, id: 2, name: 'Darkmoon', worldPort: 8185, raPort: 3543 }));
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ 'playerbots.conf': values }));
  if (trace) { fs.mkdirSync(path.join(root, '.coa-launcher')); fs.writeFileSync(path.join(root, '.coa-launcher', 'living-pack-undo.json'), JSON.stringify(trace)); }
  return { root, dir };
}
const AH = 'AiPlayerbot.CoaEconomy.AHBot.Enable';
const MARKET = 'AiPlayerbot.CoaEconomy.Market.Enable';
const BREATH = 'AiPlayerbot.CoaCombat.BreathGuard.Enable';
const RECOVERY = 'AiPlayerbot.CoaWorld.Recovery.NoProgressSeconds';
const own = dir => JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8'))['playerbots.conf'];
const previous = keys => keys.map(key => ({ file: 'playerbots.conf', key, value: '1' }));

test('values the 0.4.2 Classic pack wrote in a realm move to the 3.1 defaults once, only with its trace', async () => {
  // Trace of the pack for this realm, values still the pack's: moved; Market changed since by the player (1 -> kept);
  // a key not in the trace stays.
  const traced = classicRealm('wildcard', { [AH]: '0', [MARKET]: '1', [BREATH]: '0', [RECOVERY]: '30', 'AiPlayerbot.CoaEconomy.Rarity.Enable': '0' },
    { wildcard: { id: 'classic', at: '2026-11-10T10:00:00Z', previous: previous([AH, MARKET, BREATH, RECOVERY]) } });
  await realms.status(traced.root, { live: false }).catch(() => null);
  assert.deepEqual(own(traced.dir), { [AH]: '1', [MARKET]: '1', [BREATH]: '1', [RECOVERY]: '120', 'AiPlayerbot.CoaEconomy.Rarity.Enable': '0' });
  assert.ok(JSON.parse(fs.readFileSync(path.join(traced.dir, 'realm.json'), 'utf8')).moved.includes('classic-pack-3.1'));
  const log = fs.readFileSync(path.join(traced.root, 'logs', 'launcher-realms.log'), 'utf8');
  assert.match(log, /AHBot\.Enable 0 -> 1 \(Classic pack of 0\.4\.2\)/);
  assert.match(log, /NoProgressSeconds 30 -> 120/);
  // Once: the player sets AHBot back to 0 afterwards, it stays.
  fs.writeFileSync(path.join(traced.dir, 'settings.json'), JSON.stringify({ 'playerbots.conf': { ...own(traced.dir), [AH]: '0' } }));
  await realms.status(traced.root, { live: false }).catch(() => null);
  assert.equal(own(traced.dir)[AH], '0');
  // No trace, another pack's trace, or the trace of another realm (or of « coa »): nothing moves.
  for (const trace of [null, { wildcard: { id: 'living', previous: previous([AH]) } }, { coa: { id: 'classic', previous: previous([AH]) } }]) {
    const { root, dir } = classicRealm('wildcard', { [AH]: '0', [BREATH]: '0' }, trace);
    await realms.status(root, { live: false }).catch(() => null);
    assert.deepEqual(own(dir), { [AH]: '0', [BREATH]: '0' }, JSON.stringify(trace));
  }
});
