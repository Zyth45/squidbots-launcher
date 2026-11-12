'use strict';
// Starts, stops and watches the services of a local repack (MySQL, authserver, worldserver,
// launcher API). A service is "running" when its port answers; only programs that live inside
// the repack folder can be started or stopped.
const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const net = require('node:net');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

const exec = promisify(execFile);
const SERVICE_ID = /^[a-z][a-z0-9-]{1,20}$/;
const ACCOUNT = /^[A-Za-z0-9]{3,17}$/;
const PASSWORD = /^[\x21-\x7E]{6,16}$/;

// A command is a program inside the repack plus its arguments, e.g. a repack's own manager script.
function validateCommand(value, label) {
  if (!value) return null;
  if (typeof value.exe !== 'string' || path.isAbsolute(value.exe) || value.exe.split(/[\\/]/).includes('..') || !/\.exe$/i.test(value.exe)) throw new Error(`${label}: exe must be a relative path inside the repack.`);
  const args = (value.args || []).map(String);
  if (args.some(arg => arg.includes('..'))) throw new Error(`${label}: arguments cannot leave the repack folder.`);
  return { exe: value.exe, args, timeout: Math.min(1800, Math.max(5, Number(value.timeout) || 180)) };
}

function validateServices(list) {
  if (!Array.isArray(list) || !list.length || list.length > 8) throw new Error('A local realm needs a list of services.');
  const ids = new Set();
  return list.map(service => {
    if (!SERVICE_ID.test(service.id) || ids.has(service.id)) throw new Error(`Invalid service id: ${service.id}`);
    ids.add(service.id);
    const start = validateCommand(service.start, `${service.id} start`);
    // Another way to start the same service when a file is there (the bot-enabled worldserver of
    // CoA Bots when it is installed): the first match wins, the plain start otherwise.
    const alternatives = (service.alternatives || []).slice(0, 4).map((item, index) => {
      if (typeof item.exists !== 'string' || path.isAbsolute(item.exists) || item.exists.split(/[\\/]/).includes('..')) throw new Error(`${service.id}: alternatives need a relative "exists" path.`);
      return { exists: item.exists, label: String(item.label || '').slice(0, 40), start: validateCommand(item.start, `${service.id} alternative ${index + 1}`) };
    });
    const stop = validateCommand(service.stop, `${service.id} stop`);
    if (!start && (typeof service.exe !== 'string' || path.isAbsolute(service.exe) || service.exe.split(/[\\/]/).includes('..') || !/\.exe$/i.test(service.exe))) throw new Error(`${service.id}: exe must be a relative path inside the repack.`);
    const port = Number(service.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`${service.id}: invalid port.`);
    const args = (service.args || []).map(String);
    if (args.some(arg => arg.includes('..'))) throw new Error(`${service.id}: arguments cannot leave the repack folder.`);
    return {
      id: service.id, name: String(service.name || service.id).slice(0, 30), exe: service.exe || '', args, port, start, stop, alternatives,
      cwd: typeof service.cwd === 'string' && !path.isAbsolute(service.cwd) && !service.cwd.includes('..') ? service.cwd : path.dirname(service.exe || '.'),
      console: service.console === true,
      stopCommand: typeof service.stopCommand === 'string' ? service.stopCommand.slice(0, 80) : '',
      stopExe: typeof service.stopExe === 'string' && !path.isAbsolute(service.stopExe) && !service.stopExe.includes('..') ? service.stopExe : '',
      stopArgs: (service.stopArgs || []).map(String),
      startTimeout: Math.min(1800, Math.max(10, Number(service.startTimeout) || 120)),
    };
  });
}

// On 127.0.0.1, or on the precise address the repack's configs bind to (probe.cjs).
const probe = require('./probe.cjs');
const portOpen = port => probe.portOpen(port);
const PIPE_GONE = new Set(['EPIPE', 'ERR_STREAM_DESTROYED', 'ERR_STREAM_WRITE_AFTER_END']);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

class ServerControl {
  constructor({ root, services, commands = {}, notify = () => {}, onAuthStarted = null, pin = null }) {
    this.onAuthStarted = onAuthStarted;
    // On a several-node NUMA machine, keeps the world and MySQL on one node (src/numa.cjs); nothing on one node.
    this.pin = pin;
    this.root = path.resolve(root);
    probe.setRoot(this.root);
    this.services = services;
    this.commands = commands;
    this.notify = notify;
    this.children = new Map();
    this.states = new Map();
    // Services asked to stop whose process may still be saving after their port closed: « stopping », never « starting ».
    this.ending = new Set();
  }

  // Runs a repack command to completion, logging its output; stdin lines are sent then closed.
  async run(command, logId, input = [], secrets = []) {
    const exe = this.resolve(command.exe);
    if (!fs.existsSync(exe)) throw new Error(`${command.exe} is missing. Install or repair the repack first.`);
    await fsp.mkdir(path.dirname(this.logFile(logId)), { recursive: true });
    return new Promise((resolve, reject) => {
      const child = spawn(exe, command.args.map(arg => arg.replace(/\{root\}/g, this.root)), { cwd: this.root, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
      let output = '';
      const collect = chunk => { output += chunk.toString(); if (output.length > 200000) output = output.slice(-100000); };
      child.stdout.on('data', collect);
      child.stderr.on('data', collect);
      // A command that ended early closes its stdin: writing to it then fails with EPIPE, which must not crash the launcher.
      child.stdin.on('error', () => {});
      for (const line of input) { try { child.stdin.write(`${line}\r\n`); } catch (error) { if (!PIPE_GONE.has(error.code)) throw error; } }
      try { child.stdin.end(); } catch {}
      const timer = setTimeout(() => { exec('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }).catch(() => child.kill()); reject(new Error(`${command.exe} took too long.`)); }, command.timeout * 1000);
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('exit', code => {
        clearTimeout(timer);
        for (const secret of secrets) output = output.split(secret).join('********');
        fs.appendFileSync(this.logFile(logId), `\n==== ${new Date().toISOString()} ${path.basename(command.exe)} ${command.args.join(' ')} (exit ${code}) ====\n${output}`);
        if (code === 0) resolve(output);
        else reject(new Error(output.split(/\r?\n/).filter(Boolean).slice(-2).join(' ') || `${command.exe} failed (exit ${code}).`));
      });
    });
  }

  resolve(relative) {
    const file = path.resolve(this.root, relative);
    if (!file.startsWith(this.root + path.sep)) throw new Error('Path outside the repack folder.');
    return file;
  }

  logFile(id) { return path.join(this.root, 'logs', `launcher-${id}.log`); }

  // Who listens on a port: { pid, file, inside } (inside = a program of this repack). Several
  // repacks use the same ports, so an answering port is not proof that this server is running.
  async portOwner(port) {
    if (process.platform !== 'win32') return null;
    const stdout = await listening();
    const line = stdout.split(/\r?\n/).find(row => new RegExp(`:${port}\\s+\\S+\\s+LISTENING\\s+\\d+`).test(row));
    const pid = Number(line?.trim().split(/\s+/).pop());
    if (!pid) return null;
    this.paths ||= new Map();
    if (!this.paths.has(pid)) {
      if (this.paths.size > 64) this.paths.clear();
      this.paths.set(pid, await this.exePath(pid));
    }
    const file = this.paths.get(pid);
    if (!file) return { pid, file: '', inside: null };
    return { pid, file, inside: this.inside(file) };
  }

  // The full path of a running process ('' when it ended or cannot be read).
  async exePath(pid) {
    const { stdout } = await exec('powershell.exe', ['-NoProfile', '-Command', `(Get-Process -Id ${Number(pid)}).Path`], { windowsHide: true, timeout: 10000 }).catch(() => ({ stdout: '' }));
    return String(stdout).trim();
  }

  inside(file) { return !!file && path.resolve(file).toLowerCase().startsWith(this.root.toLowerCase() + path.sep); }

  // The programs of this server still running, whoever started them (a previous launcher, the repack's own scripts):
  // only processes whose executable lies inside the server folder, never another MySQL of the PC.
  async processesInside(names = ['mysqld.exe', 'authserver.exe', 'worldserver.exe']) {
    if (process.platform !== 'win32') return [];
    const filter = names.map(name => `Name='${name.replace(/[^\w.-]/g, '')}'`).join(' OR ');
    const script = `Get-CimInstance Win32_Process -Filter "${filter}" | ForEach-Object { '{0}|{1}' -f $_.ProcessId, $_.ExecutablePath }`;
    const { stdout } = await exec('powershell.exe', ['-NoProfile', '-Command', script], { windowsHide: true, timeout: 15000 }).catch(() => ({ stdout: '' }));
    return String(stdout).split(/\r?\n/).map(line => {
      const at = line.indexOf('|');
      return at > 0 ? { pid: Number(line.slice(0, at).trim()), file: line.slice(at + 1).trim() } : null;
    }).filter(item => item && Number.isInteger(item.pid) && item.pid > 0 && this.inside(item.file));
  }

  async processAlive(id) {
    try {
      const record = JSON.parse(fs.readFileSync(path.join(this.root, '.state', `${id}.json`), 'utf8'));
      if (!record?.pid || !String(record.exe || '').toLowerCase().startsWith(this.root.toLowerCase())) return false;
      process.kill(Number(record.pid), 0);
      if (process.platform !== 'win32') return true;
      // Windows gives a number again once its process ended (the launcher itself got MySQL's old one): the process
      // must still be the program the repack started.
      const { stdout } = await exec('tasklist.exe', ['/FI', `PID eq ${Number(record.pid)}`, '/FO', 'CSV', '/NH'], { windowsHide: true, timeout: 8000 });
      const name = /^"([^"]+)"/m.exec(stdout)?.[1] || '';
      // Same program name is not enough either: Windows may give the number to another copy of it (another server's
      // MySQL). The running file must be the one inside this server, else the record is old (it stays: it is manage.py's).
      if (name.toLowerCase() !== path.basename(String(record.exe)).toLowerCase()) return false;
      const file = await this.exePath(record.pid);
      return !file || this.inside(file);
    } catch { return false; }
  }

  async status() {
    const result = [];
    for (const service of this.services) {
      const open = await portOpen(service.port);
      const transient = this.states.get(service.id);
      let state = transient && (transient === 'starting' ? !open : open) ? transient : open ? 'running' : 'stopped';
      // The repack records the process it started (.state/<service>.json): alive with its port still closed,
      // the service is loading (a first world start with bots takes minutes), not stopped.
      // While it stops, the world closes its port first and saves for a few seconds more: still « stopping ».
      if (state === 'stopped' && await this.processAlive(service.id)) state = transient === 'stopping' || this.ending.has(service.id) ? 'stopping' : 'starting';
      else if (state === 'stopped') this.ending.delete(service.id);
      let other = '';
      if (state === 'running') {
        const owner = await this.portOwner(service.port);
        if (owner?.inside === false) { state = 'foreign'; other = owner.file; }
      }
      result.push({ id: service.id, name: service.name, port: service.port, state, other, variant: this.variant(service), managed: this.children.has(service.id), console: service.console && this.children.has(service.id) });
    }
    return result;
  }

  async assertPortFree(service) {
    if (!(await portOpen(service.port))) return false;
    const owner = await this.portOwner(service.port);
    if (owner?.inside === false) throw new Error(`${service.name}: port ${service.port} is used by another program (${owner.file}). Stop it first.`);
    return true;
  }

  async emit() { this.notify(await this.status()); }

  // A second Start of a service already starting (double click, home page and a realm card) waits for the first one.
  start(id) {
    this.pending ||= new Map();
    if (this.pending.has(id)) return this.pending.get(id);
    const job = this.startOnce(id).finally(() => this.pending.delete(id));
    this.pending.set(id, job);
    return job;
  }

  async startOnce(id) {
    const service = this.services.find(item => item.id === id);
    if (!service) throw new Error('Unknown service.');
    if (this.states.get(id) === 'stopping') throw new Error(`${service.name} is stopping: wait until it is stopped.`);
    this.ending.delete(id);
    if (await this.assertPortFree(service)) return;
    const start = this.startCommand(service);
    if (start) {
      // The repack's own manager starts the service (and whatever it depends on) and waits for it.
      this.states.set(id, 'starting');
      await this.emit();
      const began = Date.now();
      try { await this.run({ ...start, timeout: Math.max(start.timeout, service.startTimeout) }, id); }
      catch (error) {
        // CoA 2.9.2 and older give up after 20 s on a slow or busy PC while the supervisor still starts the world:
        // the start is only failed once nothing of it is alive any more, or after the service's own time.
        if (!(await this.lateStart(service, began))) throw error;
      }
      finally { this.states.delete(id); await this.emit(); }
      if (!(await portOpen(service.port))) throw new Error(`${service.name} did not open port ${service.port}. Look at its log.`);
      if (id === 'auth') await this.onAuthStarted?.().catch(() => {});
      return;
    }
    const exe = this.resolve(service.exe);
    if (!fs.existsSync(exe)) throw new Error(`${service.name}: ${service.exe} is missing. Install or repair the repack first.`);
    await fsp.mkdir(path.dirname(this.logFile(id)), { recursive: true });
    const log = fs.openSync(this.logFile(id), 'a');
    fs.writeSync(log, `\n==== ${new Date().toISOString()} started by the launcher ====\n`);
    // The core's SQL updater writes the MySQL password to %TEMP%\mysql_ac.conf, a fixed name: a temp folder of its
    // own beside the program, so a realm applying its updates at the same time never removes it.
    const tmp = /^(world|auth)server\.exe$/i.test(path.basename(exe)) ? path.join(path.dirname(exe), 'tmp') : '';
    if (tmp) await fsp.mkdir(tmp, { recursive: true });
    // A --port argument follows the port the launcher watches (repack.json may move it), else the light never turns green.
    const args = service.args.map(arg => arg.replace(/\{root\}/g, this.root)).map(arg => /^--port=/i.test(arg) ? `--port=${service.port}` : arg);
    const child = spawn(exe, args, {
      cwd: this.resolve(service.cwd || '.'), windowsHide: true, detached: false,
      stdio: [service.console ? 'pipe' : 'ignore', log, log], env: tmp ? { ...process.env, TEMP: tmp, TMP: tmp } : process.env,
    });
    fs.closeSync(log);
    // The world and MySQL are started by the repack's script: the program itself is pinned once it appears.
    if (this.pin && (id === 'world' || id === 'mysql')) this.pin(id, this.root, Date.now()).catch(() => {});
    this.children.set(id, child);
    this.states.set(id, 'starting');
    // Writing to a program that has just ended fails on its pipe: an unhandled pipe error would crash the launcher.
    for (const stream of [child.stdin, child.stdout, child.stderr]) stream?.on('error', () => {});
    child.once('exit', () => { this.children.delete(id); this.states.delete(id); this.emit().catch(() => {}); });
    child.once('error', () => { this.children.delete(id); this.states.delete(id); });
    await this.emit();
    const deadline = Date.now() + service.startTimeout * 1000;
    while (Date.now() < deadline) {
      if (!this.children.has(id)) throw new Error(`${service.name} stopped while starting. Look at its log.`);
      if (await portOpen(service.port)) { this.states.delete(id); await this.emit(); if (id === 'auth') await this.onAuthStarted?.().catch(() => {}); return; }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    this.states.delete(id);
    await this.emit();
    throw new Error(`${service.name} did not open port ${service.port} in time. Look at its log.`);
  }

  // The port opened after the start script gave up, while the repack's supervisor or the service's own process lived.
  async lateStart(service, began) {
    const deadline = began + service.startTimeout * 1000;
    for (;;) {
      if (await portOpen(service.port)) return true;
      if (Date.now() >= deadline) return false;
      if (!(await this.processAlive(service.id)) && !(service.id === 'world' && await this.processAlive('supervisor'))) return false;
      await new Promise(resolve => setTimeout(resolve, this.lateDelay ?? 2000));
    }
  }

  startCommand(service) {
    if (this.withBots === false) return service.start;
    const alternative = (service.alternatives || []).find(item => fs.existsSync(path.join(this.root, item.exists)));
    return alternative?.start || service.start;
  }

  // Which variant a service will start with, for the page ("Worldserver · with CoA Bots").
  variant(service) {
    if (this.withBots === false) return '';
    return (service.alternatives || []).find(item => fs.existsSync(path.join(this.root, item.exists)))?.label || '';
  }

  // The worldserver applies the updates of the auth database too: the authserver starts once the world is up
  // (an authserver of CoA Bots 2.6 stops at start when its new tables are not there yet).
  async startAll() {
    const order = [...this.services.filter(service => service.id !== 'auth'), ...this.services.filter(service => service.id === 'auth')];
    for (const service of order) await this.start(service.id);
  }

  // Finds the process listening on a port and returns it only if it lives in the repack folder.
  async ownedProcess(port) {
    const owner = await this.portOwner(port);
    return owner?.inside ? { pid: owner.pid, file: owner.file } : null;
  }

  // A stop done outside this class (the world by its console): shown « stopping » while it runs and afterwards, as long
  // as the process is still saving.
  async stopping(id, work) {
    this.states.set(id, 'stopping');
    this.ending.add(id);
    await this.emit();
    try { return await work(); } finally { this.states.delete(id); await this.emit(); }
  }

  async stop(id) {
    this.lastStop = Date.now();
    const service = this.services.find(item => item.id === id);
    if (!service) throw new Error('Unknown service.');
    if (!(await portOpen(service.port))) return;
    // A service started by the repack's manager is stopped the way the manager wants: all together, in order.
    if (service.start && !service.stop && this.commands.stopAll) { await this.stopAll(); return; }
    this.states.set(id, 'stopping');
    this.ending.add(id);
    await this.emit();
    const child = this.children.get(id);
    try {
      if (service.stop) {
        await this.run(service.stop, id);
      } else if (child && service.console && service.stopCommand) {
        // A console already closed means the world ended by itself: the wait below sees it.
        if (child.stdin?.writable) { try { child.stdin.write(`${service.stopCommand}\r\n`); } catch (error) { if (!PIPE_GONE.has(error.code)) throw error; } }
      } else if (service.stopExe) {
        // A busy MySQL (the world has just saved) may answer late or fail: the wait and the last resort below still stop it.
        await this.gracefulStop(service);
      } else if (child) {
        await exec('taskkill.exe', ['/PID', String(child.pid), '/T'], { windowsHide: true }).catch(() => {});
      } else {
        const owner = await this.ownedProcess(service.port);
        if (!owner) throw new Error(`${service.name} was not started from this repack; stop it where it was started.`);
        await exec('taskkill.exe', ['/PID', String(owner.pid), '/T'], { windowsHide: true }).catch(() => {});
      }
      const deadline = Date.now() + 90 * 1000;
      while (Date.now() < deadline && await portOpen(service.port)) await pause(1000);
      if (await portOpen(service.port)) {
        const owner = child ? { pid: child.pid } : await this.ownedProcess(service.port);
        if (owner) await exec('taskkill.exe', ['/PID', String(owner.pid), '/T', '/F'], { windowsHide: true }).catch(() => {});
      }
    } finally {
      this.states.delete(id);
      await this.emit();
    }
  }

  async gracefulStop(service) {
    await exec(this.resolve(service.stopExe), service.stopArgs, { cwd: this.root, windowsHide: true, timeout: 60000 })
      .catch(error => { this.note(service.id, `${path.basename(service.stopExe)} failed (${error.message}); the launcher waits for the port, then stops it itself.`); });
  }

  async anyOpen(services) {
    for (const service of services) if (await portOpen(service.port)) return true;
    return false;
  }

  // Never under a world or an authserver still at work (the world closes its port first and saves for a while):
  // once they are gone, a MySQL of this server still running gets a minute to end, then is ended.
  async stopMysqlLeft() {
    const mysql = this.services.find(service => service.id === 'mysql');
    if (!mysql || process.platform !== 'win32') return;
    const others = this.services.filter(service => service.id !== 'mysql');
    const until = Date.now() + (this.saveWait ?? 300000);
    for (;;) {
      if (await this.anyOpen(others)) return;
      if (!(await this.processesInside(['worldserver.exe', 'authserver.exe'])).length) break;
      if (Date.now() >= until) return;
      await pause(2000);
    }
    const left = async () => (await this.processesInside(['mysqld.exe'])).length > 0 || (await this.ownedProcess(mysql.port)) !== null;
    const grace = Date.now() + (this.mysqlWait ?? 60000);
    while (Date.now() < grace && await left()) await pause(2000);
    let found = await this.processesInside(['mysqld.exe']);
    if (!found.length) return;
    this.note('mysql', `MySQL still running after the stop (${found.map(item => `PID ${item.pid}`).join(', ')}): ending it.`);
    for (const item of found) await exec('taskkill.exe', ['/PID', String(item.pid), '/T'], { windowsHide: true }).catch(() => {});
    const last = Date.now() + 20000;
    while (Date.now() < last && (found = await this.processesInside(['mysqld.exe'])).length) await pause(2000);
    for (const item of found) await exec('taskkill.exe', ['/PID', String(item.pid), '/T', '/F'], { windowsHide: true }).catch(() => {});
    if (found.length) this.note('mysql', `MySQL forced to stop (${found.map(item => `PID ${item.pid}`).join(', ')}).`);
  }

  note(id, text) { try { fs.appendFileSync(this.logFile(id), `\n==== ${new Date().toISOString()} ${text}\n`); } catch {} }

  async stopAll() {
    this.lastStop = Date.now();
    if (this.commands.stopAll) {
      for (const service of this.services) { this.states.set(service.id, 'stopping'); this.ending.add(service.id); }
      await this.emit();
      let failure = null;
      try {
        // A worldserver that has only just started may refuse the graceful-shutdown connection:
        // one more try a few seconds later, before reporting a failure.
        try { await this.run(this.commands.stopAll, 'stop-all'); }
        catch {
          await pause(this.retryDelay ?? 15000);
          try { await this.run(this.commands.stopAll, 'stop-all'); } catch (error) { failure = error; }
        }
        // MySQL left behind (the stop script failed, or a previous launcher started it): stopped anyway.
        await this.stopMysqlLeft();
      } finally { this.states.clear(); await this.emit(); }
      if (failure && this.services.some(service => service.id !== 'mysql') && await this.anyOpen(this.services.filter(service => service.id !== 'mysql'))) throw failure;
      return;
    }
    for (const service of [...this.services].reverse()) await this.stop(service.id);
  }

  // Creates a game account (or gives an existing one a new password) through the repack console command, or the worldserver we started.
  async createAccount(name, password, gm, { change = false } = {}) {
    if (!ACCOUNT.test(name) || !PASSWORD.test(password)) throw new Error('Account names use 3-17 letters or digits; passwords 6-16 characters without spaces.');
    const commands = change ? [`account set password ${name} ${password} ${password}`] : [`account create ${name} ${password}`, ...(gm ? [`account set gmlevel ${name} 3 -1`] : [])];
    if (this.commands.console) {
      const lines = [...commands, 'exit'];
      const output = await this.run(this.commands.console, 'console', lines, [password]);
      // The password went through stdin only; strip it from anything we keep or show.
      // The console echoes its "AC>" prompt around each answer: keep the answers only.
      return output.split(password).join('********').split(/\r?\n/).map(line => line.replace(/AC>\s*/g, '').trim())
        .filter(line => line && !/^World console/i.test(line)).slice(-6).join('\n');
    }
    const world = this.services.find(service => service.console);
    const child = world && this.children.get(world.id);
    if (!child?.stdin?.writable) throw new Error('Start the worldserver from the launcher first.');
    for (const command of commands) {
      try { child.stdin.write(`${command}\r\n`); }
      catch (error) { if (PIPE_GONE.has(error.code)) throw new Error('The worldserver has just stopped: the command was not sent.'); throw error; }
    }
  }

  async tail(id, lines = 200) {
    if (!this.services.some(service => service.id === id)) throw new Error('Unknown service.');
    const file = this.logFile(id);
    const stat = await fsp.stat(file).catch(() => null);
    if (!stat) return '';
    const size = Math.min(stat.size, 256 * 1024);
    const handle = await fsp.open(file, 'r');
    try {
      const buffer = Buffer.alloc(size);
      await handle.read(buffer, 0, size, stat.size - size);
      return buffer.toString('utf8').split(/\r?\n/).slice(-lines).join('\n');
    } finally { await handle.close(); }
  }

}

// netstat once for every question of the same tick (status() asks it for each running service).
let netstatCache = { at: 0, job: null };
function listening() {
  if (process.platform !== 'win32') return Promise.resolve('');
  if (netstatCache.job && Date.now() - netstatCache.at < 3000) return netstatCache.job;
  netstatCache = { at: Date.now(), job: exec('netstat.exe', ['-ano', '-p', 'TCP'], { windowsHide: true, timeout: 10000 }).then(result => result.stdout).catch(() => '') };
  return netstatCache.job;
}

module.exports = { ServerControl, validateServices, validateCommand, portOpen };
