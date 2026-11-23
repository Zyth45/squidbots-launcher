'use strict';
// 22/11 (user's PC): « Add them » said the navigation of the new maps was added while nothing ran. The build started
// after « Update the data » had been killed by an update in its first seconds and left its lock; the next one stopped
// at once, its output thrown away. Now: a lock with no build behind it is removed, the output goes to a log, and the
// build is said started only once it is seen at work (its reason otherwise, kept in the state for the home page).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const assembler = require('../src/assembler.cjs');

let pythonHome = '';
try { pythonHome = execFileSync('python', ['-c', 'import sys; print(sys.base_prefix)'], { encoding: 'utf8' }).trim(); } catch {}

// A repack whose « assembler » does what `mode` says; its Python is the one of this PC (a junction).
const FAKE = `# def curl_download(  (a package script: never replaced by the launcher's copy)
import json, os, pathlib, sys, time
root = pathlib.Path.cwd()
mode = (root / "mode.txt").read_text().strip()
def emit(**kw): print(json.dumps(kw), flush=True)
state_file = root / ".state" / "assemble.json"
lock = root / ".state" / "mmaps.lock"
if mode == "error":
    emit(event="error", message="Extract the maps and vmaps first.")
    sys.exit(2)
if lock.exists():
    emit(event="log", step="mmaps", text="The navigation maps are already being built (process %s)." % lock.read_text())
    emit(event="done", steps=["mmaps"])
    sys.exit(0)
lock.write_text(str(os.getpid()))
state = json.loads(state_file.read_text())
state.setdefault("mmaps", {}).update({"running": True, "pid": os.getpid(), "total": 3})
state_file.write_text(json.dumps(state))
time.sleep(4)
state["mmaps"]["running"] = False
state_file.write_text(json.dumps(state))
lock.unlink()
emit(event="done", steps=["mmaps"])
`;

function repack(mode) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mmaps-start-'));
  fs.mkdirSync(path.join(root, 'Assembler'), { recursive: true });
  fs.mkdirSync(path.join(root, 'Runtime'), { recursive: true });
  fs.mkdirSync(path.join(root, '.state'), { recursive: true });
  fs.symlinkSync(pythonHome, path.join(root, 'Runtime', 'python'), 'junction');
  fs.writeFileSync(path.join(root, 'Assembler', 'coa_assemble.py'), FAKE);
  fs.writeFileSync(path.join(root, 'mode.txt'), mode);
  fs.writeFileSync(path.join(root, '.state', 'assemble.json'), JSON.stringify({ mmaps: { maps: { 13: 'x' }, total: 1 } }));
  return root;
}
const tidy = root => { try { fs.rmdirSync(path.join(root, 'Runtime', 'python')); } catch {} fs.rmSync(root, { recursive: true, force: true }); };
const saved = root => JSON.parse(fs.readFileSync(path.join(root, '.state', 'assemble.json'), 'utf8')).mmaps;
const skip = !pythonHome || process.platform !== 'win32';

test('the run log is read: error, already being built, done', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mmaps-log-'));
  const log = path.join(dir, 'run.log');
  fs.writeFileSync(log, '{"event":"log","step":"mmaps","text":"The navigation maps are already being built (process 26452)."}\n{"event":"done","steps":["mmaps"]}\n');
  assert.deepEqual(assembler.readRunLog(log), { error: '', already: true, done: true, tail: '' });
  fs.writeFileSync(log, 'Traceback (most recent call last):\n{"event":"error","message":"boom"}\n');
  assert.equal(assembler.readRunLog(log).error, 'boom');
  assert.deepEqual(assembler.readRunLog(path.join(dir, 'none.log')), { error: '', already: false, done: false, tail: '' });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a lock left by a killed build (dead pid, or a pid that is now another program) is removed', { skip }, () => {
  const root = repack('run');
  const lock = path.join(root, '.state', 'mmaps.lock');
  fs.writeFileSync(lock, '4194300');
  assert.equal(assembler.clearStaleLock(root), true);
  assert.ok(!fs.existsSync(lock));
  // This test's own process: alive, but no build of this repack.
  fs.writeFileSync(lock, String(process.pid));
  assert.equal(assembler.clearStaleLock(root), true);
  assert.ok(!fs.existsSync(lock));
  tidy(root);
});

test('started only once seen at work; the stale lock of 22/11 no longer stops it; output in the run log', { skip }, async () => {
  const root = repack('run');
  fs.writeFileSync(path.join(root, '.state', 'mmaps.lock'), String(process.pid));
  const result = await assembler.mmapsStart(root);
  assert.equal(result.started, true);
  assert.equal(saved(root).running, true);
  assert.notEqual(Number(fs.readFileSync(path.join(root, '.state', 'mmaps.lock'), 'utf8')), process.pid);
  for (let i = 0; i < 20 && saved(root).running; i++) await new Promise(resolve => setTimeout(resolve, 500));
  await new Promise(resolve => setTimeout(resolve, 1000));
  assert.match(fs.readFileSync(path.join(root, 'Assembler', 'logs', 'mmaps-run.log'), 'utf8'), /"done"/);
  assert.equal(saved(root).error, undefined, 'a build that ends well leaves no reason');
  tidy(root);
});

test('a build that stops at once: its reason is thrown and kept in the state for the home page', { skip }, async () => {
  const root = repack('error');
  fs.writeFileSync(path.join(root, '.state', 'assemble.json'), JSON.stringify({ mmaps: { maps: { 13: 'x' }, total: 1, error: 'old', errorAt: 1 } }));
  await assert.rejects(assembler.mmapsStart(root), /Extract the maps and vmaps first/);
  await new Promise(resolve => setTimeout(resolve, 300));
  const mm = saved(root);
  assert.equal(mm.error, 'Extract the maps and vmaps first.');
  assert.ok(mm.errorAt > 1);
  assert.equal(mm.running, false);
  tidy(root);
});

test('another build really at work: said already running, no error written', { skip }, async () => {
  const root = repack('run');
  const first = await assembler.mmapsStart(root);
  assert.equal(first.started, true);
  // A second start from another launcher window (the one-per-minute guard is per process: cleared here).
  const second = await assembler.startMmaps(root);
  assert.equal(second.already, true);
  for (let i = 0; i < 20 && saved(root).running; i++) await new Promise(resolve => setTimeout(resolve, 500));
  await new Promise(resolve => setTimeout(resolve, 800));
  assert.equal(saved(root).error, undefined);
  tidy(root);
});
