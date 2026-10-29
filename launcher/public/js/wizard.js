'use strict';
// The setup wizard (Server settings > Presets and profiles): a few illustrated questions, a recommendation for each,
// a summary of every value that changes, then it is applied: settings saved, bots made again when the world style
// asks for it (after a backup), the chosen realms switched on, and the server started. The players' characters,
// accounts and alts are never touched: only the configuration of the server and of the bots.

const WIZARD_STEPS = ['welcome', 'realms', 'style', 'bots', 'activities', 'alts', 'xp', 'collections', 'life', 'pvp', 'difficulty', 'summary'];

// Small drawings of each choice, in the colours of the theme.
const WIZARD_ART = {
  living: `<svg viewBox="0 0 120 80" aria-hidden="true"><circle cx="60" cy="44" r="26" class="wa-soft"/><path d="M34 44h52M60 18c-9 9-9 43 0 52M60 18c9 9 9 43 0 52" class="wa-line"/><g class="wa-bot"><circle cx="24" cy="22" r="8"/><circle cx="96" cy="24" r="10"/><circle cx="98" cy="62" r="7"/><circle cx="20" cy="60" r="9"/></g><g class="wa-text"><text x="24" y="25">12</text><text x="96" y="28">60</text><text x="98" y="65">7</text><text x="20" y="63">35</text></g></svg>`,
  selffound: `<svg viewBox="0 0 120 80" aria-hidden="true"><rect x="38" y="40" width="44" height="28" rx="4" class="wa-soft"/><path d="M38 50h44M60 46v8" class="wa-line"/><path d="M34 40c0-12 52-12 52 0" class="wa-line"/><path d="M92 12l-22 22M88 10l6 6M70 30l-4 8 8-4" class="wa-accent"/><g class="wa-text"><text x="22" y="22">1</text><text x="22" y="34" class="wa-small">→59</text></g></svg>`,
  fresh: `<svg viewBox="0 0 120 80" aria-hidden="true"><path d="M60 68V36" class="wa-line"/><path d="M60 46c-14 0-20-10-20-18 10 0 20 6 20 18zM60 40c0-12 8-20 20-20 0 12-8 20-20 20z" class="wa-accent"/><ellipse cx="60" cy="70" rx="26" ry="5" class="wa-soft"/><g class="wa-text"><text x="96" y="30">1</text></g></svg>`,
  pve: `<svg viewBox="0 0 120 80" aria-hidden="true"><path d="M60 12l24 9v18c0 16-11 25-24 30-13-5-24-14-24-30V21z" class="wa-soft"/><path d="M50 40l7 7 14-15" class="wa-accent"/></svg>`,
  pvpSome: `<svg viewBox="0 0 120 80" aria-hidden="true"><path d="M40 20l40 40M80 20L40 60" class="wa-line"/><path d="M36 56l8 8M76 64l8-8" class="wa-accent"/><circle cx="60" cy="40" r="6" class="wa-soft"/></svg>`,
  unlocked: `<svg viewBox="0 0 120 80" aria-hidden="true"><rect x="36" y="38" width="48" height="30" rx="4" class="wa-soft"/><path d="M36 48h48M60 44v8" class="wa-line"/><path d="M32 38l6-14h44l6 14" class="wa-line"/><path d="M60 8v10M44 14l5 7M76 14l-5 7M30 26l8 2M90 26l-8 2" class="wa-accent"/></svg>`,
  earned: `<svg viewBox="0 0 120 80" aria-hidden="true"><path d="M44 16h32v14a16 16 0 0 1-32 0z" class="wa-soft"/><path d="M44 20H34c0 10 6 14 12 14M76 20h10c0 10-6 14-12 14M60 46v10M48 66h24M52 56h16v10H52z" class="wa-line"/><path d="M60 22l2.5 5 5.5.8-4 3.9.9 5.5-4.9-2.6-4.9 2.6.9-5.5-4-3.9 5.5-.8z" class="wa-accent"/></svg>`,
  authentic: `<svg viewBox="0 0 120 80" aria-hidden="true"><path d="M30 60c10-26 50-26 60 0" class="wa-line"/><path d="M60 14v26M48 22l12-8 12 8" class="wa-accent"/><circle cx="60" cy="60" r="6" class="wa-soft"/><path d="M20 66h80" class="wa-line"/></svg>`,
  comfort: `<svg viewBox="0 0 120 80" aria-hidden="true"><path d="M26 52h68l-6 14H32z" class="wa-soft"/><path d="M38 52V40a8 8 0 0 1 16 0v12M66 52V40a8 8 0 0 1 16 0v12" class="wa-line"/><path d="M58 12l3 6 6 1-4.5 4.2 1 6.3L58 26.5l-5.5 3 1-6.3L49 19l6-1z" class="wa-accent"/></svg>`,
  missions: `<svg viewBox="0 0 120 80" aria-hidden="true"><path d="M30 62l18-30 12 16 10-12 20 26z" class="wa-soft"/><path d="M78 14l12 12M86 12l-14 14" class="wa-accent"/><rect x="44" y="64" width="32" height="10" rx="2" class="wa-line"/><path d="M44 64l16 6 16-6" class="wa-line"/></svg>`,
  bg: `<svg viewBox="0 0 120 80" aria-hidden="true"><path d="M30 64V18M30 18h30l-6 9 6 9H30" class="wa-accent"/><path d="M90 64V24M90 24H66l5 8-5 8h24" class="wa-line"/><path d="M20 66h80" class="wa-line"/></svg>`,
  dungeon: `<svg viewBox="0 0 120 80" aria-hidden="true"><path d="M34 68V34a26 26 0 0 1 52 0v34" class="wa-soft"/><path d="M48 68V44a12 12 0 0 1 24 0v24" class="wa-line"/><path d="M28 30l4-8M92 30l-4-8" class="wa-accent"/><circle cx="60" cy="18" r="4" class="wa-accent"/></svg>`,
  normal: `<svg viewBox="0 0 120 80" aria-hidden="true"><circle cx="60" cy="38" r="22" class="wa-soft"/><path d="M50 32h0M70 32h0" class="wa-accent"/><path d="M50 46c6 5 14 5 20 0" class="wa-line"/></svg>`,
  hard: `<svg viewBox="0 0 120 80" aria-hidden="true"><path d="M40 60c0-22 8-38 20-46 12 8 20 24 20 46z" class="wa-soft"/><path d="M50 36l6 4M70 36l-6 4M52 52c5-4 11-4 16 0" class="wa-accent"/><path d="M36 20l8 6M84 20l-8 6" class="wa-line"/></svg>`,
  pvpLots: `<svg viewBox="0 0 120 80" aria-hidden="true"><path d="M40 20l40 40M80 20L40 60" class="wa-accent"/><path d="M36 56l8 8M76 64l8-8" class="wa-accent"/><path d="M60 8c4 6 10 8 10 16a10 10 0 0 1-20 0c0-4 2-6 4-8 0 4 2 6 4 6 0-6 2-10 2-14z" class="wa-fire"/></svg>`,
};

function wizardInitial() {
  const conf = App.state.conf;
  const value = key => String(conf.settings.find(setting => setting.key === key)?.value ?? '').trim();
  const style = value('AiPlayerbot.CoaSelfFound') === '1' ? 'selffound' : value('AiPlayerbot.DisableRandomLevels') === '1' && value('AiPlayerbot.LevelBrackets.Enabled') === '0' ? 'fresh' : 'living';
  const ruleset = value('AiPlayerbot.CoaRulesetForBots');
  const pvp = ruleset === '0' ? 'pve' : Number(value('AiPlayerbot.CoaRulesetHighRiskPct')) >= 50 ? 'lots' : 'some';
  const created = new Set(createdRealms().map(realm => realm.key));
  return {
    step: 0, applying: false, log: [], done: false,
    from: { style, pvp },
    style, pvp,
    bots: Number(value('AiPlayerbot.MaxRandomBots')) || 500,
    around: value('AiPlayerbot.OnlineSelection.FollowPlayerLevels') === '1',
    xp: Number(value('Rate.XP.Kill')) || 1,
    botXp: value('AiPlayerbot.RandomBotXPRate') || '1',
    losses: value('HighRisk.Losses') === '1',
    lang: value('AiPlayerbot.BotTextLocale') || '-1',
    bgMode: value('AiPlayerbot.RandomBotJoinBG') === '0' ? 'off' : value('AiPlayerbot.RandomBotAutoJoinBG') === '0' || (value('AiPlayerbot.RandomBotAutoJoinBGWSCount') === '0' && value('AiPlayerbot.RandomBotAutoJoinBGABCount') === '0') ? 'player' : 'auto',
    arenaMode: value('AiPlayerbot.RandomBotAutoJoinBG') !== '0' && (value('AiPlayerbot.RandomBotAutoJoinBGRatedArena2v2Count') || '1') !== '0' ? 'auto' : 'player',
    sfDungeons: value('AiPlayerbot.CoaSelfFoundBotsPercent') || '-1',
    lfg: value('AiPlayerbot.RandomBotJoinLfg') !== '0',
    scaling: value('CoA.CreatureScaling.Enable') === '1' ? 'ascension' : 'normal',
    botWeight: value('CoaRaidDifficulty.BotMemberWeight') || '0.3',
    missions: value('AiPlayerbot.Missions.Enable') !== '0',
    missionCount: value('AiPlayerbot.Missions.MaxPerPlayer') || '3',
    questSync: value('AiPlayerbot.SyncQuestWithPlayer') !== '0',
    guildBank: value('AiPlayerbot.GuildBankDeposit.Enable') === '1',
    collect: value('CoA.UnlockAllVanity') === '0' || value('CoA.UnlockLocalAppearanceCatalog') === '0' ? 'earn' : 'all',
    riding: value('CoA.MaxRidingFromStart') !== '0',
    botColl: value('CoA.CollectionsForBots') || '1',
    flights: value('InstantFlightPaths') === '1',
    money: String(Number(value('StartPlayerMoney')) || 0),
    wear: value('DurabilityLoss.OnDeath') !== '0',
    realms: new Set(created), created,
    reset: true, start: true,
  };
}
const wizardStart = () => { const w = wizardInitial(); w.initial = { ...w }; return w; };

const wizardAdvised = () => {
  const total = App.state.conf?.memory?.totalMb;
  return total ? Math.max(100, Math.min(3000, Math.floor((total - 4500 - 4000) / 7 / 50) * 50)) : 500;
};

// Every value the choices set, only for the settings this server has.
function wizardChanges(w) {
  const conf = App.state.conf;
  const recipe = id => conf.recipes.find(item => item.id === id)?.changes || {};
  const want = {};
  if (w.style === 'living') Object.assign(want, recipe('coa-recommended'), { 'AiPlayerbot.CoaSelfFound': '0' });
  if (w.style === 'selffound') Object.assign(want, recipe('self-found-world'));
  if (w.style === 'fresh') Object.assign(want, recipe('fresh-level-1'), { 'AiPlayerbot.CoaSelfFound': '0' });
  Object.assign(want, { 'AiPlayerbot.MinRandomBots': String(w.bots), 'AiPlayerbot.MaxRandomBots': String(w.bots) });
  if (w.around) Object.assign(want, { 'AiPlayerbot.EnablePeriodicOnlineOffline': '1', 'AiPlayerbot.OnlineSelection.FollowPlayerLevels': '1', 'AiPlayerbot.OnlineSelection.LevelWindow': '5' });
  else want['AiPlayerbot.OnlineSelection.FollowPlayerLevels'] = '0';
  for (const key of ['Rate.XP.Kill', 'Rate.XP.Quest', 'Rate.XP.Explore']) want[key] = String(w.xp);
  want['AiPlayerbot.RandomBotXPRate'] = String(w.botXp);
  if (w.pvp === 'pve') want['AiPlayerbot.CoaRulesetForBots'] = '0';
  if (w.pvp === 'some') Object.assign(want, { 'AiPlayerbot.CoaRulesetForBots': '1', 'AiPlayerbot.CoaRulesetHighRiskPct': '30', 'AiPlayerbot.CoaRulesetWarModePct': '0' });
  if (w.pvp === 'lots') Object.assign(want, { 'AiPlayerbot.CoaRulesetForBots': '1', 'AiPlayerbot.CoaRulesetHighRiskPct': '50' });
  // Battlegrounds and arenas: started by the bots, or only when a player queues.
  want['AiPlayerbot.RandomBotJoinBG'] = w.bgMode === 'off' ? '0' : '1';
  want['AiPlayerbot.RandomBotAutoJoinBG'] = w.bgMode !== 'off' && (w.bgMode === 'auto' || w.arenaMode === 'auto') ? '1' : '0';
  Object.assign(want, w.bgMode === 'auto' ? { 'AiPlayerbot.RandomBotAutoJoinBGWSCount': '1', 'AiPlayerbot.RandomBotAutoJoinBGABCount': '1' } : { 'AiPlayerbot.RandomBotAutoJoinBGWSCount': '0', 'AiPlayerbot.RandomBotAutoJoinBGABCount': '0' });
  Object.assign(want, w.arenaMode === 'auto' && w.bgMode !== 'off' ? { 'AiPlayerbot.RandomBotAutoJoinBGRatedArena2v2Count': '1', 'AiPlayerbot.RandomBotAutoJoinBGRatedArena3v3Count': '1' } : { 'AiPlayerbot.RandomBotAutoJoinBGRatedArena2v2Count': '0', 'AiPlayerbot.RandomBotAutoJoinBGRatedArena3v3Count': '0' });
  // The self-found preset sets its own share; elsewhere the wizard's choice.
  if (w.style !== 'selffound') want['AiPlayerbot.CoaSelfFoundBotsPercent'] = String(w.sfDungeons);
  want['AiPlayerbot.RandomBotJoinLfg'] = w.lfg ? '1' : '0';
  want['AiPlayerbot.Missions.Enable'] = w.missions ? '1' : '0';
  if (w.missions) want['AiPlayerbot.Missions.MaxPerPlayer'] = String(w.missionCount);
  want['AiPlayerbot.SyncQuestWithPlayer'] = w.questSync ? '1' : '0';
  want['AiPlayerbot.GuildBankDeposit.Enable'] = w.guildBank ? '1' : '0';
  want['CoA.CreatureScaling.Enable'] = w.scaling === 'ascension' ? '1' : '0';
  want['CoaRaidDifficulty.BotMemberWeight'] = String(w.botWeight);
  want['HighRisk.Losses'] = w.losses ? '1' : '0';
  want['AiPlayerbot.BotTextLocale'] = String(w.lang);
  Object.assign(want, { 'CoA.UnlockAllVanity': w.collect === 'all' ? '1' : '0', 'CoA.UnlockLocalAppearanceCatalog': w.collect === 'all' ? '1' : '0', 'CoA.AutoCollectAppearances': '1', 'CoA.LearnOwnedCompanions': '1' });
  want['CoA.MaxRidingFromStart'] = w.riding ? '1' : '0';
  want['CoA.CollectionsForBots'] = String(w.botColl);
  want.InstantFlightPaths = w.flights ? '1' : '0';
  want.StartPlayerMoney = String(w.money);
  Object.assign(want, w.wear ? { 'DurabilityLoss.OnDeath': '10', 'DurabilityLoss.OnSpiritResurrect': '25' } : { 'DurabilityLoss.OnDeath': '0', 'DurabilityLoss.OnSpiritResurrect': '0' });
  const list = [];
  for (const [key, value] of Object.entries(want)) {
    const setting = conf.settings.find(item => item.key === key);
    if (!setting) continue;
    const now = String(setting.value).trim();
    const same = now === value || (['int', 'float', 'choice'].includes(setting.kind) && Number(now) === Number(value) && now !== '' && value !== '');
    if (!same) list.push({ setting, file: setting.file, key, value, kind: setting.kind, from: now });
  }
  return list;
}
// Each choice and the setting it needs on the server, with its name for the summary.
const WIZARD_FIELDS = {
  missions: ['AiPlayerbot.Missions.Enable', 'wizard.missionsTitle', 'Gathering missions'],
  missionCount: ['AiPlayerbot.Missions.MaxPerPlayer', 'wizard.missionCount', 'Alts on a mission at once'],
  guildBank: ['AiPlayerbot.GuildBankDeposit.Enable', 'wizard.guildBankTitle', 'Alts fill the guild bank'],
  questSync: ['AiPlayerbot.SyncQuestWithPlayer', 'wizard.questSyncTitle', 'Alts complete your quests with you'],
  botColl: ['CoA.CollectionsForBots', 'wizard.botCollTitle', 'Transmog of the bots'],
  sfDungeons: ['AiPlayerbot.CoaSelfFoundBotsPercent', 'wizard.sfDunTitle', 'Bot parties in dungeons'],
  scaling: ['CoA.CreatureScaling.Enable', 'wizard.stepDifficulty', 'Difficulty'],
  botWeight: ['CoaRaidDifficulty.BotMemberWeight', 'wizard.raidWeight', 'Raid bosses: a bot counts as'],
  around: ['AiPlayerbot.OnlineSelection.FollowPlayerLevels', 'wizard.aroundTitle', 'Bots online around my level'],
  collect: ['CoA.UnlockAllVanity', 'wizard.stepCollections', 'Collections'],
  riding: ['CoA.MaxRidingFromStart', 'wizard.ridingTitle', 'Full riding from level 1'],
  flights: ['InstantFlightPaths', 'wizard.flightsTitle', 'Instant flights'],
  money: ['StartPlayerMoney', 'wizard.moneyTitle', 'Gold of a new character'],
  wear: ['DurabilityLoss.OnDeath', 'wizard.wearTitle', 'Gear wears out on death'],
  losses: ['HighRisk.Losses', 'wizard.lossesTitle', 'High Risk players drop items when they die'],
  bgMode: ['AiPlayerbot.RandomBotJoinBG', 'wizard.bgTitle', 'Battlegrounds'],
  arenaMode: ['AiPlayerbot.RandomBotAutoJoinBGRatedArena2v2Count', 'wizard.arenaTitle', 'Rated arenas'],
  lfg: ['AiPlayerbot.RandomBotJoinLfg', 'wizard.lfgTitle', 'Bots in the dungeon finder'],
  lang: ['AiPlayerbot.BotTextLocale', 'wizard.chatLead', 'Language of the bots'],
};
// The choices changed in the wizard whose setting this server does not have (a newer CoA Bots brings it).
function wizardUnavailable(w) {
  const conf = App.state.conf;
  return Object.entries(WIZARD_FIELDS).filter(([field, [key]]) => String(w[field]) !== String(w.initial[field]) && !conf.settings.some(setting => setting.key === key)).map(([, [, id, text]]) => t(id, text));
}

// A new world style that starts the bots from level 1 needs them made again (after a backup).
const wizardNeedsReset = w => (['selffound', 'fresh'].includes(w.style) && w.style !== w.from.style) || w.reset;

function choiceCard(field, value, art, title, text, { advised = false, badge = '', facts = [] } = {}) {
  const selected = String(App.state.wizard[field]) === String(value);
  return `<button class="wiz-choice${selected ? ' selected' : ''}" data-action="wiz-pick" data-field="${field}" data-value="${esc(String(value))}">
    ${advised ? `<span class="wiz-advised">${esc(t('wizard.advised', 'Advised'))}</span>` : ''}${badge}
    ${art ? `<div class="wiz-art">${WIZARD_ART[art]}</div>` : ''}<strong>${esc(title)}</strong><small>${esc(text)}</small>${facts.length ? `<dl class="wiz-facts">${facts.map(([label, value, tone]) => `<div><dt>${esc(label)}</dt><dd class="${tone || ''}">${esc(value)}</dd></div>`).join('')}</dl>` : ''}${selected ? `<i class="wiz-tick">${icon('check')}</i>` : ''}</button>`;
}
const pillChoice = (field, value, label, advised) => `<button class="wiz-pill${String(App.state.wizard[field]) === String(value) ? ' selected' : ''}" data-action="wiz-pick" data-field="${field}" data-value="${esc(String(value))}">${esc(label)}${advised ? `<em>${esc(t('wizard.advisedShort', 'advised'))}</em>` : ''}</button>`;
const wizSwitch = (field, label, help) => `<label class="wiz-switch"><span><strong>${esc(label)}</strong><small>${esc(help)}</small></span><span class="switch"><input type="checkbox" data-wiz-field="${field}" ${App.state.wizard[field] ? 'checked' : ''}><span></span></span></label>`;
const safeNote = () => `<p class="wiz-safe">${icon('shield')}<span>${esc(t('wizard.safe', 'Your characters, accounts and alts are never touched: only the configuration of the server and of the bots changes.'))}</span></p>`;

// The language the bots talk in the chat (on the Bots page).
function wizardLanguage() {
  const w = App.state.wizard;
  const setting = App.state.conf.settings.find(item => item.key === 'AiPlayerbot.BotTextLocale');
  if (!setting) return '';
  const options = (setting.choices || []).map(choice => `<option value="${esc(choice.value)}" ${String(w.lang) === String(choice.value) ? 'selected' : ''}>${esc(loc(choice.label))}</option>`).join('');
  return `<div class="wiz-row spaced boxed"><span>${esc(t('wizard.chatLead', 'In which language do the bots talk in the chat?'))}</span><select class="wiz-select" data-wiz-field="lang">${options}</select></div>`;
}

function wizardStepView(id) {
  const w = App.state.wizard;
  if (id === 'welcome') return `<div class="wiz-hero"><h3>${esc(t('wizard.welcomeTitle', 'Welcome to SquidBots Server: your realm, your rules'))}</h3>
    <p>${esc(t('wizard.welcomeText', 'A few questions to set up your world the way you like to play. Each one has a recommendation; nothing changes until the last page, where you see every value before applying it.'))}</p>${safeNote()}
    <ul class="wiz-points"><li>${icon('globe')}${esc(t('wizard.pointRealms', 'Which realms you want: Conquest of Azeroth, Wildcard, Warcraft Reborn...'))}</li><li>${icon('bot')}${esc(t('wizard.pointWorld', 'How the bots live: every level, or self-found from level 1'))}</li><li>${icon('swords')}${esc(t('wizard.pointPvp', 'How much PvP, and how fast you level'))}</li><li>${icon('play')}${esc(t('wizard.pointStart', 'Then it applies everything and starts your server'))}</li></ul></div>`;
  if (id === 'realms') {
    const list = realmList();
    const rows = list.filter(realm => realm.main || realm.ready || w.created.has(realm.key)).map(realm => {
      const info = REALMS_INFO[realm.key] || { title: realm.key, sub: '', text: '' };
      const on = w.realms.has(realm.key);
      const locked = realm.main || w.created.has(realm.key);
      return `<button class="wiz-realm${on ? ' selected' : ''}${locked ? ' locked' : ''}" data-action="wiz-realm" data-key="${realm.key}" ${locked ? 'disabled' : ''}>${realmEmblem(realm.key, 56)}<span><strong>${esc(info.title)}${info.experimental ? ` <span class="pill warn realm-exp">${esc(t('modules.experimental', 'Experimental'))}</span>` : ''}</strong><small>${esc(t(info.textKey, info.text))}</small>${locked ? `<em>${esc(realm.main ? t('wizard.realmMain', 'Always on: your main realm') : t('wizard.realmOn', 'Already on'))}</em>` : ''}</span>${on ? `<i class="wiz-tick">${icon('check')}</i>` : ''}</button>`;
    }).join('');
    return `<p class="wiz-lead">${esc(t('wizard.realmsLead', 'Several realms can run at once on the same server, with the same game accounts. Each one has its own characters and bots, and needs some more memory.'))}</p><div class="wiz-realms">${rows}</div>`;
  }
  if (id === 'style') {
    const start = t('wizard.factStart', 'Start'), gear = t('wizard.factGear', 'Gear'), dungeons = t('wizard.factDungeons', 'Dungeons');
    return `<p class="wiz-lead">${esc(t('wizard.styleLead', 'How do the bots live in your world?'))}</p><div class="wiz-grid three">
    ${choiceCard('style', 'living', 'living', t('wizard.livingTitle', 'A living world'), t('wizard.livingText2', 'Bots of every level everywhere from day one: towns, quests, dungeons and battlegrounds are busy right away.'), { advised: true, facts: [[start, t('wizard.factEveryLevel', 'Every level, 1 to 60')], [gear, t('wizard.factGiven', 'Given by the server, at their level'), 'good'], [dungeons, t('wizard.factWithYou', 'With you and your group')]] })}
    ${choiceCard('style', 'selffound', 'selffound', t('wizard.sfTitle', 'Solo self-found'), t('wizard.sfText2', 'The hardcore way: the bots grow up like you, starting from nothing. At 60 they are geared for the endgame.'), { facts: [[start, t('wizard.factLevel1', 'Level 1')], [gear, t('wizard.factLooted', 'Never given: only what they loot, quest or get from you'), 'hard'], [dungeons, t('wizard.factSfParties', '20 % of them clear dungeons in parties of 5')]] })}
    ${choiceCard('style', 'fresh', 'fresh', t('wizard.freshTitle2', 'Fresh start, geared'), t('wizard.freshText2', 'The bots grow up with you from level 1, but the server keeps giving them gear of their level: an easy start, a young world.'), { facts: [[start, t('wizard.factLevel1', 'Level 1')], [gear, t('wizard.factGiven', 'Given by the server, at their level'), 'good'], [dungeons, t('wizard.factWithYou', 'With you and your group')]] })}
  </div>${wizardNeedsReset(w) && w.style !== w.from.style ? `<p class="wiz-note">${icon('info')}<span>${esc(t('wizard.resetNote', 'This style starts the bots again from level 1: at the end, the random bots are deleted and made again (a backup is made first). Your characters and alts stay.'))}</span></p>` : ''}`;
  }
  if (id === 'bots') {
    const advised = wizardAdvised();
    const steps = [...new Set([100, 250, 500, 1000, 1500, 2000, advised, w.bots])].filter(n => n <= 3000).sort((a, b) => a - b);
    return `<p class="wiz-lead">${esc(t('wizard.botsLead', 'How many random bots? Each one costs a little memory; this PC handles about {n}.', { n: advised }))}</p>
      <div class="wiz-pills">${steps.map(n => pillChoice('bots', n, String(n), n === advised)).join('')}</div>
      ${wizSwitch('around', t('wizard.aroundTitle', 'Bots online around my level'), t('wizard.aroundText', 'The realm keeps twice as many bots and logs in those near the level of the players online. No bot changes level. Nice with few players.'))}${wizardLanguage()}`;
  }
  if (id === 'xp') return `<p class="wiz-lead">${esc(t('wizard.xpLead', 'How fast do you level up?'))}</p>
    <div class="wiz-row"><span>${esc(t('wizard.xpYou', 'Your characters'))}</span><div class="wiz-pills">${[1, 2, 3, 5].map(n => pillChoice('xp', n, `× ${n}`, n === 1)).join('')}</div></div>
    <div class="wiz-row"><span>${esc(t('wizard.xpBots', 'The random bots'))}</span><div class="wiz-pills">${['1', '2', '3', '5'].map(n => pillChoice('botXp', n, `× ${n}`, n === (w.style === 'selffound' ? '2' : '1'))).join('')}</div></div>
    <p class="wiz-note">${icon('info')}<span>${esc(t('wizard.xpNote', '× 1 is the CoA experience. The bots\' speed only matters when they level up by playing (self-found, fresh start).'))}</span></p>`;
  if (id === 'activities') {
    const row = (title, text, field, options) => `<div class="wiz-activity"><div><strong>${esc(title)}</strong><small>${esc(text)}</small></div><div class="wiz-pills">${options.map(([value, label, advised]) => pillChoice(field, value, label, advised)).join('')}</div></div>`;
    return `<p class="wiz-lead">${esc(t('wizard.actLead', 'What do the bots do on their own, while you play or not?'))}</p>
    <div class="wiz-activities"><div class="wiz-act-art">${WIZARD_ART.bg}</div><div>
    ${row(t('wizard.bgTitle', 'Battlegrounds'), t('wizard.bgText', 'Warsong Gulch and Arathi Basin at level 60.'), 'bgMode', [['auto', t('wizard.bgAuto', 'Bots start their own'), true], ['player', t('wizard.bgPlayer', 'Wait for a player')], ['off', t('wizard.bgOff', 'Never')]])}
    ${w.bgMode === 'off' ? '' : row(t('wizard.arenaTitle', 'Rated arenas'), t('wizard.arenaText', '2v2 and 3v3 at level 60.'), 'arenaMode', [['auto', t('wizard.bgAuto', 'Bots start their own'), true], ['player', t('wizard.arenaPlayer', 'Only against a player team')]])}
    </div></div>
    <div class="wiz-activities"><div class="wiz-act-art">${WIZARD_ART.dungeon}</div><div>
    ${w.style === 'selffound' ? `<div class="wiz-activity"><div><strong>${esc(t('wizard.sfDunTitle', 'Bot parties in dungeons'))}</strong><small>${esc(t('wizard.sfDunOn', 'On with Solo self-found: 20 % of the bots clear the dungeons of their level in parties of five.'))}</small></div></div>`
      : row(t('wizard.sfDunTitle', 'Bot parties in dungeons'), t('wizard.sfDunText', 'Parties of five bots clear the dungeons of their level by themselves (with Dungeon Clear) and wear what they loot.'), 'sfDungeons', [['0', t('wizard.no', 'No'), true], ['20', t('wizard.sfDun20', 'Yes, 20 % of the bots')]])}
    </div></div>
    ${wizSwitch('lfg', t('wizard.lfgTitle', 'Bots in the dungeon finder'), t('wizard.lfgText', 'Queue for a dungeon and bots fill your group in a moment.'))}`;
  }
  if (id === 'alts') return `<p class="wiz-lead">${esc(t('wizard.altsLead', 'Your own characters played as bots: what they may do for you.'))}</p>
    <div class="wiz-activities"><div class="wiz-act-art">${WIZARD_ART.missions}</div><div>
    ${wizSwitch('missions', t('wizard.missionsTitle', 'Gathering missions'), t('wizard.missionsText', 'Send an alt to mine or pick herbs in the world for real: it gathers in a zone of its level and mails you the loot (Missions tab of SquidBots Lite).'))}
    ${w.missions ? `<div class="wiz-row spaced boxed"><span>${esc(t('wizard.missionCount', 'Alts on a mission at once'))}</span><div class="wiz-pills">${['1', '2', '3', '5'].map(n => pillChoice('missionCount', n, n, n === '3')).join('')}</div></div>` : ''}
    </div></div>
    <div class="wiz-row spaced boxed"><span>${esc(t('wizard.botCollTitle', 'Transmog of the bots'))}</span><div class="wiz-pills">${pillChoice('botColl', '0', t('wizard.botColl0', 'Never'))}${pillChoice('botColl', '1', t('wizard.botColl1', 'Your alts only'), true)}${pillChoice('botColl', '2', t('wizard.botColl2', 'Every bot'))}</div></div>
    ${wizSwitch('questSync', t('wizard.questSyncTitle', 'Alts complete your quests with you'), t('wizard.questSyncText', 'When you hand in a quest, your bots complete it too and leave you the quest items.'))}
    ${wizSwitch('guildBank', t('wizard.guildBankTitle', 'Alts fill the guild bank'), t('wizard.guildBankText', 'Near a guild vault, your bots deposit their trade goods and their gold above 100.'))}`;
  if (id === 'difficulty') return `<p class="wiz-lead">${esc(t('wizard.diffLead', 'How tough are the creatures?'))}</p><div class="wiz-grid two">
    ${choiceCard('scaling', 'normal', 'normal', t('wizard.normalTitle', 'Normal'), t('wizard.normalText', 'Creatures as in the original game: the classic balance, best with bots in your group.'), { advised: true, facts: [[t('wizard.factHealth', 'Health'), '× 1', 'good'], [t('wizard.factDamage', 'Damage'), '× 1', 'good']] })}
    ${choiceCard('scaling', 'ascension', 'hard', t('wizard.ascTitle', 'As on Ascension'), t('wizard.ascText', 'The reinforced creatures of the official CoA realm: more health and harder hits, growing with the level.'), { facts: [[t('wizard.factHealth', 'Health'), t('wizard.factAscHealth', '× 1.2 to 2 in the world, × 2.5 in dungeons'), 'hard'], [t('wizard.factDamage', 'Damage'), t('wizard.factAscDamage', '× 2.2 to 3 in the world, × 1.5 in dungeons'), 'hard']] })}
  </div><div class="wiz-row spaced boxed"><span>${esc(t('wizard.raidWeight', 'Raid bosses: a bot counts as'))}</span><div class="wiz-pills">${pillChoice('botWeight', '0.3', t('wizard.weight03', '0.3 player'), true)}${pillChoice('botWeight', '0.5', t('wizard.weight05', '0.5 player'))}${pillChoice('botWeight', '1', t('wizard.weight1', '1 player'))}</div></div>
  <p class="wiz-note">${icon('info')}<span>${esc(t('wizard.raidWeightNote', 'Raid boss health follows the number of players inside. At 0.3, a raid of you and 19 bots has bosses sized for about 10 players.'))}</span></p>`;
  if (id === 'collections') return `<p class="wiz-lead">${esc(t('wizard.collLead', 'Appearances (transmog), mounts, companions and toys of the CoA collection: all yours at once, or earned as you play?'))}</p><div class="wiz-grid two">
    ${choiceCard('collect', 'all', 'unlocked', t('wizard.collAllTitle', 'Everything unlocked'), t('wizard.collAllText', 'Every appearance in the wardrobe and the whole vanity collection (mounts, companions, toys) owned from the first login. The comfort of a solo server.'), { advised: true, facts: [[t('wizard.factWardrobe', 'Wardrobe'), t('wizard.factAllApp', 'Every appearance'), 'good'], [t('wizard.factVanity', 'Mounts, pets'), t('wizard.factOwned', 'All owned'), 'good']] })}
    ${choiceCard('collect', 'earn', 'earned', t('wizard.collEarnTitle', 'To collect'), t('wizard.collEarnText', 'Like a live realm: an appearance joins the wardrobe when you get the item, and mounts and companions are earned in game, then kept for good.'), { facts: [[t('wizard.factWardrobe', 'Wardrobe'), t('wizard.factAsYouGo', 'Filled as you play'), 'hard'], [t('wizard.factVanity', 'Mounts, pets'), t('wizard.factEarned', 'Earned in game'), 'hard']] })}
  </div>${wizSwitch('riding', t('wizard.ridingTitle', 'Full riding from level 1'), t('wizard.ridingText', 'Every character rides at full speed from the first login. Off: riding is learned from the trainer, as in the original game.'))}
`;
  if (id === 'life') {
    const gold = n => n ? t('wizard.gold', '{n} gold', { n }) : t('wizard.goldNone', 'None');
    const authentic = !w.flights && w.money === '0' && w.wear;
    const comfort = w.flights && w.money !== '0' && !w.wear;
    return `<p class="wiz-lead">${esc(t('wizard.lifeLead', 'The little rules of everyday life on your server.'))}</p><div class="wiz-grid two">
    <button class="wiz-choice${authentic ? ' selected' : ''}" data-action="wiz-life" data-value="authentic"><span class="wiz-advised">${esc(t('wizard.advised', 'Advised'))}</span><div class="wiz-art">${WIZARD_ART.authentic}</div><strong>${esc(t('wizard.authTitle', 'Authentic'))}</strong><small>${esc(t('wizard.authText', 'As on Ascension: you fly over the world, start with empty pockets and repair your gear after a death.'))}</small>${authentic ? `<i class="wiz-tick">${icon('check')}</i>` : ''}</button>
    <button class="wiz-choice${comfort ? ' selected' : ''}" data-action="wiz-life" data-value="comfort"><div class="wiz-art">${WIZARD_ART.comfort}</div><strong>${esc(t('wizard.comfortTitle', 'Comfort'))}</strong><small>${esc(t('wizard.comfortText', 'Less waiting, more playing: instant flights, 10 gold to start, no repairs after a death.'))}</small>${comfort ? `<i class="wiz-tick">${icon('check')}</i>` : ''}</button></div>
    <p class="wiz-sub">${esc(t('wizard.lifeDetail', 'Or pick each one:'))}</p>
    ${wizSwitch('flights', t('wizard.flightsTitle', 'Instant flights'), t('wizard.flightsText', 'The flight master takes you to your destination at once.'))}
    <div class="wiz-row spaced boxed"><span>${esc(t('wizard.moneyTitle', 'Gold of a new character'))}</span><div class="wiz-pills">${['0', '10000', '100000', '1000000'].map(n => pillChoice('money', n, gold(Number(n) / 10000), n === '0')).join('')}</div></div>
    ${wizSwitch('wear', t('wizard.wearTitle', 'Gear wears out on death'), t('wizard.wearText', 'Your gear loses durability at each death and must be repaired, as in the original game.'))}`;
  }
  if (id === 'pvp') return `<p class="wiz-lead">${esc(t('wizard.pvpLead', 'How much PvP in the open world?'))}</p><div class="wiz-grid three">
    ${choiceCard('pvp', 'pve', 'pve', t('wizard.pveTitle', 'Peaceful'), t('wizard.pveText', 'Every bot in PvE: nobody attacks you in the open world. Battlegrounds stay open.'))}
    ${choiceCard('pvp', 'some', 'pvpSome', t('wizard.someTitle', 'A bit of danger'), t('wizard.someText', '30 % of the bots are High Risk: they fight High Risk and War Mode players, never PvE ones.'), { advised: true })}
    ${choiceCard('pvp', 'lots', 'pvpLots', t('wizard.lotsTitle', 'PvP world'), t('wizard.lotsText2', 'Half of the bots are High Risk: the open world is a battlefield.'))}
  </div>${wizSwitch('losses', t('wizard.lossesTitle', 'High Risk players drop items when they die'), t('wizard.lossesText', 'As on Ascension: gear, resources and gold go into a chest that High Risk players nearby can loot. Off by default.'))}`;
  // Summary
  const changes = wizardChanges(w);
  const newRealms = [...w.realms].filter(key => !w.created.has(key));
  const reset = wizardNeedsReset(w);
  const canPurge = App.state.server?.bots?.installed && App.state.server?.canPurgeBots;
  const unavailable = wizardUnavailable(w);
  const row = change => `<li><strong>${esc(loc(change.setting.label))}</strong><span><code>${esc(change.from || '—')}</code> → <code>${esc(change.value)}</code></span></li>`;
  return `${safeNote()}<div class="wiz-summary">
    <section><h4>${icon('settings')}${esc(t('wizard.sumSettings', '{n} setting(s) change', { n: changes.length }))}</h4>${changes.length ? `<ul>${changes.map(row).join('')}</ul>` : `<p class="muted">${esc(t('wizard.sumNoChange', 'Your settings already match these choices.'))}</p>`}${unavailable.length ? `<p class="wiz-note warn">${icon('warning')}<span>${esc(t('wizard.sumUnavailable', 'Not on this server yet (they come with a newer CoA Bots, update it from the home page): {list}.', { list: unavailable.join(', ') }))}</span></p>` : ''}</section>
    ${newRealms.length ? `<section><h4>${icon('globe')}${esc(t('wizard.sumRealms', 'Realms switched on'))}</h4><p>${esc(newRealms.map(realmTitle).join(', '))}</p></section>` : ''}
    ${changes.length || newRealms.length ? `<section><h4>${icon('bot')}${esc(t('wizard.sumBots', 'The bots'))}</h4>${canPurge ? wizSwitch('reset', t('wizard.resetTitle', 'Make the random bots again'), reset && !w.reset ? t('wizard.resetForced', 'Needed by the chosen world style: the random bots are deleted and made again after a backup. Your characters and alts stay.') : t('wizard.resetText', 'Deletes the random bots and makes them again with the new settings (a backup first). Your characters and alts stay.')) : `<p class="muted">${esc(t('wizard.resetNone', 'The bots keep going as they are.'))}</p>`}</section>
    <section>${wizSwitch('start', t('wizard.startTitle', 'Start the server at the end'), t('wizard.startText', 'With every realm switched on.'))}</section>` : ''}</div>`;
}

function wizardView() {
  const w = App.state.wizard;
  const id = WIZARD_STEPS[w.step];
  const titles = { welcome: t('wizard.stepWelcome', 'Welcome'), realms: t('wizard.stepRealms', 'Realms'), style: t('wizard.stepStyle', 'World'), bots: t('wizard.stepBots', 'Bots'), xp: t('wizard.stepXp', 'Experience'), collections: t('wizard.stepCollections', 'Collections'), life: t('wizard.stepLife', 'Server life'), activities: t('wizard.stepActivities', 'Bot activities'), alts: t('wizard.stepAlts', 'Your alts'), difficulty: t('wizard.stepDifficulty', 'Difficulty'), pvp: t('wizard.stepPvp', 'PvP'), chat: t('wizard.stepChat', 'Language'), summary: t('wizard.stepSummary', 'Summary') };
  const rail = `<ol class="wiz-rail">${WIZARD_STEPS.map((step, index) => `<li class="${index === w.step ? 'current' : index < w.step ? 'done' : ''}"><i>${index < w.step ? icon('check') : index + 1}</i>${esc(titles[step])}</li>`).join('')}</ol>`;
  if (w.applying || w.done) {
    const lines = w.log.map(line => `<li class="${line.state}"><i>${line.state === 'done' ? icon('check') : line.state === 'error' ? icon('warning') : icon('refresh')}</i>${esc(line.text)}</li>`).join('');
    return `<div class="wiz-shell">${rail}<div class="wiz-main"><h3>${esc(w.done ? t('wizard.doneTitle', 'Your world is ready') : t('wizard.applyingTitle', 'Setting up your world…'))}</h3><ul class="wiz-log">${lines}</ul>
      ${w.done ? `<p class="wiz-note">${icon('info')}<span>${esc(t('wizard.doneText', 'Everything can still be changed in Server settings, and the wizard can be opened again at any time.'))}</span></p><footer class="wiz-foot"><span></span><button class="button primary" data-action="dialog-close">${esc(t('common.close', 'Close'))}</button></footer>` : ''}</div></div>`;
  }
  const last = w.step === WIZARD_STEPS.length - 1;
  return `<div class="wiz-shell">${rail}<div class="wiz-main">${id === 'welcome' ? '' : `<h3>${esc(titles[id])}</h3>`}${wizardStepView(id)}
    <footer class="wiz-foot">${w.step ? `<button class="button ghost" data-action="wiz-back">${esc(t('wizard.back', 'Back'))}</button>` : '<span></span>'}
    ${last ? (!wizardChanges(w).length && ![...w.realms].some(key => !w.created.has(key)) ? `<button class="button primary" data-action="wiz-apply">${icon('check')}${esc(t('wizard.finish', 'Close'))}</button>` : `<button class="button primary" data-action="wiz-apply">${icon('play')}${esc(t('wizard.apply', 'Apply'))}</button>`) : `<button class="button primary" data-action="wiz-next">${esc(w.step ? t('wizard.next', 'Next') : t('wizard.begin', 'Let\'s go'))}</button>`}</footer></div></div>`;
}

function wizardRender() {
  const head = dialog.header(t('wizard.title', 'Setup wizard'), t('wizard.subtitle', 'Your realm, your rules'));
  if ($('#dialog').open && $('#dialog').classList.contains('wizard-dialog')) $('#dialog-body').innerHTML = `${head}${wizardView()}`;
  else dialog.open(`${head}${wizardView()}`, 'wizard-dialog');
}

async function wizardApply() {
  const w = App.state.wizard;
  const changes = wizardChanges(w);
  const newRealms = [...w.realms].filter(key => !w.created.has(key));
  // Nothing to do: the wizard just closes (no stop, no backup, no start).
  if (!changes.length && !newRealms.length) { dialog.close(); toast(t('wizard.nothing', 'Nothing to change: your server already matches these choices.'), 'success'); return; }
  const forced = ['selffound', 'fresh'].includes(w.style) && w.style !== w.from.style;
  const reset = (forced || (w.reset && changes.length > 0)) && App.state.server?.bots?.installed && App.state.server?.canPurgeBots;
  w.applying = true;
  const step = async (text, work) => {
    const line = { text, state: 'running' };
    w.log.push(line); wizardRender();
    try { await work(); line.state = 'done'; } catch (error) { line.state = 'error'; line.text = `${text} — ${translateError(error.message)}`; throw error; } finally { wizardRender(); }
  };
  const block = event => event.preventDefault();
  $('#dialog').addEventListener('cancel', block);
  try {
    if (changes.length) await step(t('wizard.doSettings', 'Saving {n} setting(s)', { n: changes.length }), () => App.api.saveServerSettings(changes.map(({ file, key, value, kind }) => ({ file, key, value, kind })), ''));
    if (reset) {
      await step(t('wizard.doStop', 'Stopping the server'), async () => { App.state.server = await App.api.stopService('all'); });
      await step(t('wizard.doBackup', 'Backing up the databases'), () => App.api.createBackup({ label: 'wizard' }));
      await step(t('wizard.doPurge', 'Deleting the random bots (they are made again at the start)'), () => App.api.purgeBots());
    }
    for (const key of newRealms) await step(t('wizard.doRealm', 'Switching on {name}', { name: realmTitle(key) }), () => App.api.realmsCreate(key, {}));
    if (w.start) await step(t('wizard.doStart', 'Starting the server'), async () => { App.state.server = await App.api.startService('all'); });
    w.done = true;
  } catch { w.done = true; }
  finally {
    w.applying = false;
    $('#dialog').removeEventListener('cancel', block);
    App.state.pending = {};
    await loadConf();
    if (typeof loadRealms === 'function') loadRealms();
    wizardRender();
  }
}

Object.assign(App.actions, {
  'setup-wizard': button => guard(async () => {
    if (!App.state.conf || App.state.conf.error) await loadConf();
    if (typeof loadRealms === 'function' && !App.state.realms) await loadRealms();
    markSeen('wizard');
    App.state.wizard = wizardStart();
    wizardRender();
  }, button),
  'wiz-next': () => { const w = App.state.wizard; w.step = Math.min(WIZARD_STEPS.length - 1, w.step + 1); wizardRender(); },
  'wiz-back': () => { const w = App.state.wizard; w.step = Math.max(0, w.step - 1); wizardRender(); },
  'wiz-pick': button => { const w = App.state.wizard; const { field, value } = button.dataset; w[field] = field === 'bots' || field === 'xp' ? Number(value) : value; wizardRender(); },
  // The two ways of life set the three little rules at once.
  'wiz-life': button => { const w = App.state.wizard; Object.assign(w, button.dataset.value === 'comfort' ? { flights: true, money: '100000', wear: false } : { flights: false, money: '0', wear: true }); wizardRender(); },
  'wiz-realm': button => { const w = App.state.wizard; const key = button.dataset.key; if (w.realms.has(key)) w.realms.delete(key); else w.realms.add(key); wizardRender(); },
  'wiz-apply': button => guard(() => wizardApply(), button),
});
document.addEventListener('change', event => {
  const field = event.target.dataset?.wizField;
  if (!field || !App.state.wizard) return;
  App.state.wizard[field] = event.target.type === 'checkbox' ? event.target.checked : event.target.value;
  if (WIZARD_STEPS[App.state.wizard.step] === 'summary') wizardRender();
});
// The red dots of the wizard go away for good as soon as its button is hovered (or opened).
document.addEventListener('mouseover', event => {
  if (!event.target.closest?.('[data-action="setup-wizard"]') || !isNew('wizard')) return;
  markSeen('wizard');
  $$('[data-action="setup-wizard"] .dot, .conf-tab[data-id="presets"] .dot').forEach(dot => dot.remove());
  if (!isNew('settings')) $$('.tab[data-tab="server"] .dot, .subtab[data-id="settings"] .dot').forEach(dot => dot.remove());
});
