'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ach = require('../src/bot-achievements.cjs');

test('every characters database of the server, and the bots prefix from playerbots.conf', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ach-'));
  const conf = (dir, chars) => { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, 'worldserver.conf'), `LoginDatabaseInfo = "127.0.0.1;3307;u;p;acore_auth"\nCharacterDatabaseInfo = "127.0.0.1;3307;u;p;${chars}"\n`); };
  conf(path.join(root, 'CoA-Bots', 'Core', 'configs'), 'acore_characters');
  conf(path.join(root, 'Royaumes', 'wildcard', 'configs'), 'acore_characters_wildcard');
  conf(path.join(root, 'Royaumes', 'bad', 'configs'), 'acore chars-x');
  fs.mkdirSync(path.join(root, 'CoA-Bots', 'Core', 'configs', 'modules'));
  fs.writeFileSync(path.join(root, 'CoA-Bots', 'Core', 'configs', 'modules', 'playerbots.conf'), 'AiPlayerbot.RandomBotAccountPrefix = "rndbot"\n');
  assert.deepEqual(await ach.targets(root), [{ chars: 'acore_characters', auth: 'acore_auth' }, { chars: 'acore_characters_wildcard', auth: 'acore_auth' }]);
  assert.equal(await ach.botPrefix(root), 'RNDBOT');
});
