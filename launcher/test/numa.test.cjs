'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createNuma, chooseNode, parseTopology, PIN } = require('../src/numa.cjs');

const TWO = [{ node: 0, group: 0, mask: '4294967295', free: 3e9 }, { node: 1, group: 1, mask: '4294967295', free: 9e9 }];

test('NUMA: one node, nothing to choose; several, the most free memory or the node forced in the settings', () => {
  assert.equal(chooseNode([], 'auto'), null);
  assert.equal(chooseNode([TWO[0]], 'auto'), null);
  assert.equal(chooseNode([TWO[0]], 0), null);
  assert.equal(chooseNode(TWO, 'auto').node, 1);
  assert.equal(chooseNode(TWO, 0).node, 0);
  // A node that is not there (a machine changed) falls back to the automatic choice.
  assert.equal(chooseNode(TWO, 5).node, 1);
});

test('NUMA: the topology from PowerShell, anything malformed left out', () => {
  assert.deepEqual(parseTopology('[{"node":0,"group":0,"mask":"4294967295","free":"2920255488"},{"node":1,"group":1,"mask":"4294967295","free":"510631936"}]'),
    [{ node: 0, group: 0, mask: '4294967295', free: 2920255488 }, { node: 1, group: 1, mask: '4294967295', free: 510631936 }]);
  // One node: PowerShell gives an object, not an array.
  assert.equal(parseTopology('{"node":0,"group":0,"mask":"255","free":"100"}').length, 1);
  assert.deepEqual(parseTopology('not json'), []);
  assert.deepEqual(parseTopology('[{"node":0,"group":0,"mask":"0","free":"1"},{"node":"x","group":0,"mask":"1","free":"1"}]'), []);
  // The pin script carries only numbers.
  assert.match(PIN(1234, 1, '4294967295'), /OpenProcess\(0x3000, \$false, 1234\)/);
  assert.match(PIN(1234, 1, '4294967295'), /\[uint64\]4294967295; \$a\.Group = 1;/);
});

test('NUMA: on one node no pinning and no log line; on two, the process pinned and one line in the log', async () => {
  const calls = [];
  const fakeExec = topology => (file, args, options, done) => {
    const script = args[args.length - 1];
    calls.push(script.includes('SetProcessDefaultCpuSetMasks(h') || script.includes('SetProcessDefaultCpuSetMasks($h') ? 'pin' : 'topology');
    done(null, script.includes('GetNumaHighestNodeNumber') ? JSON.stringify(topology) : 'ok', '');
  };
  const lines = [];
  const one = createNuma({ exec: fakeExec([{ node: 0, group: 0, mask: '255', free: '1000' }]), log: line => lines.push(line), platform: 'win32' });
  assert.equal(await one.pin(42, 'worldserver.exe'), null);
  assert.deepEqual(calls, ['topology']);
  assert.deepEqual(lines, []);
  calls.length = 0;
  const two = createNuma({ exec: fakeExec(TWO.map(node => ({ ...node, free: String(node.free) }))), log: line => lines.push(line), platform: 'win32' });
  assert.equal(await two.pin(42, 'worldserver.exe'), 1);
  assert.equal(await two.pin(43, 'mysqld.exe', 0), 0);
  // The topology is read once.
  assert.deepEqual(calls, ['topology', 'pin', 'pin']);
  assert.deepEqual(lines, ['NUMA: 2 nodes, worldserver.exe on node 1', 'NUMA: 2 nodes, mysqld.exe on node 0 (chosen in the settings)']);
  // Off Windows: nothing at all.
  assert.equal(await createNuma({ exec: () => assert.fail('no call'), platform: 'linux' }).pin(42, 'x'), null);
});

test('NUMA: a pin that fails leaves the process to Windows, with a line in the log', async () => {
  const lines = [];
  const exec = (file, args, options, done) => (args[args.length - 1].includes('GetNumaHighestNodeNumber') ? done(null, JSON.stringify(TWO.map(node => ({ ...node, free: String(node.free) }))), '') : done(new Error('x'), '', 'SetProcessDefaultCpuSetMasks failed: 5'));
  const numa = createNuma({ exec, log: line => lines.push(line), platform: 'win32' });
  assert.equal(await numa.pin(42, 'worldserver.exe'), null);
  assert.deepEqual(lines, ['NUMA: 2 nodes, worldserver.exe left to Windows (SetProcessDefaultCpuSetMasks failed: 5)']);
});

test('NUMA: a program the repack starts itself is waited for under the repack, then pinned', async () => {
  const { PIN_NEW } = require('../src/numa.cjs');
  const script = PIN_NEW('worldserver', "D:\\CoA's repack", 1700000000000, 1, '4294967295');
  assert.match(script, /Get-Process -Name 'worldserver'/);
  assert.ok(script.includes("$root = 'D:\\CoA''s repack'"));
  assert.match(script, /FromUnixTimeMilliseconds\(1700000000000\)/);
  assert.match(script, /OpenProcess\(0x3000, \$false, \[uint32\]\$found\.Id\)/);
  // A name is only letters and dots: nothing else reaches PowerShell.
  assert.match(PIN_NEW("x'; rm -r /", 'D:\\R', 1, 0, '1'), /Get-Process -Name 'xrm-r'/);
  const lines = [];
  const exec = (file, args, options, done) => done(null, args[args.length - 1].includes('GetNumaHighestNodeNumber') ? JSON.stringify(TWO.map(node => ({ ...node, free: String(node.free) }))) : 'ok', '');
  const numa = createNuma({ exec, log: line => lines.push(line), platform: 'win32' });
  assert.equal(await numa.pinNew('worldserver', 'D:\\R', Date.now()), 1);
  assert.deepEqual(lines, ['NUMA: 2 nodes, worldserver.exe on node 1']);
});
