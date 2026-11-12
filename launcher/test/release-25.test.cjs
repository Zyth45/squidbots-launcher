'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { compareVersions, cleanManifest, status } = require('../src/repack-update.cjs');
const modules = require('../src/modules.cjs');
const { entriesOf } = require('../src/manastorm-client.cjs');

function folder(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'r25-'));
  for (const [file, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), content);
  }
  return root;
}
const manifest = extra => cleanManifest({ version: '2.5-beta.1', release: 'main-20261020-0123abcd', from: ['main-20261016-2ab3ebca'], package: { url: 'https://example.org/a.zip', sha256: 'a'.repeat(64), size: 10, folder: 'CoA-Update-2.5' }, ...extra });

test('versions: numbers first, then a stable version before its betas', () => {
  assert.ok(compareVersions('2.5-beta.1', '2.4') > 0);
  assert.ok(compareVersions('2.5', '2.5-beta.3') > 0);
  assert.ok(compareVersions('2.5-beta.2', '2.5-beta.1') > 0);
  assert.equal(compareVersions('2.4', '2.4'), 0);
  // The test packages of 3.0 (release.json "3.0-test-a55"): below 3.0, above 2.9.5, in build order.
  assert.ok(compareVersions('3.0', '3.0-test-a57') > 0);
  assert.ok(compareVersions('3.0-test-a57', '3.0-test-a55') > 0);
  assert.ok(compareVersions('3.0-test-a55', '2.9.5') > 0);
  assert.ok(compareVersions('3.0.1', '3.0') > 0);
});

test('a server on a 3.0 test package is offered the stable 3.0, a 3.0 server is up to date', () => {
  const pkg = { url: 'https://example.org/c.zip', sha256: 'c'.repeat(64), size: 10, folder: 'CoA-Update-3.0' };
  const stable = cleanManifest({ version: '3.0', release: 'main-20261120-0123abcd', from: ['main-20261108-7fc67d94'], package: pkg });
  const onTest = folder({ 'RELEASE.json': '{"releaseId":"main-20261112-33df6faf"}', 'CoA-Bots/release.json': '{"version":"3.0-test-a55"}' });
  assert.equal(status(onTest, stable).state, 'unsupported');
  assert.notEqual(status(onTest, stable).ahead, true);
  const onStable = folder({ 'RELEASE.json': '{"releaseId":"main-20261120-0123abcd"}', 'CoA-Bots/release.json': '{"version":"3.0"}' });
  assert.equal(status(onStable, stable).state, 'current');
  const on295 = folder({ 'RELEASE.json': '{"releaseId":"main-20261108-7fc67d94"}', 'CoA-Bots/release.json': '{"version":"2.9.5"}' });
  assert.equal(status(on295, stable).state, 'available');
});

test('a beta is signed as such, and a tester ahead of the stable version has nothing to do', () => {
  assert.equal(manifest({ channel: 'beta' }).channel, 'beta');
  // A test or pre-release version is never offered by the stable channel (12/11), except from a local test feed.
  assert.throws(() => manifest({}), /test version on the stable channel/);
  assert.throws(() => manifest({ version: '3.0-test-a57b' }), /stable channel/);
  assert.equal(manifest({ version: '3.0-test-a57b', package: { url: 'http://127.0.0.1:8096/a.zip', sha256: 'a'.repeat(64), size: 10, folder: 'CoA-Update-3.0' } }).channel, 'stable');
  assert.equal(manifest({ version: '3.0' }).channel, 'stable');
  const root = folder({ 'RELEASE.json': '{"releaseId":"main-20261020-0123abcd"}', 'CoA-Bots/release.json': '{"version":"2.5-beta.1"}' });
  const stable = cleanManifest({ version: '2.4', release: 'main-20261016-2ab3ebca', from: ['main-20261014-ad8370da'], package: { url: 'https://example.org/b.zip', sha256: 'b'.repeat(64), size: 10, folder: 'CoA-Update-2.4' } });
  assert.equal(status(root, stable).state, 'current');
});

test('auction house on from its .dist, Manastorm keys written with ClientMode 2', async () => {
  const root = folder({
    'CoA-Bots/Core/configs/modules/mod_ahbot.conf.dist': 'AuctionHouseBot.Enable = true\n',
    'CoA-Bots/Core/configs/modules/manastorm-endless.conf.dist': 'Manastorm.Enable = 0\nManastorm.ClientMode = 1\n',
  });
  assert.deepEqual(await modules.ahbotStatus(root), { available: true, enabled: true });
  await modules.setManastorm(root, true);
  const text = fs.readFileSync(path.join(root, 'CoA-Bots/Core/configs/modules/manastorm-endless.conf'), 'utf8');
  assert.match(text, /Manastorm\.Enable = 1/);
  assert.match(text, /Manastorm\.ClientMode = 2/);
});

test('rotation assistant: a missing key becomes 0 before a start, a chosen value is kept', async () => {
  const root = folder({
    'Settings/coa.conf.template': 'CoA.Something = 1\n',
    'CoA-Bots/Core/worldserver.exe': 'binary ... CoA.RotationAssist.Enable ... binary',
  });
  assert.equal((await modules.rotationStatus(root)).enabled, true);
  await modules.keepRotationOff(root);
  assert.match(fs.readFileSync(path.join(root, 'Settings/coa.conf.template'), 'utf8'), /CoA\.RotationAssist\.Enable = 0/);
  await modules.setRotation(root, true);
  await modules.keepRotationOff(root);
  assert.equal((await modules.rotationStatus(root)).enabled, true);
});

test('the Manastorm client zip may only hold Data and Interface files', () => {
  assert.deepEqual(entriesOf('Manastorm/\nManastorm/Interface/FrameXML/UIParent.lua\nManastorm/Data/patch-B.MPQ\n').map(item => item.rel), ['Interface/FrameXML/UIParent.lua', 'Data/patch-B.MPQ']);
  assert.throws(() => entriesOf('Interface/../Wow.exe\n'));
  assert.throws(() => entriesOf('Wow.exe\n'));
});
