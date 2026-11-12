'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// homeState of the home page, run apart (the window's own scripts need a browser). Asked by the user on 0.4.1-beta.9:
// Malfurion starting alone showed « 2 of 3 services running », CoA red and Start the server, nothing about Malfurion.
const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'serverhome.js'), 'utf8').replace(/\r\n/g, '\n');
const pick = name => source.slice(source.indexOf(`function ${name}(`), source.indexOf('\n}\n', source.indexOf(`function ${name}(`)) + 2);
const context = { realmShort: key => ({ coa: 'CoA', living: 'Living' }[key] || key) };
vm.runInNewContext(`${pick('homeState')}\nthis.homeState = homeState;`, context);
const services = (world, mysql = 'running', auth = 'running') => [{ id: 'mysql', name: 'MySQL', state: mysql }, { id: 'auth', name: 'Authserver', state: auth }, { id: 'world', name: 'Worldserver', state: world }];
const realms = (living, more = {}) => ({ available: true, realms: [{ key: 'living', name: 'Malfurion', state: living, firstStart: true, ...more }, { key: 'wildcard', name: 'Darkmoon', state: 'absent' }, { key: 'reborn', name: 'Reborn', state: 'disabled' }] });
const lights = home => home.items.map(item => `${item.name}:${item.state}`).join(' ');

test('a light per service and per realm switched on, counted together', () => {
  const home = context.homeState({ services: services('stopped'), realms: realms('stopped') });
  assert.equal(lights(home), 'MySQL:running Authserver:running CoA:stopped Malfurion:stopped');
  assert.equal(home.running, 2);
  assert.equal(home.total, 4);
  assert.equal(home.moving, null);
});

test('a realm starting, alone: it is the one moving, by name, with its first start', () => {
  const home = context.homeState({ services: services('stopped'), realms: realms('starting') });
  assert.equal(home.moving.name, 'Malfurion');
  assert.equal(home.moving.state, 'starting');
  assert.equal(home.moving.firstStart, true);
  assert.equal(home.realmsOnly, false);
});

test('a realm whose card is at work before its process shows is starting already', () => {
  const home = context.homeState({ services: services('stopped'), realms: realms('stopped'), busy: 'living', busyKind: '' });
  assert.equal(home.moving.state, 'starting');
});

test('a secondary realm running alone: the server runs with it', () => {
  const home = context.homeState({ services: services('stopped'), realms: realms('running') });
  assert.equal(home.moving, null);
  assert.equal(home.realmsOnly, true);
  assert.deepEqual(home.realmsUp.map(realm => realm.name), ['Malfurion']);
  assert.equal(home.running, 3);
});

test('stopping: the CoA world saving after its port closed, a realm stopped from its card, Stop all', () => {
  assert.deepEqual({ ...context.homeState({ services: services('stopping'), realms: realms('stopped') }).moving }, { key: 'coa', name: 'CoA', state: 'stopping', world: true, realm: true });
  assert.equal(context.homeState({ services: services('running'), realms: realms('running'), busy: 'living', busyKind: 'stop' }).moving.name, 'Malfurion');
  assert.equal(context.homeState({ services: services('running'), realms: realms('running'), busy: 'coa', busyKind: 'stop' }).moving.state, 'stopping');
  const all = context.homeState({ services: services('running'), realms: realms('running'), stoppingAll: true });
  assert.equal(all.moving.all, true);
  assert.equal(all.items.find(item => item.name === 'Malfurion').state, 'stopping');
});

test('before the Realms status is read, the realms of the server info give the lights', () => {
  const home = context.homeState({ services: services('stopped'), realmsOn: [{ key: 'living', state: 'starting' }] });
  assert.equal(lights(home), 'MySQL:running Authserver:running Worldserver:stopped Living:starting');
  assert.equal(home.moving.state, 'starting');
});
