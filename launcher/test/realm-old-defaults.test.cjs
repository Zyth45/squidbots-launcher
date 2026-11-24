'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const realms = require('../src/realms.cjs');

const KEY = 'AiPlayerbot.CoaEconomy.LaunchCurve.LaunchPremiumPercent';
const AT60 = 'AiPlayerbot.CoaSelfFoundMaxLevel';
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
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'realm.json'), 'utf8')).moved, ['launch-premium-0', 'bgsim-3.2', 'at60-off-3.2.2', 'serverfirst-off-3.2.2', 'classic-pack-3.1', 'classic-pack-3.1.6']);
    // The player sets 100 again afterwards: kept.
    changed['playerbots.conf'][KEY] = '100';
    fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify(changed));
    await realms.status(root, { live: false }).catch(() => null);
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8'))['playerbots.conf'][KEY], '100');
  }
});

// Pilote, 21/11 (users' rule of 13/11): a Squid World made before 0.4.7 had no BgSim value of its own (it followed CoA,
// off by default). It gets 1 once; a value of its own (set by the player or a pack) stays, and so does a later 0.
test('simulated battlegrounds reach an existing Squid World once; a value of its own stays', async () => {
  const BG = 'AiPlayerbot.CoaWorld.BgSim.Enable';
  for (const [before, after] of [[undefined, '1'], ['0', '0'], ['1', '1']]) {
    const { root, dir } = realm('0');
    const start = JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8'));
    if (before !== undefined) start['playerbots.conf'][BG] = before;
    fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify(start));
    await realms.status(root, { live: false }).catch(() => null);
    const changed = own(dir);
    assert.equal(changed[BG], after, String(before));
    if (before === undefined) assert.match(fs.readFileSync(path.join(root, 'logs', 'launcher-realms.log'), 'utf8'), /BgSim\.Enable \(as CoA\) -> 1/);
    changed[BG] = '0';
    fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ 'playerbots.conf': changed }));
    await realms.status(root, { live: false }).catch(() => null);
    assert.equal(own(dir)[BG], '0', 'a 0 set afterwards stays');
  }
  // Another realm never gets it.
  const { root, dir } = classicRealm('wildcard', { 'AiPlayerbot.MaxRandomBots': '50' });
  await realms.status(root, { live: false }).catch(() => null);
  assert.equal(own(dir)[BG], undefined);
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
  assert.deepEqual(own(traced.dir), { [AH]: '1', [MARKET]: '1', [BREATH]: '1', [RECOVERY]: '120', 'AiPlayerbot.CoaEconomy.Rarity.Enable': '0', [AT60]: '80' });
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
    assert.deepEqual(own(dir), { [AH]: '0', [BREATH]: '0', [AT60]: '80' }, JSON.stringify(trace));
  }
});

// 3.1.6 (SquidBot f4ba8b1a, user's decision): the combat options the Classic pack wrote off move to their new defaults, with
// the pack's trace; a realm that already had the 0.4.2 move still gets this one; a value the player changed stays.
test('values the Classic pack wrote at the old combat defaults move to the 3.1.6 defaults once', async () => {
  const STUCK = 'AiPlayerbot.CoaCombat.StuckCombat.Enable', ZG = 'AiPlayerbot.CoaCombat.ZulGurub.Enable', PCT = 'AiPlayerbot.CoaCombat.LootNeedMinUpgradePct';
  const { root, dir } = classicRealm('wildcard', { [STUCK]: '0', [ZG]: '1', [PCT]: '0', [BREATH]: '1' },
    { wildcard: { id: 'classic', previous: previous([STUCK, ZG, PCT, BREATH]) } });
  const realm = JSON.parse(fs.readFileSync(path.join(dir, 'realm.json'), 'utf8'));
  fs.writeFileSync(path.join(dir, 'realm.json'), JSON.stringify({ ...realm, moved: ['classic-pack-3.1'] }));
  await realms.status(root, { live: false }).catch(() => null);
  assert.deepEqual(own(dir), { [STUCK]: '1', [ZG]: '1', [PCT]: '10', [BREATH]: '1', [AT60]: '80' });
  assert.ok(JSON.parse(fs.readFileSync(path.join(dir, 'realm.json'), 'utf8')).moved.includes('classic-pack-3.1.6'));
  assert.match(fs.readFileSync(path.join(root, 'logs', 'launcher-realms.log'), 'utf8'), /LootNeedMinUpgradePct 0 -> 10 [(]Classic pack, 3[.]1[.]6 defaults[)]/);
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ 'playerbots.conf': { ...own(dir), [STUCK]: '0' } }));
  await realms.status(root, { live: false }).catch(() => null);
  assert.equal(own(dir)[STUCK], '0');
  // Without the trace: nothing moves.
  const bare = classicRealm('wildcard', { [STUCK]: '0', [PCT]: '0' }, null);
  await realms.status(bare.root, { live: false }).catch(() => null);
  assert.deepEqual(own(bare.dir), { [STUCK]: '0', [PCT]: '0', [AT60]: '80' });
});

// 0.4.5 test, 19/11: the status read a realm's settings many times at once and the migration ran 18 times in the same
// millisecond (one log line per run). Reads of one realm now wait for each other: one run, one line.
test('many reads of a realm at once move an old default once, with one log line', async () => {
  const { root, dir } = realm('100');
  const all = await Promise.all(Array.from({ length: 5 }, () => realms.status(root, { live: false }).catch(e => e)));
  assert.equal(all.length, 5);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8'))['playerbots.conf'][KEY], '0');
  const lines = fs.readFileSync(path.join(root, 'logs', 'launcher-realms.log'), 'utf8').split('\n').filter(l => l.includes(KEY));
  assert.equal(lines.length, 1);
});

// 3.2.2 (user, 24/11: « prochaine update on force ce champs à OFF »): Auto-gear at level 60 goes off ONCE on every realm,
// whatever its value (ON by the player included); turned on again afterwards, it stays on.
test('Auto-gear at level 60 is turned off once on every realm, then the choice of the player stays', async () => {
  for (const [key, before] of [['living', '59'], ['living', undefined], ['wildcard', '59'], ['reborn', '80'], ['wildcard', '70']]) {
    const { root, dir } = classicRealm(key, before === undefined ? { 'AiPlayerbot.CoaSelfFound': '1' } : { [AT60]: before }, {});
    await realms.status(root, { live: false }).catch(() => null);
    assert.equal(own(dir)[AT60], '80', `${key} ${before} -> 80`);
    assert.ok(JSON.parse(fs.readFileSync(path.join(dir, 'realm.json'), 'utf8')).moved.includes('at60-off-3.2.2'));
    // The player turns it on again: never undone by a later read or update.
    const values = JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8'));
    values['playerbots.conf'][AT60] = '59';
    fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify(values));
    await realms.status(root, { live: false }).catch(() => null);
    assert.equal(own(dir)[AT60], '59');
  }
});

// 3.2.2 (Pilote, 24/11): the server firsts written at 1 by the creation of a Squid World go to 0 once; a 0 stays, and a 1
// set again by the player afterwards stays too.
test('server firsts go off once on an existing Squid World; the choice of the player afterwards stays', async () => {
  const SF = 'AiPlayerbot.CoaWorld.ServerFirst.Enable';
  for (const [before, after] of [['1', '0'], ['0', '0'], [undefined, undefined]]) {
    const { root, dir } = realm('0');
    const start = JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8'));
    if (before !== undefined) start['playerbots.conf'][SF] = before;
    fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify(start));
    await realms.status(root, { live: false }).catch(() => null);
    const changed = JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8'))['playerbots.conf'];
    assert.equal(changed[SF], after, String(before));
    assert.ok(JSON.parse(fs.readFileSync(path.join(dir, 'realm.json'), 'utf8')).moved.includes('serverfirst-off-3.2.2'));
    changed[SF] = '1';
    fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ 'playerbots.conf': changed }));
    await realms.status(root, { live: false }).catch(() => null);
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8'))['playerbots.conf'][SF], '1', 'a 1 set afterwards stays');
  }
});
