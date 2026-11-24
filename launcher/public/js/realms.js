'use strict';
// The Realms tab: one server, several ways to play. The CoA realm is the repack's own; Wildcard and Warcraft Reborn
// are extra realms with their own characters, bots and settings (accounts are shared). Each realm has its emblem
// and its colour, used everywhere a page works on one realm (settings, console) so nobody wonders where they are.

// Emblems drawn for this launcher (simple shapes, no image of another launcher or game).
const REALM_EMBLEMS = {
  coa: `<svg viewBox="0 0 64 64" aria-hidden="true"><defs><linearGradient id="re-coa" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffe7ad"/><stop offset="1" stop-color="#c7862c"/></linearGradient></defs>
    <path d="M32 4 54 12v18c0 15-10 25-22 30C20 55 10 45 10 30V12Z" fill="#1d1508" stroke="url(#re-coa)" stroke-width="3" stroke-linejoin="round"/>
    <path d="M20 44 44 20M44 44 20 20" stroke="url(#re-coa)" stroke-width="2.6" stroke-linecap="round" opacity=".55"/>
    <path d="M17 41l6 6M41 17l6 6M47 41l-6 6M23 17l-6 6" stroke="url(#re-coa)" stroke-width="2.4" stroke-linecap="round" opacity=".55"/>
    <path d="M32 15l3.6 12.4L48 31l-12.4 3.6L32 47l-3.6-12.4L16 31l12.4-3.6Z" fill="url(#re-coa)"/>
    <circle cx="32" cy="31" r="3.2" fill="#1d1508"/></svg>`,
  wildcard: `<svg viewBox="0 0 64 64" aria-hidden="true"><defs><linearGradient id="re-wc" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f3b8ff"/><stop offset="1" stop-color="#8b43e6"/></linearGradient></defs>
    <g transform="rotate(16 44 22)"><rect x="32" y="8" width="25" height="25" rx="6" fill="#241238" stroke="url(#re-wc)" stroke-width="2.6"/>
      <circle cx="38.5" cy="14.5" r="2.4" fill="#f3c9ff"/><circle cx="50.5" cy="14.5" r="2.4" fill="#f3c9ff"/><circle cx="38.5" cy="26.5" r="2.4" fill="#f3c9ff"/><circle cx="50.5" cy="26.5" r="2.4" fill="#f3c9ff"/></g>
    <g transform="rotate(-14 25 38)"><rect x="8" y="21" width="33" height="33" rx="8" fill="url(#re-wc)"/>
      <circle cx="16" cy="29" r="3" fill="#fff"/><circle cx="24.5" cy="37.5" r="3" fill="#fff"/><circle cx="33" cy="46" r="3" fill="#fff"/><circle cx="33" cy="29" r="3" fill="#fff"/><circle cx="16" cy="46" r="3" fill="#fff"/></g></svg>`,
  reborn: `<svg viewBox="0 0 64 64" aria-hidden="true"><defs><linearGradient id="re-wr" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#b8541c"/><stop offset=".6" stop-color="#ff9a3c"/><stop offset="1" stop-color="#ffe2a0"/></linearGradient></defs>
    <path d="M29 36C21 36 11 30 5 17c8 4 14 5 19 3-3 5-2 10 5 13Z" fill="url(#re-wr)" opacity=".85"/>
    <path d="M35 36c8 0 18-6 24-19-8 4-14 5-19 3 3 5 2 10-5 13Z" fill="url(#re-wr)" opacity=".85"/>
    <path d="M32 7c6 9 11 15 8 26-1 6-5 10-8 23-3-13-7-17-8-23-3-11 2-17 8-26Z" fill="url(#re-wr)"/>
    <path d="M32 21c2.5 4 4 7 2.8 11.5-.6 2.4-1.8 4-2.8 7.5-1-3.5-2.2-5.1-2.8-7.5C28 28 29.5 25 32 21Z" fill="#fff3d6"/>
    <path d="M18 58h28" stroke="url(#re-wr)" stroke-width="2.6" stroke-linecap="round" opacity=".6"/></svg>`,
  living: `<svg viewBox="0 0 64 64" aria-hidden="true"><defs><linearGradient id="re-lv" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#2f8f4e"/><stop offset=".6" stop-color="#7fd17a"/><stop offset="1" stop-color="#e6ffb0"/></linearGradient></defs>
    <path d="M32 50V27" stroke="url(#re-lv)" stroke-width="3" stroke-linecap="round"/>
    <path d="M32 32C30 20 21 13 9 13c1 12 9 20 23 19Z" fill="url(#re-lv)"/>
    <path d="M32 27c1-10 9-16 21-16-1 11-8 17-21 16Z" fill="url(#re-lv)" opacity=".85"/>
    <path d="M32 30c-4-5-10-8-16-9" stroke="#173d22" stroke-width="1.6" stroke-linecap="round" opacity=".6"/>
    <circle cx="48" cy="44" r="2.2" fill="#e6ffb0"/><circle cx="15" cy="40" r="1.8" fill="#e6ffb0" opacity=".8"/>
    <path d="M10 52h44M18 58h28" stroke="url(#re-lv)" stroke-width="2.6" stroke-linecap="round" opacity=".6"/></svg>`,
  dawnrise: `<svg viewBox="0 0 64 64" aria-hidden="true"><defs><linearGradient id="re-fp" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#2e9bd6"/><stop offset="1" stop-color="#ffe38a"/></linearGradient></defs>
    <path d="M14 42a18 18 0 0 1 36 0Z" fill="url(#re-fp)"/>
    <path d="M32 10v8M15 17l5 5.5M49 17l-5 5.5M7 31h7M50 31h7" stroke="url(#re-fp)" stroke-width="2.6" stroke-linecap="round"/>
    <path d="M6 47h52M14 53h36" stroke="url(#re-fp)" stroke-width="2.6" stroke-linecap="round" opacity=".6"/></svg>`,
};

const REALMS_INFO = {
  coa: { color: '#e8b04a', title: 'Conquest of Azeroth', sub: 'CoA', textKey: 'realms.coaText', text: 'The classic realm: the classes of Conquest of Azeroth, your characters and your bots of today.' },
  wildcard: { color: '#c27bff', title: 'Wildcard', sub: 'Darkmoon', textKey: 'realms.wildcardText', text: 'One class, the Hero: its spells and talents are drawn at random. A new game every time.' },
  reborn: { color: '#ff8a3d', title: 'Warcraft Reborn', sub: 'Bronzebeard', textKey: 'realms.rebornText', text: 'The ten original classes, reworked: classic Warcraft, plus.' },
  dawnrise: { color: '#5cc8ff', title: 'Free Pick', sub: 'Dawnrise', textKey: 'realms.dawnriseText', text: 'One class, the Hero: choose every spell and talent yourself, from every class.', experimental: true, noBots: true, since: '2.8.2' },
  living: { color: '#7fd17a', title: 'Squid World', sub: 'Our take on levelling', subKey: 'realms.livingSub', since: '3.0', textKey: 'realms.livingText2', text: 'Our own take on levelling and a living world, next to your classic CoA realm: a fresh realm, 1000 bots from level 1, self-loot, a growing auction house, server firsts.' },
};
const realmEmblem = (key, size = 56) => `<span class="realm-emblem realm-${key} s${size}">${REALM_EMBLEMS[key] || ''}</span>`;
const realmTitle = key => REALMS_INFO[key]?.title || key;
// Short names, for the lights of the home page.
const realmShort = key => ({ coa: 'CoA', wildcard: 'Wildcard', reborn: 'Reborn', dawnrise: 'Free Pick', living: 'Squid World' }[key] || key);

async function loadRealms() {
  const before = !!App.state.realms?.available;
  try { App.state.realms = await App.api.realmsStatus(); } catch (error) { App.state.realms = { error: translateError(error.message) }; }
  // The Realms tab exists only from CoA Bots 2.6 (or when realms were made): redraw the tabs when that changes.
  if (!!App.state.realms?.available !== before) { App.render(); return; }
  if (['realms', 'server', 'console', 'modules'].includes(App.state.tab)) App.refresh(App.state.tab);
  if (typeof livingOfferDialog === 'function') livingOfferDialog();
  // A realm started or stopped from its card: the home page (status line, lights, Start/Stop) follows.
  const worlds = list => (list || []).filter(realm => ['running', 'starting'].includes(realm.state)).map(realm => `${realm.key}:${realm.state}`).sort().join(',');
  if (App.state.server && worlds(App.state.realms?.realms) !== worlds(App.state.server.realmsOn)) {
    App.state.server = await App.api.serverInfo().catch(() => App.state.server);
    if (App.state.tab === 'home') App.refresh('home');
  }
}
// The home page reads the realms too (every 10 s): a realm started from its card shows there without visiting its tab.
// It also reads them while a card works: a realm starting for minutes shows on the home page meanwhile.
setInterval(() => { if (App.state.tab === 'home' && App.state.realms?.available) loadRealms(); }, 10000);

// Every realm in the order of the page (user, 11/11): CoA, Squid World on the first row; Wildcard, Reborn, then Free
// Pick (Dawnrise) last on the next one. A realm not in that list comes after them.
const REALM_ORDER = ['living', 'wildcard', 'reborn', 'dawnrise'];
const realmRank = key => (REALM_ORDER.includes(key) ? REALM_ORDER.indexOf(key) : REALM_ORDER.length);
function realmList() {
  const r = App.state.realms;
  if (!r || r.error) return [];
  return [{ key: 'coa', ...r.coa, main: true }, ...[...r.realms].sort((a, b) => realmRank(a.key) - realmRank(b.key))];
}
const createdRealms = () => realmList().filter(realm => realm.main || !['absent', 'disabled'].includes(realm.state));

function realmStatePill(state, realm) {
  if (state === 'queued') return `<span class="pill warn"><i class="state-dot"></i>${esc(t('realms.queuedShort', 'Waiting'))}</span>`;
  const map = { lowmem: ['bad', 'realms.lowMemory', 'Low memory'], running: ['ok', 'realms.running', 'Running'], starting: ['warn', 'realms.starting', 'Starting…'], stopping: ['warn', 'realms.stopping', 'Stopping…'], stopped: ['', 'realms.stopped', 'Stopped'], disabled: ['', 'realms.disabled', 'Switched off'], foreign: ['bad', 'realms.foreign', 'Port used by another program'] };
  const [kind, key, text] = map[state] || map.stopped;
  return `<span class="pill ${kind}"><i class="state-dot"></i>${esc(t(key, text))}</span>`;
}

// The switch at the top of the settings and console pages: which realm the page works on.
function realmPicker(current, action) {
  const list = createdRealms();
  if (list.length < 2) return '';
  return `<div class="realm-picker" role="tablist" aria-label="${esc(t('realms.which', 'Realm'))}">${list.map(realm => `<button role="tab" class="realm-pick realm-${realm.key}${realm.key === current ? ' active' : ''}" data-action="${action}" data-key="${realm.key}" aria-selected="${realm.key === current}">${realmEmblem(realm.key, 22)}<span>${esc(realmTitle(realm.key))}</span>${realm.state === 'running' ? '<i class="state-dot on"></i>' : ''}</button>`).join('')}</div>`;
}

// The coloured line that says, on a page, which realm is being worked on.
function realmBanner(key, text) {
  return `<div class="realm-banner realm-${key}">${realmEmblem(key, 30)}<div><strong>${esc(realmTitle(key))}</strong><span>${esc(text)}</span></div></div>`;
}

// The line under the name says what is going on when it matters more than the description of the mode.
function realmNote(realm, working) {
  const line = (kind, text) => `<p class="realm-text realm-note ${kind}">${esc(text)}</p>`;
  if (realm.state === 'queued') return line('warn', t('realms.queuedText', 'Starts after {name}: the worlds start one after the other.', { name: realmTitle(realm.after || 'coa') }));
  if ((realm.state === 'starting' || working) && realm.firstStart) return line('info', t('realms.firstStart', 'First start: a few minutes (auction house, new bots). The next ones are quicker.'));
  // A warning, not a refusal: the estimate may be high for this PC, the player can start it anyway.
  if (realm.state === 'stopped' && realm.skipped?.reason === 'memory') return `<p class="realm-text realm-note warn">${esc(t('realms.lowMemoryText2', 'Not started with the server: {free} GB free, about {need} GB estimated. You can start it anyway, or stop a realm or lower its bots.', { free: (realm.skipped.free / 1024).toFixed(1), need: (realm.skipped.need / 1024).toFixed(1) }))} <button class="link-button" data-action="realm-start" data-key="${esc(realm.key)}">${icon('play')}${esc(t('realms.startAnyway', 'Start anyway'))}</button></p>`;
  return '';
}

// A subtitle that is a tagline is translated (Squid World); the others are the realms' own names (Darkmoon…).
const realmSub = info => (info.subKey ? t(info.subKey, info.sub) : info.sub);

// What a realm shows in its tab and in its panel: running, starting, stopped… (absent and switched off: « disabled »).
function realmShownState(realm, busy) {
  const working = busy === realm.key || (App.state.stoppingAll && ['running', 'starting'].includes(realm.state));
  if (realm.state === 'absent') return 'disabled';
  if (working && (App.state.realmBusyKind === 'stop' || App.state.stoppingAll)) return 'stopping';
  if (working && realm.state === 'stopped') return 'starting';
  if (realm.state === 'stopped' && realm.skipped) return 'lowmem';
  return realm.state;
}

// The bar at the top (user, 13/11): one button per realm, its emblem, its kind, its name in the game's list, its state.
function realmTabs(list, current, busy) {
  return `<nav class="realm-tabs" role="tablist" aria-label="${esc(t('realms.which', 'Realm'))}">${list.map(realm => {
    const info = REALMS_INFO[realm.key];
    const state = realmShownState(realm, busy);
    const named = realm.name && realm.name !== info.title && realm.state !== 'absent' ? realm.name : realmSub(info);
    return `<button role="tab" class="realm-tab realm-${realm.key}${realm.key === current ? ' active' : ''} st-${state}" data-action="realm-view" data-key="${realm.key}" aria-selected="${realm.key === current}">${realmEmblem(realm.key, 30)}<span class="realm-tab-text"><strong title="${esc(info.title)}">${esc(realmShort(realm.key))}</strong><small>${esc(named)}</small>${realmStatePill(state, realm)}</span></button>`;
  }).join('')}</nav>`;
}

// One realm, wide: its head, its figures and main buttons, its switches by theme, its tools, and apart the actions that
// erase or hide something.
// compact (0.5.0, user 24/11: « les deux royaumes côte à côte »): one column, half the page wide, the start options in
// the glance block and the facts in a few lines.
function realmPanel(realm, busy, compact = false) {
  if (!realm) return '';
  const info = REALMS_INFO[realm.key];
  const working = busy === realm.key || (App.state.stoppingAll && ['running', 'starting'].includes(realm.state));
  const state = realmShownState(realm, busy);
  const gear = realm.state === 'absent' ? '' : `<button class="button ghost small" data-action="realm-card" data-key="${realm.key}" title="${esc(t('cards.gear', 'How this realm looks in the game\'s realm list'))}">${icon('settings')}${esc(t('realms.cardLook', 'Look in the realm list'))}</button>`;
  const listName = realm.name && realm.state !== 'absent' ? `<span class="realm-listname" title="${esc(t('realms.listNameHint', 'The name of this realm in the game\'s realm list'))}">${icon('globe')}${esc(realm.name)}</span>` : '';
  const head = `<header class="realm-panel-head">${realmEmblem(realm.key, 64)}<div class="realm-name"><h2>${esc(info.title)}</h2><small>${esc(realmSub(info))}</small>${listName}</div><div class="realm-side">${realmStatePill(state, realm)}${gear}</div></header>
    <div class="realm-about">${realmNote(realm, working) || `<p class="realm-text">${esc(t(info.textKey, info.text))}</p>`}${info.experimental || info.noBots ? `<p class="realm-text muted">${info.experimental ? `<span class="pill warn realm-exp">${esc(t('modules.experimental', 'Experimental'))}</span>` : ''}${info.noBots ? esc(t('realms.botsSoon', 'No bots for now: they come in a next version.')) : ''}</p>` : ''}</div>`;
  if (realm.state === 'absent') {
    const r = App.state.realms;
    const creatable = r.supported && realm.ready;
    const why = !r.supported && r.version ? t('realms.needVersion', 'Comes with CoA Bots 2.6 (this server: {version}).', { version: r.version })
      : r.supported && info.since ? t('realms.needSince2', 'Needs CoA Bots {version} or later (installed: {installed}).', { version: info.since, installed: r.version || '?' })
      : r.supported ? t('realms.needNewer', 'Comes with CoA Bots 2.6: its update tool must know the databases of this realm.')
      : t('realms.needBots', 'Needs CoA Bots in this server.');
    return `<article class="realm-panel realm-${realm.key} absent">${head}
      <ul class="realm-promise"><li>${icon('user')}${esc(t('realms.ownChars', 'Its own characters (your CoA characters stay where they are)'))}</li>${info.noBots ? '' : `<li>${icon('bot')}${esc(t('realms.ownBots', 'Its own bots, {n} to start with', { n: realm.key === 'living' ? 1000 : 500 }))}</li>`}<li>${icon('key')}${esc(t('realms.sameAccount', 'The same game accounts'))}</li></ul>
      <div class="realm-actions">${creatable ? `<button class="button primary" data-action="realm-create" data-key="${realm.key}" ${busy ? 'disabled' : ''}>${icon('play')}${esc(working ? t('realms.creating', 'Switching on…') : t('realms.activate', 'Switch on'))}</button>` : `<button class="button primary" disabled title="${esc(why)}">${icon('play')}${esc(t('realms.activate', 'Switch on'))}</button>`}<small class="muted">${esc(creatable ? (working && App.state.realmLine ? App.state.realmLine : t('realms.createTime', 'About a minute.')) : why)}</small></div>
    </article>`;
  }
  if (realm.state === 'disabled') {
    return `<article class="realm-panel realm-${realm.key} absent">${head}
      <ul class="realm-promise"><li>${icon('check')}${esc(t('realms.keptChars', 'Its characters and its bots are kept'))}</li><li>${icon('check')}${esc(t('realms.keptSettings', 'Its settings and modules are kept'))}</li><li>${icon('info')}${esc(t('realms.hidden', 'Out of the realm list of the game'))}</li></ul>
      <div class="realm-actions"><button class="button primary" data-action="realm-enable" data-key="${realm.key}" ${busy ? 'disabled' : ''}>${icon('play')}${esc(t('realms.activate', 'Switch on'))}</button><small class="muted">${esc(t('realms.nothingDeleted', 'Nothing is deleted: switch it on whenever you want.'))}</small></div>
    </article>`;
  }
  const on = ['running', 'starting', 'stopping'].includes(realm.state) || working;
  const stat = (label, value, hint, of) => `<div${hint ? ` title="${esc(hint)}"` : ''}><dt>${esc(label)}</dt><dd>${value === null || value === undefined || value === '' ? '—' : esc(String(value))}${of ? `<small>/${esc(String(of))}</small>` : ''}</dd></div>`;
  const stats = `<dl class="realm-stats">${stat(t('realms.players', 'Players'), realm.state === 'running' ? realm.players : null)}${realm.state === 'running' && Number.isFinite(realm.online) ? stat(t('realms.bots', 'Bots'), realm.online, t('realms.botsHint', 'Bots in game now, out of the number set for this realm.'), realm.bots) : stat(t('realms.bots', 'Bots'), realm.bots)}${stat(t('realms.port', 'Port'), realm.worldPort, t('realms.portHint', 'The game reaches this realm on this port (the realm list gives it to the client).'))}</dl>`;
  const startStop = on
    ? `<button class="button ghost" data-action="realm-stop" data-key="${realm.key}" ${busy || ['starting', 'stopping'].includes(realm.state) ? 'disabled' : ''}>${icon('pause')}${esc(t('realms.stop', 'Stop'))}</button>`
    : `<button class="button primary" data-action="realm-start" data-key="${realm.key}" ${busy || realm.state === 'queued' ? 'disabled' : ''}>${icon('play')}${esc(t('realms.start', 'Start'))}</button>`;
  const buttons = `<div class="realm-main-buttons">${startStop}<button class="button ghost" data-action="realm-settings" data-key="${realm.key}">${icon('settings')}${esc(t('realms.settings', 'Settings'))}${realm.changed ? `<em class="count" title="${esc(t('realms.ownHint', 'Settings changed for this realm only'))}">${realm.changed}</em>` : ''}</button><button class="button ghost" data-action="realm-console" data-key="${realm.key}" ${realm.state === 'running' ? '' : 'disabled'}>${icon('terminal')}${esc(t('realms.console', 'Console'))}</button>${App.state.dashboard?.available ? `<button class="button ghost" data-action="realm-dashboard" data-key="${realm.key}">${icon('chart')}${esc(t('realms.dashboard', 'Dashboard'))}</button>` : ''}</div>`;
  const group = (title, body, extra = '') => (body ? `<section class="realm-group ${extra}"><h3>${esc(title)}</h3>${body}</section>` : '');
  const startup = realm.main
    ? `<label class="realm-auto"><input type="checkbox" data-action="realm-auto" data-key="coa" ${realm.autostart !== false ? 'checked' : ''}>${esc(t('realms.autostart', 'Start with the server'))}</label>${ecoSwitch(realm)}${realm.autostart === false && realmList().some(other => !other.main && other.autostart && !['absent', 'disabled'].includes(other.state)) ? `<small class="muted">${esc(t('realms.coaAlone', 'One start per realm: "Start" on the home page leaves this realm stopped; the realms ticked start without it.'))}</small>` : ''}<small class="muted">${esc(t('realms.mainFoot', 'Its settings are the base of the other realms.'))}</small>`
    : `<label class="realm-auto"><input type="checkbox" data-action="realm-auto" data-key="${realm.key}" ${realm.autostart ? 'checked' : ''}>${esc(t('realms.autostart', 'Start with the server'))}</label>${ecoSwitch(realm)}`;
  const stoppedFirst = on ? `<small class="muted">${esc(t('realms.stopFirst', 'Stop the realm to use the actions that change its bots or its world.'))}</small>` : '';
  // 0.5.0: every extra realm can be reset (saved first, name typed again); the CoA realm not (not decided, 24/11).
  const resettable = RESETTABLE_REALMS.includes(realm.key);
  const tools = group(t('realms.tools', 'Tools'), `<div class="realm-tool-buttons"><button class="button ghost" data-action="${realm.main ? 'open-logs' : 'realm-logs'}" data-key="${realm.key}">${icon('book')}${esc(t('realms.logs', 'Logs'))}</button><button class="button ghost" data-action="realm-purge" data-key="${realm.key}" ${on || busy ? 'disabled' : ''} title="${esc(t('glance.purgeHint', 'Deletes the random bots of this realm only (saved first); they are made again at its next start.'))}">${icon('refresh')}${esc(t('glance.recreate', 'Recreate the bots'))}</button>${resettable ? `<button class="button ghost" data-action="realm-restore" data-key="${realm.key}" ${on || busy ? 'disabled' : ''}>${icon('book')}${esc(t('realms.restore', 'Restore a backup'))}</button>` : ''}</div>${stoppedFirst}`);
  // The reset of the CoA realm waits for its bench (24/11): shown, greyed, unless the launcher is a preview or the flag is set.
  const coaWaits = realm.main && !(App.state.config?.coaResetReady || App.state.config?.preview);
  const danger = `<section class="realm-group realm-danger"><h3>${icon('warning')}${esc(t('realms.dangerZone', 'Actions that erase or hide'))}</h3><div class="realm-tool-buttons">${resettable || realm.main ? `<button class="button danger-ghost" data-action="realm-reset" data-key="${realm.key}" ${on || busy || coaWaits ? 'disabled' : ''} title="${esc(t('realms.resetHint', 'A completely new run: bots, auction house, mail, guilds, the characters of this realm, achievements and server firsts start again. Saved first.'))}">${icon('refresh')}${esc(t('realms.reset', 'Reset the world'))}</button>` : ''}${realm.main ? '' : `<button class="button danger-ghost" data-action="realm-disable" data-key="${realm.key}" ${busy ? 'disabled' : ''}>${icon('close')}${esc(t('realms.disable', 'Switch off'))}</button>`}</div>${resettable || realm.main ? `<small class="muted">${esc(t('realms.resetLine', 'Reset the world saves the whole realm first (Backups), then starts it again as new.'))}</small>` : ''}${coaWaits ? `<small class="muted">${esc(t('glance.coaResetWaits', 'Reset the world of Conquest of Azeroth comes once it has been tested on a bench.'))}</small>` : ''}${realm.main ? '' : `<small class="muted">${esc(t('realms.disableLine', 'Switch off takes it out of the realm list of the game, without deleting anything. Stopped, it stays in the list as Offline.'))}</small>`}</section>`;
  if (compact) {
    // The start with the server and the eco mode at the top, as switches (user, 24/11: « tout en haut visible on off »).
    const toggle = (action, checked, label, hint) => `<label class="rc-toggle" title="${esc(hint)}"><input type="checkbox" data-action="${action}" data-key="${realm.key}" ${checked ? 'checked' : ''}><span class="rc-sw" aria-hidden="true"></span><span>${esc(label)}</span></label>`;
    const eco = App.state.realms?.eco;
    const ecoState = eco?.realms?.[realm.key] || {};
    const toggles = `<div class="rc-toggles">${toggle('realm-auto', realm.main ? realm.autostart !== false : !!realm.autostart, t('glance.autostart', 'Auto-start'), t('glance.autostartHint', 'Starts with the server (the Start button of the home page).'))}${eco?.supported ? toggle('realm-eco', !!ecoState.on, t('glance.eco', 'Eco mode'), t('glance.ecoHelp', 'With nobody on this realm for 10 minutes, the bots far from players sleep (1 % stay awake). Back to normal as soon as a player logs in.')) : ''}${ecoState.on && ecoState.asleep ? `<span class="pill realm-asleep">${esc(t('realms.ecoAsleep', 'Bots asleep'))}</span>` : ''}</div>`;
    const about = `<span class="rc-help" tabindex="0" title="${esc(t(info.textKey, info.text))}">?</span>`;
    const look = realm.state === 'absent' ? '' : `<button class="icon-button rc-look" data-action="realm-card" data-key="${realm.key}" title="${esc(t('realms.cardLook', 'Look in the realm list'))}" aria-label="${esc(t('realms.cardLook', 'Look in the realm list'))}">${icon('palette')}</button>`;
    const cHead = `<header class="rc-head">${realmEmblem(realm.key, 40)}<div class="rc-name"><h2>${esc(info.title)}${about}</h2><small>${esc(realm.name || realmSub(info))}</small></div><div class="rc-side">${realmStatePill(state, realm)}${look}</div></header>${toggles}${realmNote(realm, working)}`;
    const players = realm.state === 'running' ? realm.players : null;
    const bots = realm.state === 'running' && Number.isFinite(realm.online) ? `${realm.online}/${realm.bots ?? '?'}` : realm.bots;
    const fig = (label, value) => `<span>${esc(label)} <b>${value === null || value === undefined || value === '' ? '—' : esc(String(value))}</b></span>`;
    const line = `<div class="rc-line">${fig(t('realms.players', 'Players'), players)}${fig(t('realms.bots', 'Bots'), bots)}${fig(t('realms.port', 'Port'), realm.worldPort)}</div>`;
    const more = App.state.realmMore?.[realm.key];
    const fold = `<button class="rc-more-toggle" data-action="realm-more" data-key="${realm.key}" aria-expanded="${!!more}">${icon('settings')}${esc(t('glance.moreTools', 'Tools and reset'))}${icon('chevron')}</button>${more ? `<div class="rc-more">${tools}${danger}</div>` : ''}`;
    return `<article class="realm-panel compact realm-${realm.key}${on ? ' on' : ''}${more ? ' more' : ''}">${cHead}${line}${buttons}
      <section class="realm-group realm-glance-group">${realmGlance(realm, true)}</section>
      ${realmFacts(realm, true)}${fold}
    </article>`;
  }
  return `<article class="realm-panel realm-${realm.key}${on ? ' on' : ''}">${head}
    <div class="realm-panel-grid">
      <div class="realm-panel-main">${stats}${buttons}${group(t('glance.title', 'At a glance'), realmGlance(realm), 'realm-glance-group')}${tools}</div>
      <div class="realm-panel-side">${group(t('glance.factsTitle', 'To join this realm'), realmFacts(realm))}${group(t('realms.startup', 'Starting'), startup)}</div>
    </div>
    ${danger}
  </article>`;
}

// The realm shown wide: the one chosen in the bar, else the first running one, else CoA.
function realmViewKey() {
  const list = realmList();
  const chosen = App.state.realmView;
  if (chosen && list.some(realm => realm.key === chosen)) return chosen;
  return (list.find(realm => realm.state === 'running') || list[0])?.key || 'coa';
}
Object.assign(App.actions, { 'realm-view': button => { App.state.realmView = button.dataset.key; App.refresh('realms'); if (button.closest?.('.realm-others')) document.querySelector('.realm-tabs')?.scrollIntoView({ block: 'start', behavior: 'smooth' }); } });

// « At a glance » (0.5.0, user 24/11: « facile et compréhensible pour un joueur qui lance son instance »): the three
// choices a player makes first, on the realm itself, with the same keys as Server settings, in this realm's own values.
// The card writes only what the player clicks (never a value of its own); anything set another way shows as Custom.
const SELFLOOT_KEY = 'AiPlayerbot.CoaSelfFound';
// MAXLEVEL_KEY of server.js: 80 = self-gear at every level (the .dist default since 3.2.2), 59 = auto-gear at 60.
// Bots catch up with the players (SquidBot 5576aa9f): only on the Squid World realm, where CoaFreshStart is on.
const CATCHUP_KEY = 'AiPlayerbot.CoaFreshStart.CatchUp.Enable';
const POP_KEYS = ['AiPlayerbot.MinRandomBots', 'AiPlayerbot.MaxRandomBots'];
const LEVEL_KEYS = { fixed: 'AiPlayerbot.DisableRandomLevels', start: 'AiPlayerbot.RandombotStartingLevel', brackets: 'AiPlayerbot.LevelBrackets.Enabled', dynamic: 'AiPlayerbot.LevelBrackets.Dynamic.UseDynamicDistribution', min: 'AiPlayerbot.RandomBotMinLevel', max: 'AiPlayerbot.RandomBotMaxLevel' };
const POP_CHOICES = [200, 500, 1000];
// The values each choice writes: those of the presets « Fresh world » and « Mixed levels » of Server settings.
const START_CHOICES = {
  level1: { [LEVEL_KEYS.fixed]: '1', [LEVEL_KEYS.start]: '1', [LEVEL_KEYS.brackets]: '0' },
  spread: { [LEVEL_KEYS.fixed]: '0', [LEVEL_KEYS.brackets]: '1', [LEVEL_KEYS.dynamic]: '1' },
};
// Choice 1 writes only CoaSelfFound 0: the level of self-found is kept for a later return to self-gear.
const GEAR_CHOICES = {
  auto: { [SELFLOOT_KEY]: '0' },
  self: { [SELFLOOT_KEY]: '1', AiPlayerbot_MAX: '80' },
  self59: { [SELFLOOT_KEY]: '1', AiPlayerbot_MAX: '59' },
};
const gearPairs = choice => Object.entries(GEAR_CHOICES[choice]).map(([key, value]) => [key === 'AiPlayerbot_MAX' ? MAXLEVEL_KEY : key, value]);

// A realm's values ('' = the main realm), read once, then kept until a save.
function quickOf(target) {
  const cache = App.state.realmQuick ||= {};
  if (!(target in cache)) {
    cache[target] = null;
    App.api.serverSettings(target).then(conf => {
      const find = key => conf.settings.find(setting => setting.key === key);
      const value = key => String(find(key)?.value ?? '').trim();
      const has = key => !!find(key);
      cache[target] = {
        chat: value(CHAT_KEY), selfloot: value(SELFLOOT_KEY), maxLevel: value(MAXLEVEL_KEY), catchup: value(CATCHUP_KEY),
        hasChat: has(CHAT_KEY), hasLoot: has(SELFLOOT_KEY), hasCatchup: has(CATCHUP_KEY),
        min: value(POP_KEYS[0]), max: value(POP_KEYS[1]), hasPop: has(POP_KEYS[1]),
        fixed: value(LEVEL_KEYS.fixed), start: value(LEVEL_KEYS.start), lowest: value(LEVEL_KEYS.min), highest: value(LEVEL_KEYS.max), hasLevels: has(LEVEL_KEYS.fixed),
      };
      App.refresh('realms'); App.refresh('server');
    }).catch(() => { cache[target] = { error: true }; });
  }
  return cache[target];
}

// Which choice the values match ('' when none: Custom).
function popChoice(q) {
  const min = Number(q.min), max = Number(q.max);
  return q.min === q.max && POP_CHOICES.includes(max) ? String(max) : Number.isFinite(max) && q.max !== '' ? (min === max ? 'other' : '') : '';
}
const startChoice = q => (q.fixed === '1' ? (q.start === '1' || q.start === '' ? 'level1' : '') : q.fixed === '0' ? 'spread' : '');
function gearChoice(q, locked) {
  const self = locked || q.selfloot === '1';
  if (!self) return q.selfloot === '0' ? 'auto' : '';
  const level = q.maxLevel === '' ? 80 : Number(q.maxLevel);
  return level >= 60 ? 'self' : level === 59 ? 'self59' : '';
}

// c (compact, user 24/11: « les deux royaumes côte à côte » at the window's own size): one line of choices per row, no
// subtitle under a choice, the sentences in the « ? » of the row; one short line for the gear chosen.
function realmGlance(realm, c = false) {
  const target = realm.main ? '' : realm.key;
  const q = quickOf(target);
  if (!q) return `<p class="muted">${esc(t('glance.reading', 'Reading the settings of this realm…'))}</p>`;
  if (q.error) return `<p class="muted">${esc(t('glance.unreadable', 'The settings of this realm cannot be read: use Settings.'))}</p>`;
  // Squid World is self-gear by design (its levelling is made for it): Auto-gear is not offered there.
  const locked = realm.key === 'living';
  const seg = (action, options, current) => `<div class="glance-seg${c ? ' c' : ''}" role="radiogroup">${options.map(option => { const hint = c ? (option.hint || option.sub) : option.hint; return `<button class="glance-opt${option.value === current ? ' active' : ''}" role="radio" aria-checked="${option.value === current}" data-action="${action}" data-key="${esc(target)}" data-realm="${esc(realm.key)}" data-value="${esc(option.value)}" ${option.disabled ? 'disabled' : ''}${hint ? ` title="${esc(hint)}"` : ''}><strong>${esc(c && option.short ? option.short : option.label)}</strong>${option.sub && !c ? `<small>${esc(option.sub)}</small>` : ''}</button>`; }).join('')}</div>`;
  const custom = (shown, text) => (shown ? `<p class="glance-custom">${icon('info')}<span>${esc(text)}</span></p>` : '');
  const help = text => `<span class="rc-help" tabindex="0" role="img" aria-label="${esc(text)}" title="${esc(text)}">?</span>`;
  const row = (iconName, title, explain, control) => (c
    ? `<div class="glance-row c"><div class="glance-label c">${icon(iconName)}<strong>${esc(title)}</strong>${help(explain)}</div>${control}</div>`
    : `<div class="glance-row"><div class="glance-label">${icon(iconName)}<div><strong>${esc(title)}</strong><small>${esc(explain)}</small></div></div>${control}</div>`);
  const note = text => `<p class="glance-note">${esc(text)}</p>`;
  const rows = [];
  if (q.hasPop) {
    const current = popChoice(q);
    const options = [
      { value: '200', label: '200', sub: t('glance.pop200', 'Light') },
      { value: '500', label: '500', sub: t('glance.pop500', 'Recommended') },
      { value: '1000', label: '1000', sub: t('glance.pop1000', 'Big PC, 32 GB') },
      { value: 'other', label: current === 'other' ? q.max : t('glance.popOther', 'Other…'), short: current === 'other' ? q.max : '…', sub: current === 'other' ? t('glance.popYours', 'Your number') : t('glance.popPick', 'Pick a number') },
    ];
    rows.push(row('bot', t('glance.pop', 'Population'), c ? t('glance.popHelp', 'How many bots live on this realm, from its next start. 200 is light; 1000 needs about 32 GB of memory.') : t('glance.popText', 'How many bots live on this realm. About 16 GB of memory holds 200 comfortably; 1000 needs about 32 GB.'), seg('glance-pop', options, current)
      + custom(!current, t('glance.popCustom', 'Set another way: between {min} and {max} bots. A choice above replaces it.', { min: q.min || '?', max: q.max || '?' }))));
  }
  if (q.hasLevels) {
    // Squid World (CoaFreshStart) and a self-gear realm (CoaSelfFound: « random bots gain levels only by playing (no
    // random level, no level brackets) », playerbots.conf.dist): bots start at level 1 whatever the keys of levels say.
    const fromOne = locked ? 'fresh' : q.selfloot === '1' ? 'self' : '';
    const current = fromOne ? 'level1' : startChoice(q);
    const range = `${q.lowest || '1'}-${q.highest || '60'}`;
    const options = [
      { value: 'level1', label: t('glance.level1', 'Everyone at level 1'), short: t('glance.level1Short', 'Level 1'), sub: t('glance.level1Sub', 'A fresh world: bots level up with you') },
      { value: 'spread', label: t('glance.spread', 'Spread {range}', { range }), short: range, sub: t('glance.spreadSub', 'Bots of every level from the start') },
    ].map(option => (fromOne ? { ...option, disabled: true } : option));
    const why = fromOne === 'fresh' ? t('glance.startFresh', 'Squid World is a fresh world: every bot starts at level 1 and levels up by playing, at its own pace.')
      : fromOne === 'self' ? t('glance.startSelf', 'With Self-gear, every new bot starts at a low level and gains levels only by playing. Choose Auto-gear to spread the bots from the start.') : '';
    const startText = t('glance.startText', 'Only bots made from now on start this way: the bots already there keep their level until they are recreated.');
    rows.push(row('user', t('glance.start', 'Bots start'), c ? (why || t('glance.startHelp', 'Level 1: every bot starts at level 1 and levels up with you. 1-60: bots of every level from the start. Only new bots follow it: recreate the bots to apply it to all.')) : startText, seg('glance-start', options, current)
      + (why ? (c ? note(fromOne === 'fresh' ? t('glance.startFreshShort', 'Fixed here: every bot starts at level 1.') : t('glance.startSelfShort', 'Fixed by Self-gear: bots start low.')) : `<p class="glance-explain">${esc(why)}</p>`) : '')
      + custom(!current, t('glance.startCustom', 'Set another way (every bot starts at level {level}). A choice above replaces it.', { level: q.start || '?' }))));
  }
  if (q.hasLoot) {
    const current = gearChoice(q, locked);
    // The words of each choice, checked against playerbots.conf.dist of SquidBot 3.2.2 (24/11): AutoUpgradeEquip and
    // CoaGearMatchGroup (auto); CoaSelfFound, StarterWeapon, BotAuctions.Shop, RemoteBuy, CraftForSelf (self-gear);
    // CoaSelfFoundMaxLevel 59 and CoaSelfFoundBotsPercent -1 = 20 % (self-gear 1-59).
    const texts = {
      auto: t('glance.gearAutoText', 'The server gives bots gear for their level when they are made and when they level up. Grouped with a player, a bot is geared at that player\'s item level.'),
      self: t('glance.gearSelfOnlyText', 'No gear is ever made for bots: they wear only what they loot, earn from quests, craft, trade or buy at the auction house. Every piece is earned. (A bot left with no weapon at all gets its class\'s starting weapon, once.)'),
      self59: t('glance.gearSelf159Text3', 'Levels 1 to 59 play exactly as Self-gear only. A bot that reaches level 60 gets its endgame gear at once, as with Auto-gear. Bots already at 60 keep their gear until they group with a player.'),
    };
    // The detail kept apart from the simple sentence (Pilote, 24/11): CoaSelfFoundBotsPercent -1 = 20 on a self-found realm.
    const share = t('glance.gearShare', 'The bots sent to dungeons (20 % by default) stay self-gear at 60 too.');
    const options = [
      { value: 'auto', label: t('glance.gearAuto', 'Auto-gear'), sub: t('glance.gearAutoSub2', 'Gear made for their level'), disabled: locked, hint: locked ? t('glance.gearLocked', 'Squid World is always self-gear: its levelling is made for it.') : texts.auto },
      { value: 'self', label: t('glance.gearSelfOnly', 'Self-gear only'), short: t('glance.gearSelfShortLabel', 'Self-gear'), sub: t('glance.gearSelfOnlySub', 'Every piece is earned'), hint: texts.self },
      { value: 'self59', label: t('glance.gearSelf159', 'Self-gear 1-59'), sub: t('glance.gearSelf159Sub', 'Then auto-gear at 60'), hint: `${texts.self59} ${share}` },
    ];
    const shorts = { auto: t('glance.gearAutoShort', 'Gear made for their level; in a group, at your item level.'), self: t('glance.gearSelfShort', 'Only what they loot, craft, trade or buy.'), self59: t('glance.gearSelf159Short', 'Self-gear until 59, auto-gear from 60.') };
    const gearText = t('glance.gearText', 'Bots already equipped keep what they wear: only what comes next changes.');
    rows.push(row('shield', t('glance.gear', 'Bot gear'), c ? t('glance.gearHelp', 'Auto-gear: the server gears bots for their level. Self-gear: bots wear only what they find, craft, trade or buy. Self-gear 1-59: the same, then auto-gear at 60. Bots keep what they already wear.') : gearText, seg('glance-gear', options, current)
      + (c ? (shorts[current] ? note(shorts[current]) : '') : texts[current] ? `<p class="glance-explain">${esc(texts[current])}${current === 'self59' ? `<small>${esc(share)}</small>` : ''}${locked ? `<small>${esc(t('glance.gearLocked', 'Squid World is always self-gear: its levelling is made for it.'))}</small>` : ''}</p>` : '')
      + custom(!current, t('glance.gearCustom', 'Set another way (self-found up to level {level}). A choice above replaces it.', { level: q.maxLevel || '?' }))));
  }
  const toggle = (action, on, title, hint) => `<div class="realm-quick-row"><span${c ? '' : ` title="${esc(hint)}"`}>${esc(title)}</span>${c ? help(hint) : ''}${moduleSwitch(action, on, false).replace('<button', `<button data-key="${esc(target)}"`)}</div>`;
  const chat = q.hasChat && CHAT_READY ? toggle('realm-chat', q.chat === '1', t('lw.chat', 'Bot chat'), t('lw.chatText', 'Bots talk in the chat channels, greet and answer. Off: they stay silent, everything else goes on.')) : '';
  const catchup = locked && q.hasCatchup ? toggle('realm-catchup', q.catchup === '1', t('realms.catchup', 'Bots catch up with players'), t('realms.catchupHint', 'Random bots behind the human players earn more experience.')) : '';
  const switches = chat || catchup ? `<div class="realm-quick glance-switches">${chat}${catchup}</div>` : '';
  if (!rows.length && !switches) return '';
  const on = ['running', 'starting'].includes(realm.state);
  const next = on ? t('glance.nextStartOn', 'Saved at once; this realm uses it at its next start (Stop, then Start).') : t('realms.quickNext', 'Applied at the next start of this realm.');
  return `<div class="glance${c ? ' c' : ''}">${rows.join('')}${switches}${c && !on ? '' : `<small class="muted">${esc(next)}</small>`}</div>`;
}

// What a player needs to join: the address of the realmlist, the version, the last saved copy.
function realmFacts(realm, compact = false) {
  const facts = App.state.realmFacts ||= {};
  if (!facts.loading) {
    facts.loading = true;
    App.api.networkInfo().then(info => { facts.net = info; App.refresh('realms'); }).catch(() => { facts.net = { error: true }; });
  }
  const backups = facts.backups ||= {};
  if (!(realm.key in backups)) {
    backups[realm.key] = undefined;
    const read = realm.main ? App.api.backups().then(list => list[0]?.createdAt || null) : App.api.realmsBackups(realm.key).then(list => list[0]?.at || null);
    read.then(at => { backups[realm.key] = at; App.refresh('realms'); }).catch(() => { backups[realm.key] = null; });
  }
  const net = facts.net?.network;
  const address = net ? (net.mode === 'open' ? net.address : '127.0.0.1') : '';
  const line = address ? `set realmlist ${address}` : '';
  const where = net ? (net.mode === 'open' ? t('glance.addrOpen2', 'Play sets it in your game; on another PC, put this line in its realmlist.wtf.') : t('glance.addrLocal2', 'This PC only: Play sets it in your game. Server > Network opens the server to the other PCs of your home.')) : '';
  const at = backups[realm.key];
  const saved = at === undefined ? '…' : at ? new Date(at).toLocaleString() : t('glance.noBackup', 'None yet');
  const version = App.state.realms?.version;
  if (compact) {
    const copy = line ? `<button class="link-button" data-action="glance-copy" data-line="${esc(line)}">${icon('copy')}${esc(t('glance.copy', 'Copy'))}</button>` : '';
    const details = [where, `${t('glance.inListShort', 'In the realm list:')} ${realm.name || realmTitle(realm.key)}`, version ? `CoA Bots ${version}` : '', t('glance.lastBackupShort', 'last saved copy: {when}', { when: saved })].filter(Boolean).join(' · ');
    return `<div class="realm-facts compact"><div class="fact-line">${icon('globe')}<code>${esc(line || '…')}</code>${copy}<span class="rc-help" tabindex="0" title="${esc(details)}">?</span></div></div>`;
  }
  const item = (iconName, label, value, extra = '') => `<div class="fact-row">${icon(iconName)}<div><small>${esc(label)}</small><strong>${esc(value)}</strong>${extra}</div></div>`;
  return `<div class="realm-facts">
    ${item('globe', t('glance.addr2', 'Server address (realmlist)'), line || '…', line ? `<button class="link-button" data-action="glance-copy" data-line="${esc(line)}">${icon('copy')}${esc(t('glance.copy', 'Copy'))}</button><small class="muted">${esc(where)}</small>` : '')}
    ${item('map', t('glance.inList', 'Then, in the realm list of the game'), realm.name || realmTitle(realm.key))}
    ${version ? item('bot', t('glance.version', 'Version'), `CoA Bots ${version}`) : ''}
    ${item('book', t('glance.lastBackup', 'Last saved copy'), saved)}
  </div>`;
}
// Bot chat and the bots' catch-up are read again by a running world (.reload config): applied at once. Self-loot is read
// at the start of the world only.
const QUICK_RELOAD = ['AiPlayerbot.CoaLive.Chat.Enable', 'AiPlayerbot.CoaFreshStart.CatchUp.Enable'];
// pairs: [[key, value]] of playerbots.conf, written together in this realm's own values (only what the player clicked).
async function realmQuickSave(target, pairs, { quiet = false } = {}) {
  await App.api.saveServerSettings(pairs.map(([key, value]) => ({ file: 'playerbots.conf', key, value })), target);
  delete App.state.realmQuick?.[target];
  const running = target ? realmList().some(item => item.key === target && item.state === 'running') : worldRunning(App.state.server);
  if (running && pairs.every(([key]) => QUICK_RELOAD.includes(key))) {
    await App.api.consoleRun('reload config', target)
      .then(() => toast(t('conf.reloaded', 'Applied at once: the server read its settings again.'), 'success'))
      .catch(() => toast(t('conf.reloadFailed', 'The server did not answer: these settings apply at its next start.'), 'info'));
  } else if (running && !quiet) toast(t('realms.quickNextStart', 'Saved: it applies at the next start of this realm.'), 'info');
  else if (!quiet) toast(t('glance.saved', 'Saved.'), 'success');
  // Server settings of that realm show the new values too.
  if (App.state.conf && !App.state.conf.error && confRealm() === target) for (const setting of App.state.conf.settings) for (const [key, value] of pairs) if (setting.key === key) setting.value = value;
  App.refresh('realms'); App.refresh('server');
}
const realmQuickSet = (target, key, on, values = ['0', '1']) => realmQuickSave(target, [[key, on ? values[1] : values[0]]]);

// A number of bots typed by the player (Other…): the bounds of Server settings.
async function askBotCount(current) {
  let typed = String(current || '');
  const onInput = event => { if (event.target?.id === 'glance-count') typed = event.target.value; };
  document.addEventListener('input', onInput);
  let ok = false;
  try {
    ok = await confirmDialog({ title: t('glance.popAskTitle', 'How many bots on this realm?'), body: `${esc(t('glance.popAskBody', 'From 0 to 5000. About 16 GB of memory holds 200 bots comfortably; 1000 needs about 32 GB.'))}</p><p><input class="text-input" id="glance-count" type="number" min="0" max="5000" step="50" value="${esc(typed)}">`, confirm: t('common.save', 'Save') });
  } finally { document.removeEventListener('input', onInput); }
  if (!ok) return null;
  const count = Number(typed);
  if (!Number.isInteger(count) || count < 0 || count > 5000) { toast(t('glance.popBad', 'A whole number from 0 to 5000.'), 'error'); return null; }
  return count;
}

// After a new start of the bots: those already there keep their level; recreating them is offered, never done alone.
async function offerRecreate(realm) {
  const name = realmTitle(realm);
  const on = realm === 'coa' ? worldRunning(App.state.server) : realmList().some(item => item.key === realm && ['running', 'starting'].includes(item.state));
  if (on) { await resultDialog({ title: t('glance.recreateLaterTitle', 'Saved: new bots start this way'), body: `<p>${esc(t('glance.recreateLater', 'The bots already on {name} keep their level. To start every bot this way, stop the realm, then use Recreate the bots (Tools).', { name }))}</p>`, kind: 'success' }); return; }
  if (!await confirmDialog({ title: t('glance.recreateTitle', 'Recreate the bots of {name} now?', { name }), body: esc(t('glance.recreateBody', 'Saved: bots made from now on start this way. The bots already there keep their level: recreate them so that every bot starts this way. Players and their characters are not touched; the bots come back at the next start.')), confirm: t('glance.recreate', 'Recreate the bots'), danger: true })) return;
  const button = { dataset: { key: realm } };
  if (realm === 'coa') await App.actions['purge-bots'](button);
  else await App.actions['realm-purge'](button);
}

Object.assign(App.actions, {
  'realm-chat': button => guard(() => realmQuickSet(button.dataset.key, CHAT_KEY, button.dataset.on !== '1'), button),
  'realm-catchup': button => guard(() => realmQuickSet(button.dataset.key, CATCHUP_KEY, button.dataset.on !== '1'), button),
  'glance-pop': button => guard(async () => {
    const q = App.state.realmQuick?.[button.dataset.key] || {};
    const count = button.dataset.value === 'other' ? await askBotCount(q.max) : Number(button.dataset.value);
    if (count === null) return;
    await realmQuickSave(button.dataset.key, POP_KEYS.map(key => [key, String(count)]));
  }, button),
  'glance-start': button => guard(async () => {
    const choice = START_CHOICES[button.dataset.value];
    if (!choice || button.classList.contains('active')) return;
    await realmQuickSave(button.dataset.key, Object.entries(choice), { quiet: true });
    await offerRecreate(button.dataset.realm);
  }, button),
  'glance-gear': button => guard(async () => {
    if (!GEAR_CHOICES[button.dataset.value] || button.classList.contains('active')) return;
    await realmQuickSave(button.dataset.key, gearPairs(button.dataset.value));
  }, button),
  'glance-copy': button => guard(async () => {
    const line = button.dataset.line;
    await App.api.copyText(line);
    toast(t('net.copied', 'Copied: {line}', { line }), 'success');
  }, button),
  'realm-more': button => { const more = App.state.realmMore ||= {}; more[button.dataset.key] = !more[button.dataset.key]; App.refresh('realms'); },
  'realm-others': () => { App.state.realmOthers = !App.state.realmOthers; App.refresh('realms'); },
  'realm-other-open': button => { App.state.realmOther = button.dataset.key; App.refresh('realms'); document.querySelector('.realm-other-open')?.scrollIntoView({ block: 'start', behavior: 'smooth' }); },
  'realm-other-close': () => { App.state.realmOther = ''; App.refresh('realms'); },
});

// Eco mode (CoA Bots 2.9.1 and later): the bots far from players mostly sleep while nobody plays on this realm.
function ecoSwitch(realm) {
  const e = App.state.realms?.eco;
  if (!e?.supported) return '';
  const state = e.realms?.[realm.key] || {};
  return `<label class="realm-auto" title="${esc(t('realms.ecoHint', 'With no player on this realm for 10 minutes, its bots far from players sleep (bots awake: 1 %). Your own value comes back as soon as a player logs in. Your settings are not changed.'))}"><input type="checkbox" data-action="realm-eco" data-key="${realm.key}" ${state.on ? 'checked' : ''}>${esc(t('realms.eco', 'Eco mode when nobody plays'))}${state.on && state.asleep ? ` <span class="pill realm-asleep">${esc(t('realms.ecoAsleep', 'Bots asleep'))}</span>` : ''}</label>`;
}

function realmsPage() {
  const head = `<div class="page-head"><div><p class="eyebrow">${esc(t('server.eyebrow', 'On this PC'))}</p><h1>${esc(t('tab.realms', 'Realms'))} <span class="pill warn">${esc(t('realms.beta', 'Beta'))}</span></h1></div></div>`;
  if (!App.state.server?.path) return `<div class="page classic">${head}${emptyState('globe', t('modules.noServer', 'No server yet'), t('modules.noServerText', 'Install or choose your server first.'))}</div>`;
  const r = App.state.realms;
  if (!r) return `<div class="page classic">${head}${skeleton(3)}</div>`;
  if (r.error) return `<div class="page classic">${head}${emptyState('warning', t('realms.error', 'The realms cannot be read'), r.error)}</div>`;
  const busy = App.state.realmBusy || '';
  const current = realmViewKey();
  // 0.5.0 (user, 24/11): the two main realms side by side, whole, no tab; another realm type opened from the cards
  // below shows whole under them.
  const main = MAIN_REALMS.map(key => realmList().find(realm => realm.key === key)).filter(Boolean);
  const others = realmList().filter(realm => !MAIN_REALMS.includes(realm.key));
  const other = others.find(realm => realm.key === App.state.realmOther);
  const open = App.state.realmOthers;
  return `<div class="page classic realms-page">${head}
    <p class="realms-lead c" title="${esc(t('realms.lead2', 'Your server, ready to play: Conquest of Azeroth is the classic realm, Squid World a fresh world where everything starts at level 1. Pick the realm in the realm list of the game; the game accounts are the same on every realm.'))}">${esc(t('realms.lead3', 'Two realms ready to play; your game accounts work on both.'))}</p>
    <div class="realm-duo">${main.map(realm => realmPanel(realm, busy, true)).join('')}</div>
    ${other ? `<div class="realm-other-open"><button class="link-button" data-action="realm-other-close">${icon('close')}${esc(t('glance.otherClose', 'Close {name}', { name: realmTitle(other.key) }))}</button>${realmPanel(other, busy)}</div>` : ''}
    <section class="realm-others${open ? ' open' : ''}">
      <button class="button ghost realm-others-toggle" data-action="realm-others" aria-expanded="${!!open}">${icon('layers')}${esc(open ? t('glance.othersHide', 'Hide the other realm types') : t('glance.othersShow', 'See other realm types ({n})', { n: others.length }))}${icon('chevron')}</button>
      ${open ? `<p class="muted">${esc(t('glance.othersLead', 'Other ways to play, each with its own characters and bots, next to your main realms. Switch one on when you want to try it; nothing of your main realms changes.'))}</p><div class="realm-other-cards">${others.map(realm => realmOtherCard(realm, busy, App.state.realmOther)).join('')}</div>` : ''}
    </section>
  </div>`;
}

// The realms whose world can be reset (RESETTABLE of src/realms.cjs): not the CoA realm, its database is the repack's.
const RESETTABLE_REALMS = ['living', 'wildcard', 'reborn', 'dawnrise'];
// The two realms every player starts with (user, 24/11); the others are one click away.
const MAIN_REALMS = ['coa', 'living'];
// A small card of another realm type: what it is and its state; Open shows its full panel above.
function realmOtherCard(realm, busy, current) {
  const info = REALMS_INFO[realm.key];
  const state = realmShownState(realm, busy);
  const action = realm.state === 'absent' ? t('glance.otherDiscover', 'Discover') : t('glance.otherOpen', 'Open');
  return `<article class="realm-other realm-${realm.key}${realm.key === current ? ' active' : ''}">
    <header>${realmEmblem(realm.key, 40)}<div><strong>${esc(info.title)}</strong><small>${esc(realmSub(info))}</small></div>${realmStatePill(state, realm)}</header>
    <p>${esc(t(info.textKey, info.text))}</p>
    ${info.experimental ? `<span class="pill warn realm-exp">${esc(t('modules.experimental', 'Experimental'))}</span>` : ''}
    <button class="button ghost small" data-action="realm-other-open" data-key="${realm.key}">${esc(action)}${icon('arrow')}</button>
  </article>`;
}

App.pages.realms = {
  render: realmsPage,
  mount() {
    markSeen('realms');
    if (!App.state.server) App.api.serverInfo().then(info => { App.state.server = info; App.refresh('realms'); loadRealms(); }).catch(() => {});
    else if (!App.state.realmsFresh) { App.state.realmsFresh = true; loadRealms(); }
  },
};

// The page follows the realms while it is shown (states, players), without redrawing during an action.
setInterval(() => { if (App.state.tab === 'realms' && !App.state.realmBusy && App.state.server?.path && !$('#dialog').open) loadRealms(); }, 8000);
// Known once a server is chosen, so the tab shows up (or not) without visiting a page first.
// Read again every 15 s while the tab is hidden or unreadable (a server updated to 2.6, another server chosen):
// the tab appears without restarting the launcher.
let realmsCheckedAt = 0;
let realmsRoot = '';
setInterval(() => {
  const root = App.state.server?.path;
  if (!root || App.state.realmBusy) return;
  const stale = !App.state.realms || realmsRoot !== root || ((!App.state.realms.available || App.state.realms.error) && Date.now() - realmsCheckedAt > 15000);
  if (!stale) return;
  realmsCheckedAt = Date.now();
  realmsRoot = root;
  loadRealms();
}, 2000);

async function realmAction(key, work, kind = '') {
  App.state.realmBusy = key;
  App.state.realmBusyKind = kind;
  App.refresh(App.state.tab);
  try { return await work(); }
  finally { App.state.realmBusy = ''; App.state.realmBusyKind = ''; await loadRealms(); }
}

// The name of a realm in the game's realm list (realm.json, renamed by the player in its card: « Malfurion »), not the
// title of its kind (« Squid World »). A reset asks for this name; the main process checks the same one.
// « Name - Subtitle » shows in the game as the name and a line under it: the part before « - » is asked.
const realmListName = key => String((key === 'coa' ? App.state.realms?.coa : (App.state.realms?.realms || []).find(realm => realm.key === key))?.name || realmTitle(key)).split(' - ')[0];
// A preview (COA_PREVIEW=1): every window opens, the last step answers « demo » and nothing is erased (user, 24/11).
const isDemo = result => !!(result?.demo || result?.purged?.demo || result?.reset?.demo || result?.restored?.demo);
const demoDone = () => ({ title: t('glance.demoTitle', 'Preview: nothing was erased'), body: `<p>${esc(t('glance.demoBody', 'This is a preview of the launcher: the windows are the real ones, but this last step does nothing here.'))}</p>` });
// The big warning of a reset (user, 24/11: « un gros warning qui rappelle ce que ça delete »).
function resetWarning(name) {
  const list = items => `<ul>${items.map(item => `<li>${esc(item)}</li>`).join('')}</ul>`;
  return `<div class="reset-warning"><strong>${icon('warning')}${esc(t('glance.resetWarnTitle', 'Everything played on {name} is erased', { name }))}</strong>
    <div class="reset-columns"><div><em>${esc(t('glance.resetErased', 'Erased'))}</em>${list([t('glance.resetE1', 'Every character of this realm: those of the players AND the bots'), t('glance.resetE2', 'Guilds, mail and the auction house'), t('glance.resetE3', 'Achievements and server firsts'), t('glance.resetE4', 'Levels, gear, gold and quests of those characters')])}</div>
    <div><em>${esc(t('glance.resetKept', 'Kept'))}</em>${list([t('glance.resetK1', 'The game accounts (log in as before)'), t('glance.resetK2', 'Your other realms'), t('glance.resetK3', 'The settings of this realm')])}</div></div>
    <small>${esc(t('glance.resetSeller', 'The auction house seller and the Dungeon Clear driver are made again by themselves at the next start.'))}</small>
    <small>${esc(t('glance.resetSaved', 'A full copy is saved first (Backups): it can be put back.'))}</small></div>`;
}
// The same comparison as src/realms.cjs sameRealmName: case and outer spaces do not count, accents do.
const sameRealmName = (a, b) => {
  const clean = value => String(value || '').normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
  return clean(a) !== '' && clean(a) === clean(b);
};

Object.assign(App.actions, {
  'realm-create': button => guard(async () => {
    const key = button.dataset.key;
    const name = realmTitle(key);
    if (!await confirmDialog({ title: t('realms.activateTitle', 'Switch the {name} realm on?', { name }), body: esc(t('realms.activateBody', 'The first time, its two databases are made (its characters and its bots, about a minute) and it is added to the realm list of the game. Your Conquest of Azeroth characters and bots are not touched. You can switch it off again at any time.')), confirm: t('realms.activate', 'Switch on') })) return;
    const off = App.api.onRealmsProgress(line => { App.state.realmLine = line; App.refresh('realms'); });
    let result = null;
    try { await realmAction(key, async () => { result = await App.api.realmsCreate(key, {}); }); }
    finally { off(); App.state.realmLine = ''; }
    toast(t('realms.activated', '{name} is on: start it, then pick it in the realm list of the game.', { name }), 'success');
    if (result?.cardsLater) toast(t('realms.cardsLater', 'Its look in the realm list of the game (background, text) appears at the next start of the server.'));
  }, button),
  'realm-start': button => guard(async () => {
    const key = button.dataset.key;
    if (key !== 'coa') {
      const memory = await App.api.realmsMemory(key).catch(() => null);
      if (memory && !memory.enough && !await confirmDialog({ title: t('realms.memoryTitle', 'Not much free memory'), body: esc(t('realms.memoryBody', '{name} needs about {need} GB with its bots, and {free} GB are free. The whole PC may slow down. Stop another realm or lower its bots first, or start anyway.', { name: realmTitle(key), need: (memory.need / 1024).toFixed(1), free: (memory.free / 1024).toFixed(1) })), confirm: t('realms.startAnyway', 'Start anyway'), danger: true })) return;
    }
    toast(t('realms.startingLong', 'Starting {name}… the first start with bots takes a few minutes.', { name: realmTitle(key) }));
    await realmAction(key, () => App.api.realmsStart(key));
    toast(t('realms.started', '{name} is running.', { name: realmTitle(key) }), 'success');
  }, button),
  'realm-stop': button => guard(async () => {
    const key = button.dataset.key;
    await realmAction(key, () => App.api.realmsStop(key), 'stop');
    toast(t('realms.stopped2', '{name} is stopped.', { name: realmTitle(key) }), 'success');
  }, button),
  'realm-eco': input => guard(async () => { await App.api.realmsEco(input.dataset.key, input.checked); await loadRealms(); }),
  'realm-auto': input => guard(async () => { await App.api.realmsOptions(input.dataset.key, { autostart: input.checked }); await loadRealms(); }),
  'realm-logs': button => guard(() => App.api.realmsOpenLogs(button.dataset.key)),
  'realm-purge': button => guard(async () => {
    const key = button.dataset.key;
    const main = key === 'coa';
    // Their auctions go with them; the auction house bot's ones too unless the box is unticked. Players' auctions stay.
    // On the CoA realm the repack's own purge (coa_bots.py purge-bots) does it all: no box.
    let house = true;
    const onChange = event => { if (event.target?.id === 'purge-house') house = event.target.checked; };
    document.addEventListener('change', onChange);
    const saved = `</p><p class="muted">${esc(t('glance.purgeSaved', 'The realm is saved first (Backups): it can be restored if needed.'))}`;
    const body = main
      ? `${esc(t('glance.purgeCoaBody', 'Every random bot of Conquest of Azeroth is deleted, then made again at the next start. Your characters, your alts and your accounts are not touched.'))}${saved}`
      : `${esc(t('realms.purgeBody2', 'The random bots of this realm are deleted with their auctions (players are not touched; a player who bid on one gets the bid back by mail). They are made again at its next start. The bots of the other realms stay.'))}${saved}</p><p><label class="check-line"><input type="checkbox" id="purge-house" checked> ${esc(t('realms.purgeHouse', 'Empty the auctions of the auction house bot too'))}</label>`;
    let ok = false;
    try { ok = await confirmDialog({ title: t('realms.purgeTitle', 'Recreate the bots of {name}?', { name: realmTitle(key) }), body, confirm: t('glance.recreate', 'Recreate the bots'), danger: true }); } finally { document.removeEventListener('change', onChange); }
    if (!ok) return;
    await destructiveTask({
      holdTitle: t('server.purgingTitle', 'Recreating the bots'),
      holdBody: t('glance.purgingLong', 'Saving {name}, then recreating its bots: the realm starts, deletes them and stops by itself (a few minutes).', { name: realmTitle(key) }),
      errorTitle: t('realms.purgeFailed', 'The bots of {name} were not recreated', { name: realmTitle(key) }),
      work: () => (main ? realmAction(key, async () => ({ purged: await App.api.purgeBots({ backup: true }) })) : realmAction(key, () => App.api.realmsPurge(key, { house, backup: true }))),
      success: result => {
        if (isDemo(result)) return demoDone();
        const purged = result?.purged || null;
        const where = purged?.backup ? `<p class="muted">${esc(t('realms.savedIn', 'Saved copy: {path}', { path: purged.backup }))}</p>` : '';
        return { title: t('realms.purgeDoneTitle', 'Bots of {name} deleted', { name: realmTitle(key) }), body: `<p>${esc(purged && !main ? t('realms.purged2', 'Done: the bots come back at the next start. {auctions} auction(s) removed, {refunds} bid(s) refunded by mail.', { auctions: purged.auctions || 0, refunds: purged.refunds || 0 }) : t('realms.purged', 'Done: the bots come back at the next start.'))}</p>${where}` };
      },
    });
    delete App.state.realmFacts?.backups?.[key];
  }, button),
  // Reset the world (Squid World only), in two steps: what will be erased, then the realm's name typed again.
  'realm-reset': button => guard(async () => {
    const key = button.dataset.key;
    // The realm's own name (as in the game's realm list), the one to type and the one the main process checks.
    const name = realmListName(key);
    const main = key === 'coa';
    const preview = main ? await App.api.coaResetPreview() : await App.api.realmsResetPreview(key);
    const players = preview.players.length
      ? `<ul class="reset-list">${preview.players.slice(0, 12).map(player => `<li>${esc(player.name)} (${esc(t('realms.level', 'level {n}', { n: player.level }))})</li>`).join('')}${preview.players.length > 12 ? `<li>… +${preview.players.length - 12}</li>` : ''}</ul>`
      : `<p class="muted">${esc(t('realms.resetNoPlayers', 'No player character on this realm.'))}</p>`;
    const first = `${resetWarning(name)}<p>${preview.demo ? `<span class="pill warn">${esc(t('glance.demoPill', 'Preview: made-up figures'))}</span> ` : ''}${esc(t('realms.resetBody', 'Everything of {name} starts again as a realm just created: its bots, its auction house (seller included), mail, guilds, achievements and server firsts, and the characters of the players on THIS realm. Game accounts, your other realms and the settings of this realm stay. The whole realm is saved first, and can be restored.', { name }))}</p>
      <p><strong>${esc(t('realms.resetPlayers', '{n} player character(s) erased:', { n: preview.players.length }))}</strong></p>${players}
      <p class="muted">${esc(t('realms.resetCounts', 'Also erased: {bots} bots, {guilds} guilds, {auctions} auctions, {mails} mails, {achievements} achievements.', preview))}`;
    if (!await confirmDialog({ title: t('realms.resetTitle', 'Reset {name}?', { name }), body: first, confirm: t('common.continue', 'Continue'), danger: true })) return;
    let typed = '';
    const onInput = event => { if (event.target?.id === 'reset-name') typed = event.target.value; };
    document.addEventListener('input', onInput);
    let ok = false;
    try {
      ok = await confirmDialog({ title: t('realms.resetConfirmTitle', 'Type the name of the realm'), body: `${esc(t('realms.resetConfirmBody2', 'To reset it, type the name of the realm as it shows in the game\'s realm list: {name}. This erases the characters listed before (a saved copy is kept in Backups).', { name }))}</p><p class="reset-name-shown"><strong>${esc(name)}</strong></p><p><input class="text-input" id="reset-name" autocomplete="off" spellcheck="false" placeholder="${esc(name)}">`, confirm: t('realms.reset', 'Reset the world'), danger: true });
    } finally { document.removeEventListener('input', onInput); }
    if (!ok) return;
    if (!sameRealmName(typed, name)) { await resultDialog({ title: t('realms.resetNotDone', '{name} was not reset', { name }), body: `<p>${esc(t('realms.resetWrongName', 'The name typed is not {name}: nothing was reset.', { name }))}</p>`, kind: 'error' }); return; }
    await destructiveTask({
      holdTitle: t('realms.resetting', 'Resetting the world'),
      holdBody: t('realms.resettingLong', 'Saving {name}, then making it new (a few minutes). Do not close the launcher.', { name }),
      errorTitle: t('realms.resetNotDone', '{name} was not reset', { name }),
      work: () => realmAction(key, () => (main ? App.api.coaReset(typed) : App.api.realmsReset(key, typed))),
      success: result => (isDemo(result) ? demoDone() : { title: t('realms.resetDoneTitle', '{name} is new', { name }), body: `<p>${esc(t('realms.worldResetDone', '{name} is new: its bots are made at its next start. The old world is saved in Backups.', { name }))}</p><p class="muted">${esc(t('realms.savedIn', 'Saved copy: {path}', { path: result?.reset?.backup || '' }))}</p>` }),
    });
  }, button),
  'realm-restore': button => guard(async () => {
    const key = button.dataset.key;
    const name = realmListName(key);
    const list = await App.api.realmsBackups(key);
    if (!list.length) { toast(t('realms.noBackup', 'No saved copy of {name} yet.', { name }), 'info'); return; }
    const last = list[0];
    const when = new Date(last.at).toLocaleString();
    if (!await confirmDialog({ title: t('realms.restoreTitle', 'Restore {name}?', { name }), body: esc(t('realms.restoreBody', 'The copy of {when} replaces the realm as it is now (which is saved first). {count} saved cop(ies) in Backups.', { when, count: list.length })), confirm: t('realms.restore', 'Restore a backup'), danger: true })) return;
    await destructiveTask({
      holdTitle: t('realms.restoring', 'Restoring the world'),
      holdBody: t('realms.restoringLong', 'Putting back the copy of {when} (a few minutes). Do not close the launcher.', { when }),
      errorTitle: t('realms.restoreNotDone', '{name} was not restored', { name }),
      work: () => realmAction(key, () => App.api.realmsRestore(key, last.id)),
      success: result => (isDemo(result) ? demoDone() : { title: t('realms.restoreDoneTitle', '{name} is restored', { name }), body: `<p>${esc(t('realms.restored', '{name} is back as it was on {when}.', { name, when }))}</p><p class="muted">${esc(t('realms.savedBefore', 'The realm as it was just before is saved in: {path}', { path: result?.restored?.before || '' }))}</p>` }),
    });
  }, button),
  'realm-disable': button => guard(async () => {
    const key = button.dataset.key;
    const name = realmTitle(key);
    if (!await confirmDialog({ title: t('realms.disableTitle', 'Switch {name} off?', { name }), body: esc(t('realms.disableBody', 'Its world stops and it leaves the realm list of the game. Its characters, its bots and its settings are kept: switch it on again whenever you want.')), confirm: t('realms.disable', 'Switch off') })) return;
    await realmAction(key, () => App.api.realmsDisable(key, true));
    toast(t('realms.disabledDone', '{name} is switched off. Nothing was deleted.', { name }), 'success');
  }, button),
  'realm-enable': button => guard(async () => {
    const key = button.dataset.key;
    await realmAction(key, () => App.api.realmsDisable(key, false));
    toast(t('realms.enabledDone', '{name} is back in the realm list: start it when you want.', { name: realmTitle(key) }), 'success');
  }, button),
  'realm-settings': button => { App.state.confRealm = button.dataset.key; App.state.pending = {}; App.state.conf = null; App.state.srvTab = 'settings'; App.go('server'); loadConf(); },
  'realm-console': button => { App.state.consoleRealm = button.dataset.key; App.go('console'); },
  // The bots dashboard on this realm: started first when it is not running yet.
  'realm-dashboard': button => guard(async () => {
    if (!App.state.dashboard?.running) App.state.dashboard = await App.api.startDashboard();
    await App.api.openDashboard(button.dataset.key);
  }, button),
  'conf-realm': button => {
    if (Object.keys(App.state.pending).length) { toast(t('realms.saveFirst', 'Save or discard your changes first.'), 'error'); return; }
    App.state.confRealm = button.dataset.key; App.state.conf = null; App.refresh('server'); loadConf();
  },
  'console-realm': button => { App.state.consoleRealm = button.dataset.key; App.render(); },
});

// ---------------------------------------------------------------- modules of a realm (Modules tab, realm picked)
const REALM_MODULES = {
  bots: { art: 'squidbots', icon: 'bot', title: () => 'SquidBots', textKey: 'realms.modBots', text: 'The random bots and the group AI of this realm. Off, the realm is for players only.' },
  ahbot: { art: 'ahbot', icon: 'coin', title: () => t('modules.ahbot', 'Auction house'), textKey: 'realms.modAhbot', text: 'Gavelgrin keeps the auction house of this realm busy; he gets his own character in this realm.' },
  manastorm: { art: 'manastorm', icon: 'play', title: () => 'Manastorm Endless', textKey: 'realms.modManastorm', text: 'Endless runs of Manastorm rooms. Every player needs the updated client files.' },
  rotation: { art: 'rotation', icon: 'refresh', title: () => t('modules.rotation', 'Rotation assistant'), textKey: 'realms.modRotation', text: 'One button that casts the next spell of your rotation.' },
  multirace: { art: '', icon: 'user', title: () => 'Multirace', textKey: 'realms.modMultirace', text: 'More playable races.' },
};

async function loadRealmModules(key) {
  try { App.state.realmModules = { key, list: await App.api.realmsModules(key) }; } catch (error) { App.state.realmModules = { key, error: translateError(error.message) }; }
  if (App.state.tab === 'modules') App.refresh('modules');
}

function realmModulesView(key) {
  const data = App.state.realmModules;
  if (!data || data.key !== key) { loadRealmModules(key); return skeleton(3); }
  if (data.error) return emptyState('warning', t('modules.error', 'The modules cannot be read'), data.error);
  const realm = realmList().find(item => item.key === key);
  const running = ['running', 'starting'].includes(realm?.state);
  const shown = data.list.filter(module => module.origin !== 'mode');
  const absent = data.list.filter(module => module.origin === 'mode').map(module => REALM_MODULES[module.id].title());
  const stopFirst = running ? `<p class="module-note">${icon('info')}${esc(t('realms.modStop', 'Stop this realm to switch a module: it is read when the realm starts.'))}</p>` : '';
  const cards = shown.map(module => {
    const info = REALM_MODULES[module.id];
    const tag = module.origin === 'own'
      ? `<span class="origin own">${esc(t('realms.fromRealm', 'This realm only'))}<button class="link-button" data-action="realm-module" data-key="${key}" data-id="${module.id}" data-state="coa" ${running ? 'disabled' : ''}>${icon('refresh')}${esc(t('realms.backToCoa', 'As CoA ({value})', { value: module.coaOn ? t('realms.on', 'on') : t('realms.off', 'off') }))}</button></span>`
      : `<span class="origin coa">${esc(t('realms.fromCoa', 'As CoA'))}</span>`;
    return `<section class="panel module-card">${info.art ? moduleArt(info.art) : ''}<header><h2>${icon(info.icon)}${esc(info.title())}</h2><button class="switch ${module.on ? 'on' : ''}" data-action="realm-module" data-key="${key}" data-id="${module.id}" data-state="${module.on ? 'off' : 'on'}" ${running ? 'disabled' : ''} role="switch" aria-checked="${module.on}"><span></span></button></header>
      <p class="muted">${esc(t(info.textKey, info.text))}</p>
      <p class="module-origin">${tag}</p>${stopFirst}
    ${module.id === 'ahbot' && module.on ? `<div class="button-row module-actions"><button class="button ghost small" data-action="realm-ahbot-settings" data-key="${key}">${icon('settings')}${esc(t('ah.settings', 'Settings'))}</button></div>` : ''}</section>`;
  }).join('');
  const note = absent.length ? `<p class="modules-foot">${icon('info')} ${esc(t('realms.modAbsent', 'Not in this game mode: {list}.', { list: absent.join(', ') }))}</p>` : '';
  return `<div class="grid-2 modules realm-mods">${cards}</div>${note}`;
}

// The realm picker and its banner above the modules (only when a realm exists besides CoA).
function modulesRealmHead(key) {
  if (createdRealms().length < 2) return '';
  return realmPicker(key, 'modules-realm') + realmBanner(key, key === 'coa'
    ? t('realms.modCoa', 'The modules of Conquest of Azeroth. The other realms follow them, except the ones they change.')
    : t('realms.modRealm', 'The modules of this realm. "As CoA" follows Conquest of Azeroth; switch one and it becomes this realm\'s own.'));
}

Object.assign(App.actions, {
  'modules-realm': button => { App.state.modRealm = button.dataset.key; App.state.realmModules = null; App.refresh('modules'); },
  'realm-ahbot-settings': button => guard(() => ahbotDialog(button.dataset.key), button),
  'realm-module': button => guard(async () => {
    const { key, id, state } = button.dataset;
    const list = await App.api.realmsModule(key, id, state);
    App.state.realmModules = { key, list };
    toast(t('modules.restartNeeded', 'Saved: it applies at the next start of the server.'), 'success');
    App.refresh('modules');
    loadRealms();
  }, button),
});

// "Start the server" could not start a realm: say which and why (the card also says it for the memory).
App.api.onRealmsFailed?.(failed => {
  for (const item of failed || []) {
    const name = item.key ? realmTitle(item.key) : t('tab.realms', 'Realms');
    toast(item.error === 'memory' ? t('realms.failedMemory', '{name} was not started: not enough free memory.', { name }) : t('realms.failed', '{name} did not start: {error}', { name, error: translateError(item.error) }), 'error');
  }
  loadRealms();
});

// ---------------------------------------------------------------- the realm's card in the game (realm list)
async function realmCardDialog(key) {
  const data = await App.api.cardsGet();
  const card = data.cards.realms[key];
  const option = (value, label, current) => `<option value="${esc(value)}" ${String(current) === String(value) ? 'selected' : ''}>${esc(label)}</option>`;
  const titled = id => data.images.find(item => item.id === id)?.title;
  const off = data.perRealm ? '' : 'disabled';
  const row = (label, help, control) => `<div class="ah-row"><div><strong>${esc(label)}</strong>${help ? `<small>${esc(help)}</small>` : ''}</div>${control}</div>`;
  dialog.open(`${dialog.header(t('cards.title', 'Card in the realm list'), realmTitle(key))}<div class="dialog-content ah-settings">
    <p class="muted small">${esc(t('cards.hint', 'What players see when they pick a realm in the game. Applied at the next start of the server (login server).'))}</p>
    ${row(t('cards.name', 'Realm name'), key === 'coa' && !card.name ? t('cards.nameCoa', 'Empty: the name chosen in Who can join ({name}).', { name: data.coaName }) : t('cards.nameHint', 'No « - » (the game cuts the name there).'), `<input id="card-name" maxlength="24" value="${esc(card.name || (key === 'coa' ? data.coaName.split(' - ')[0] : ''))}">`)}
    ${row(t('cards.subtitle', 'Subtitle'), t('cards.subtitleHint', 'A line under the name, like « Warcraft Reborn ». Optional.'), `<input id="card-subtitle" maxlength="24" value="${esc(card.subtitle)}">`)}
    ${row(t('cards.mode', 'Game mode'), t('cards.modeHint', 'The icon and the mode named on the card.'), `<select id="card-mode">${data.modes.map(mode => option(mode.id, mode.name, card.mode)).join('')}</select>`)}
    ${row(t('cards.image', 'Background'), t('cards.imageHint', 'An image with a title (★) shows that title instead of the realm name.'), `<select id="card-image" ${off}>${data.images.map(image => option(image.id, `${image.id}${image.title ? ' ★' : ''}`, card.image)).join('')}</select>`)}
    <p class="ah-warn" id="card-title-note" ${titled(card.image) ? '' : 'hidden'}>${icon('info')}<span>${esc(t('cards.titleNote', 'This background draws its own big title: it shows instead of the realm name (your subtitle stays under it).'))}</span></p>
    ${row(t('cards.description', 'Description'), t('cards.descriptionHint', 'A text chosen among those of the game (it cannot be typed).'), `<select id="card-description" ${off}>${data.descriptions.map(item => option(item.id, item.id ? item.name : t('cards.noText', 'No text'), card.description)).join('')}</select>`)}
    ${data.perRealm ? '' : `<p class="ah-warn">${icon('info')}<span>${esc(t('cards.needsCore', 'Background and description per realm come with the next server core (CoA Bots 2.8). Until then: the game mode, the name and the expansion.'))}</span></p>`}
    ${row(t('cards.expansion', 'Expansion shown (every realm)'), t('cards.expansionHint', 'Vanilla (Progressive) as on the official realms.'), `<select id="card-expansion">${[[0, 'Vanilla (Progressive)'], [1, 'The Burning Crusade'], [2, 'Wrath of the Lich King']].map(([id, label]) => option(id, label, data.cards.expansion)).join('')}</select>`)}
    <div class="button-row"><button class="link-button" data-action="realm-card-default" data-key="${key}">${icon('refresh')}${esc(t('cards.default', 'Back to the official look'))}</button></div>
  </div><footer class="dialog-foot"><button class="button ghost" data-action="dialog-close">${esc(t('common.cancel', 'Cancel'))}</button><button class="button primary" data-action="realm-card-save" data-key="${key}">${esc(t('common.save', 'Save'))}</button></footer>`, 'form');
  App.state.cardsData = data;
  $('#card-image').addEventListener('change', event => { $('#card-title-note').hidden = !titled(event.target.value); });
}
const CARD_DEFAULTS = { coa: { mode: 11, image: 'Voljin', description: 13977864, subtitle: '' }, wildcard: { mode: 6, image: 'Darkmoon', description: 13977904, name: 'Darkmoon', subtitle: '' }, reborn: { mode: 12, image: 'Bronzebeard', description: 1397607, name: 'Bronzebeard', subtitle: 'Warcraft Reborn' }, dawnrise: { mode: 9, image: 'Dawnrise', description: 13977920, name: 'Dawnrise', subtitle: 'Free Pick' }, living: { mode: 11, image: 'Thrall1', description: 13977864, name: '', subtitle: 'New server' } };
Object.assign(App.actions, {
  'realm-card': button => guard(() => realmCardDialog(button.dataset.key), button),
  'realm-card-default': button => {
    const base = CARD_DEFAULTS[button.dataset.key];
    if (base.name !== undefined) $('#card-name').value = base.name;
    $('#card-subtitle').value = base.subtitle;
    $('#card-mode').value = String(base.mode);
    $('#card-image').value = base.image;
    $('#card-description').value = String(base.description);
    $('#card-expansion').value = '0';
  },
  'realm-card-save': button => guard(async () => {
    const key = button.dataset.key;
    const cards = App.state.cardsData.cards;
    const realms = { ...cards.realms, [key]: { mode: Number($('#card-mode').value), image: $('#card-image').value, description: Number($('#card-description').value), name: $('#card-name').value.trim(), subtitle: $('#card-subtitle').value.trim() } };
    const result = await App.api.cardsSave({ expansion: Number($('#card-expansion').value), realms });
    dialog.close();
    toast(result.shown === 'now' ? t('cards.savedNow', 'Saved: the realm list of the game shows it now (open the realm list again).') : result.authRunning ? t('cards.savedRunning', 'Saved: the realm list shows it after the next start of the server.') : t('cards.saved', 'Saved: the realm list shows it at the next start of the server.'), 'success');
    loadRealms();
  }, button),
});
