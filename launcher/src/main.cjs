'use strict';
// CoA Launcher Lite, main process: the game (install, update, addons, play) and a local server
// (repack + bot package: services, updates, backups, upgrades). No account, no store, no web API:
// every download is a signed static file.
const { app, BrowserWindow, ipcMain, dialog, shell, protocol, net, session, clipboard, Tray, Menu, Notification, nativeImage } = require('electron');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs/promises');
const netSocket = require('node:net');
const { pathToFileURL } = require('node:url');
const { loadConfig } = require('./config.cjs');
const { readSettings, writeSettings } = require('./settings.cjs');
const { ClientUpdater } = require('./client-updater.cjs');
const { AddonManager } = require('./addons.cjs');
const { requireGameClosed, configureRealmlist, realmlistStatus, launch } = require('./game.cjs');
const { ServerControl, portOpen } = require('./server-control.cjs');
const { ServerConfig } = require('./server-config.cjs');
const { ServerBackup } = require('./server-backup.cjs');
const { ServerUpgrade, inspect: inspectRepack, suggestFolder } = require('./server-upgrade.cjs');
const { BotsPackage } = require('./bots.cjs');
const assembler = require('./assembler.cjs');
const { peekUpdates } = require('./updates.cjs');
const fs_exists = folder => require('node:fs').existsSync(folder);
const { runChecks, summary } = require('./verify.cjs');
const { FIXES } = require('./repack-checks.cjs');
const { Dashboard } = require('./dashboard.cjs');
const network = require('./network.cjs');
const repackImport = require('./repack-import.cjs');
const { cleanFeed } = require('./feed.cjs');
const repackUpdate = require('./repack-update.cjs');
const addonSync = require('./addon-sync.cjs');
const manastormClient = require('./manastorm-client.cjs');
const components = require('./components.cjs');
const sqlConsole = require('./sql-console.cjs');
const realmCards = require('./realm-cards.cjs');
const botAchievements = require('./bot-achievements.cjs');
const tweaks = require('./repack-tweaks.cjs');
const live = require('./live.cjs');
const modules = require('./modules.cjs');
const realms = require('./realms.cjs');
const { mysqlLender } = require('./mysql-lender.cjs');
// The repack's own updates (squidbots-updates releases): the signed list, the run in progress, its last result.
const update = { manifest: null, error: null, busy: false, phase: null, last: null };
let feed = null;
// Who is online on the community server: Discord's public widget (only when the server owner enabled it).
async function discordWidget(id) {
  try {
    const response = await net.fetch(`https://discord.com/api/guilds/${id}/widget.json`, { signal: AbortSignal.timeout(10000) });
    if (!response.ok) return null;
    const data = await response.json();
    const name = value => String(value ?? '').slice(0, 40);
    return {
      name: name(data.name), online: Number(data.presence_count) || 0,
      invite: /^https:\/\/discord\.com\/invite\/[\w-]+$/.test(data.instant_invite || '') ? data.instant_invite : '',
      members: (Array.isArray(data.members) ? data.members : []).slice(0, 8).map(member => ({ name: name(member.username), status: ['online', 'idle', 'dnd'].includes(member.status) ? member.status : 'online' })),
    };
  } catch { return null; }
}

// The news feed is read at start and every 30 minutes; the home page gets it as soon as it changes.
async function refreshFeed() {
  if (!config.feedUrl) return null;
  try {
    const { data } = await fetchSigned(new URL(config.feedUrl), { key: config.keys.server, fetchImpl: (u, o) => net.fetch(String(u), o), signal: AbortSignal.timeout(20000), maxBytes: 1024 * 1024, redirect: 'follow' });
    const next = cleanFeed(data);
    if (next.discord?.id) next.discord.live = await discordWidget(next.discord.id);
    if (JSON.stringify(next) !== JSON.stringify(feed)) { feed = next; send('feed:update', feed); }
  } catch {}
  return feed;
}
const { fetchSigned } = require('./signing.cjs');
const { createLauncherUpdates } = require('./launcher-updates.cjs');
const clientTools = require('./client-tools.cjs');
const support = require('./support.cjs');
const { safePath, statOrNull } = require('./release-format.cjs');

const SCHEME = 'conquest';
const APP_URL = `${SCHEME}://launcher/index.html`;
const publicRoot = path.resolve(__dirname, '../public');
const smokeArg = process.argv.find(arg => arg.startsWith('--smoke='));
const smokeDir = smokeArg ? path.resolve(smokeArg.slice('--smoke='.length)) : '';

if (process.env.COA_LAUNCHER_PROFILE) app.setPath('userData', path.resolve(process.env.COA_LAUNCHER_PROFILE));
app.setName('CoA Launcher Lite');
if (process.platform === 'win32') app.setAppUserModelId('org.coa.launcher-lite');
protocol.registerSchemesAsPrivileged([{ scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

let config;
let settings;
let settingsFile;
let window = null;
let launcherUpdates = null;
let game = null;
let busyFiles = false;
let saveChain = Promise.resolve();
let updater = null;
let addons = null;
let repackUpdater = null;
let bots = null;
let control = null;
let tools = null;
const upgrade = new ServerUpgrade({ notify: update => upgradeNotify(update) });
const upgradeState = { running: false, step: '', log: [] };
const dashboard = new Dashboard();

const send = (channel, payload) => { if (window && !window.isDestroyed()) window.webContents.send(channel, payload); };
const text = (value, max = 200) => String(value ?? '').slice(0, max);

function persist(next) {
  const run = saveChain.then(async () => { settings = await writeSettings(settingsFile, next); return settings; });
  saveChain = run.catch(() => {});
  return run;
}

const gamePath = () => settings.installPaths.game || '';
const serverPath = () => settings.installPaths.server || '';
const realmlist = () => settings.realmlist || config.game.realmlists[0].address;

function upgradeNotify(update) {
  if (update.line !== undefined) { upgradeState.log.push(update.line); if (upgradeState.log.length > 400) upgradeState.log.shift(); }
  if (update.step) upgradeState.step = update.step;
  send('server:upgrade', { ...update, running: upgradeState.running });
}

function serverControl() {
  if (!config.server || !serverPath()) return null;
  const ports = inspectRepack(serverPath()).ports;
  const services = config.server.services.map(service => ({ ...service, port: ports[service.id] || service.port }));
  const key = `${path.resolve(serverPath())}|${services.map(service => service.port).join(',')}`;
  if (!control || control.key !== key) {
    control = new ServerControl({ root: serverPath(), services, commands: config.server.commands, notify: status => send('repack:services', status), onAuthStarted: () => realms.onlineRunning(serverPath()) });
    control.key = key;
  }
  control.withBots = settings.modules?.squidbots !== false;
  return control;
}

function serverTools() {
  if (!config.server || !serverPath()) throw new Error('Choose the server folder first.');
  if (!tools || tools.root !== path.resolve(serverPath())) {
    const backup = new ServerBackup(serverPath(), { notify: status => send('server:task', status) });
    tools = { root: path.resolve(serverPath()), config: new ServerConfig(serverPath()), backup };
  }
  return tools;
}

async function clientInfo() {
  const folder = gamePath();
  const installed = !!folder && !!(await statOrNull(path.join(folder, config.game.clientExecutable)).catch(() => null))?.isFile();
  return {
    path: folder, installed, running: !!game, executable: config.game.clientExecutable, realmlist: realmlist(),
    version: installed && updater ? await updater.installedVersion(folder) : '',
    progress: updater?.status || { phase: 'idle', message: '' },
    updatesEnabled: !!updater,
  };
}

// A CoA patch of the game since its tables were extracted for this server: read at most every 10 minutes
// (names, sizes and dates of the game archives). Only for data the launcher extracted itself.
let clientDrift = { key: '', at: 0, changed: false };
async function assemblyInfo(folder) {
  const asm = assembler.state(folder);
  // The game the data were taken from (the Game folder of the settings is often empty on a server-only PC).
  const client = [asm.client, gamePath()].find(item => item && fs_exists(item)) || '';
  if (!client || !asm.extracted || asm.needed) return { ...asm, clientChanged: false };
  const key = `${path.resolve(folder)}|${path.resolve(client)}`;
  if (clientDrift.key !== key || Date.now() - clientDrift.at > 10 * 60 * 1000) clientDrift = { key, at: Date.now(), changed: await assembler.clientChanged(folder, client) };
  return { ...asm, clientChanged: clientDrift.changed };
}

// The world reads the navigation maps as bots need them and keeps those it read: maps finished after it started
// are all in use only after a restart. Started = the process time the repack's supervisor wrote (.state/world.json).
function mmapsNeedRestart(folder, asm) {
  if (!asm.applies || !asm.mmaps?.complete || asm.mmaps.running) return false;
  try {
    const finished = require('node:fs').statSync(path.join(folder, 'Data', 'mmaps')).mtimeMs;
    const record = JSON.parse(require('node:fs').readFileSync(path.join(folder, '.state', 'world.json'), 'utf8'));
    if (!record?.pid || !record.created) return false;
    process.kill(Number(record.pid), 0);
    const started = Number(record.created) / 10000 - 11644473600000;
    return started < finished;
  } catch { return false; }
}

// The bots' navigation maps we publish (manifest.json signed, one zip per map), read at most every 30 minutes.
let mmapsList = { at: 0, data: null };
async function publishedMmaps() {
  if (!config.server?.mmapsUrl) return null;
  if (mmapsList.data && Date.now() - mmapsList.at < 30 * 60 * 1000) return mmapsList.data;
  const { data } = await fetchSigned(new URL('manifest.json', config.server.mmapsUrl), { key: config.keys.server, fetchImpl: netFetch, signal: AbortSignal.timeout(20000), maxBytes: 1024 * 1024, redirect: 'follow' });
  if (data?.format !== 1 || !data.maps || typeof data.maps !== 'object') throw new Error('The list of navigation maps is malformed.');
  mmapsList = { at: Date.now(), data };
  return data;
}
// Only an assembler that knows the command (packages from 2.8.1 on).
function canFetchMmaps(folder) {
  try { return require('node:fs').readFileSync(path.join(folder, 'Assembler', 'coa_assemble.py'), 'utf8').includes('mmaps-fetch'); } catch { return false; }
}
// The maps whose maps/vmaps here are those we built them from are downloaded; the others stay to be built here.
async function downloadMmaps(folder, onEvent) {
  const data = await publishedMmaps();
  if (!data) return false;
  const file = path.join(folder, '.state', 'mmaps-manifest.json');
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(data));
  // The assembler says how far it is between two maps only; a large map (150 MB) would show 0 % for a minute, so
  // the bytes of the map being downloaded (its .part file) are added every second and a half.
  const known = { done: 0, total: 0, text: '' };
  const cache = path.join(folder, 'Data', '.work-mmaps-download');
  const live = setInterval(async () => {
    if (!known.total) return;
    const names = await fs.readdir(cache).catch(() => []);
    const sizes = await Promise.all(names.filter(name => name.endsWith('.part')).map(name => fs.stat(path.join(cache, name)).then(stat => stat.size, () => 0)));
    // Never backwards: a map just finished is no longer a .part, and not yet counted by the assembler.
    known.shown = Math.max(known.shown || 0, Math.min(known.total, known.done + sizes.reduce((sum, size) => sum + size, 0)));
    onEvent({ event: 'progress', step: 'mmaps-fetch', done: known.shown, total: known.total, text: known.text });
  }, 1500);
  try {
    await assembler.fetchMmaps(folder, file, config.server.mmapsUrl, event => {
      if (event.event === 'progress') {
        Object.assign(known, { done: event.done || 0, total: event.total || 0, text: event.text || '' });
        known.shown = Math.max(known.shown || 0, known.done);
        onEvent({ ...event, done: known.shown });
      } else if (event.event === 'log') onEvent(event);
    });
  } finally { clearInterval(live); await fs.rm(file, { force: true }); }
  return true;
}
let mmapsFetching = false;

async function serverInfo() {
  if (!config.server) return null;
  const folder = serverPath();
  const found = serverControl();
  return {
    path: folder,
    installed: !!folder && !!(await statOrNull(path.join(folder, config.server.requiredExecutable)).catch(() => null)),
    version: folder && repackUpdater ? await repackUpdater.installedVersion(folder) : '',
    progress: repackUpdater?.status || { phase: 'idle' },
    updatesEnabled: !!repackUpdater,
    services: found ? await found.status() : config.server.services.map(service => ({ id: service.id, name: service.name, port: service.port, state: 'unknown' })),
    ports: folder ? inspectRepack(folder).ports : null,
    details: folder ? inspectRepack(folder) : null,
    // A package without game data: what the assembler still has to do here (data from the client, database, mmaps).
    assembly: folder ? await assemblyInfo(folder) : { applies: false },
    mmapsRestart: folder ? mmapsNeedRestart(folder, assembler.state(folder)) : false,
    driveBus: folder ? await driveBus(folder) : '',
    bots: bots ? { name: config.server.bots.name, description: config.server.bots.description, ...(await bots.info(folder)) } : null,
    canPurgeBots: !!config.server.commands.purgeBots,
    // The extra realms whose world runs or starts: the home page counts the server as running with them alone.
    realmsOn: folder ? (await realms.status(folder, { live: false }).catch(() => ({ realms: [] }))).realms.filter(realm => ['running', 'starting'].includes(realm.state)).map(realm => ({ key: realm.key, state: realm.state })) : [],
  };
}

// The launcher, system folders and the user's own folders are never valid game or server folders.
function assertFolder(folder) {
  const target = path.resolve(folder).toLowerCase();
  const launcherRoot = path.resolve(app.isPackaged ? path.dirname(app.getPath('exe')) : path.join(__dirname, '..')).toLowerCase();
  const forbidden = [path.parse(target).root, app.getPath('home'), app.getPath('desktop'), app.getPath('documents'), process.env.WINDIR, process.env.ProgramFiles, process.env['ProgramFiles(x86)'], app.getPath('userData')]
    .filter(Boolean).map(item => path.resolve(item).toLowerCase());
  if (forbidden.includes(target)) throw new Error('Choose a dedicated folder, for example C:\\Games\\Conquest.');
  if (target === launcherRoot || target.startsWith(launcherRoot + path.sep) || launcherRoot.startsWith(target + path.sep)) throw new Error('The game cannot live inside the launcher folder.');
}

// MySQL and the worldserver need a disk of this PC: on a network drive (a NAS, \\server\share) they lose or lock their files.
async function assertLocalDrive(folder) {
  const target = path.resolve(folder);
  const network = 'The server needs a disk of this PC: a network drive (NAS, shared folder) breaks MySQL. Choose a folder on C: or another local disk.';
  if (target.startsWith('\\\\')) throw new Error(network);
  const letter = /^[A-Za-z]:/.test(target) ? target[0] : '';
  if (!letter) return;
  const type = await new Promise(resolve => require('node:child_process').execFile('powershell.exe', ['-NoProfile', '-Command', `[System.IO.DriveInfo]::new('${letter}').DriveType`], { windowsHide: true, timeout: 15000 }, (error, out) => resolve(error ? '' : String(out).trim())));
  if (type === 'Network') throw new Error(network);
}

// The bus of the server's disk (USB for an external drive, where MySQL can freeze): read once per drive letter.
const driveBuses = new Map();
async function driveBus(folder) {
  const letter = /^[A-Za-z]:/.test(path.resolve(folder)) ? path.resolve(folder)[0].toUpperCase() : '';
  if (!letter) return '';
  if (!driveBuses.has(letter)) driveBuses.set(letter, new Promise(resolve => require('node:child_process').execFile('powershell.exe', ['-NoProfile', '-Command', `(Get-Partition -DriveLetter ${letter} | Get-Disk).BusType`], { windowsHide: true, timeout: 15000 }, (error, out) => resolve(error ? '' : String(out).trim()))));
  return driveBuses.get(letter);
}

// With the bots comes their in-game addon (SquidBots Lite): installed once per game folder, when both the
// bots and the game are there. A player who removes it later is not asked again.
async function offerBotsAddon() {
  const id = config.server?.bots?.addon;
  if (!id || !addons || !bots || game || busyFiles || updater?.busy) return '';
  const info = await clientInfo();
  if (!info.installed || !serverPath() || !(await bots.info(serverPath())).installed) return '';
  const marker = await safePath(info.path, '.coa-launcher/bots-addon.json', { internal: true });
  if (await statOrNull(marker)) return '';
  const pkg = (await addons.list(info.path)).packages.find(item => item.id === id);
  if (!pkg) return '';
  let installed = '';
  if (pkg.status === 'available') {
    busyFiles = true;
    try { await addons.install(info.path, [id]); installed = pkg.name; } finally { busyFiles = false; }
  }
  await fs.mkdir(path.dirname(marker), { recursive: true });
  await fs.writeFile(marker, JSON.stringify({ addon: id, at: new Date().toISOString() }));
  return installed;
}

async function exclusiveFiles(action) {
  if (busyFiles || updater?.busy) throw new Error('Another file operation is running. Wait for it to finish.');
  if (game) throw new Error('Close the game first.');
  busyFiles = true;
  try { await requireGameClosed(config.game.processNames, gamePath()); return await action(); }
  finally { busyFiles = false; }
}

async function gameFolder() {
  const info = await clientInfo();
  if (!info.installed) throw new Error('Install or locate the game first.');
  return info.path;
}

// Is the realm the player chose answering? (its login port, 3724 unless the address says otherwise)
function probe(address) {
  const [host, port] = address.split(':');
  return new Promise(resolve => {
    const socket = netSocket.connect({ host, port: Number(port) || 3724, timeout: 1500 });
    const done = ok => { socket.destroy(); resolve(ok); };
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

function publicConfig() {
  return {
    appName: config.appName,
    edition: config.edition,
    hasFeed: !!config.feedUrl,
    hasMmaps: !!config.server?.mmapsUrl,
    // The repack updater: core, bots and addon come from one signed update; the old bots channel is not offered.
    hasUpdates: !!config.server?.updatesUrl,
    hasBeta: !!config.server?.betaUpdatesUrl,
    hasMultirace: !!config.server?.multirace,
    hasTestChannel: !!(config.game.testManifestUrl || config.server?.testManifestUrl || config.server?.bots?.testManifestUrl),
    game: { name: config.game.name, realmlists: config.game.realmlists, updatesOnly: config.game.updatesOnly, baseClient: config.game.baseClient ? { note: config.game.baseClient.note } : null, hasClient: !!config.game.manifestUrl, hasAddons: !!config.game.addonCatalogUrl, signed: !!config.keys.game },
    server: config.server ? { repackSource: config.server.repackSource, repackSourceUrl: !!config.server.repackSourceUrl, hosted: !!config.server.manifestUrl, description: config.server.description, hasBots: !!config.server.bots, botsName: config.server.bots?.name || '' } : null,
    discord: !!config.discordUrl,
  };
}

// MySQL started only for one operation on a stopped server (a backup, the SQL console, the characters, the network
// choice, the bots installer, the preparation...) is stopped again when it ends, so the home page never shows
// « 1 service of 3 running » that the player did not start. Left as it was when it already ran, or when a world,
// the authserver or a realm runs.
const mysqlState = async () => (serverControl() ? await serverControl().status().catch(() => []) : []);
const anyRealmRunning = async () => (serverPath() ? (await realms.status(serverPath(), { live: false })).realms.some(realm => ['running', 'starting'].includes(realm.state)) : false);
const lendMysql = mysqlLender({ status: mysqlState, start: async id => { await serverControl()?.start(id); }, stopAll: async () => { await serverControl()?.stopAll(); }, realmRunning: anyRealmRunning });
// The same, for an operation that starts MySQL by itself (the assembler, the repack's scripts).
const afterMysql = mysqlLender({ status: mysqlState, start: async () => {}, stopAll: async () => { await serverControl()?.stopAll(); }, realmRunning: anyRealmRunning });
const LENDS_MYSQL = new Set(['chars:list', 'chars:export', 'chars:import', 'sql:run', 'backup:create', 'backup:restore', 'bots:install']);
const LEAVES_MYSQL = new Set(['network:save']);

function handle(channel, action) {
  ipcMain.handle(channel, async (event, ...args) => {
    // Only the launcher page itself may call in.
    if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || event.senderFrame.url !== APP_URL) return { ok: false, error: 'Request refused.' };
    const run = LENDS_MYSQL.has(channel) && serverControl() ? () => lendMysql(() => action(...args)) : LEAVES_MYSQL.has(channel) && serverControl() ? () => afterMysql(() => action(...args)) : () => action(...args);
    try { return { ok: true, value: await run() }; }
    catch (error) { return { ok: false, error: error.message || 'Something went wrong.', code: error.code, folders: error.folders }; }
  });
}

function registerIpc() {
  handle('bootstrap', async () => ({ config: publicConfig(), settings, client: await clientInfo(), version: app.getVersion(), launcherUpdate: launcherUpdates.status, smoke: !!smokeDir, whatsNew: whatsNew() }));
  handle('whatsnew:seen', async () => { await persist({ ...settings, lastSeenVersion: app.getVersion() }); return true; });
  handle('window', action => {
    if (action === 'minimize') window.minimize();
    else if (action === 'maximize') window.isMaximized() ? window.unmaximize() : window.maximize();
    else if (action === 'close') window.close();
  });
  handle('settings:save', async patch => {
    if (!patch || typeof patch !== 'object') throw new Error('Invalid settings.');
    const next = { ...settings };
    for (const key of ['language', 'theme', 'channel', 'startPage', 'realmlist', 'minimizeOnLaunch', 'reduceMotion', 'autoCheckAddons', 'betaUpdates', 'hideCloseNotice', 'trayOnClose', 'notifications', 'startWithWindows', 'startServerOnOpen', 'restartWorldOnCrash', 'dailyBackup']) if (Object.hasOwn(patch, key)) next[key] = patch[key];
    // Start with Windows: the launcher opens in the background (in the notification area) at logon.
    if (Object.hasOwn(patch, 'startWithWindows') && app.isPackaged) app.setLoginItemSettings({ openAtLogin: patch.startWithWindows === true, args: ['--hidden'] });
    const switching = Object.hasOwn(patch, 'channel') && patch.channel !== settings.channel;
    if (switching && (busyFiles || upgradeState.running || updater?.busy || repackUpdater?.busy || bots?.updater.busy || bots?.child)) throw new Error('Wait for the current operation to finish.');
    const saved = await persist(next);
    if (switching) createUpdaters();
    return saved;
  });
  handle('realm:probe', async () => ({ address: realmlist(), online: await probe(realmlist()) }));

  // ---- the game ----
  handle('client:info', clientInfo);
  handle('client:locate', async () => {
    const result = smokeDir && process.env.COA_SMOKE_GAME_DIR ? { filePaths: [process.env.COA_SMOKE_GAME_DIR] } : await dialog.showOpenDialog(window, { title: `Locate your game folder (contains ${config.game.clientExecutable})`, properties: ['openDirectory'], defaultPath: gamePath() || undefined });
    if (result.canceled || !result.filePaths[0]) return null;
    const folder = path.resolve(result.filePaths[0]);
    assertFolder(folder);
    if (!(await statOrNull(path.join(folder, config.game.clientExecutable)))?.isFile()) throw new Error(`This folder does not contain ${config.game.clientExecutable}.`);
    await safePath(folder, 'Interface/AddOns/.probe', { internal: true });
    await persist({ ...settings, installPaths: { ...settings.installPaths, game: folder } });
    return clientInfo();
  });
  handle('client:chooseInstall', async () => {
    if (config.game.updatesOnly) throw new Error('This launcher only updates an existing game: download the game first, then show its folder.');
    const result = await dialog.showOpenDialog(window, { title: 'Choose where to install the game', properties: ['openDirectory', 'createDirectory'], defaultPath: gamePath() || 'C:\\' });
    if (result.canceled || !result.filePaths[0]) return null;
    const folder = path.resolve(result.filePaths[0]);
    assertFolder(folder);
    const entries = await fs.readdir(folder);
    if (entries.length && !entries.some(name => name.toLowerCase() === config.game.clientExecutable.toLowerCase() || name === '.coa-launcher')) throw new Error(`Choose an empty folder, or an existing game folder containing ${config.game.clientExecutable}.`);
    if (serverPath() && path.resolve(serverPath()).toLowerCase() === folder.toLowerCase()) throw new Error('The server and the game need two different folders.');
    await persist({ ...settings, installPaths: { ...settings.installPaths, game: folder } });
    return clientInfo();
  });
  handle('client:check', async force => {
    if (!updater) return { needsUpdate: false, disabled: true };
    if (busyFiles) throw new Error('Another file operation is running.');
    return updater.check(gamePath(), { force: force === true, components: settings.components.game });
  });
  handle('client:update', async force => {
    if (!updater) throw new Error('No game release is configured.');
    if (!gamePath()) throw new Error('Choose a folder for the game first.');
    if (busyFiles) throw new Error('Another file operation is running.');
    if (game) throw new Error('Close the game first.');
    if (config.game.updatesOnly && !(await statOrNull(path.join(gamePath(), config.game.clientExecutable)))?.isFile()) throw new Error(`This folder does not contain ${config.game.clientExecutable}.`);
    busyFiles = true;
    let result;
    try {
      await clientTools.backupSettings(gamePath(), { automatic: true }).catch(() => null);
      result = await updater.update(gamePath(), { force: force === true, components: settings.components.game });
      await configureRealmlist(gamePath(), realmlist());
    } finally { busyFiles = false; }
    const addonInstalled = await offerBotsAddon().catch(() => '');
    return { ...result, client: await clientInfo(), addonInstalled };
  });
  handle('client:pause', () => updater?.cancel());
  handle('client:components', async choice => {
    if (!choice || typeof choice !== 'object') throw new Error('Invalid selection.');
    await persist({ ...settings, components: { ...settings.components, game: choice } });
    return settings.components.game || {};
  });
  handle('client:settingsBackups', async () => clientTools.listSettingsBackups(await gameFolder()));
  handle('client:backupSettings', async () => {
    const result = await clientTools.backupSettings(await gameFolder());
    if (!result) throw new Error('This game folder has no WTF folder yet: start the game once.');
    return result;
  });
  handle('client:restoreSettings', async id => exclusiveFiles(async () => clientTools.restoreSettings(await gameFolder(), text(id, 40))));
  handle('client:clearCache', async () => exclusiveFiles(async () => clientTools.clearCache(await gameFolder())));
  handle('client:openFolder', async () => {
    if (!gamePath()) throw new Error('No game folder selected yet.');
    const error = await shell.openPath(gamePath());
    if (error) throw new Error(error);
  });
  handle('game:launch', async () => {
    const info = await clientInfo();
    if (!info.installed) throw new Error('Install or locate the game first.');
    if (game) throw new Error('The game is already running.');
    await requireGameClosed(config.game.processNames, info.path).catch(() => { throw new Error('The game is already running from this folder.'); });
    if (busyFiles || updater?.busy) throw new Error('Wait for the current update to finish.');
    await configureRealmlist(info.path, realmlist());
    game = await launch(info.path, config.game.clientExecutable, () => { game = null; send('game:exit'); });
    if (settings.minimizeOnLaunch && !smokeDir) window.minimize();
    return { running: true };
  });

  // ---- addons ----
  handle('addons:list', async force => {
    if (!addons) return { packages: [], others: [], disabled: true };
    const info = await clientInfo();
    return addons.list(info.installed ? info.path : '', force === true);
  });
  handle('addons:install', async (ids, replaceManual) => exclusiveFiles(async () => {
    if (!addons) throw new Error('No addon catalog is configured.');
    if (!Array.isArray(ids) || !ids.length || ids.length > 200 || ids.some(id => typeof id !== 'string')) throw new Error('Invalid addon selection.');
    const folder = await gameFolder();
    await clientTools.backupSettings(folder, { automatic: true }).catch(() => null);
    return addons.install(folder, ids, { replaceManual: replaceManual === true, onProgress: (done, total) => send('addons:progress', { done, total }) });
  }));
  handle('addons:uninstall', async id => exclusiveFiles(async () => addons.uninstall(await gameFolder(), text(id, 80))));
  handle('addons:openFolder', async () => {
    const folder = await safePath(await gameFolder(), 'Interface/AddOns', { internal: true });
    await fs.mkdir(folder, { recursive: true });
    const error = await shell.openPath(folder);
    if (error) throw new Error(error);
  });

  // ---- local server ----
  const requireServer = () => { if (!config.server) throw new Error('No local server is configured.'); };
  const requireControl = () => { const found = serverControl(); if (!found) throw new Error('Choose the server folder first.'); return found; };
  handle('repack:info', serverInfo);
  handle('news:list', async () => {
    const out = [];
    for (const [area, source] of [['client', updater], ['server', repackUpdater], ['bots', bots?.updater]]) {
      if (!source) continue;
      try { const release = await source.peek(); out.push({ area, version: release.version, publishedAt: release.publishedAt, notes: release.notes, files: release.files, bytes: release.bytes }); } catch {}
    }
    const botsNews = out.find(item => item.area === 'bots');
    if (botsNews && serverPath()) {
      try {
        const text = await fs.readFile(path.join(serverPath(), config.server.bots.folder, 'CHANGELOG.md'), 'utf8');
        const sections = text.split(/^(?=## )/m).filter(part => part.startsWith('## '));
        if (sections[0]) botsNews.changelog = sections[0].slice(0, 12000);
      } catch {}
    }
    return out;
  });
  // ---- verification of the server (core, bots, services, database, files)
  handle('verify:run', async deep => {
    if (!config.server || !serverPath()) throw new Error('Choose the server folder first.');
    if (deep === true && (busyFiles || upgradeState.running)) throw new Error('Another file operation is running.');
    if (deep === true) busyFiles = true;
    try {
      const found = serverControl();
      const checks = await runChecks({ root: serverPath(), inspect: inspectRepack, control: found, backup: serverTools().backup, repack: repackUpdater, botsPackage: bots, deep: deep === true });
      // The bots' navigation maps, built once from the player's game: rebuilt only on demand (bots walking oddly).
      const asm = assembler.state(serverPath());
      if (asm.applies && !asm.needed && asm.mmaps.done > 0) checks.push({ group: 'bots', id: 'bots.mmaps', state: 'info', data: { done: asm.mmaps.done, total: asm.mmaps.total || asm.mmaps.done }, action: asm.mmaps.running ? '' : 'mmaps-rebuild' });
      // A newer set of our navigation maps than the one here (or than maps built here): offered, never forced.
      if (asm.applies && !asm.needed && canFetchMmaps(serverPath())) {
        const published = await publishedMmaps().catch(() => null);
        if (published?.version && published.version !== asm.mmaps.published) checks.push({ group: 'bots', id: 'bots.mmapsUpdate', state: 'info', data: { version: published.version }, action: asm.mmaps.running || mmapsFetching ? '' : 'mmaps-update' });
      }
      return { checks, summary: summary(checks), at: new Date().toISOString(), deep: deep === true };
    } finally { if (deep === true) busyFiles = false; }
  });
  // A safe fix from the list of known problems, then the quick checks again.
  handle('verify:fix', async id => {
    const fix = FIXES[text(id, 40)];
    if (!fix) throw new Error('Unknown fix.');
    if (!config.server || !serverPath()) throw new Error('Choose the server folder first.');
    if (busyFiles || upgradeState.running) throw new Error('Another operation is running.');
    const found = serverControl();
    await fix({ root: serverPath(), control: found, mysqlQuery: sql => serverTools().backup.query(sql) });
    const checks = await runChecks({ root: serverPath(), inspect: inspectRepack, control: found, backup: serverTools().backup, repack: repackUpdater, botsPackage: bots });
    return { checks, summary: summary(checks), at: new Date().toISOString(), deep: false };
  });
  // For the support: RELEASE.json and CoA-Bots\release.json, as the first answer on Discord always asks.
  handle('verify:versions', async () => {
    if (!serverPath()) throw new Error('Choose the server folder first.');
    const info = inspectRepack(serverPath());
    const read = async file => { try { return JSON.parse((await fs.readFile(path.join(serverPath(), file), 'utf8')).replace(/^\uFEFF/, '')); } catch { return null; } };
    const core = await read('RELEASE.json');
    const botsRelease = await read('CoA-Bots/release.json');
    const lines = [
      `Launcher: ${config.appName} ${app.getVersion()}`,
      `Core: ${core?.releaseId || info.release || '?'}${core?.releaseDate ? ` (${core.releaseDate})` : ''}`,
      `Core files: ${repackUpdater ? (await repackUpdater.installedVersion(serverPath())) || 'not installed by the launcher' : '-'}`,
      botsRelease ? `CoA Bots: ${botsRelease.version} for ${botsRelease.release}${botsRelease.built ? ` (built ${botsRelease.built})` : ''}` : 'CoA Bots: not installed',
      `Channel: ${settings.channel}`,
    ];
    clipboard.writeText(lines.join('\n'));
    return lines.join('\n');
  });
  // ---- the SquidBots dashboard of the bots package
  handle('dashboard:status', () => dashboard.status(serverPath()));
  handle('dashboard:start', async () => { if (!serverPath()) throw new Error('Choose the server folder first.'); return dashboard.start(serverPath()); });
  handle('dashboard:stop', async () => { dashboard.stop(); return dashboard.status(serverPath()); });
  handle('dashboard:open', async realm => {
    const status = await dashboard.status(serverPath());
    if (!status.running) throw new Error('Start the dashboard first.');
    // The game folder chosen in "Your game" goes along (?client=), so the dashboard can fill it in (map extraction).
    const page = new URL(status.url);
    if (settings.installPaths.addon && fs_exists(settings.installPaths.addon)) page.searchParams.set('client', settings.installPaths.addon);
    // A realm's card opens the dashboard on that realm (dashboard 2.8 and later; older ones ignore it).
    if (/^[a-z]{3,12}$/.test(String(realm || ''))) page.searchParams.set('realm', realm);
    // In the player's own browser (bookmarks, tabs); the launcher's window only if Windows cannot open one.
    try { await shell.openExternal(page.toString()); } catch { openDashboardWindow(page.toString()); }
  });
  // ---- who can join: this PC only, or other PCs (LAN / Internet)
  handle('network:get', async () => {
    if (!serverPath()) throw new Error('Choose the server folder first.');
    return { network: await network.readNetwork(serverPath()), lan: network.lanAddresses(), ports: inspectRepack(serverPath()).ports };
  });
  handle('network:save', async value => {
    if (!serverPath()) throw new Error('Choose the server folder first.');
    const result = await network.saveNetwork(serverPath(), { mode: text(value?.mode, 10), address: text(value?.address, 253), name: text(value?.name, 32) });
    return { ...result, running: (await serverControl().status()).some(service => service.state === 'running') };
  });
  handle('network:firewall', async () => {
    if (!serverPath()) throw new Error('Choose the server folder first.');
    const ports = inspectRepack(serverPath()).ports;
    const extra = (await realms.status(serverPath(), { live: false }).catch(() => ({ realms: [] }))).realms.map(realm => realm.worldPort).filter(Boolean);
    return network.openFirewall(serverPath(), { auth: ports.auth || 3724, world: ports.world || 8085, extra });
  });
  handle('updates:peek', () => (config.server ? peekUpdates({ folder: serverPath(), repack: repackUpdater, bots }) : { core: null, bots: null }));
  handle('repack:choose', async () => {
    requireServer();
    const result = smokeDir && process.env.COA_SMOKE_SERVER_DIR ? { filePaths: [process.env.COA_SMOKE_SERVER_DIR] }
      : await dialog.showOpenDialog(window, { title: 'Choose the folder of your server (repack)', properties: ['openDirectory', 'createDirectory'], defaultPath: serverPath() || 'C:\\' });
    if (result.canceled || !result.filePaths[0]) return null;
    let folder = path.resolve(result.filePaths[0]);
    // The folder the zip was unpacked into often holds the repack one level down (CoA-Repack-Bots-2.0\…).
    if (!inspectRepack(folder).repack) {
      const inner = (await fs.readdir(folder, { withFileTypes: true }).catch(() => [])).filter(entry => entry.isDirectory()).map(entry => path.join(folder, entry.name)).filter(sub => inspectRepack(sub).repack);
      if (inner.length === 1) folder = inner[0];
    }
    // Only a complete repack is taken (an empty folder too, to install into). An update package or any other
    // folder is refused with what to choose instead.
    if (!inspectRepack(folder).repack && (await fs.readdir(folder).catch(() => [])).length) {
      const names = (await fs.readdir(folder).catch(() => [])).map(name => name.toLowerCase());
      const update = names.includes('update') || names.includes('payload') || /update/i.test(path.basename(folder)) || names.some(name => name.startsWith('coa-update-'));
      throw new Error(update
        ? 'This is an update package, not the full repack. Choose the folder of the full repack you unpacked (the one with Start_All_Server.bat, Core and mysql inside), or import the full repack zip.'
        : 'This folder is not a complete repack: choose the one with Start_All_Server.bat, Core and mysql inside (or an empty folder).');
    }
    assertFolder(folder);
    await assertLocalDrive(folder);
    if (gamePath() && path.resolve(gamePath()).toLowerCase() === folder.toLowerCase()) throw new Error('The server and the game need two different folders.');
    // The folder left and the one chosen both stay in the list of instances.
    settings.instances = [...new Set([serverPath(), folder].filter(Boolean).map(item => path.normalize(item)).concat(settings.instances))].slice(0, 12);
    await persist({ ...settings, installPaths: { ...settings.installPaths, server: folder } });
    return serverInfo();
  });
  // ---- instances: several server folders, one current. A new one starts in an empty folder; with
  // "other ports" it gets free ports so it can run next to the others.
  const remember = folder => { if (folder) settings.instances = [...new Set([path.normalize(folder), ...settings.instances])].slice(0, 12); };
  handle('instance:list', async () => {
    const current = serverPath() ? path.normalize(serverPath()) : '';
    const all = [...new Set([current, ...settings.instances].filter(Boolean))];
    return all.map(folder => { const info = inspectRepack(folder); return { path: folder, current: folder === current, exists: fs_exists(folder), repack: info.repack, release: info.release, bots: info.bots?.version || '', ports: info.ports }; });
  });
  handle('instance:create', async options => {
    requireServer();
    if (busyFiles || upgradeState.running) throw new Error('Another operation is running.');
    const result = await dialog.showOpenDialog(window, { title: 'Choose an EMPTY folder for the new server', properties: ['openDirectory', 'createDirectory'], defaultPath: serverPath() ? path.dirname(serverPath()) : 'C:\\' });
    if (result.canceled || !result.filePaths[0]) return null;
    const folder = path.resolve(result.filePaths[0]);
    assertFolder(folder);
    await assertLocalDrive(folder);
    if ((await fs.readdir(folder).catch(() => [])).length) throw new Error('Choose an empty folder: the new server is installed there.');
    let ports = null;
    if (options?.otherPorts === true) {
      // Ports nobody listens on and no other instance uses: 3307/3724/8085/3443 + n.
      const taken = new Set();
      for (const other of [serverPath(), ...settings.instances].filter(Boolean)) for (const port of Object.values(inspectRepack(other).ports || {})) if (port) taken.add(port);
      const { portOpen } = require('./dashboard.cjs');
      for (let step = 1; step < 40 && !ports; step++) {
        const candidate = { mysqlPort: 3307 + step, authPort: 3724 + step, worldPort: 8085 + step, raPort: 3443 + step };
        const values = Object.values(candidate);
        if (values.some(port => taken.has(port))) continue;
        if ((await Promise.all(values.map(port => portOpen(port)))).some(Boolean)) continue;
        ports = candidate;
      }
      if (!ports) throw new Error('No free set of ports was found.');
      // Settings/repack.json is only installed when missing: written now, it is the one the new server keeps.
      await fs.mkdir(path.join(folder, 'Settings'), { recursive: true });
      await fs.writeFile(path.join(folder, 'Settings', 'repack.json'), JSON.stringify({ ...ports, raUsername: 'local', raPassword: 'local' }, null, 4));
    }
    remember(serverPath());
    remember(folder);
    await persist({ ...settings, installPaths: { ...settings.installPaths, server: folder } });
    return { info: await serverInfo(), ports };
  });
  handle('instance:switch', async folder => {
    requireServer();
    if (busyFiles || upgradeState.running) throw new Error('Another operation is running.');
    const target = path.normalize(text(folder, 400));
    if (!settings.instances.includes(target)) throw new Error('Unknown instance.');
    remember(serverPath());
    await persist({ ...settings, installPaths: { ...settings.installPaths, server: target } });
    return serverInfo();
  });
  handle('instance:forget', async folder => {
    const target = path.normalize(text(folder, 400));
    if (serverPath() && path.normalize(serverPath()) === target) throw new Error('This is the current server.');
    await persist({ ...settings, instances: settings.instances.filter(item => item !== target) });
    return true;
  });
  // ---- a repack the player downloaded (Jealous's zip): checked, then unpacked into an empty folder
  let pendingImport = null;
  handle('repack:importPick', async () => {
    requireServer();
    if (busyFiles || upgradeState.running) throw new Error('Another operation is running.');
    const result = smokeDir && process.env.COA_SMOKE_IMPORT_ZIP ? { filePaths: [process.env.COA_SMOKE_IMPORT_ZIP] } : await dialog.showOpenDialog(window, { title: 'Choose the repack zip you downloaded', properties: ['openFile'], filters: [{ name: 'Repack (zip)', extensions: ['zip'] }] });
    if (result.canceled || !result.filePaths[0]) return null;
    const file = path.resolve(result.filePaths[0]);
    busyFiles = true;
    try {
      const { sha256, size } = await repackImport.hashZip(file, (done, total) => send('repack:import', { phase: 'hash', done, total }));
      const content = await repackImport.inspectZip(file);
      let known = null;
      let listed = false;
      if (feed) { listed = true; known = repackImport.findKnown(feed, sha256); }
      if (!known && config.server.knownRepacksUrl) {
        try {
          const { data } = await fetchSigned(new URL(config.server.knownRepacksUrl), { key: config.keys.server, fetchImpl: netFetch, signal: AbortSignal.timeout(20000), maxBytes: 1024 * 1024 });
          listed = true;
          known = repackImport.findKnown(data, sha256);
        } catch {}
      }
      pendingImport = { file, sha256, size, content };
      send('repack:import', { phase: 'idle' });
      const target = serverPath();
      const targetFree = !!target && (!fs_exists(target) || !(await fs.readdir(target)).length);
      return { name: path.basename(file), size, sha256, known, listed, ...content, target: targetFree ? target : '' };
    } finally { busyFiles = false; }
  });
  // The full repack from the feed: an empty folder chosen first, the zip downloaded (resumed, checked
  // by its sha256 from the signed feed), unpacked there, then removed. Every update comes after that.
  let installAbort = null;
  // The package of the feed downloaded and unpacked into an empty folder; the zip is not kept once unpacked (several GB).
  const installPackage = async target => {
    const entry = feed?.repack;
    if (!entry?.sha256 || !entry.bytes) throw new Error('The full server is not on the channel yet.');
    installAbort = new AbortController();
    const file = path.join(app.getPath('userData'), 'updates', `${entry.sha256}.zip`);
    try {
      await fs.mkdir(path.dirname(file), { recursive: true });
      await require('./downloader.cjs').downloadObject({ url: new URL(entry.url), size: entry.bytes, sha256: entry.sha256, destination: file, signal: installAbort.signal, fetchImpl: netFetch, redirect: 'follow', onBytes: have => send('repack:import', { phase: 'download', done: have, total: entry.bytes }) })
        .catch(error => { throw new Error(installAbort.signal.aborted ? 'Download stopped. It goes on from there next time.' : error.message); });
      const content = await repackImport.inspectZip(file);
      if (content.missing.length) throw new Error('This zip is not a full repack.');
      await repackImport.extractZip(file, target, { top: content.top, total: content.entries, onProgress: (done, total) => send('repack:import', { phase: 'extract', done, total }) });
      if (!inspectRepack(target).repack) throw new Error('The unpacked folder is not a complete repack.');
      await fs.rm(file, { force: true });
    } finally { installAbort = null; send('repack:import', { phase: 'idle' }); }
  };
  handle('repack:downloadInstall', async () => {
    requireServer();
    const entry = feed?.repack;
    if (!entry?.sha256 || !entry.bytes) throw new Error('The full server is not on the channel yet.');
    // This server comes without game data: it is prepared from the game, so the game folder comes first.
    if (!gamePath()) throw new Error('Choose your game folder first: the server takes its game data from it.');
    if (busyFiles || upgradeState.running || update.busy) throw new Error('Another operation is running.');
    const result = smokeDir && process.env.COA_SMOKE_IMPORT_DIR ? { filePaths: [process.env.COA_SMOKE_IMPORT_DIR] } : await dialog.showOpenDialog(window, { title: 'Choose an EMPTY folder for the server', properties: ['openDirectory', 'createDirectory'], defaultPath: 'C:\\' });
    if (result.canceled || !result.filePaths[0]) return null;
    const target = path.resolve(result.filePaths[0]);
    assertFolder(target);
    await assertLocalDrive(target);
    if ((await fs.readdir(target).catch(() => [])).length) throw new Error('Choose an empty folder: the new server is installed there.');
    busyFiles = true;
    try {
      await installPackage(target);
      await network.applyNetwork(target).catch(() => {});
      settings.instances = [...new Set([serverPath(), target].filter(Boolean).map(item => path.normalize(item)).concat(settings.instances))].slice(0, 12);
      await persist({ ...settings, installPaths: { ...settings.installPaths, server: target } });
    } finally { busyFiles = false; }
    // No game data in the package: it is taken from the player's client now (the folder stays installed if this fails).
    if (assembler.state(target).needed && gamePath()) await assembleServer().catch(error => send('assemble:progress', { event: 'error', message: error.message }));
    return serverInfo();
  });
  handle('repack:downloadCancel', () => { installAbort?.abort(); return true; });
  // ---- assembly of a data-free package from the player's client (see assembler.cjs)
  let assembling = false;
  // The preparation starts MySQL for the database and the bots: it is stopped again at the end if it was not running.
  const assembleServer = steps => afterMysql(() => assembleServerOnce(steps));
  // inside: run as one step of a reinstall, which holds the upgrade lock itself.
  const assembleServerOnce = async (steps, { inside = false } = {}) => {
    const folder = serverPath();
    if (!folder) throw new Error('Install the server first.');
    const client = gamePath() || (fs_exists(assembler.state(folder).client || '#') ? assembler.state(folder).client : '');
    if (!client) throw new Error('Show the launcher your game folder first (Play tab): the data comes from it.');
    if (assembling || busyFiles || (upgradeState.running && !inside) || update.busy) throw new Error('Another operation is running.');
    if (game) throw new Error('Close the game first.');
    assembling = true;
    assembler.busy.add(path.resolve(folder));
    try {
      // Only what is left (a run cut by a closed launcher goes on where it stopped; the extraction is not redone).
      const todo = steps || assembler.state(folder).missing;
      if (todo.length) {
        // The import of the world package: its tables counted every 20 s, and a warning when nothing moved for 15 min.
        let watch = null;
        const stopWatch = () => { clearInterval(watch); watch = null; };
        const onEvent = event => {
          const world = event.event === 'step' && event.step === 'db' && /world package/i.test(event.text || '');
          // The assembler of the 2.8 package says « about 2 min »: on most PCs it is longer.
          send('assemble:progress', world ? { ...event, text: 'Importing the public CoA world package (5 to 20 minutes, depending on the disk)' } : event);
          if (event.event !== 'step') return;
          if (world && !watch) {
            let last = { done: -1, total: 0 };
            let since = Date.now();
            watch = setInterval(async () => {
              const seen = await assembler.worldImport(folder);
              if (!watch) return;
              // MySQL not answering counts as not moving.
              if (seen && seen.done !== last.done) { last = seen; since = Date.now(); }
              const stuck = Date.now() - since > 15 * 60 * 1000;
              send('assemble:progress', { event: 'progress', step: 'db', done: Math.max(0, last.done), total: last.total || undefined,
                warning: stuck ? 'Nothing has moved for 15 minutes. A server folder on an external (USB) drive or an antivirus scanning MySQL can block it: close the launcher, move the server to an internal disk or allow its folder in the antivirus, then prepare again (the database starts over).' : '' });
            }, 20000);
          } else stopWatch();
        };
        try { await assembler.assemble(folder, client, onEvent, todo); } finally { stopWatch(); }
      }
      // The bots go in at once, on the new database.
      // A new database (first one, or one built again after a cut) needs them again even when their files are there.
      if (!steps && bots && (todo.includes('db') || !(await bots.info(folder)).installed)) {
        send('assemble:progress', { event: 'step', step: 'bots', text: 'Installing CoA Bots' });
        // Like « Install the bots »: the installer shipped in the package, on the repack's MySQL.
        if (!inspectRepack(folder).started) await requireControl().start('mysql');
        if (config.server?.updatesUrl) await bots.runInstaller(folder);
        else await bots.install(folder);
      }
      // The game the data came from is the game of this server: its addon (SquidBots Lite) goes in it now.
      if (!settings.installPaths.addon) await persist({ ...settings, installPaths: { ...settings.installPaths, addon: client } });
      if (settings.installPaths.addon === client) {
        send('assemble:progress', { event: 'step', step: 'bots', text: 'Installing the SquidBots Lite addon' });
        await addonSync.install(folder, client, path.join(app.getPath('userData'), 'addon-backups')).catch(error => send('assemble:progress', { event: 'log', text: `Addon not installed: ${error.message}` }));
      }
      // The bots' navigation maps: about an hour, in the background (they go on if the launcher closes). Built once:
      // taking the data again after a game patch never starts them over (Verification has a button for that).
      if (!steps) {
        // A new server downloads our navigation maps (minutes) instead of building them (hours on a small PC). A server
        // that has its own already keeps them; what does not match this game is built here afterwards, as before.
        if (config.server.mmapsUrl && assembler.state(folder).mmaps.done === 0 && canFetchMmaps(folder)) {
          send('assemble:progress', { event: 'step', step: 'mmaps', text: 'Downloading the navigation maps of the bots (about 1.9 GB)' });
          await downloadMmaps(folder, event => send('assemble:progress', event.event === 'progress' ? { ...event, step: 'mmaps' } : event))
            .catch(error => send('assemble:progress', { event: 'log', text: `Navigation maps not downloaded (${error.message}): they are built here.` }));
        }
        await assembler.startMmaps(folder);
      }
    } finally { assembling = false; assembler.busy.delete(path.resolve(folder)); send('assemble:progress', { event: 'idle' }); }
    return serverInfo();
  };
  handle('assemble:run', () => assembleServer());
  // After a CoA patch of the game: its tables, terrain and vmaps extracted again (the database and the bots stay).
  handle('assemble:refreshData', async () => {
    const world = (await requireControl().status()).some(service => /world/i.test(service.id) && service.state !== 'stopped' && service.state !== 'foreign');
    const realmOn = (await realms.status(serverPath(), { live: false })).realms.some(realm => ['running', 'starting'].includes(realm.state));
    if (world || realmOn) throw new Error('Stop the server first: its game data are replaced.');
    try { return await assembleServer(['dbc', 'maps', 'vmaps']); } finally { clientDrift = { key: '', at: 0, changed: false }; }
  });
  handle('assemble:status', () => assembler.state(serverPath()));
  handle('assemble:mmaps', async () => { await assembler.startMmaps(serverPath()); return assembler.state(serverPath()); });
  handle('assemble:mmapsPause', () => assembler.stopMmaps(serverPath()));
  // Our latest navigation maps instead of those here (Verification): the build in progress is paused first, what is
  // not published for this game is built after.
  handle('assemble:mmapsUpdate', async () => {
    const folder = serverPath();
    if (!folder || !canFetchMmaps(folder)) throw new Error('Update the server first: this one cannot download the navigation maps.');
    if (assembling || mmapsFetching) throw new Error('Another operation is running.');
    mmapsFetching = true;
    try {
      assembler.stopMmaps(folder);
      await downloadMmaps(folder, event => send('assemble:mmaps', event));
      mmapsList.at = 0;
    } finally { mmapsFetching = false; }
    if (!assembler.state(folder).mmaps.complete) await assembler.startMmaps(folder);
    return assembler.state(folder);
  });
  handle('assemble:mmapsRebuild', async () => { await assembler.rebuildMmaps(serverPath()); return assembler.state(serverPath()); });
  handle('repack:importRun', async () => {
    requireServer();
    if (!pendingImport) throw new Error('Choose the repack zip first.');
    if (pendingImport.content.missing.length) throw new Error('This zip is not a full repack.');
    if (busyFiles || upgradeState.running) throw new Error('Another operation is running.');
    let target = serverPath();
    if (!target || (fs_exists(target) && (await fs.readdir(target)).length)) {
      const result = smokeDir && process.env.COA_SMOKE_IMPORT_DIR ? { filePaths: [process.env.COA_SMOKE_IMPORT_DIR] } : await dialog.showOpenDialog(window, { title: 'Choose an EMPTY folder for the server', properties: ['openDirectory', 'createDirectory'], defaultPath: target ? path.dirname(target) : 'C:\\' });
      if (result.canceled || !result.filePaths[0]) return null;
      target = path.resolve(result.filePaths[0]);
      assertFolder(target);
      await assertLocalDrive(target);
      if ((await fs.readdir(target).catch(() => [])).length) throw new Error('Choose an empty folder: the new server is installed there.');
    }
    busyFiles = true;
    try {
      const { file, content } = pendingImport;
      const again = await repackImport.hashZip(file, (done, total) => send('repack:import', { phase: 'hash', done, total }));
      if (again.sha256 !== pendingImport.sha256) { pendingImport = null; throw new Error('The zip changed since it was checked: choose it again.'); }
      await repackImport.extractZip(file, target, { top: content.top, total: content.entries, onProgress: (done, total) => send('repack:import', { phase: 'extract', done, total }) });
      if (!inspectRepack(target).repack) throw new Error('The unpacked folder is not a complete repack.');
      await network.applyNetwork(target).catch(() => {});
      settings.instances = [...new Set([serverPath(), target].filter(Boolean).map(item => path.normalize(item)).concat(settings.instances))].slice(0, 12);
      await persist({ ...settings, installPaths: { ...settings.installPaths, server: target } });
      pendingImport = null;
    } finally { busyFiles = false; send('repack:import', { phase: 'idle' }); }
    return serverInfo();
  });
  handle('repack:openSource', async () => {
    const link = feed?.repack?.url || config.server?.repackSourceUrl;
    if (link) await shell.openExternal(link);
  });
  handle('feed:get', () => feed || refreshFeed());
  handle('update:state', () => repackUpdateState());
  handle('notes:list', () => patchNotes());
  handle('notes:open', async index => { const link = notesCache.list[Number(index)]?.url; if (link) await shell.openExternal(link); });
  handle('update:refresh', () => refreshRepackUpdate());
  // ---- components published on their own (addon, dashboard): no full update, the server is not touched
  handle('components:state', () => componentsState());
  handle('components:refresh', () => refreshComponents());
  handle('components:install', async name => {
    const id = text(name, 20);
    const offer = componentLists[id];
    if (!serverPath() || !offer) throw new Error('No new version of this component.');
    if (componentsBusy) throw new Error('A component is already being installed.');
    if (offer.minLauncher && repackUpdate.compareVersions(app.getVersion(), offer.minLauncher) < 0) throw new Error(`This needs launcher ${offer.minLauncher} or newer: update the launcher first (Settings > About).`);
    if (components.blocker(serverPath(), offer)) throw new Error(`This needs CoA Bots ${offer.minBots} or newer on the server: update the server first.`);
    if (update.busy) throw new Error('An update is running.');
    componentsBusy = true;
    let restart = false;
    try {
      if (id === 'dashboard') { restart = (await dashboard.status(serverPath())).running; if (restart) dashboard.stop(); }
      const dirs = { cacheDir: path.join(app.getPath('userData'), 'updates'), backupDir: path.join(app.getPath('userData'), 'component-backups'), fetchImpl: netFetch };
      const version = await components.install(serverPath(), offer, dirs);
      let game = '';
      // The addon goes on into the game, as at every start (only when the game is closed).
      if (id === 'addon' && settings.installPaths.addon) game = await addonSync.gameRunning() ? 'running' : (await addonInstall().then(() => 'installed').catch(() => 'failed'));
      if (restart) await dashboard.start(serverPath()).catch(() => {});
      componentsBusy = false;
      return { version, game, state: componentsState() };
    } finally { componentsBusy = false; send('components:state', componentsState()); }
  });
  // One heavy server operation at a time (update, restore of a backup, upgrade, recreating the bots): two of them
  // together would stop, start or rewrite the same server under each other.
  let serverJob = '';
  let updateAbort = null;
  const serverBusy = () => serverJob || (update.busy ? 'an update' : '') || (upgradeState.running ? 'an upgrade' : '');
  const assertServerFree = () => { const busy = serverBusy(); if (busy) throw new Error(`Wait until ${busy} is done.`); };
  const oneServerJob = async (name, work) => {
    assertServerFree();
    serverJob = name;
    try { return await work(); } finally { serverJob = ''; }
  };
  // Download, check, apply. Each step stops at the first error; the tool says whether anything was changed.
  handle('update:run', async () => {
    // The launcher first: a new launcher (found now if it was not looked for yet) is installed before any repack update.
    if (!demoUpdate() && ['idle', 'checking'].includes(launcherUpdates.status.phase)) await launcherUpdates.check().catch(() => {});
    if (!demoUpdate() && ['downloading', 'downloaded'].includes(launcherUpdates.status.phase)) throw new Error('A new launcher is on its way: install it first (it restarts the launcher), then update the server.');
    if (demoUpdate()) {
      update.busy = true;
      const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
      const events = [{ event: 'phase', phase: 'download', total: 73608202 }, { event: 'bytes', done: 31000000, total: 73608202 }, { event: 'bytes', done: 73608202, total: 73608202 },
        { event: 'phase', phase: 'check' }, { event: 'step', text: 'Checks (nothing is written yet)' }, { event: 'step', text: 'Backup: Backups\\2.4-20261020-2140' }, { event: 'info', text: 'backup made and checked in 41 s' },
        { event: 'step', text: 'Files (1834 operations, each written in the journal before it is done)' }, { event: 'progress', text: '912/1834 Core/worldserver.exe', done: 912, total: 1834 },
        { event: 'step', text: 'CoA Bots installer (settings merge, bot database, addon)' }, { event: 'step', text: 'Test start (server with bots): up to 10 minutes' }];
      for (const event of events) { send('update:event', event); await wait(1300); }
      const result = process.env.COA_SMOKE_UPDATE_RESULT || 'ok';
      update.last = result === 'ok' ? { code: 0, error: null, details: [], log: [], command: 'apply' }
        : { code: Number(result), error: { code: Number(result), text: result === '17' ? '[17] Not enough free disk space on the drive of the repack: free 6745 MB, needed 6968 MB. Nothing was changed.' : result === '50' ? '[50] The test start failed. Your backup is intact: undo with the command below, or send the lines below to the CoA Bots support.' : '[40] The update failed (disk full); the repack was put back as it was. Nothing was lost.' }, details: ['ERROR: Map file maps/0004331.map is missing', 'backup kept: Backups\\2.4-20261020-2140'], log: [], command: 'apply' };
      update.busy = false;
      return repackUpdateState();
    }
    const folder = serverPath();
    // The signed list is read again first: « Try again » after a damaged package takes the package published since.
    if (!update.busy) await refreshRepackUpdate().catch(() => {});
    const state = repackUpdateState();
    if (update.busy) throw new Error('An update is already running.');
    assertServerFree();
    if (state.state !== 'available') throw new Error('No update to install for this server.');
    if (update.manifest?.minLauncher && repackUpdate.compareVersions(app.getVersion(), update.manifest.minLauncher) < 0) throw new Error(`This update needs launcher ${update.manifest.minLauncher} or newer: update the launcher first (Settings > About).`);
    update.busy = true;
    const phase = (name, extra = {}) => { update.phase = name; send('update:event', { event: 'phase', phase: name, ...extra }); };
    // A server that was running is started again once the update ended well (the tool stops it for the update).
    const wasRunning = await serverControl()?.status().then(services => services.some(service => /world/i.test(service.id) && service.state === 'running')).catch(() => false);
    try {
      dashboard.stop();
      // The extra realms use the same worldserver and MySQL: stopped before the update, started again after it.
      // A realm still saving stops the update before anything is changed (MySQL must stay up for it).
      await realms.stopAll(serverPath()).catch(error => { throw Object.assign(new Error(error.message), { launcherCode: 'realm' }); });
      const wanted = repackUpdate.forRelease(update.manifest, state.here?.release);
      phase('download', { total: repackUpdate.packageSize(wanted) });
      const controller = new AbortController();
      updateAbort = controller;
      const zip = await repackUpdate.fetchPackage(wanted, path.join(app.getPath('userData'), 'updates'), { fetchImpl: netFetch, signal: controller.signal, onBytes: have => send('update:event', { event: 'bytes', done: have, total: repackUpdate.packageSize(wanted) }) })
        .catch(error => { throw Object.assign(new Error(error.message), { launcherCode: controller.signal.aborted ? 'cancelled' : 'download' }); });
      updateAbort = null;
      phase('unpack');
      await repackUpdate.unpack(zip, folder, update.manifest.package.folder, (done, total) => send('update:event', { event: 'unpack', done, total })).catch(error => { throw Object.assign(new Error(error.message), { launcherCode: 'unpack' }); });
      // A package without game data: the core's public SQL are fetched now, checked by coa_update.py right after.
      await repackUpdate.fillSql(folder, update.manifest.package.folder, event => send('update:event', event)).catch(error => { throw Object.assign(new Error(error.message), { launcherCode: 'unpack' }); });
      phase('check');
      let result = await runUpdateTool(folder, update.manifest.package.folder, 'check', []);
      if (!result.code) {
        phase('apply');
        const client = settings.installPaths.addon && fs_exists(settings.installPaths.addon) ? ["--client", settings.installPaths.addon] : ['--no-addon'];
        result = await runUpdateTool(folder, update.manifest.package.folder, 'apply', client);
      }
      update.last = result;
      if (!result.code && !result.error) await cleanAchievementsOnce(folder).catch(error => send('update:event', { event: 'warn', text: `Bot achievements not cleaned: ${error.message}` }));
    } catch (error) {
      // Cancelled by the player: nothing was changed, the update is offered again (and its download goes on where it stopped).
      update.last = error.launcherCode === 'cancelled' ? null : { code: 1, error: { code: error.launcherCode || 'launcher', text: error.message }, details: [], log: [], command: 'run' };
      if (error.launcherCode === 'cancelled') realms.startMarked(folder).catch(() => {});
    } finally {
      updateAbort = null;
      update.busy = false;
      update.phase = null;
    }
    if (wasRunning && update.last && !update.last.code && !update.last.error) {
      network.applyNetwork(folder).catch(() => {}).then(() => modules.keepRotationOff(folder)).then(() => quietLogs(folder)).then(() => requireControl().startAll()).then(() => realms.startMarked(folder)).catch(() => {});
    }
    const state2 = repackUpdateState();
    send('update:state', state2);
    return state2;
  });
  // Only while it downloads: once unpacked, the tool's own steps run to their end (or put everything back).
  handle('update:cancel', () => { if (update.phase === 'download' && updateAbort) updateAbort.abort(); return update.phase === 'download'; });
  // Undo (the latest backup of the update) or the end of a cut update: with the tool already in the repack.
  // The last update that can be undone: the update tool still in the repack and its backup (Backups\<version>-<date>).
  handle('update:undoInfo', async () => {
    const folder = serverPath();
    if (!folder || !(await packageInRepack(folder))) return { available: false };
    const names = (await fs.readdir(path.join(folder, 'Backups')).catch(() => [])).filter(name => /^\d+(\.\d+)*[\w.-]*-\d{8}-\d{6}$/.test(name) && fs_exists(path.join(folder, 'Backups', name, 'backup.json')));
    const last = names.sort((a, b) => a.slice(-15).localeCompare(b.slice(-15))).pop();
    if (!last) return { available: false };
    const [, version, day, time] = /^(.+)-(\d{8})-(\d{6})$/.exec(last);
    // Already undone (the server is back on an older version): nothing to offer.
    if (repackUpdate.installed(folder).bots !== version) return { available: false };
    return { available: true, version, at: `${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6)} ${time.slice(0, 2)}:${time.slice(2, 4)}` };
  });
  handle('update:undo', async mode => {
    const folder = serverPath();
    if (update.busy) throw new Error('An update is already running.');
    const packageFolder = await packageInRepack(folder);
    if (!packageFolder) throw new Error('The update tool is not in the server folder any more: use Backups\\<backup>\\Retour-Arriere.bat.');
    update.busy = true;
    try {
      update.phase = mode === 'finish' ? 'apply' : 'undo';
      send('update:event', { event: 'phase', phase: update.phase });
      update.last = mode === 'finish' || mode === 'undo-cut'
        ? await runUpdateTool(folder, packageFolder, 'apply', ['--on-cut', mode === 'finish' ? 'finish' : 'undo', '--no-addon'])
        : await runUpdateTool(folder, packageFolder, 'rollback', []);
    } finally { update.busy = false; update.phase = null; }
    const state = repackUpdateState();
    send('update:state', state);
    return state;
  });
  // The game client where the SquidBots addon goes (Interface\AddOns): chosen once, remembered. Choosing
  // Interface or AddOns by mistake is understood (the folder above is taken).
  async function pickClient() {
    const result = await dialog.showOpenDialog(window, { title: 'Choose your game client folder (the one with Ascension.exe or Wow.exe)', properties: ['openDirectory'], defaultPath: settings.installPaths.addon || undefined });
    let folder = result.filePaths?.[0];
    if (!folder) return null;
    for (let up = 0; up < 2 && !addonSync.isClient(folder); up++) folder = path.dirname(folder);
    if (!addonSync.isClient(folder)) throw new Error('This folder has no Ascension.exe or Wow.exe: choose the folder of your game client.');
    await persist({ ...settings, installPaths: { ...settings.installPaths, addon: folder } });
    return folder;
  }
  handle('update:pickClient', async () => (await pickClient()) ?? (settings.installPaths.addon || ''));
  // Play: starts the game client of this PC (the folder chosen for the addon), asked once when none is known.
  handle('game:play', async options => {
    const known = settings.installPaths.addon;
    const client = known && addonSync.isClient(known) ? known : await pickClient();
    if (!client) return { started: false };
    const exe = ['Ascension.exe', 'Wow.exe', 'WoW.exe'].map(name => path.join(client, name)).find(file => fs_exists(file));
    if (!exe) throw new Error('No Ascension.exe or Wow.exe in the game folder.');
    if (options?.startServer === true && config.server && serverPath()) {
      const world = (await requireControl().status()).find(service => /world/i.test(service.id));
      if (world && world.state !== 'running') { assertServerFree(); await startEverything(); }
    }
    const child = require('node:child_process').spawn(exe, [], { cwd: client, detached: true, stdio: 'ignore', windowsHide: false });
    child.on('error', () => {});
    child.unref();
    return { started: true, client };
  });
  // The game client also needs its realmlist on this server: 127.0.0.1 here, or the address given to the
  // other PCs (and any address of this PC) when the server is open, always with the login port.
  const clientRealmlist = async client => {
    if (!client || !serverPath()) return null;
    const net = await network.readNetwork(serverPath());
    const hosts = ['127.0.0.1', 'localhost', ...network.lanAddresses(), ...(net.mode === 'open' ? [net.address.toLowerCase()] : [])];
    return realmlistStatus(client, { hosts, port: inspectRepack(serverPath()).ports?.auth || 3724 }).catch(() => null);
  };
  // The client against the files the feed lists: present, the right size, and (files under 64 MB) the right sha256.
  // Read once per file, size and date.
  const clientChecks = new Map();
  const clientMissing = async client => {
    for (const item of feed?.clientRequires || []) {
      const file = path.join(client, ...item.file.split('/'));
      const stat = await statOrNull(file).catch(() => null);
      if (!stat?.isFile() || (item.bytes && stat.size !== item.bytes)) return item.file;
      if (!item.sha256 || stat.size > 64 * 1024 ** 2) continue;
      const key = `${file}|${stat.size}|${stat.mtimeMs}`;
      if (!clientChecks.has(key)) clientChecks.set(key, require('node:crypto').createHash('sha256').update(await fs.readFile(file)).digest('hex'));
      if (clientChecks.get(key) !== item.sha256) return item.file;
    }
    return '';
  };
  // The first file of the client that the feed lists as too new for this server (same size, and same sha256 when given).
  const clientTooNew = async client => {
    for (const item of feed?.clientIncompatible || []) {
      const file = path.join(client, ...item.file.split('/'));
      const stat = await statOrNull(file).catch(() => null);
      if (!stat?.isFile() || stat.size !== item.bytes) continue;
      if (item.sha256 && stat.size <= 300 * 1024 ** 2) {
        const key = `${file}|${stat.size}|${stat.mtimeMs}`;
        if (!clientChecks.has(key)) clientChecks.set(key, await new Promise((resolve, reject) => { const hash = require('node:crypto').createHash('sha256'); require('node:fs').createReadStream(file).on('data', chunk => hash.update(chunk)).on('end', () => resolve(hash.digest('hex'))).on('error', reject); }));
        if (clientChecks.get(key) !== item.sha256) continue;
      }
      return { file: item.file, note: item.note };
    }
    return null;
  };
  const addonStatus = async () => {
    // The game folder chosen for the server stands for the addon's game until one is chosen for the addon itself.
    const status = addonSync.status(serverPath(), settings.installPaths.addon || gamePath());
    const outdated = status.client && feed?.clientRequires?.length ? await clientMissing(status.client).catch(() => '') : '';
    const tooNew = status.client && feed?.clientIncompatible?.length ? await clientTooNew(status.client).catch(() => null) : null;
    return { ...status, realmlist: await clientRealmlist(status.client), clientOutdated: outdated, clientTooNew: tooNew };
  };
  const addonInstall = async () => {
    const installed = await addonSync.install(serverPath(), settings.installPaths.addon, path.join(app.getPath('userData'), 'addon-backups'));
    return { installed, status: await addonStatus() };
  };
  handle('addon:status', () => addonStatus());
  // Points the chosen game at this server (the files it replaces are kept once, in the game's .coa-launcher).
  handle('addon:realmlist', async () => {
    const status = await addonStatus();
    if (!status.client || !status.realmlist) throw new Error('Choose your game folder first.');
    if (await addonSync.gameRunning()) throw new Error('Close the game first: it reads its realmlist only at start.');
    await configureRealmlist(status.client, status.realmlist.expected);
    return addonStatus();
  });
  // ---- the world console and the live state of the server
  // ---- modules: SquidBots (start with or without the bots) and Multirace (added races)
  const worldRunning = async () => {
    const found = serverControl();
    return found ? (await found.status()).some(service => /world/i.test(service.id) && ['running', 'starting', 'stopping'].includes(service.state)) : false;
  };
  const modulesStatus = async () => ({ ...(await modules.status(serverPath(), { squidbots: settings.modules?.squidbots !== false, client: settings.installPaths.addon || '' })), worldRunning: await worldRunning(),
    // Screenshot tours only (--smoke): a module of a later CoA Bots shown as installed.
    ...(smokeDir && process.env.COA_SMOKE_DUNGEON ? { dungeonclear: { available: true, enabled: true, difficulties: ['normal', 'heroic', 'mythic'], difficultyKnown: true } } : {}) });
  handle('modules:status', () => { if (!serverPath()) throw new Error('Choose the server folder first.'); return modulesStatus(); });
  // Source code of each module and of the launcher: a fixed list, nothing else is opened.
  const SOURCES = {
    launcher: 'https://github.com/Zyth45/squidbots-updates',
    squidbots: 'https://github.com/Zyth45/mod-playerbots',
    multirace: 'https://github.com/ilusixn/azerothcore-wotlk-coa',
    ahbot: 'https://github.com/NathanHandley/mod-ah-bot-plus',
    // Our AGPL copy of Jared Wright's module, published with CoA Bots 2.8 (address to fill in then).
    dungeonclear: '',
    core: 'https://github.com/jealous-sound/azerothcore-wotlk-coa',
    botsHelp: 'https://zyth45.github.io/mod-playerbots/',
  };
  handle('source:open', async id => { const link = SOURCES[text(id, 20)]; if (link) await shell.openExternal(link); });
  handle('modules:dungeonDifficulties', async list => {
    if (await worldRunning()) throw new Error('Stop the server first: Dungeon Clear is read when it starts.');
    await modules.setDungeonDifficulties(serverPath(), Array.isArray(list) ? list.map(item => text(item, 10)) : []);
    return modulesStatus();
  });
  handle('modules:dungeonclear', async on => {
    if (await worldRunning()) throw new Error('Stop the server first: Dungeon Clear is read when it starts.');
    await modules.setDungeon(serverPath(), on === true);
    return modulesStatus();
  });
  handle('modules:ahbot', async on => {
    if (await worldRunning()) throw new Error('Stop the server first: the auction house bot is read when it starts.');
    await modules.setAhbot(serverPath(), on === true);
    return modulesStatus();
  });
  // Empties the auctions of the bot (bidders are paid back by the server): only on a running world.
  handle('ahbot:settings', async realm => {
    if (!serverPath()) throw new Error('Choose the server folder first.');
    const key = realmKey(realm);
    const instantKnown = await modules.ahbotInstantKnown(serverPath());
    return key ? realms.ahbotSettingsOf(serverPath(), key, { instantKnown }) : modules.ahbotSettings(serverPath());
  });
  handle('ahbot:save', async (values, realm) => {
    if (!serverPath()) throw new Error('Choose the server folder first.');
    const clean = { buyer: values?.buyer === true, pace: text(values?.pace, 10), price: Number(values?.price), coaPrices: values?.coaPrices === true, perSeller: Number(values?.perSeller), instant: values?.instant === true, size: text(values?.size, 10) };
    const key = realmKey(realm);
    const instantKnown = await modules.ahbotInstantKnown(serverPath());
    let running = false;
    let raPort = 0;
    if (key) ({ running, raPort } = await realms.setAhbotSettingsOf(serverPath(), key, clean, { instantKnown }));
    else { await modules.setAhbotSettings(serverPath(), clean); running = await worldRunning(); }
    // Applied at once on a running world; otherwise at its next start.
    const reloaded = running ? await live.raCommand(serverPath(), 'ahbot reload', 30000, raPort).then(() => true, () => false) : false;
    return { reloaded, running };
  });
  handle('modules:ahbotEmpty', async () => {
    if (!serverPath()) throw new Error('Choose the server folder first.');
    if (!(await worldRunning())) throw new Error('Start the server to empty the auction house.');
    return live.raCommand(serverPath(), 'ahbot empty', 120000);
  });
  handle('modules:rotation', async on => {
    if (!serverPath()) throw new Error('Choose the server folder first.');
    if (await worldRunning()) throw new Error('Stop the server first: the rotation assistant is read when it starts.');
    await modules.setRotation(serverPath(), on === true);
    return modulesStatus();
  });
  handle('modules:manastorm', async on => {
    if (!serverPath()) throw new Error('Choose the server folder first.');
    if (await worldRunning()) throw new Error('Stop the server first: Manastorm is read when it starts.');
    await modules.setManastorm(serverPath(), on === true);
    return modulesStatus();
  });
  // The Manastorm files of the game, from the zip named in the signed feed (game closed).
  handle('modules:manastormClient', async () => {
    if (await addonSync.gameRunning()) throw new Error('Close the game first.');
    return manastormClient.install({ client: settings.installPaths.addon, entry: feed?.manastormClient, cacheDir: path.join(app.getPath('userData'), 'downloads'), backupDir: path.join(app.getPath('userData'), 'manastorm-backups'), fetchImpl: netFetch });
  });
  handle('modules:squidbots', async on => {
    if (await worldRunning()) throw new Error('Stop the server first: the bots are chosen when it starts.');
    await persist({ ...settings, modules: { ...settings.modules, squidbots: on === true } });
    return modulesStatus();
  });
  // Characters of real players with an added race: counted (never changed) before switching Multirace off.
  handle('modules:customCharacters', async () => {
    try {
      const rows = await serverTools().backup.query("SELECT COUNT(*) FROM acore_characters.characters c JOIN acore_auth.account a ON a.id = c.account WHERE c.race NOT IN (1,2,3,4,5,6,7,8,10,11) AND a.username NOT LIKE 'RNDBOT%'");
      return Number(String(rows).match(/\d+/)?.[0] ?? 0);
    } catch { return null; }
  });
  handle('modules:multirace', async options => {
    if (!config.server?.multirace) throw new Error('This edition has no Multirace module.');
    if (!serverPath()) throw new Error('Choose the server folder first.');
    if (await worldRunning()) throw new Error('Stop the server first: the races are read when it starts.');
    const on = options?.on === true;
    // The repack's own switch when it has one (it also moves the players' characters and purges the bots).
    if (modules.hasScript(serverPath())) {
      if (on && (await modules.multiraceBlockers(serverPath())).length) throw new Error('Multirace cannot be switched on with this core.');
      const result = await modules.runScript(serverPath(), on ? 'on' : 'off', true);
      return { ...(await modulesStatus()), purged: result.purged !== false, result };
    }
    await modules.setMultirace(serverPath(), on, { bots: options?.bots !== false });
    // Both ways the random bots are recreated: no bot of an added race may stay for players without the patch,
    // and switched on, the new pool takes every race.
    let purged = false;
    if (config.server.commands.purgeBots && inspectRepack(serverPath()).bots) { await serverControl().run(config.server.commands.purgeBots, 'purge-bots'); purged = true; }
    return { ...(await modulesStatus()), purged };
  });
  // What the switch would do (nothing written): the characters that change race, the ones given back.
  handle('modules:multiracePlan', async on => {
    if (!serverPath() || !modules.hasScript(serverPath())) return null;
    return modules.runScript(serverPath(), on === true ? 'on' : 'off', false);
  });
  handle('modules:clientPatch', async on => {
    const client = settings.installPaths.addon;
    if (!client) throw new Error('Choose your game folder first (SquidBots addon card).');
    if (await addonSync.gameRunning()) throw new Error('Close the game first.');
    await modules.setClientPatch(client, on === true);
    return modulesStatus();
  });
  handle('live:forceStopWorld', async () => {
    if (!serverPath()) throw new Error('Choose the server folder first.');
    await live.forceStopWorld(serverPath());
    // The rest (relay, login, database) is then stopped the normal way.
    const found = serverControl();
    if (found) await found.stopAll().catch(() => {});
    return serverInfo();
  });
  let liveRealms = { at: 0, root: '', list: [] };
  handle('live:stats', async () => {
    if (smokeDir && process.env.COA_SMOKE_LIVE) return JSON.parse(process.env.COA_SMOKE_LIVE);
    if (!serverPath()) return { running: false };
    const stats = await live.stats(serverPath());
    // The other realms that run, added up for the home page (the tiles stay those of the CoA realm).
    // Their consoles are asked at most every 15 s (a world loaded with bots answers slowly).
    if (!liveRealms.at || Date.now() - liveRealms.at > 15000 || liveRealms.root !== serverPath()) {
      const list = (await realms.status(serverPath()).catch(() => ({ realms: [] }))).realms;
      for (const realm of list) if (realm.state === 'running' && realm.pid) realm.memory = await live.processMemory(realm.pid);
      liveRealms = { at: Date.now(), root: serverPath(), list };
    }
    return live.withRealms(stats, liveRealms.list);
  });
  handle('console:run', async (command, realm) => {
    if (!serverPath()) throw new Error('Choose the server folder first.');
    const line = text(command, 500).trim();
    if (!line || /[\r\n]/.test(line)) throw new Error('One command per line.');
    // The console of another realm: its own RA port, same account.
    const target = realms.MODES[text(realm, 12)] ? (await realms.status(serverPath(), { live: false })).realms.find(item => item.key === text(realm, 12)) : null;
    if (target && target.state !== 'running') throw new Error('Start this realm first.');
    return live.raCommand(serverPath(), line.replace(/^\./, ''), 30000, target?.raPort || 0);
  });
  // First click: the game folder (the one the bots installer used is offered), then the addon is copied.
  handle('addon:setup', async useSuggested => {
    const suggested = (await addonStatus()).suggested;
    if (useSuggested === true && suggested) await persist({ ...settings, installPaths: { ...settings.installPaths, addon: suggested } });
    else if (!(await pickClient())) return { installed: [], status: await addonStatus() };
    return addonInstall();
  });
  handle('addon:install', () => addonInstall());
  // At start and after an update: a newer addon in the repack goes into the game by itself (not while it runs).
  handle('addon:auto', async () => {
    const state = await addonStatus();
    if (!['outdated', 'missing'].includes(state.state) || !state.client) return { installed: [], status: state };
    if (await addonSync.gameRunning()) return { installed: [], status: state, gameRunning: true };
    return addonInstall().catch(async () => ({ installed: [], status: await addonStatus() }));
  });
  handle('update:clearClient', async () => { const paths = { ...settings.installPaths }; delete paths.addon; await persist({ ...settings, installPaths: paths }); return ''; });
  handle('update:report', () => { clipboard.writeText(supportReport()); return true; });
  handle('update:openLog', async () => { if (update.last?.logFile) shell.showItemInFolder(update.last.logFile); });
  handle('feed:open', async kind => {
    const key = text(kind, 20);
    const link = key.startsWith('news:') ? feed?.news?.[Number(key.slice(5))]?.url
      : key === 'discord' ? feed?.discord?.invite || feed?.discord?.live?.invite : feed?.[key]?.url;
    if (!link) throw new Error('This link is not available yet: try again in a minute.');
    // If Windows cannot open the browser, the link is put on the clipboard instead.
    try { await shell.openExternal(link); return { opened: true }; }
    catch { clipboard.writeText(link); return { copied: true }; }
  });
  handle('repack:check', async force => {
    requireServer();
    if (!repackUpdater) return { needsUpdate: false, disabled: true };
    return repackUpdater.check(serverPath(), { force: force === true, components: settings.components.server });
  });
  handle('repack:update', async force => {
    requireServer();
    if (!repackUpdater || !serverPath()) throw new Error('Choose the server folder first.');
    if (busyFiles) throw new Error('Another file operation is running.');
    busyFiles = true;
    try { await repackUpdater.update(serverPath(), { force: force === true, components: settings.components.server }); }
    finally { busyFiles = false; }
    await network.applyNetwork(serverPath()).catch(() => {});
    return serverInfo();
  });
  handle('repack:pause', () => { repackUpdater?.cancel(); bots?.updater.cancel(); });
  const prepareStart = async () => { await applyCards(serverPath()).catch(() => {}); await network.applyNetwork(serverPath()).catch(() => {}); await modules.keepRotationOff(serverPath()); await quietLogs(serverPath()); };
  const startEverything = async () => {
    baseByRealm = false;
    await prepareStart();
    // CoA left out of "Start all" when the player chose so and a realm starts with the server: MySQL and the authserver only.
    const skipCoa = await realms.skipCoaAtStart(serverPath()).catch(() => false);
    await realms.queueMarked(serverPath()).catch(() => {});
    // The authserver after a worldserver: the world applies the updates of the auth database.
    // A realm that did not start says why on the page (not enough memory, an error of its world).
    const startRealms = () => realms.startMarked(serverPath()).then(failed => { if (failed.length) send('realms:failed', failed); }).catch(error => send('realms:failed', [{ key: '', error: error.message }]));
    if (skipCoa) { await requireControl().start('mysql'); await startRealms(); await requireControl().start('auth'); }
    else { try { await requireControl().startAll(); } finally { startRealms(); } }
    // MySQL runs now: the names of the cards reach the realm list, stopped realms included.
    await applyCardNames(serverPath(), await realmCards.read(serverPath())).catch(() => {});
  };
  // Stop all, then start all again (the realms marked to start with the server too).
  handle('repack:restartAll', async () => {
    await oneServerJob('the restart of the server', async () => { baseByRealm = false; await realms.stopAll(serverPath()); await requireControl().stopAll(); });
    await startEverything();
    return serverInfo();
  });
  handle('repack:start', async id => { assertServerFree(); if (assembler.state(serverPath()).needed) throw new Error('Prepare the game data from your client first (home page).'); if (id === 'all') await startEverything(); else { await prepareStart(); await requireControl().start(text(id, 30)); } return serverInfo(); });
  // The repack's manager only stops everything (stop-all): one service alone is stopped by the launcher itself.
  const stopCoaWorld = async () => {
    const world = requireControl().services.find(service => /world/i.test(service.id));
    await live.raCommand(serverPath(), 'server shutdown 1s 0', 20000).catch(() => {});
    const deadline = Date.now() + 120000;
    while (Date.now() < deadline && await portOpen(world.port)) await new Promise(resolve => setTimeout(resolve, 1000));
    if (await portOpen(world.port)) throw new Error('The CoA world is still stopping; try Stop all on the home page.');
  };
  const stopOne = async id => {
    const root = serverPath();
    const service = requireControl().services.find(item => item.id === id);
    if (!service) throw new Error('Unknown service.');
    if (!(await portOpen(service.port))) return;
    if (/world/i.test(id)) return stopCoaWorld();
    if (id === 'auth') {
      // The authserver recorded by the repack (.state/auth.json), only when it is this repack's program.
      const record = JSON.parse(await fs.readFile(path.join(root, '.state', 'auth.json'), 'utf8').catch(() => '{}'));
      if (!record?.pid || !String(record.exe || '').toLowerCase().startsWith(root.toLowerCase())) throw new Error('The authserver was not started from this repack; stop it where it was started.');
      await require('node:util').promisify(require('node:child_process').execFile)('taskkill.exe', ['/PID', String(Number(record.pid)), '/T', '/F'], { windowsHide: true }).catch(() => {});
    } else if (id === 'mysql') {
      // The worlds need their database: MySQL alone only once every world is stopped.
      const worldOn = (await requireControl().status()).some(item => /world/i.test(item.id) && item.state !== 'stopped');
      const realmOn = (await realms.status(root, { live: false }).catch(() => ({ realms: [] }))).realms.some(realm => ['running', 'starting', 'stopping'].includes(realm.state));
      if (worldOn || realmOn) throw new Error('Stop the worlds first (CoA and the realms): they need MySQL. Or use Stop all.');
      await require('node:util').promisify(require('node:child_process').execFile)(path.join(root, 'mysql', 'bin', 'mysqladmin.exe'), [`--defaults-file=${path.join(root, 'mysql', 'admin-client.ini')}`, 'shutdown'], { windowsHide: true, timeout: 60000 });
    } else return requireControl().stop(id);
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline && await portOpen(service.port)) await new Promise(resolve => setTimeout(resolve, 1000));
  };
  handle('repack:stop', async id => { if (id === 'all') { baseByRealm = false; await realms.stopAll(serverPath()); await requireControl().stopAll(); } else await stopOne(text(id, 30)); return serverInfo(); });
  handle('repack:tail', id => requireControl().tail(text(id, 30)));
  // ---- extra realms (Wildcard, Warcraft Reborn, Free Pick) beside the CoA realm: same MySQL, authserver and bot worldserver
  // The CoA realm (the repack's own world) beside the extra ones, for the Realms page.
  const coaRealm = async () => {
    const world = (await requireControl().status()).find(service => /world/i.test(service.id));
    const conf = await fs.readFile(path.join(serverPath(), 'CoA-Bots', 'Core', 'configs', 'modules', 'playerbots.conf'), 'utf8').catch(() => '');
    const bots = Number(/^\s*AiPlayerbot\.MaxRandomBots\s*=\s*(\d+)/m.exec(conf)?.[1]);
    const info = world?.state === 'running' ? await live.raCommand(serverPath(), 'server info', 6000).then(live.parseInfo).catch(() => null) : null;
    return { id: 1, state: world?.state || 'stopped', worldPort: world?.port, bots: Number.isFinite(bots) ? bots : null, players: info?.players ?? null, autostart: await realms.coaAutostart(serverPath()) };
  };
  const realmsStatus = async () => {
    // Screenshot tours only (--smoke): made-up realms, like COA_SMOKE_LIVE for the home page.
    if (smokeDir && process.env.COA_SMOKE_REALMS) return JSON.parse(process.env.COA_SMOKE_REALMS);
    if (!serverPath()) throw new Error('Choose the server folder first.');
    return { ...(await realms.status(serverPath())), coa: await coaRealm() };
  };
  // MySQL (and the authserver to log in) of the repack, started through its own scripts when needed.
  const realmBase = async withAuth => { const c = requireControl(); await c.start('mysql'); if (withAuth) await c.start('auth'); };
  // MySQL lent to a realm task (switch on, new bots, switch off) on a stopped server, stopped again afterwards.
  const withMysql = mysqlLender({
    status: () => requireControl().status(),
    start: id => requireControl().start(id),
    stopAll: () => requireControl().stopAll(),
    realmRunning: async () => (await realms.status(serverPath(), { live: false })).realms.some(realm => ['running', 'starting'].includes(realm.state)),
  });
  handle('realms:status', realmsStatus);
  // ---- the cards of the realm list in the game (game mode, background, description, expansion)
  const cardIds = async root => ({ coa: 1, ...Object.fromEntries((await realms.status(root, { live: false }).catch(() => ({ realms: [] }))).realms.filter(realm => realm.state !== 'absent' && realm.id).map(realm => [realm.key, realm.id])) });
  // The names follow the cards: the extra realms in realm.json (and the list), CoA through the network choice.
  const applyCardNames = async (root, cards) => {
    for (const key of ['wildcard', 'reborn', 'dawnrise']) if (cards.realms[key]?.name) await realms.setRealmName(root, key, realmCards.listName(cards.realms[key])).catch(() => {});
    if (cards.realms.coa) {
      const current = await network.readNetwork(root);
      // Name left empty: the name chosen in Who can join, without an earlier subtitle (" - …").
      const base = cards.realms.coa.name || current.name.split(' - ')[0].trim();
      const name = realmCards.listName({ ...cards.realms.coa, name: base });
      if (current.name !== name) await network.saveNetwork(root, { mode: current.mode, address: current.address, name }).catch(() => {});
    }
  };
  // A launcher that knows the cards meets this server for the first time: the official look, once; the player
  // changes it afterwards in the gear of each realm card.
  applyCards = async root => {
    if (!root || !inspectRepack(root).repack) return;
    let cards = await realmCards.read(root);
    if (!cards.version) { cards = await realmCards.save(root, realmCards.DEFAULTS); await applyCardNames(root, cards); }
    await realmCards.apply(root, await cardIds(root));
  };
  handle('cards:get', async () => {
    if (!serverPath()) throw new Error('Choose the server folder first.');
    return { cards: await realmCards.read(serverPath()), perRealm: realmCards.perRealmSupported(serverPath()), modes: realmCards.GAME_MODES, images: realmCards.IMAGES, descriptions: realmCards.DESCRIPTIONS, coaName: (await network.readNetwork(serverPath())).name };
  });
  handle('cards:save', async value => {
    if (!serverPath()) throw new Error('Choose the server folder first.');
    const cards = await realmCards.save(serverPath(), value);
    await applyCardNames(serverPath(), cards);
    await realmCards.apply(serverPath(), await cardIds(serverPath()));
    const auth = (await requireControl().status()).find(service => service.id === 'auth');
    return { cards, authRunning: auth?.state === 'running' };
  });
  handle('realms:create', async (key, options) => {
    if (options?.start === true) {
      await realmBase(false);
      await realms.create(serverPath(), text(key, 12), { bots: Number(options?.bots) || undefined, notify: line => send('realms:progress', line) });
      await realms.start(serverPath(), text(key, 12));
      await requireControl().start('auth');
    } else await withMysql(() => realms.create(serverPath(), text(key, 12), { bots: Number(options?.bots) || undefined, notify: line => send('realms:progress', line) }));
    // A server open to other PCs: the new realm's world port joins the firewall rules (Windows asks for the
    // administrator; refused, the realm stays created and Who can join > Open the firewall does it later).
    if ((await network.readNetwork(serverPath()).catch(() => ({}))).mode === 'open') {
      const ports = inspectRepack(serverPath()).ports;
      const extra = (await realms.status(serverPath(), { live: false }).catch(() => ({ realms: [] }))).realms.filter(realm => realm.state !== 'absent').map(realm => realm.worldPort).filter(Boolean);
      await network.openFirewall(serverPath(), { auth: ports.auth || 3724, world: ports.world || 8085, extra }).catch(error => send('realms:progress', error.message));
    }
    return realmsStatus();
  });
  // MySQL and the authserver started by a realm's own Start (the server was stopped): stopped again with the last world
  // stopped from a card, so the home page does not stay on "2 of 3 services running". "Start the server" keeps them.
  let baseByRealm = false;
  const mysqlRunning = async () => (await requireControl().status()).some(service => service.id === 'mysql' && service.state === 'running');
  const releaseBase = async () => {
    if (!baseByRealm) return;
    const c = requireControl();
    const world = (await c.status()).some(service => /world/i.test(service.id) && ['running', 'starting'].includes(service.state));
    const realmOn = (await realms.status(serverPath(), { live: false })).realms.some(realm => ['running', 'starting'].includes(realm.state));
    if (world || realmOn) return;
    baseByRealm = false;
    await c.stopAll().catch(() => {});
  };
  handle('realms:start', async key => {
    assertServerFree();
    await applyCards(serverPath()).catch(() => {});
    await network.applyNetwork(serverPath()).catch(() => {});
    if (!(await mysqlRunning())) baseByRealm = true;
    await realmBase(false);
    // The CoA realm alone (its own world through the repack's scripts), without the realms marked to start with the server.
    if (text(key, 12) === 'coa') { if (await realms.anotherStarting(serverPath(), '')) throw new Error('A realm is starting: wait until it runs.'); await modules.keepRotationOff(serverPath()); await quietLogs(serverPath()); await requireControl().start('world'); }
    else await realms.start(serverPath(), text(key, 12));
    // The authserver once a world is up (the world applies the auth database updates).
    await requireControl().start('auth');
    return realmsStatus();
  });
  handle('realms:stop', async key => {
    if (text(key, 12) !== 'coa') { await realms.stop(serverPath(), text(key, 12)); await releaseBase(); return realmsStatus(); }
    // The CoA world alone, by its console: MySQL and the authserver stay for the other realms (the repack's supervisor
    // ends with its world). Stop all, on the home page, still stops everything.
    await stopCoaWorld();
    await releaseBase();
    return realmsStatus();
  });
  handle('realms:memory', key => realms.memoryFor(serverPath(), text(key, 12)));
  handle('realms:modules', key => realms.modulesOf(serverPath(), text(key, 12)));
  handle('realms:module', (key, id, state) => realms.setModule(serverPath(), text(key, 12), text(id, 20), text(state, 4)));
  handle('realms:options', async (key, options) => { if (text(key, 12) === 'coa') { await realms.setCoaAutostart(serverPath(), options?.autostart === true); return realmsStatus(); } await realms.setOptions(serverPath(), text(key, 12), { autostart: options?.autostart, bots: options?.bots }); return realmsStatus(); });
  const onePurge = (name, work) => oneServerJob(`recreating the bots of ${name}`, () => withMysql(work));
  handle('realms:purge', async key => { await onePurge(realms.MODES[text(key, 12)]?.title || key, () => realms.purgeBots(serverPath(), text(key, 12))); return realmsStatus(); });
  handle('realms:disable', async (key, off) => { await withMysql(() => realms.setDisabled(serverPath(), text(key, 12), off === true)); return realmsStatus(); });
  handle('realms:openLogs', async key => { const error = await shell.openPath(path.join(serverPath(), 'Royaumes', text(key, 12).replace(/[^a-z]/g, ''), 'Logs')); if (error) throw new Error(error); });
  // The world console only reads and writes a bare file name (PlayerDump.DisallowPaths = 1), in the worldserver's own
  // folder (where manage.py starts it): the launcher moves the file to <server>\Characters, or puts it there to import.
  const pdumpFolder = () => path.join(serverPath(), 'Characters');
  const worldFolder = () => {
    try { const exe = JSON.parse(require('node:fs').readFileSync(path.join(serverPath(), '.state', 'world.json'), 'utf8')).exe; if (exe && String(exe).toLowerCase().startsWith(serverPath().toLowerCase())) return path.dirname(exe); } catch {}
    return path.join(serverPath(), 'Core');
  };
  // The players' characters and accounts (random bots left out), to pick from instead of typing.
  handle('chars:list', async () => {
    await ensureMysql();
    const rows = await serverTools().backup.query("SELECT c.name, a.username, c.level FROM acore_characters.characters c JOIN acore_auth.account a ON a.id = c.account WHERE a.username NOT LIKE 'RNDBOT%' ORDER BY a.username, c.name");
    const accounts = await serverTools().backup.query("SELECT username FROM acore_auth.account WHERE username NOT LIKE 'RNDBOT%' ORDER BY username");
    return { characters: rows.map(row => { const [name, account, level] = row.split('\t'); return { name, account, level: Number(level) || 0 }; }), accounts };
  });
  handle('chars:export', async name => {
    // CoA names may hold a space (« Lord Lapin »): the world console is given the character's guid, never its name.
    const who = text(name, 24).trim();
    if (!/^[\p{L}][\p{L} '-]{1,23}$/u.test(who)) throw new Error('Choose the character to export.');
    await ensureMysql();
    const [guid] = await serverTools().backup.query(`SELECT guid FROM acore_characters.characters WHERE name = '${who.replace(/'/g, "''")}'`);
    if (!Number(guid)) throw new Error(`No character named ${who} on this server.`);
    const bare = `squidbots-export-${Number(guid)}-${Date.now()}.sql`;
    const answer = await live.raCommand(serverPath(), `pdump write ${bare} ${Number(guid)}`, 60000);
    const written = path.join(worldFolder(), bare);
    if (!fs_exists(written)) throw new Error(answer || 'The world did not write the character: is the world running?');
    await fs.mkdir(pdumpFolder(), { recursive: true });
    const file = path.join(pdumpFolder(), `${who.replace(/[^\p{L}\p{N}-]+/gu, '_')}-${new Date().toISOString().slice(0, 10)}-${Number(guid)}.sql`);
    await fs.rename(written, file).catch(async () => { await fs.copyFile(written, file); await fs.unlink(written).catch(() => {}); });
    shell.showItemInFolder(file);
    return { file, answer };
  });
  handle('chars:import', async account => {
    const login = text(account, 20).trim();
    if (!/^[A-Za-z0-9]{2,20}$/.test(login)) throw new Error('Choose the game account that gets the character.');
    await ensureMysql();
    const [known] = await serverTools().backup.query(`SELECT id FROM acore_auth.account WHERE username = '${login.toUpperCase()}'`);
    if (!Number(known)) throw new Error(`No game account named ${login} on this server.`);
    await fs.mkdir(pdumpFolder(), { recursive: true });
    const result = await dialog.showOpenDialog(window, { title: 'Choose the character file (.sql)', properties: ['openFile'], filters: [{ name: 'Character (sql)', extensions: ['sql'] }], defaultPath: pdumpFolder() });
    if (result.canceled || !result.filePaths[0]) return null;
    const bare = `squidbots-import-${Date.now()}.sql`;
    const copy = path.join(worldFolder(), bare);
    await fs.copyFile(path.resolve(result.filePaths[0]), copy);
    try {
      const answer = await live.raCommand(serverPath(), `pdump load ${bare} ${login}`, 60000);
      if (!/success|loaded/i.test(answer)) throw new Error(answer || 'The world did not load the character.');
      return { answer };
    } finally { await fs.unlink(copy).catch(() => {}); }
  });
  handle('repack:account', (name, password, gm) => requireControl().createAccount(text(name, 20), text(password, 20), gm === true));
  handle('repack:accountPassword', (name, password) => requireControl().createAccount(text(name, 20), text(password, 20), false, { change: true }));
  // The server's logs (CoreLogs): the console scrolls too fast, the files keep everything.
  handle('repack:openLogs', async () => {
    if (!serverPath()) throw new Error('Choose the server folder first.');
    const error = await shell.openPath(path.join(serverPath(), 'Core', 'Logs'));
    if (error) throw new Error(error);
  });
  handle('repack:openFolder', async () => {
    if (!serverPath()) throw new Error('Choose the server folder first.');
    const error = await shell.openPath(serverPath());
    if (error) throw new Error(error);
  });
  handle('repack:purgeBots', async () => {
    const found = requireControl();
    if (!config.server.commands.purgeBots || !inspectRepack(serverPath()).bots) throw new Error('The bots are not installed in this server.');
    if ((await found.status()).some(service => service.id === 'world' && service.state !== 'stopped')) throw new Error('Stop the worldserver first.');
    return onePurge('Conquest of Azeroth', () => found.run(config.server.commands.purgeBots, 'purge-bots'));
  });

  // ---- the bot package ----
  const requireBots = () => { if (!bots) throw new Error('No bot package is configured.'); if (!serverPath()) throw new Error('Choose the server folder first.'); };
  handle('bots:check', async force => { requireBots(); return bots.check(serverPath(), { force: force === true }); });
  handle('bots:install', async () => {
    requireBots();
    const found = requireControl();
    if (!inspectRepack(serverPath()).repack) throw new Error('Install the server first: the bots go on top of it.');
    const states = await found.status();
    const other = states.find(service => service.state === 'foreign');
    if (other) throw new Error(`Another server is running on port ${other.port} (${other.other || 'another program'}). Stop it, then install the bots.`);
    if (states.some(service => service.id === 'world' && service.state !== 'stopped')) throw new Error('Stop the worldserver first.');
    if (busyFiles) throw new Error('Another file operation is running.');
    busyFiles = true;
    upgradeState.log = [];
    try {
      // The bot installer needs the repack's database settings, written at its first start.
      if (!inspectRepack(serverPath()).started) await found.start('mysql');
      // With the repack updates (GitHub releases) the bots come inside the repack: its own installer is run,
      // nothing is downloaded from the old bots channel.
      if (config.server?.updatesUrl) await bots.runInstaller(serverPath());
      else await bots.install(serverPath());
    } finally { busyFiles = false; }
    const addonInstalled = await offerBotsAddon().catch(() => '');
    return { ...(await serverInfo()), addonInstalled };
  });

  // ---- settings of the server (.conf) ----
  // A realm other than CoA: the same page, its values inherited from CoA, its own, or set by its game mode.
  const realmKey = value => (realms.MODES[text(value, 12)] ? text(value, 12) : '');
  handle('srvconf:overview', async realm => { const overview = await serverTools().config.overview(); const memory = { totalMb: Math.round(os.totalmem() / 1048576), freeMb: Math.round(os.freemem() / 1048576) }; return { ...(realmKey(realm) ? await realms.settingsOf(serverPath(), realmKey(realm), overview) : overview), memory }; });
  handle('srvconf:save', async (changes, realm) => {
    if (!Array.isArray(changes)) throw new Error('Nothing to save.');
    if (realmKey(realm)) return realms.saveSettings(serverPath(), realmKey(realm), changes.slice(0, 200).map(change => ({ file: text(change?.file, 80), key: text(change?.key, 100), value: text(change?.value, 400), reset: change?.reset === true })));
    return serverTools().config.save(changes.slice(0, 500).map(change => ({ file: text(change?.file, 80), key: text(change?.key, 100), value: text(change?.value, 400), kind: text(change?.kind, 10) })));
  });
  handle('srvconf:backups', () => serverTools().config.backups());
  handle('srvconf:restore', id => serverTools().config.restore(text(id, 40)));

  // ---- backups ----
  const ensureMysql = async () => { const found = serverControl(); if (found && config.server.services.some(service => service.id === 'mysql')) await found.start('mysql'); };
  // SQL for the support: reading only, unless the player allowed changes (then a backup of the databases comes first).
  handle('sql:run', async (query, allowChanges) => {
    if (!serverPath()) throw new Error('Choose the server folder first.');
    const { writes } = sqlConsole.check(String(query || '').slice(0, 20000), allowChanges === true);
    await ensureMysql();
    let backup = '';
    if (writes) backup = (await serverTools().backup.create({ label: 'before-sql', includeWorld: true, reason: 'automatic' }))?.name || 'done';
    return { ...(await sqlConsole.run(serverPath(), String(query).slice(0, 20000), { allowChanges: allowChanges === true })), backup };
  });
  const verify = require('./verify.cjs');
  const watch = { world: null, crashes: null, restarts: [], backupDay: '' };
  serverStartOnOpen = async () => {
    if (!serverPath() || !inspectRepack(serverPath()).repack || serverBusy()) return;
    const services = await requireControl().status();
    if (services.some(service => /world/i.test(service.id) && service.state !== 'stopped')) return;
    await startEverything();
    send('repack:services', await requireControl().status().catch(() => []));
  };
  serverWatch = async () => {
    const root = serverPath();
    const found = serverControl();
    // The states are always followed (a start by the launcher is seen as starting, then running); the actions wait.
    if (!root || !found) return;
    const quiet = !serverBusy() && !found.states.size;
    const services = await found.status().catch(() => null);
    if (!services) return;
    const world = services.find(service => /world/i.test(service.id))?.state || null;
    const count = (await verify.crashes(root, 2).catch(() => [])).length;
    const crashed = watch.crashes !== null && count > watch.crashes;
    const before = watch.world;
    Object.assign(watch, { world, crashes: count });
    if (before === 'starting' && world === 'running' && !window?.isFocused()) notifyUser('ready');
    if (before === 'running' && world !== 'running' && crashed) {
      // At most 3 restarts an hour: a world that crashes at every start is left stopped.
      watch.restarts = watch.restarts.filter(at => Date.now() - at < 3600000);
      if (quiet && settings.restartWorldOnCrash && world === 'stopped' && watch.restarts.length < 3) { watch.restarts.push(Date.now()); notifyUser('restarted'); startEverything().catch(() => {}); }
      else notifyUser('crash');
    }
    // One automatic backup a day while MySQL runs (characters, accounts, bots), the last 7 kept.
    const day = new Date().toISOString().slice(0, 10);
    if (quiet && settings.dailyBackup !== false && watch.backupDay !== day && services.some(service => service.id === 'mysql' && service.state === 'running')) {
      watch.backupDay = day;
      const list = await serverTools().backup.list();
      const daily = list.filter(item => item.label === 'daily').sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      if (daily.some(item => item.createdAt.slice(0, 10) === day)) return;
      await oneServerJob('the daily backup', () => serverTools().backup.create({ label: 'daily', reason: 'automatic' }));
      for (const old of daily.slice(6)) await serverTools().backup.remove(old.name).catch(() => {});
    }
  };
  // ---- the achievements of the random bots (see bot-achievements.cjs): once after the update to 2.8, then on demand
  const achievementsMarker = root => path.join(root, 'Settings', 'maintenance.json');
  const cleanAchievements = root => withMysql(async () => {
    if ((await requireControl().status()).some(item => /world/i.test(item.id) && item.state !== 'stopped')) throw new Error('Stop the server first: the bots would write their achievements again while it runs.');
    if ((await realms.status(root, { live: false }).catch(() => ({ realms: [] }))).realms.some(realm => ['running', 'starting', 'stopping'].includes(realm.state))) throw new Error('Stop the realms first.');
    const done = await botAchievements.purge(root, serverTools().backup, { notify: line => send('maintenance:progress', line) });
    const marker = JSON.parse(await fs.readFile(achievementsMarker(root), 'utf8').catch(() => '{}'));
    await fs.writeFile(achievementsMarker(root), JSON.stringify({ ...marker, achievementsCleaned: new Date().toISOString() }, null, 2));
    return done;
  });
  cleanAchievementsOnce = async root => {
    const bots = repackUpdate.installed(root).bots || '';
    if (!bots || repackUpdate.compareVersions(bots, '2.8') < 0) return;
    if (JSON.parse(await fs.readFile(achievementsMarker(root), 'utf8').catch(() => '{}')).achievementsCleaned) return;
    send('update:event', { event: 'step', text: 'Cleaning the achievements of the random bots (a backup first)' });
    await cleanAchievements(root);
  };
  handle('maintenance:achievementsSize', async () => {
    if (!serverPath() || !(await requireControl().status()).some(item => item.id === 'mysql' && item.state === 'running')) return null;
    return botAchievements.sizes(serverPath(), serverTools().backup);
  });
  handle('maintenance:achievements', () => oneServerJob('the cleaning of the bots achievements', () => cleanAchievements(serverPath())));
  handle('backup:list', () => serverTools().backup.list());
  handle('backup:create', async options => { await ensureMysql(); return serverTools().backup.create({ label: text(options?.label, 40), includeWorld: options?.includeWorld === true }); });
  handle('backup:restore', name => oneServerJob('the restore of a backup', async () => {
    await ensureMysql();
    const world = config.server.services.find(service => service.id === 'world');
    await realms.stopAll(serverPath());
    return serverTools().backup.restore(text(name, 80), { worldPort: world?.port });
  }));
  handle('backup:remove', name => serverTools().backup.remove(text(name, 80)));
  handle('backup:openFolder', async () => {
    const folder = path.join(serverTools().root, 'Backups');
    await fs.mkdir(folder, { recursive: true });
    const error = await shell.openPath(folder);
    if (error) throw new Error(error);
  });

  // ---- moving to a new version of the server ----
  handle('upgrade:state', () => ({ ...upgradeState, log: upgradeState.log.slice(-200) }));
  handle('upgrade:prepare', async () => {
    requireServer();
    const folder = serverPath();
    let release = null;
    if (repackUpdater) { try { release = await repackUpdater.peek(); } catch (error) { release = { error: error.message }; } }
    let botsRelease = null;
    if (bots?.bots.manifestUrl) { try { botsRelease = await bots.updater.peek(); } catch (error) { botsRelease = { error: error.message }; } }
    let previous = null;
    try { previous = folder ? JSON.parse(await fs.readFile(path.join(folder, '.coa-launcher', 'previous.json'), 'utf8')) : null; } catch {}
    if (previous && !inspectRepack(previous.path).repack) previous = null;
    const installed = folder && repackUpdater ? await repackUpdater.installedVersion(folder) : '';
    return { previous, current: folder ? { ...inspectRepack(folder), installed } : null, release, botsRelease, suggested: folder && release?.version ? suggestFolder(folder, release.version) : '' };
  });
  handle('upgrade:chooseFolder', async purpose => {
    const result = await dialog.showOpenDialog(window, {
      title: purpose === 'old' ? 'Choose the folder of the old repack' : 'Choose an empty folder for the new version',
      properties: purpose === 'old' ? ['openDirectory'] : ['openDirectory', 'createDirectory'],
      defaultPath: serverPath() ? path.dirname(serverPath()) : 'C:\\',
    });
    if (result.canceled || !result.filePaths[0]) return null;
    return inspectRepack(result.filePaths[0]);
  });
  handle('upgrade:migrate', async options => {
    const target = serverPath();
    if (!target) throw new Error('Choose the server folder first.');
    if (upgradeState.running) throw new Error('An upgrade is already running.');
    assertServerFree();
    upgradeState.running = true;
    upgradeState.log = [];
    upgradeNotify({ step: options?.check ? 'check' : 'migrate' });
    try {
      if ((await requireControl().status()).some(item => item.id === 'world' && item.state !== 'stopped')) throw new Error('Stop the worldserver first.');
      return await upgrade.migrate({ from: text(options?.from, 400), to: target, check: options?.check === true, force: options?.force === true, noBots: options?.noBots === true });
    } finally {
      upgradeState.running = false;
      upgradeNotify({ step: 'idle' });
    }
  });
  handle('upgrade:cancel', () => { upgrade.cancel(); repackUpdater?.cancel(); bots?.updater.cancel(); });
  handle('upgrade:revert', async () => {
    const current = serverPath();
    if (!current || upgradeState.running || busyFiles) throw new Error('Another operation is running.');
    let previous = null;
    try { previous = JSON.parse(await fs.readFile(path.join(current, '.coa-launcher', 'previous.json'), 'utf8')); } catch {}
    if (!previous?.path || !inspectRepack(previous.path).repack) throw new Error('The previous version is no longer there.');
    const found = requireControl();
    if ((await found.status()).some(service => service.state !== 'stopped' && service.state !== 'foreign')) await found.stopAll();
    await persist({ ...settings, installPaths: { ...settings.installPaths, server: path.resolve(previous.path) } });
    return serverInfo();
  });
  handle('upgrade:run', async options => {
    requireServer();
    const oldRoot = serverPath();
    if (!oldRoot || !repackUpdater) throw new Error('Choose the server folder first.');
    if (upgradeState.running || busyFiles) throw new Error('Another operation is running.');
    assertServerFree();
    const target = path.resolve(text(options?.folder, 400));
    assertFolder(target);
    await assertLocalDrive(target);
    const old = inspectRepack(oldRoot);
    if (target.toLowerCase() === path.resolve(oldRoot).toLowerCase() || target.toLowerCase().startsWith(path.resolve(oldRoot).toLowerCase() + path.sep)) throw new Error('Install the new version next to the current one, not inside it.');
    const entries = await fs.readdir(target).catch(() => []);
    if (entries.length && !inspectRepack(target).repack && !entries.includes('.coa-launcher')) throw new Error('Choose an empty folder for the new version.');
    upgradeState.running = true;
    upgradeState.log = [];
    const warnings = [];
    const say = line => upgradeNotify({ line });
    try {
      upgradeNotify({ step: 'stop' });
      const oldControl = requireControl();
      if ((await oldControl.status()).some(service => service.state !== 'stopped' && service.state !== 'foreign')) { say('Stopping the current server…'); await oldControl.stopAll(); }

      upgradeNotify({ step: 'install' });
      say(`Installing the new version in ${target}…`);
      await repackUpdater.idle();
      busyFiles = true;
      try { await repackUpdater.update(target, { components: settings.components.server }); }
      finally { busyFiles = false; }
      try {
        await fs.copyFile(path.join(oldRoot, 'Settings/network.json'), path.join(target, 'Settings/network.json'));
        await network.applyNetwork(target);
      } catch {}

      upgradeNotify({ step: 'prepare' });
      say('First start of the new database…');
      const fresh = new ServerControl({ root: target, services: config.server.services, commands: config.server.commands });
      await fresh.start('mysql');

      // Bots that were on the old server come back on the new one: package, then its installer.
      if (bots && old.bots && options?.bots !== false) {
        upgradeNotify({ step: 'bots' });
        say(`Installing ${config.server.bots.name} on the new version…`);
        await fresh.stopAll();
        await bots.install(target);
      }
      await fresh.stopAll();

      upgradeNotify({ step: 'migrate' });
      if (options?.migrate !== false && old.hasData) {
        const result = await upgrade.migrate({ from: oldRoot, to: target, force: true, noBots: options?.bots === false });
        say(`Accounts: ${result.summary.result?.accounts ?? '?'} · characters: ${result.summary.result?.characters ?? '?'}`);
      } else say('No migration asked: the new version starts with an empty realm.');

      upgradeNotify({ step: 'settings' });
      const carried = await new ServerConfig(oldRoot).carryTo(target);
      if (carried.applied.length) say(`Settings carried over: ${carried.applied.join(', ')}`);
      if (carried.skipped.length) warnings.push(`Settings not found in the new version: ${carried.skipped.join(', ')}`);
      if (JSON.stringify(inspectRepack(target).ports) !== JSON.stringify(old.ports)) {
        await fs.copyFile(path.join(oldRoot, 'Settings/repack.json'), path.join(target, 'Settings/repack.json'));
        say('Ports carried over from the current server.');
      }
      if (old.bots && !inspectRepack(target).bots) warnings.push('The bots were on the old server and are not on the new one yet: install them from the Server tab.');
      if (options?.purgeBots && inspectRepack(target).bots && config.server.commands.purgeBots) {
        say('Deleting the random bots so they are created again with the new version…');
        await fresh.run(config.server.commands.purgeBots, 'purge-bots');
      }

      upgradeNotify({ step: 'switch' });
      await fs.writeFile(path.join(target, '.coa-launcher', 'previous.json'), JSON.stringify({ path: oldRoot, release: old.release, switchedAt: new Date().toISOString() }, null, 2));
      await persist({ ...settings, installPaths: { ...settings.installPaths, server: target } });
      say(`The launcher now uses ${target}. The previous version stays in ${oldRoot}.`);
      upgradeNotify({ step: 'done' });
      return { ok: true, folder: target, previous: oldRoot, warnings, info: await serverInfo() };
    } catch (error) {
      upgradeNotify({ step: 'failed', line: error.message });
      throw error;
    } finally {
      upgradeState.running = false;
      upgradeNotify({});
    }
  });

  // ---- reinstalling CoA + Bots from scratch (Verification > Troubleshooting) ----
  // Next to the current server, never over it: a fresh package prepared from the game, the bots, our navigation maps,
  // then the accounts, characters, bots, realms and settings of the current server copied in. The current folder is
  // only read: a failure puts the launcher back on it, and it is offered for deletion only once the new one started.
  const folderBytes = async folder => {
    let total = 0;
    const walk = async dir => { for (const entry of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) { const file = path.join(dir, entry.name); if (entry.isDirectory()) await walk(file); else total += (await fs.stat(file).catch(() => ({ size: 0 }))).size; } };
    await walk(folder);
    return total;
  };
  const freeBytes = folder => { try { const disk = require('node:fs').statfsSync(folder); return disk.bavail * disk.bsize; } catch { return Infinity; } };
  const reinstallTarget = current => {
    const day = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const base = path.join(path.dirname(current), `${path.basename(current).replace(/-reinstall-\d{8}(-\d+)?$/, '')}-reinstall-${day}`);
    let candidate = base;
    for (let i = 2; fs_exists(candidate) && i < 100; i++) candidate = `${base}-${i}`;
    return candidate;
  };
  const reinstallNeed = async current => {
    const entry = feed?.repack;
    // The zip and its unpacked files, the game data taken from the client (about 4 GB), our navigation maps (1.9 GB
    // downloaded, about 5 GB unpacked), and the databases copied over.
    return (entry?.bytes || 0) * 3 + 4e9 + 7e9 + await folderBytes(path.join(current, 'mysql', 'data'));
  };
  const previousOf = async current => {
    try {
      const previous = JSON.parse(await fs.readFile(path.join(current, '.coa-launcher', 'previous.json'), 'utf8'));
      return previous?.path && inspectRepack(previous.path).repack && path.resolve(previous.path).toLowerCase() !== path.resolve(current).toLowerCase() ? previous : null;
    } catch { return null; }
  };
  handle('reinstall:prepare', async () => {
    requireServer();
    const current = serverPath();
    if (!current) return null;
    const target = reinstallTarget(current);
    const previous = await previousOf(current);
    return {
      available: !!feed?.repack?.sha256 && !!config.server?.updatesUrl,
      folder: target, need: await reinstallNeed(current), free: freeBytes(path.dirname(current)),
      game: !!gamePath(), realms: (await realms.status(current, { live: false }).catch(() => ({ realms: [] }))).realms.filter(realm => realm.state !== 'absent').map(realm => realm.key),
      previous: previous?.reinstall ? { path: previous.path, bytes: await folderBytes(previous.path) } : null,
    };
  });
  handle('reinstall:run', async () => {
    requireServer();
    const old = serverPath();
    if (!old || !feed?.repack?.sha256) throw new Error('The full server is not on the channel yet.');
    if (!gamePath()) throw new Error('Choose your game folder first: the server takes its game data from it.');
    if (game) throw new Error('Close the game first.');
    if (upgradeState.running || busyFiles || assembling || update.busy) throw new Error('Another operation is running.');
    assertServerFree();
    const need = await reinstallNeed(old);
    const free = freeBytes(path.dirname(old));
    if (free < need) throw new Error(`Free at least ${Math.ceil((need - free) / 1e9)} GB more on ${path.parse(old).root.replace(/\\$/, '')}: the new install goes next to the current one.`);
    const target = reinstallTarget(old);
    assertFolder(target);
    await assertLocalDrive(target);
    const before = inspectRepack(old);
    const oldRealms = (await realms.status(old, { live: false }).catch(() => ({ realms: [] }))).realms.filter(realm => realm.state !== 'absent').map(realm => realm.key);
    upgradeState.running = true;
    upgradeState.log = [];
    const say = line => upgradeNotify({ line });
    let switched = false;
    try {
      upgradeNotify({ step: 'backup' });
      say('Backup of the databases (Backups, « before-reinstall »)…');
      await lendMysql(() => serverTools().backup.create({ label: 'before-reinstall', reason: 'automatic' }));

      upgradeNotify({ step: 'stop' });
      say('Stopping the server…');
      await realms.stopAll(old);
      await requireControl().stopAll();

      upgradeNotify({ step: 'install' });
      say(`Downloading and unpacking a fresh server in ${target}…`);
      await fs.mkdir(target, { recursive: true });
      busyFiles = true;
      try { await installPackage(target); } finally { busyFiles = false; }
      // The player's own files of the repack: ports and remote console, who can join, the realm cards, MySQL tuning.
      for (const name of ['repack.json', 'network.json', 'realm-cards.json', 'my.ini.custom']) {
        await fs.copyFile(path.join(old, 'Settings', name), path.join(target, 'Settings', name)).catch(() => {});
      }
      await network.applyNetwork(target).catch(() => {});
      await fs.mkdir(path.join(target, '.coa-launcher'), { recursive: true });
      await fs.writeFile(path.join(target, '.coa-launcher', 'previous.json'), JSON.stringify({ path: old, release: before.release, switchedAt: new Date().toISOString(), reinstall: true }, null, 2));
      settings.instances = [...new Set([old, target].map(item => path.normalize(item)).concat(settings.instances))].slice(0, 12);
      await persist({ ...settings, installPaths: { ...settings.installPaths, server: target } });
      switched = true;

      upgradeNotify({ step: 'prepare' });
      say('Preparing the server from your game, then the bots and the navigation maps (about 30 minutes)…');
      await assembleServerOnce(undefined, { inside: true });
      await requireControl().stopAll();

      upgradeNotify({ step: 'migrate' });
      if (before.hasData) {
        // The extra realms first get their (empty) databases and realm list line here, then their data with the rest.
        if (oldRealms.length) {
          await requireControl().start('mysql');
          for (const key of oldRealms) {
            const saved = JSON.parse(await fs.readFile(path.join(old, 'Royaumes', key, 'realm.json'), 'utf8').catch(() => '{}'));
            say(`Realm ${saved.name || key}…`);
            const made = await realms.create(target, key, { notify: say });
            for (const name of (await fs.readdir(path.join(old, 'Royaumes', key)).catch(() => [])).filter(item => /\.json$/i.test(item) && item !== 'realm.json')) {
              await fs.copyFile(path.join(old, 'Royaumes', key, name), path.join(target, 'Royaumes', key, name));
            }
            await fs.writeFile(path.join(target, 'Royaumes', key, 'realm.json'), JSON.stringify({ ...made, name: saved.name || made.name, autostart: saved.autostart !== false, disabled: saved.disabled === true }, null, 2));
            if (saved.disabled) await realms.setDisabled(target, key, true).catch(() => {});
          }
          await requireControl().stopAll();
        }
        const result = await upgrade.migrate({ from: old, to: target, force: true, realms: oldRealms });
        say(`Accounts: ${result.summary.result?.accounts ?? '?'} · characters: ${result.summary.result?.characters ?? '?'}`);
      } else say('The current server has no characters yet: nothing to copy.');

      upgradeNotify({ step: 'settings' });
      const edits = await new ServerConfig(old).carryEdits(target, { sameRelease: !!before.release && before.release === inspectRepack(target).release });
      const carried = await new ServerConfig(old).carryTo(target);
      const applied = [...new Set([...edits.applied, ...carried.applied])];
      say(applied.length ? `Settings carried over: ${applied.join(', ')}` : 'No changed setting to carry over.');
      const skipped = [...new Set([...edits.skipped, ...carried.skipped])];
      if (skipped.length) say(`Not carried over (absent from the new version or refused): ${skipped.join(', ')}`);

      upgradeNotify({ step: 'test' });
      say('Test start of the new server (the first one brings the copied characters up to date: it can take a few minutes)…');
      await prepareStart();
      await requireControl().startAll();
      await requireControl().stopAll();

      upgradeNotify({ step: 'done' });
      say(`Done: the launcher now uses ${target}. The previous server stays in ${old} until you delete it (Verification).`);
      return { ok: true, folder: target, previous: old, info: await serverInfo() };
    } catch (error) {
      upgradeNotify({ step: 'failed', line: error.message });
      if (switched) {
        await Promise.resolve(assembler.stopMmaps(target)).catch(() => {});
        await requireControl().stopAll().catch(() => {});
        await persist({ ...settings, installPaths: { ...settings.installPaths, server: old } });
        say(`The launcher is back on ${old}: nothing was changed there. The unfinished install stays in ${target} for the support.`);
      }
      throw error;
    } finally {
      upgradeState.running = false;
      upgradeNotify({});
    }
  });
  // The server left behind by a reinstall, deleted on the player's word once the new one runs. Its backups move to
  // the new server first.
  handle('reinstall:removeOld', async () => {
    requireServer();
    const current = serverPath();
    const previous = await previousOf(current);
    if (!previous?.reinstall) throw new Error('There is no previous server to delete.');
    if (upgradeState.running || busyFiles || assembling) throw new Error('Another operation is running.');
    const old = path.resolve(previous.path);
    if (current.toLowerCase().startsWith(old.toLowerCase() + path.sep) || old.toLowerCase().startsWith(path.resolve(current).toLowerCase() + path.sep)) throw new Error('The two servers are inside each other: delete the folder by hand.');
    if ((await requireControl().status()).some(service => service.state !== 'stopped' && service.state !== 'foreign')) throw new Error('Stop the server first.');
    if ((await realms.status(old, { live: false }).catch(() => ({ realms: [] }))).realms.some(realm => ['running', 'starting', 'stopping'].includes(realm.state))) throw new Error('A realm of the previous server still runs.');
    const backups = path.join(old, 'Backups');
    if (fs_exists(backups)) {
      const kept = path.join(current, 'Backups', `previous-${path.basename(old)}`);
      await fs.mkdir(path.dirname(kept), { recursive: true });
      await fs.rename(backups, kept).catch(() => fs.cp(backups, kept, { recursive: true }));
    }
    await fs.rm(old, { recursive: true, force: true, maxRetries: 3 });
    await fs.rm(path.join(current, '.coa-launcher', 'previous.json'), { force: true });
    settings.instances = settings.instances.filter(item => path.resolve(item).toLowerCase() !== old.toLowerCase());
    await persist({ ...settings });
    return serverInfo();
  });

  // ---- support report ----
  handle('support:report', async () => {
    const client = await clientInfo();
    const server = await serverInfo().catch(() => null);
    const summary = [
      `${config.appName} ${app.getVersion()} — ${new Date().toISOString()}`,
      support.systemSummary(),
      '',
      `Game: ${client.installed ? `installed, release ${client.version || '?'}` : 'not installed'}`,
      `Game folder: ${client.path || '-'}`,
      `Realm address: ${client.realmlist}`,
      `Game update state: ${client.progress.phase} ${client.progress.message || ''}`,
      '',
      server ? `Server folder: ${server.path || '-'}` : 'No local server configured.',
      server?.details ? `Repack: ${server.details.release || '?'} (launcher release ${server.version || '-'})` : '',
      server?.bots ? `Bots: ${server.bots.installed ? `${server.bots.version} for ${server.bots.builtFor}` : 'not installed'}` : '',
      server ? `Services: ${server.services.map(service => `${service.name} ${service.state}`).join(', ')}` : '',
    ].filter(line => line !== undefined).join('\n');
    const zip = await support.buildReport({ summary, gameRoot: client.installed ? client.path : '', serverRoot: server?.path || '' });
    const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
    const result = await dialog.showSaveDialog(window, { title: 'Save the support report', defaultPath: path.join(app.getPath('desktop'), `support-${stamp}.zip`), filters: [{ name: 'Zip', extensions: ['zip'] }] });
    if (result.canceled || !result.filePath) return null;
    await fs.writeFile(result.filePath, zip);
    shell.showItemInFolder(result.filePath);
    return { file: result.filePath, size: zip.length, discord: !!config.discordUrl };
  });
  handle('link:discord', async () => { if (config.discordUrl) await shell.openExternal(config.discordUrl); });
  handle('link:baseClient', async () => { if (config.game.baseClient) await shell.openExternal(config.game.baseClient.url); });

  handle('launcher:check', () => launcherUpdates.check());
  handle('notify:test', () => { if (!Notification.isSupported()) throw new Error('Windows notifications are not available here.'); notifyUser('ready'); return true; });
  // Clean the logs: the old ones (world-console.log.1 …) always, the big current ones only with every world stopped
  // (a running world writes in them). Only files of the Logs folders, never a folder.
  handle('verify:cleanLogs', async () => {
    if (!serverPath()) throw new Error('Choose the server folder first.');
    const root = serverPath();
    const folders = ['Core/Logs', 'CoA-Bots/Core/Logs', ...(await fs.readdir(path.join(root, 'Royaumes')).catch(() => [])).map(key => `Royaumes/${key}/Logs`)];
    const worldOn = (await requireControl().status()).some(service => /world/i.test(service.id) && service.state !== 'stopped')
      || (await realms.status(root, { live: false }).catch(() => ({ realms: [] }))).realms.some(realm => ['running', 'starting', 'stopping'].includes(realm.state));
    let deleted = 0;
    let freed = 0;
    let kept = 0;
    for (const folder of folders) {
      const dir = path.join(root, ...folder.split('/'));
      for (const name of await fs.readdir(dir).catch(() => [])) {
        const file = path.join(dir, name);
        const stat = await fs.lstat(file).catch(() => null);
        if (!stat?.isFile()) continue;
        const old = /\.\d+$/.test(name) || /\.log\.\d+/i.test(name);
        const big = stat.size > 100 * 1024 ** 2;
        if (!old && !big) continue;
        if (!old && worldOn) { kept++; continue; }
        if (await fs.unlink(file).then(() => true, () => false)) { deleted++; freed += stat.size; } else kept++;
      }
    }
    return { deleted, freed, kept, worldOn };
  });
  handle('verify:archiveCrashes', () => { if (!serverPath()) throw new Error('Choose the server folder first.'); return require('./verify.cjs').archiveCrashes(serverPath()); });
  handle('launcher:install', () => launcherUpdates.install());
}

function registerProtocol() {
  const csp = ["default-src 'self'", "script-src 'self'", "style-src 'self'", "img-src 'self' data:", "font-src 'self'", "connect-src 'self'", "object-src 'none'", "base-uri 'none'", "form-action 'none'"].join('; ');
  protocol.handle(SCHEME, async request => {
    const url = new URL(request.url);
    if (url.hostname !== 'launcher' || request.method !== 'GET') return new Response('Not found', { status: 404 });
    let relative;
    try { relative = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html'; } catch { return new Response('Bad request', { status: 400 }); }
    const file = path.resolve(publicRoot, relative);
    if (!file.startsWith(publicRoot + path.sep)) return new Response('Forbidden', { status: 403 });
    const response = await net.fetch(pathToFileURL(file).href).catch(() => new Response('Not found', { status: 404 }));
    if (!file.endsWith('.html')) return response;
    const headers = new Headers(response.headers);
    headers.set('Content-Security-Policy', csp);
    return new Response(response.body, { status: response.status, headers });
  });
}

async function runSmoke() {
  // Screenshot tour: COA_SMOKE_PAGES="play,server,click:<selector>,until:<selector>:<seconds>,wait".
  await fs.mkdir(smokeDir, { recursive: true });
  const log = line => fs.appendFile(path.join(smokeDir, 'smoke.log'), `${new Date().toISOString()} ${line}\n`).catch(() => {});
  window.webContents.on('console-message', event => log(`[page:${event.level}] ${event.message}`));
  const pages = (process.env.COA_SMOKE_PAGES || 'play,server').split(',');
  await new Promise(resolve => setTimeout(resolve, 2500));
  let index = 0;
  for (const page of pages) {
    log(`step ${page}`);
    const until = /^until:(.+):(\d+)$/.exec(page);
    if (until) {
      const deadline = Date.now() + Number(until[2]) * 1000;
      let found = false;
      while (!found && Date.now() < deadline) {
        found = await window.webContents.executeJavaScript(`!!document.querySelector(${JSON.stringify(until[1])})`).catch(() => false);
        if (!found) await new Promise(resolve => setTimeout(resolve, 2000));
      }
      log(`until ${until[1]}: ${found ? 'found' : 'timed out'}`);
    } else await window.webContents.executeJavaScript(`window.App && App.smoke(${JSON.stringify(page)})`).catch(error => log(`step failed: ${error.message}`));
    await new Promise(resolve => setTimeout(resolve, Number(process.env.COA_SMOKE_DELAY) || 2000));
    const image = await window.webContents.capturePage();
    index++;
    await fs.writeFile(path.join(smokeDir, `${String(index).padStart(2, '0')}-${page.replace(/[^a-z0-9-]/gi, '_').slice(0, 60)}.png`), image.toPNG());
  }
  app.quit();
}

// Stable or test: the test address is used only when the player chose it and the configuration has one.
function channelUrl(section) {
  return settings.channel === 'test' && section.testManifestUrl ? section.testManifestUrl : section.manifestUrl;
}

// Downloads go through Chromium's network stack: Node's own fetch (undici) can abort the whole process
// with "assert(!this.paused)" when a server closes a connection while a large download waits for the disk.
const netFetch = (url, options) => net.fetch(String(url), options);

// Built at start and again when the player changes channel (never during a file operation).
function createUpdaters() {
  updater = null;
  repackUpdater = null;
  bots = null;
  if (config.game.manifestUrl) {
    updater = new ClientUpdater({
      manifestUrl: channelUrl(config.game), requiredExecutable: config.game.clientExecutable, publicKey: config.keys.game, updatesOnly: config.game.updatesOnly, fetchImpl: netFetch,
      notify: status => send('client:progress', status),
      beforeApply: async () => { if (game) throw new Error('Close the game first.'); await requireGameClosed(config.game.processNames, gamePath()); },
    });
  }
  if (config.game.addonCatalogUrl) addons = new AddonManager({ catalogUrl: config.game.addonCatalogUrl, publicKey: config.keys.game, fetchImpl: netFetch });
  if (config.server?.manifestUrl) {
    repackUpdater = new ClientUpdater({
      manifestUrl: channelUrl(config.server), requiredExecutable: config.server.requiredExecutable, publicKey: config.keys.server, rules: 'server', area: 'repack', fetchImpl: netFetch,
      notify: status => send('repack:progress', status),
      beforeApply: async () => { const found = serverControl(); if (found && (await found.status()).some(service => service.state === 'running' || service.state === 'starting')) throw new Error('Stop the server before updating it.'); },
    });
  }
  if (config.server?.bots) bots = new BotsPackage({ bots: { ...config.server.bots, channelUrl: channelUrl(config.server.bots) }, key: config.keys.bots, fetchImpl: netFetch, notify: status => send('bots:progress', status), onLine: line => upgradeNotify({ line }) });
}

// The signed list of the latest update, read at start and every 30 minutes.
// Before a start: the repack's small log fix (only when the player has no line of his own); the window is told.
async function quietLogs(root) {
  if (await tweaks.quietPlayerLogger(root).catch(() => false)) send('repack:notice', { key: 'logs.quieted', text: 'Quieter logs: the repeated "Wrong area flag" messages of the new maps are no longer written (Settings\\worldserver.conf.template).' });
}

// The signed lists of the components, read at start and every 30 minutes (a missing one is simply not offered).
let componentLists = {};
let serverWatch = null;
let applyCards = async () => {};
let cleanAchievementsOnce = async () => {};
let serverStartOnOpen = null;
let componentsBusy = false;
const componentsState = () => ({ busy: componentsBusy, list: components.status(serverPath(), componentLists) });
async function refreshComponents() {
  const base = config.server?.componentsUrl;
  if (!base) return componentsState();
  const next = {};
  for (const name of components.NAMES) {
    try {
      const { data } = await fetchSigned(new URL(`${name}.json`, base.endsWith('/') ? base : `${base}/`), { key: config.keys.server, fetchImpl: netFetch, signal: AbortSignal.timeout(20000), maxBytes: 64 * 1024, redirect: 'follow' });
      next[name] = components.clean(name, data);
    } catch {}
  }
  componentLists = next;
  const state = componentsState();
  send('components:state', state);
  return state;
}

// Testers (betaUpdates in the settings) also read the beta list and get the newer of the two.
async function refreshRepackUpdate() {
  const url = config.server?.updatesUrl;
  if (!url) return null;
  const read = async (link, channel) => {
    const { data } = await fetchSigned(new URL(link), { key: config.keys.server, fetchImpl: netFetch, signal: AbortSignal.timeout(20000), maxBytes: 512 * 1024, redirect: 'follow' });
    const manifest = repackUpdate.cleanManifest(data);
    if (manifest.channel !== channel) throw new Error(`The ${channel} update list holds a ${manifest.channel} version: it is not used.`);
    return manifest;
  };
  try {
    let manifest = await read(url, 'stable');
    if (settings.betaUpdates && config.server.betaUpdatesUrl) {
      const beta = await read(config.server.betaUpdatesUrl, 'beta').catch(() => null);
      if (beta && repackUpdate.compareVersions(beta.version, manifest.version) > 0) manifest = beta;
    }
    update.manifest = manifest;
    update.error = null;
  } catch (error) { update.error = error.message; }
  const state = repackUpdateState();
  if (state.state === 'available' && update.manifest?.version && notifiedUpdate !== update.manifest.version) { notifiedUpdate = update.manifest.version; notifyUser('update', { version: update.manifest.version }); }
  send('update:state', state);
  return state;
}

// Screenshot tours: a pretend update, so every screen of the update can be looked at without a release.
const demoUpdate = () => (smokeDir ? process.env.COA_SMOKE_UPDATE : '') || '';
const DEMO_MANIFEST = { version: '2.4', release: 'main-20261020-0123abcd', from: ['main-20261014-ad8370da'], notes: '## CoA Bots 2.4\n\n- **Updates from the launcher**: one click, with a backup and an undo.\n- Bots and core brought up to date together.', package: { size: 73608202, folder: 'CoA-Update-2.4' } };

function repackUpdateState() {
  if (demoUpdate()) return { busy: update.busy, phase: update.phase, last: update.last, state: update.last && !update.last.error ? 'current' : demoUpdate(), here: { release: 'main-20261014-ad8370da', bots: '2.3' }, manifest: DEMO_MANIFEST };
  const folder = serverPath();
  const base = { busy: update.busy, phase: update.phase, last: update.last, listError: update.error, addonClient: settings.installPaths.addon || '' };
  let diskFree = null;
  try { const disk = require('node:fs').statfsSync(folder); diskFree = disk.bavail * disk.bsize; } catch {}
  return folder && fs_exists(folder) ? { ...base, diskFree, ...repackUpdate.status(folder, update.manifest) } : { ...base, state: 'noserver', manifest: update.manifest };
}

// The newest CoA-Update-x folder already in the repack (for an undo or the end of a cut update).
async function packageInRepack(folder) {
  const names = (await fs.readdir(folder).catch(() => [])).filter(name => /^CoA-Update-[0-9A-Za-z.-]+$/.test(name) && fs_exists(path.join(folder, name, 'update', 'coa_update.py')));
  return names.sort((a, b) => a.localeCompare(b, 'en', { numeric: true })).pop() || null;
}

// One run of the update tool, with its events sent to the window and its whole log kept on disk.
async function runUpdateTool(folder, packageFolder, command, extra) {
  const result = await repackUpdate.runTool(folder, packageFolder, command, extra, event => send('update:event', event));
  const logs = path.join(app.getPath('userData'), 'logs');
  await fs.mkdir(logs, { recursive: true });
  const file = path.join(logs, `update-${new Date().toISOString().replace(/[:.]/g, '-')}-${command}.log`);
  await fs.writeFile(file, result.log.join('\n') + '\n').catch(() => {});
  return { ...result, logFile: file, command };
}

// Everything the support needs in one text: versions, the error, its details, the end of the log.
function supportReport() {
  const last = update.last || {};
  const here = serverPath() ? repackUpdate.installed(serverPath()) : {};
  return [`SquidBots Server ${app.getVersion()} · Windows ${require('node:os').release()}`,
    `Repack: ${serverPath() || '-'} · release ${here.release || '-'} · CoA Bots ${here.bots || '-'}`,
    `Update: ${update.manifest?.version || '-'} (${update.manifest?.release || '-'})`,
    last.error ? `Error [${last.error.code}] ${last.error.text}` : 'No error',
    ...(last.details || []).map(line => `  ${line}`), '--- log ---', ...(last.log || []).slice(-40), `Log file: ${last.logFile || '-'}`].join('\n');
}

// The last 3 patch notes: the releases of squidbots-updates (GitHub), or else the CHANGELOG of the installed bots.
// Text only, shown escaped: it needs no signature.
let notesCache = { at: 0, list: [] };
const plain = line => line.replace(/\*\*|`/g, '').trim();
function noteSummary(body) {
  // The title line of the notes ("## v2.6 — Three realms… (October 2026) — release main-…") says it best.
  const head = /^##\s+(.+)$/m.exec(body)?.[1];
  // The card already shows "CoA Bots 2.6" and the date: the version, the month and the release id are left out.
  if (head) return plain(head).replace(/\s*[—-]\s*release\s+\S+\s*$/i, '').replace(/^v?[\d.]+\s*[—-]\s*/, '').replace(/\s*\([A-Za-z]+ \d{4}\)\s*$/, '').slice(0, 300);
  const bold = [...body.matchAll(/^\s*[-*] \*\*(.+?)\*\*/gm)].map(m => plain(m[1]).replace(/[.:]$/, ''));
  if (bold.length) return bold.slice(0, 4).join(' · ');
  return plain(body.split(/\r?\n/).find(line => line.trim() && !line.startsWith('#')) || '').slice(0, 300);
}
// The notes of the installed CoA Bots (its CHANGELOG.md), newest first: read each time, so an update shows at once.
async function installedNotes() {
  if (!serverPath() || !config.server?.bots?.folder) return [];
  try {
    const text = await fs.readFile(path.join(serverPath(), config.server.bots.folder, 'CHANGELOG.md'), 'utf8');
    return text.split(/^(?=## )/m).filter(part => part.startsWith('## ')).slice(0, 3).map(part => {
      const head = part.split(/\r?\n/)[0].replace(/^## /, '');
      const [, version, date] = /^v?([\d.]+)\s*(?:\(([^)]+)\))?/.exec(head) || [];
      const body = part.split(/\r?\n/).slice(1).join('\n').trim();
      return { title: version ? `CoA Bots ${version}` : head.slice(0, 80), version: version || '', date: date || '', text: body.slice(0, 60000), summary: noteSummary(body), url: '' };
    });
  } catch { return []; }
}
async function patchNotes() {
  let list = notesCache.list;
  if (!(Date.now() - notesCache.at < 25 * 60 * 1000 && list.length)) {
    list = [];
    const repo = /github\.com\/([\w.-]+\/[\w.-]+)\/releases/.exec(config.server?.updatesUrl || '')?.[1];
    if (repo) {
      try {
        const response = await netFetch(`https://api.github.com/repos/${repo}/releases?per_page=10`, { headers: { Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(15000) });
        if (response.ok) {
          list = (await response.json()).filter(item => !item.draft && !item.prerelease).slice(0, 3).map(item => ({
            title: String(item.name || item.tag_name || '').slice(0, 80), date: String(item.published_at || '').slice(0, 10),
            text: String(item.body || '').slice(0, 60000), summary: noteSummary(String(item.body || '')), url: /^https:\/\/github\.com\//.test(item.html_url || '') ? item.html_url : '',
          }));
        }
      } catch {}
    }
    if (list.length) notesCache = { at: Date.now(), list };
  }
  // The installed version first when the published notes do not have it yet (a test channel, or just updated).
  const local = await installedNotes();
  const own = local[0];
  const known = own?.version && list.some(note => new RegExp(`(^|[^\\d.])v?${own.version.replace(/\./g, '\\.')}($|[^\\d.])`).test(note.title));
  if (!list.length) list = local;
  else if (own?.version && !known && repackUpdate.compareVersions(own.version, (/(\d+(?:\.\d+)+)/.exec(list[0].title) || [])[1] || '0') > 0) list = [own, ...list].slice(0, 3);
  return list.map(({ version, ...note }) => ({ ...note, ...localNote(note.text) }));
}
// The part of a release text in the player's language (after <!-- fr -->), the English part (before any marker) otherwise.
function localNote(body) {
  const parts = String(body || '').split(/^<!--\s*(en|fr|ru)\s*-->\s*$/m);
  if (parts.length < 3) return {};
  const byLang = { en: parts[0].trim() };
  for (let i = 1; i < parts.length; i += 2) byLang[parts[i]] = parts[i + 1].trim();
  const text = byLang[settings.language] || byLang.en || parts[0];
  return { text, summary: noteSummary(text) };
}

// The dashboard in its own window of the launcher: a local page only (localhost), links to the web go to the browser.
let dashboardWindow = null;
function openDashboardWindow(url) {
  if (dashboardWindow && !dashboardWindow.isDestroyed()) { dashboardWindow.loadURL(url); dashboardWindow.show(); dashboardWindow.focus(); return; }
  dashboardWindow = new BrowserWindow({ width: 1320, height: 860, minWidth: 900, minHeight: 600, title: 'SquidBots Dashboard', backgroundColor: '#04121c', autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false } });
  dashboardWindow.removeMenu();
  const local = target => /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(target);
  dashboardWindow.webContents.setWindowOpenHandler(({ url: target }) => { if (/^https?:\/\//.test(target)) shell.openExternal(target); return { action: 'deny' }; });
  dashboardWindow.webContents.on('will-navigate', (event, target) => { if (!local(target)) { event.preventDefault(); if (/^https?:\/\//.test(target)) shell.openExternal(target); } });
  dashboardWindow.on('closed', () => { dashboardWindow = null; });
  dashboardWindow.loadURL(url);
}

// Closing the launcher only closes the launcher: the server it started keeps running (manage.py runs it on its own).
let closing = false;
let notifiedUpdate = '';
let tray = null;
let balloonIcon = null;
// Windows notifications (update, server ready, crash) in the player's language; a click brings the launcher back.
const NOTE_TEXT = {
  en: { update: ['New version {version}', 'An update of the server is ready to install in the launcher.'], ready: ['Server ready', 'The world is up: you can play.'], crash: ['The world stopped', 'The worldserver crashed. A crash report was written (Verification).'], restarted: ['The world is starting again', 'The worldserver crashed and is being started again.'], open: 'Open the launcher', quit: 'Close the launcher (the server keeps running)' },
  fr: { update: ['Nouvelle version {version}', 'Une mise à jour du serveur est prête à installer dans le launcher.'], ready: ['Serveur prêt', 'Le monde est lancé : vous pouvez jouer.'], crash: ['Le monde s\'est arrêté', 'Le worldserver a planté. Un rapport de crash a été écrit (Vérification).'], restarted: ['Le monde redémarre', 'Le worldserver a planté et redémarre.'], open: 'Ouvrir le launcher', quit: 'Fermer le launcher (le serveur continue)' },
  ru: { update: ['Новая версия {version}', 'Обновление сервера готово к установке в лаунчере.'], ready: ['Сервер готов', 'Мир запущен: можно играть.'], crash: ['Мир остановился', 'Worldserver упал. Записан отчёт о сбое (Проверка).'], restarted: ['Мир перезапускается', 'Worldserver упал и запускается снова.'], open: 'Открыть лаунчер', quit: 'Закрыть лаунчер (сервер продолжает работать)' },
};
const noteWords = () => NOTE_TEXT[settings?.language] || NOTE_TEXT.en;
function showWindow() { if (!window) return; if (window.isMinimized()) window.restore(); window.show(); window.focus(); }
function notifyUser(kind, values = {}) {
  if (smokeDir || settings?.notifications === false) return;
  const [title, body] = noteWords()[kind] || [];
  if (!title) return;
  const fill = value => value.replace(/\{(\w+)\}/g, (_m, key) => values[key] ?? '');
  // Through the notification area icon on Windows: a toast of Notification needs a Start menu shortcut with the
  // app's id, which a launcher run from its sources (or moved by hand) does not have; the icon's balloon always shows.
  if (tray && process.platform === 'win32') { tray.displayBalloon({ title: fill(title), content: fill(body), ...(balloonIcon ? { iconType: 'custom', icon: balloonIcon } : { iconType: 'info' }), respectQuietTime: true }); return; }
  if (!Notification.isSupported()) return;
  const note = new Notification({ title: fill(title), body: fill(body) });
  note.on('click', showWindow);
  note.show();
}
// The notification area: the launcher can stay there when its window is closed (Settings), and comes back on a click.
async function createTray() {
  // Drawn at 16, 24 and 32 px (tray, @1.5x, @2x) and shipped with the app: the exe's own icon read back by
  // getFileIcon came out blank in the notification area of the installed launcher.
  const drawnTray = nativeImage.createFromPath(path.join(__dirname, 'assets', 'tray.png'));
  const image = !drawnTray.isEmpty() ? drawnTray : await app.getFileIcon(process.execPath, { size: 'small' }).catch(() => nativeImage.createEmpty());
  // The octopus in the balloons, drawn at 32, 48 and 64 px (notify@1.5x, @2x) so Windows never enlarges a small icon.
  const drawn = nativeImage.createFromPath(path.join(__dirname, 'assets', 'notify.png'));
  balloonIcon = !drawn.isEmpty() ? drawn : await app.getFileIcon(process.execPath, { size: 'large' }).catch(() => null);
  tray = new Tray(image);
  tray.setToolTip(config.appName);
  tray.on('click', showWindow);
  tray.on('balloon-click', showWindow);
  const menu = () => Menu.buildFromTemplate([{ label: noteWords().open, click: showWindow }, { type: 'separator' }, { label: noteWords().quit, click: () => { closing = true; app.quit(); } }]);
  tray.setContextMenu(menu());
  tray.on('right-click', () => tray.setContextMenu(menu()));
}
const CLOSE_TEXT = {
  en: { title: 'The server keeps running', message: 'Warning: this closes only the launcher, the server keeps running.', detail: 'Open the launcher again to stop it (Stop all on the home page).', close: 'Close the launcher', cancel: 'Cancel', again: 'Do not show this again' },
  fr: { title: 'Le serveur continue de tourner', message: 'Attention : ceci ferme seulement le launcher, le serveur continue de tourner.', detail: "Rouvrez le launcher pour l'arrêter (Tout arrêter sur l'accueil).", close: 'Fermer le launcher', cancel: 'Annuler', again: 'Ne plus afficher' },
  ru: { title: 'Сервер продолжает работать', message: 'Внимание: закрывается только лаунчер, сервер продолжает работать.', detail: 'Откройте лаунчер снова, чтобы остановить его (Остановить всё на главной).', close: 'Закрыть лаунчер', cancel: 'Отмена', again: 'Больше не показывать' },
};
async function closeWithNotice() {
  // Kept in the notification area: the window only hides.
  if (settings.trayOnClose && tray) { window?.hide(); return; }
  const running = !settings.hideCloseNotice && (await serverControl()?.status().catch(() => []) || []).some(service => service.state === 'running' || service.state === 'starting');
  if (running) {
    const words = CLOSE_TEXT[settings.language] || CLOSE_TEXT.en;
    const answer = await dialog.showMessageBox(window, { type: 'info', title: words.title, message: words.message, detail: words.detail, buttons: [words.close, words.cancel], defaultId: 0, cancelId: 1, checkboxLabel: words.again, noLink: true });
    if (answer.response !== 0) return;
    if (answer.checkboxChecked) await persist({ ...settings, hideCloseNotice: true }).catch(() => {});
  }
  closing = true;
  window?.close();
}

// The notes of the launcher versions newer than the one the player last saw, newest first. A player updating from
// a launcher that did not record it sees the current version's notes; a fresh install sees none.
let firstRunOfLauncher = false;
function whatsNew() {
  if (smokeDir && !process.env.COA_SMOKE_WHATSNEW) return [];
  const current = app.getVersion();
  if (firstRunOfLauncher || settings.lastSeenVersion === current) return [];
  let list = [];
  try { list = require('./data/whats-new.json'); } catch { return []; }
  const newer = list.filter(entry => repackUpdate.compareVersions(entry.version, current) <= 0 && (!settings.lastSeenVersion || repackUpdate.compareVersions(entry.version, settings.lastSeenVersion) > 0));
  return settings.lastSeenVersion ? newer.slice(0, 4) : newer.filter(entry => entry.version === current);
}

async function main() {
  config = loadConfig(path.join(__dirname, '../launcher.config.json'), path.join(app.getPath('userData'), 'launcher.config.json'));
  settingsFile = path.join(app.getPath('userData'), 'settings.json');
  const firstRun = !(await statOrNull(settingsFile).catch(() => null));
  settings = await readSettings(settingsFile);
  // A fresh install of the server edition starts with the classic skin and its emblem.
  if (firstRun && config.edition === 'server') settings.theme = 'abyss';
  // A fresh install has nothing « new » to show: this version counts as seen.
  firstRunOfLauncher = firstRun;
  if (firstRun) settings.lastSeenVersion = app.getVersion();
  if (firstRun) {
    const locale = app.getLocale().toLowerCase();
    settings.language = locale.startsWith('fr') ? 'fr' : locale.startsWith('ru') ? 'ru' : 'en';
    await writeSettings(settingsFile, settings).catch(() => {});
  }
  // Windows shows notifications only for an app with its own id (the installer's appId; the exe itself when run from the sources).
  if (process.platform === 'win32') app.setAppUserModelId(app.isPackaged ? (config.edition === 'server' ? 'org.squidbots.server' : 'org.coa.launcher-lite') : process.execPath);
  createUpdaters();
  launcherUpdates = createLauncherUpdates(app, { feedUrl: config.launcherUpdateUrl, key: config.launcherUpdateKey, fetchImpl: netFetch }, status => send('launcher:update', status), async () => {
    if (busyFiles || updater?.busy) throw new Error('Wait for the current operation to finish.');
    // Restarting would cut the preparation of the server in the middle (its database would start over).
    if (assembler.busy.size) throw new Error('The server is being prepared: restart the launcher when it is done.');
  });
  session.defaultSession.setPermissionRequestHandler((_c, _p, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  registerProtocol();
  registerIpc();

  window = new BrowserWindow({
    // The server edition's home fits in 700 px: no empty band under it.
    width: 1180, height: config.edition === 'server' ? 700 : 760, minWidth: 980, minHeight: 640, frame: false, show: false, backgroundColor: '#04121c', title: config.appName,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false, devTools: !app.isPackaged, backgroundThrottling: !smokeDir },
  });
  window.removeMenu();
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  // Opened by Windows at logon (--hidden): in the notification area when the player chose it, minimized otherwise.
  const hidden = process.argv.includes('--hidden') && !smokeDir;
  window.once('ready-to-show', () => { if (smokeDir && !process.env.COA_SMOKE_SHOW) return; if (!hidden) window.show(); else if (!settings.trayOnClose) { window.showInactive(); window.minimize(); } });
  window.on('close', event => {
    if (update.busy) {
      event.preventDefault();
      dialog.showMessageBox(window, { type: 'warning', title: 'Update in progress', message: 'The server is being updated. Closing now would cut the update: please wait until it says it is done.' });
      return;
    }
    if (updater?.status.phase === 'applying' || repackUpdater?.status.phase === 'applying') {
      event.preventDefault();
      dialog.showMessageBox(window, { type: 'info', title: 'Update in progress', message: 'Files are being installed. Please wait a few seconds before closing.' });
      return;
    }
    // Closing would cut the repack's own start/stop script half-way and leave services behind.
    if (control?.states.size || bots?.child || upgradeState.running) {
      event.preventDefault();
      dialog.showMessageBox(window, { type: 'info', title: 'Server operation in progress', message: 'The server is starting, stopping or being updated. Please wait until it is done before closing.' });
      return;
    }
    if (closing || smokeDir) return;
    event.preventDefault();
    closeWithNotice().catch(() => { closing = true; window?.close(); });
  });
  window.on('closed', () => { window = null; });
  await window.loadURL(APP_URL);
  if (smokeDir) { runSmoke().catch(error => { console.error(error); app.exit(1); }); return; }
  setInterval(async () => {
    const found = serverControl();
    if (window && window.isVisible() && !window.isMinimized() && found) send('repack:services', await found.status().catch(() => []));
  }, 5000).unref();
  app.on('before-quit', () => { closing = true; dashboard.stop(); if (dashboardWindow && !dashboardWindow.isDestroyed()) dashboardWindow.destroy(); });
  setTimeout(() => launcherUpdates.check(), 1500).unref();
  if (config.edition === 'server' && !smokeDir) createTray().catch(() => {});
  // The server watched every 20 seconds, window shown or not: ready, crash (and restart), the daily backup.
  if (!smokeDir) setInterval(() => serverWatch?.().catch(() => {}), 20000).unref();
  if (!smokeDir) setTimeout(() => applyCards(serverPath()).catch(() => {}), 5000).unref();
  if (settings.startServerOnOpen && !smokeDir) setTimeout(() => serverStartOnOpen?.().catch(() => {}), 4000).unref();
  // A new launcher and the news are looked for every 30 minutes (two small signed files).
  setInterval(() => launcherUpdates.check(), 30 * 60 * 1000).unref();
  setTimeout(() => refreshFeed(), 3000).unref();
  setInterval(() => refreshFeed(), 30 * 60 * 1000).unref();
  setInterval(() => { if (!update.busy) refreshRepackUpdate(); }, 30 * 60 * 1000).unref();
  setTimeout(() => refreshComponents(), 6000).unref();
  setInterval(() => refreshComponents(), 30 * 60 * 1000).unref();
}

if (!smokeDir && !app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => showWindow());
  app.whenReady().then(main).catch(error => { dialog.showErrorBox('The launcher could not start', error.message); app.quit(); });
  app.on('window-all-closed', () => app.quit());
}
