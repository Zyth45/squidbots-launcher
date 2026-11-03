'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const eco = require('../src/eco.cjs');

test('the eco value and the player value back, key present or not', () => {
  const text = 'A = 1\r\nAiPlayerbot.BotActiveAlone = 60\r\nB = 2\r\n';
  const asleep = eco.ecoText(text);
  assert.equal(asleep, 'A = 1\r\nAiPlayerbot.BotActiveAlone = 1\r\nB = 2\r\n');
  assert.equal(eco.restoreText(asleep, '60'), text);
  const none = 'A = 1\n';
  assert.equal(eco.restoreText(eco.ecoText(none), null), none);
});

test('a world that does not run gets the player value back; a value changed meanwhile is kept', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eco-'));
  const conf = path.join(root, 'CoA-Bots', 'Core', 'configs', 'modules', 'playerbots.conf');
  fs.mkdirSync(path.dirname(conf), { recursive: true });
  fs.mkdirSync(path.join(root, 'Settings'), { recursive: true });
  fs.writeFileSync(path.join(root, 'Settings', 'repack.json'), JSON.stringify({ worldPort: 1 }));
  fs.writeFileSync(path.join(root, 'CoA-Bots', 'release.json'), JSON.stringify({ version: '2.9.1' }));
  fs.writeFileSync(conf, 'AiPlayerbot.BotActiveAlone = 1\n');
  fs.mkdirSync(path.join(root, 'Royaumes'), { recursive: true });
  fs.writeFileSync(path.join(root, 'Royaumes', 'eco-state.json'), JSON.stringify({ coa: { original: '45' } }));
  await eco.wakeStopped(root);
  assert.equal(fs.readFileSync(conf, 'utf8'), 'AiPlayerbot.BotActiveAlone = 45\n');
  assert.equal(fs.existsSync(path.join(root, 'Royaumes', 'eco-state.json')), false);
  fs.writeFileSync(conf, 'AiPlayerbot.BotActiveAlone = 30\n');
  fs.writeFileSync(path.join(root, 'Royaumes', 'eco-state.json'), JSON.stringify({ coa: { original: '45' } }));
  await eco.wakeStopped(root);
  assert.equal(fs.readFileSync(conf, 'utf8'), 'AiPlayerbot.BotActiveAlone = 30\n');
  assert.equal(eco.supported(root), true);
  fs.writeFileSync(path.join(root, 'CoA-Bots', 'release.json'), JSON.stringify({ version: '2.9' }));
  assert.equal(eco.supported(root), false);
  fs.rmSync(root, { recursive: true, force: true });
});
