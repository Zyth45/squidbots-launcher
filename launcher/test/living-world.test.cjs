'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { tempDir } = require('./helpers.cjs');
const CATALOG = require('../src/catalog.cjs');
const { ServerConfig } = require('../src/server-config.cjs');

const FIXTURE = path.join(__dirname, 'fixtures', 'repack');
const GROUPS = [{ id: 'lw-test', icon: 'globe', label: 'Test group' }];

test('the living world manifest shipped with the launcher is valid and makes its own section', () => {
  assert.deepEqual(CATALOG.refused, []);
  const living = CATALOG.settings.filter(setting => setting.living);
  assert.ok(living.length >= 1);
  assert.ok(living.every(setting => setting.default !== undefined && setting.label.en));
  // Every switch of the shipped manifest is off by default, unless named in onByDefault.
  const allowed = require('../src/data/living-world.json').onByDefault || [];
  assert.deepEqual(living.filter(setting => /(^|.)Enabled?$/i.test(setting.key) && setting.default !== '0' && !allowed.includes(setting.key)).map(setting => setting.key), []);
  const section = CATALOG.sections.find(item => item.id === 'living');
  assert.ok(section && living.every(setting => section.groups.includes(setting.group)));
});

test('a manifest option is turned into a setting; a malformed one is refused, never guessed', () => {
  const built = CATALOG.build(require('../src/data/server-settings.json'), {
    groups: GROUPS,
    onByDefault: ['Living.City.Enable'],
    options: [
      { key: 'Living.Invasions.Enable', file: 'mod_living.conf', group: 'lw-test', type: 'bool', default: 0, label: 'Invasions', help: 'Off by default.' },
      { key: 'Living.Invasions.Rate', file: 'mod_living.conf', group: 'lw-test', type: 'int', default: 5, min: 1, max: 60, when: 'reload', label: { en: 'Rate', fr: 'Fréquence' } },
      { key: 'Living.NoDefault', file: 'mod_living.conf', group: 'lw-test', type: 'int', label: 'x' },
      { key: 'Living.OutOfBounds', file: 'mod_living.conf', group: 'lw-test', type: 'int', default: 99, max: 10, label: 'x' },
      { key: 'Living.NoGroup', file: 'mod_living.conf', group: 'nope', type: 'bool', default: 0, label: 'x' },
      { key: 'Living.BadType', file: 'mod_living.conf', group: 'lw-test', type: 'list', default: 0, label: 'x' },
      { key: 'Living.BadChoice', file: 'mod_living.conf', group: 'lw-test', type: 'choice', default: 3, choices: [{ value: 1, label: 'One' }], label: 'x' },
      { key: 'AiPlayerbot.RandomBotTalk', file: 'playerbots.conf', group: 'lw-test', type: 'bool', default: 0, label: 'Taken' },
      // A new feature ships off: a switch on by default is refused unless named in onByDefault.
      { key: 'Living.Pvp.Enable', file: 'mod_living.conf', group: 'lw-test', type: 'bool', default: true, label: 'x' },
      { key: 'Living.Social.Enabled', file: 'mod_living.conf', group: 'lw-test', type: 'int', default: 1, label: 'x' },
      { key: 'Living.Travel.Enable', file: 'mod_living.conf', group: 'lw-test', type: 'bool', default: false, label: 'Travellers' },
      { key: 'Living.City.Enable', file: 'mod_living.conf', group: 'lw-test', type: 'bool', default: 1, label: 'City life' },
    ],
  });
  const enable = built.settings.find(setting => setting.key === 'Living.Invasions.Enable');
  assert.deepEqual({ kind: enable.kind, default: enable.default, when: enable.when, label: enable.label }, { kind: 'bool', default: '0', when: 'restart', label: { en: 'Invasions' } });
  const rate = built.settings.find(setting => setting.key === 'Living.Invasions.Rate');
  assert.deepEqual([rate.min, rate.max, rate.when, rate.label.fr], [1, 60, 'reload', 'Fréquence']);
  assert.equal(built.refused.length, 8);
  assert.ok(built.refused.some(line => line.startsWith('Living.Pvp.Enable: a new feature ships off')));
  assert.ok(built.refused.some(line => line.startsWith('Living.Social.Enabled: a new feature ships off')));
  assert.equal(built.settings.find(setting => setting.key === 'Living.Travel.Enable').default, '0');
  assert.equal(built.settings.find(setting => setting.key === 'Living.City.Enable').default, '1');
  assert.equal(built.settings.filter(setting => setting.key === 'AiPlayerbot.RandomBotTalk').length, 1);
  assert.ok(built.groups.some(group => group.id === 'lw-test'));
});

test('a living world option shows the player\'s value or its default, writes nothing until changed, and keeps its bounds', async () => {
  const root = await tempDir();
  await fsp.cp(FIXTURE, root, { recursive: true });
  const conf = path.join(root, 'CoA-Bots', 'Core', 'configs', 'modules', 'mod_living.conf');
  const before = '# Living world\r\nLiving.Invasions.Enable = 1\r\n';
  await fsp.writeFile(conf, before);
  const built = CATALOG.build({ ...require('../src/data/server-settings.json'), settings: [] }, {
    groups: GROUPS,
    options: [
      { key: 'Living.Invasions.Enable', file: 'mod_living.conf', group: 'lw-test', type: 'bool', default: 0, label: 'Invasions' },
      { key: 'Living.Invasions.Rate', file: 'mod_living.conf', group: 'lw-test', type: 'int', default: 5, min: 1, max: 60, label: 'Rate' },
    ],
  });
  CATALOG.settings.push(...built.settings);
  try {
    const config = new ServerConfig(root);
    const settings = (await config.overview()).settings;
    assert.equal(settings.find(item => item.key === 'Living.Invasions.Enable').value, '1');
    assert.equal(settings.find(item => item.key === 'Living.Invasions.Rate').value, '5');
    assert.equal(await fsp.readFile(conf, 'utf8'), before);
    await assert.rejects(config.save([{ file: 'mod_living.conf', key: 'Living.Invasions.Rate', value: '61' }]), /from 1 to 60/);
    assert.equal(await fsp.readFile(conf, 'utf8'), before);
    await config.save([{ file: 'mod_living.conf', key: 'Living.Invasions.Rate', value: '10' }]);
    const after = await fsp.readFile(conf, 'utf8');
    assert.ok(after.startsWith(before));
    assert.equal(after.match(/^Living\.Invasions\.Rate = 10\r?$/gm).length, 1);
    assert.match(after, /^Living\.Invasions\.Enable = 1\r?$/m);
  } finally {
    CATALOG.settings.splice(CATALOG.settings.length - built.settings.length);
  }
});

test('bot surname: the player\'s 0/1 is kept, 2 is a new choice, and the list shows only with it', async () => {
  const root = await tempDir();
  await fsp.cp(FIXTURE, root, { recursive: true });
  const bots = path.join(root, 'CoA-Bots', 'Core', 'configs', 'modules', 'playerbots.conf');
  const before = await fsp.readFile(bots, 'utf8');
  assert.match(before, /^AiPlayerbot\.CoaBotSurname = 0\r?$/m);
  const config = new ServerConfig(root);
  const settings = (await config.overview()).settings;
  const surname = settings.find(item => item.key === 'AiPlayerbot.CoaBotSurname');
  assert.equal(surname.value, '0');
  assert.deepEqual(surname.choices.map(choice => choice.value), ['0', '1', '2']);
  const list = settings.find(item => item.key === 'AiPlayerbot.CoaBotSurnameList');
  assert.equal(list.value, '');
  assert.deepEqual([list.offWhen, list.hideOff], [{ key: 'AiPlayerbot.CoaBotSurname', values: ['0', '1'] }, true]);
  assert.equal(await fsp.readFile(bots, 'utf8'), before);
  await config.save([{ file: 'playerbots.conf', key: 'AiPlayerbot.CoaBotSurname', value: '2' }, { file: 'playerbots.conf', key: 'AiPlayerbot.CoaBotSurnameList', value: 'Ashford, Brightwood' }]);
  const after = await fsp.readFile(bots, 'utf8');
  assert.match(after, /^AiPlayerbot\.CoaBotSurname = 2\r?$/m);
  assert.equal(after.match(/^AiPlayerbot\.CoaBotSurnameList = "Ashford, Brightwood"\r?$/gm).length, 1);
  assert.equal(after.replace(/^AiPlayerbot\.CoaBotSurnameList = .*\r?\n/m, '').replace('AiPlayerbot.CoaBotSurname = 2', 'AiPlayerbot.CoaBotSurname = 0'), before);
});

test('onlyWhen must name a bool or choice setting and some of its values', () => {
  const built = CATALOG.build({ ...require('../src/data/server-settings.json'), settings: [] }, {
    groups: GROUPS,
    options: [
      { key: 'Living.Mode', file: 'mod_living.conf', group: 'lw-test', type: 'choice', default: 0, choices: [{ value: 0, label: 'A' }, { value: 1, label: 'B' }], label: 'Mode' },
      { key: 'Living.Rate', file: 'mod_living.conf', group: 'lw-test', type: 'int', default: 1, label: 'Rate' },
      { key: 'Living.Good', file: 'mod_living.conf', group: 'lw-test', type: 'text', default: '', onlyWhen: { key: 'Living.Mode', values: [1] }, label: 'x' },
      { key: 'Living.NotChoice', file: 'mod_living.conf', group: 'lw-test', type: 'text', default: '', onlyWhen: { key: 'Living.Rate', values: [1] }, label: 'x' },
      { key: 'Living.BadValue', file: 'mod_living.conf', group: 'lw-test', type: 'text', default: '', onlyWhen: { key: 'Living.Mode', values: [5] }, label: 'x' },
    ],
  });
  assert.deepEqual(built.settings.find(item => item.key === 'Living.Good').offWhen, { key: 'Living.Mode', values: ['0'] });
  assert.deepEqual(built.refused.map(line => line.split(':')[0]).sort(), ['Living.BadValue', 'Living.NotChoice']);
});
