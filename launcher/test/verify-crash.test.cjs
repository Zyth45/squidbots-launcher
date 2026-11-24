'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { lastCrash } = require('../src/verify.cjs');

// User, 24/11: a world that stopped at start said only « Check its log »; the newest crash report gives the line.
test('the newest crash report of the last minutes gives where the world stopped; an old one is not shown', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crash-'));
  assert.equal(await lastCrash(root), null);
  const dir = path.join(root, 'CoA-Bots', 'Core', 'Crashes');
  fs.mkdirSync(dir, { recursive: true });
  const old = path.join(dir, 'old_worldserver.exe_[1].txt');
  fs.writeFileSync(old, '# Location: old.cpp:1\n');
  const hour = (Date.now() - 3600 * 1000) / 1000;
  fs.utimesSync(old, hour, hour);
  assert.equal(await lastCrash(root), null);
  fs.writeFileSync(path.join(dir, 'new_worldserver.exe_[2].txt'), 'Exception code: C0000420\nAssertion message: #------#\n>> ASSERTION FAILED\n# Location: D:\tree\ArenaSeasonMgr.cpp:112\n# Function: LoadActiveSeason\n# Condition: result\n# Message: active_arena_season can\'t be empty\n');
  const crash = await lastCrash(root);
  assert.match(crash.line, /^Location: D:\tree\ArenaSeasonMgr\.cpp:112 Message: active_arena_season can't be empty$/);
  assert.match(crash.file, /new_worldserver/);
});
