'use strict';
// The settings catalog: the curated settings of server-settings.json, plus the options of the living world modules,
// read from living-world.json (docs/LIVING-WORLD-MANIFEST.md). An option of that manifest becomes a setting of its
// own tab, under the "Living world" section, with no change to the interface code.
//
// The player's values are never changed: every option has a default; an option missing from the player's .conf is
// shown at that default and its line is written only when the player changes it. A malformed option is left out
// (and said in the log of the tests), never guessed.
const BASE = require('./data/server-settings.json');
const LIVING = require('./data/living-world.json');

const TYPES = { bool: 'bool', int: 'int', float: 'float', choice: 'choice', text: 'quoted', ids: 'ids' };
const WHEN = new Set(Object.keys(BASE.when || {}));
const SECTION = { id: 'living', label: { en: 'Living world', fr: 'Monde vivant', ru: 'Живой мир', zh: '鲜活世界' } };

const text = value => (typeof value === 'string' ? { en: value } : value && typeof value === 'object' && typeof value.en === 'string' ? value : null);

// The reason an option is refused, or null.
// A switch of a new feature (a key ending in .Enable or .Enabled) ships off: a default that turns it on is refused,
// unless the manifest names the key in onByDefault.
const SWITCH = /(^|.)Enabled?$/i;
const asText = value => (value === true ? '1' : value === false ? '0' : value === undefined || value === null ? '' : String(value));

function problem(option, groups, keys, onByDefault = new Set()) {
  if (!option || typeof option !== 'object') return 'not an object';
  if (typeof option.key !== 'string' || !/^[A-Za-z0-9_.]+$/.test(option.key)) return 'key';
  if (typeof option.file !== 'string' || !/^[A-Za-z0-9_.-]+\.conf$/.test(option.file)) return 'file';
  if (!groups.has(option.group)) return `group ${option.group}`;
  if (!TYPES[option.type]) return `type ${option.type}`;
  if (option.when !== undefined && !WHEN.has(option.when)) return `when ${option.when}`;
  if (!text(option.label)) return 'label (en)';
  if (option.help !== undefined && !text(option.help)) return 'help (en)';
  if (keys.has(`${option.file}\u0000${option.key}`)) return 'key already in the catalog';
  const value = asText(option.default);
  // A text or a list may default to empty; every other type needs a value.
  if (option.default === undefined || option.default === null || (value === '' && !['text', 'ids'].includes(option.type))) return 'default';
  if (option.type === 'bool' && !['0', '1'].includes(value)) return 'default (0 or 1)';
  if (['int', 'float'].includes(option.type)) {
    const number = Number(value);
    if (!Number.isFinite(number) || (option.type === 'int' && !Number.isInteger(number))) return 'default (number)';
    if ((option.min !== undefined && number < option.min) || (option.max !== undefined && number > option.max)) return 'default (out of min/max)';
  }
  if (option.type === 'choice') {
    if (!Array.isArray(option.choices) || !option.choices.length || option.choices.some(choice => choice?.value === undefined || !text(choice.label))) return 'choices';
    if (!option.choices.some(choice => String(choice.value) === value)) return 'default (not one of the choices)';
  }
  if (SWITCH.test(option.key) && !['0', 'false'].includes(value.toLowerCase()) && !onByDefault.has(option.key)) return 'a new feature ships off (default 0), or is named in onByDefault';
  return null;
}

function build(base = BASE, living = LIVING) {
  // section: where the group's tab goes, "living" (the Living world section, by default) or "bots" (the Bots section,
  // after Dungeon Clear). A group with another section is left out, and so are its options.
  const groups = (living.groups || []).filter(group => group && typeof group.id === 'string' && text(group.label) && !base.groups.some(item => item.id === group.id) && [undefined, 'living', 'bots'].includes(group.section))
    .map(group => ({ id: group.id, icon: group.icon || 'globe', label: text(group.label) }));
  const sectionOf = Object.fromEntries((living.groups || []).filter(group => group && typeof group.id === 'string').map(group => [group.id, group.section || 'living']));
  const ids = new Set(groups.map(group => group.id));
  const keys = new Set(base.settings.map(setting => `${setting.file}\u0000${setting.key}`));
  const refused = [];
  const onByDefault = new Set(living.onByDefault || []);
  // onInCore: switches the core itself turns on (its code and conf.dist say 1). The manifest only shows that default; no
  // master is asked, as the launcher writes nothing for them.
  const onInCore = new Set(living.onInCore || []);
  const hiddenSettings = [];
  const settings = [];
  for (const option of living.options || []) {
    const why = problem(option, ids, keys, new Set([...onByDefault, ...onInCore]));
    if (why) { refused.push(`${option?.key || '?'}: ${why}`); continue; }
    keys.add(`${option.file}\u0000${option.key}`);
    const setting = { key: option.key, file: option.file, group: option.group, living: true, kind: TYPES[option.type], when: option.when || 'restart', default: asText(option.default), label: text(option.label) };
    if (option.help !== undefined) setting.help = text(option.help);
    if (option.min !== undefined) setting.min = option.min;
    if (option.max !== undefined) setting.max = option.max;
    if (option.type === 'choice') setting.choices = option.choices.map(choice => ({ value: String(choice.value), label: text(choice.label) }));
    for (const field of ['onlyWhen', 'idleWhen']) if (option[field] !== undefined) setting[field] = option[field];
    if (option.classic === false) setting.notClassic = true;
    // hidden: checked and kept in the manifest, not shown to the players yet (a feature waiting for a decision).
    if (option.hidden === true) { hiddenSettings.push(setting); continue; }
    settings.push(setting);
  }
  // onlyWhen { key, values }: the option is shown only while that bool or choice setting holds one of the values (hidden
  // otherwise). idleWhen { key, values }: the option has no effect while that setting holds one of the values (shown
  // greyed). Both become the catalog's offWhen.
  for (const setting of [...settings, ...hiddenSettings]) {
    for (const field of ['onlyWhen', 'idleWhen']) {
      const rule = setting[field];
      if (rule === undefined || (!settings.includes(setting) && !hiddenSettings.includes(setting))) continue;
      delete setting[field];
      const other = [...base.settings, ...settings, ...hiddenSettings].find(item => item.key === rule?.key);
      const all = other?.kind === 'bool' ? ['0', '1'] : other?.kind === 'choice' ? other.choices.map(choice => String(choice.value)) : null;
      const values = Array.isArray(rule?.values) ? rule.values.map(asText) : [];
      if (!all || !values.length || values.some(value => !all.includes(value)) || setting.offWhen) {
        refused.push(`${setting.key}: ${field} (a bool or choice key, and some of its values; one rule per option)`);
        for (const list of [settings, hiddenSettings]) if (list.includes(setting)) list.splice(list.indexOf(setting), 1);
        continue;
      }
      if (field === 'onlyWhen') { setting.offWhen = { key: rule.key, values: all.filter(value => !values.includes(value)) }; setting.hideOff = true; }
      else { setting.offWhen = { key: rule.key, values }; setting.idleRule = true; }
    }
  }
  // A switch of onByDefault must sit under a master switch that is off by default: an idleWhen on that master, idle at
  // its default 0. Nothing runs until the player turns the master on.
  for (const setting of [...settings, ...hiddenSettings]) {
    if (!onByDefault.has(setting.key) || !SWITCH.test(setting.key) || setting.default === '0') continue;
    const master = [...base.settings, ...settings, ...hiddenSettings].find(item => item.key === setting.offWhen?.key);
    const rule = setting.idleRule;
    if (!rule || !master || master.default !== '0' || !setting.offWhen.values.includes('0')) {
      refused.push(`${setting.key}: onByDefault needs idleWhen on a master switch off by default`);
      for (const list of [settings, hiddenSettings]) if (list.includes(setting)) list.splice(list.indexOf(setting), 1);
    }
  }
  for (const setting of [...settings, ...hiddenSettings]) delete setting.idleRule;
  const used = groups.filter(group => sectionOf[group.id] === 'living' && settings.some(setting => setting.group === group.id));
  const inBots = groups.filter(group => sectionOf[group.id] === 'bots').map(group => group.id);
  const baseSections = (base.sections || []).map(section => {
    if (section.id !== 'bots' || !inBots.length) return section;
    const at = section.groups.indexOf('dungeonclear');
    const list = [...section.groups];
    list.splice(at < 0 ? list.length : at + 1, 0, ...inBots);
    return { ...section, groups: list };
  });
  return {
    ...base,
    groups: [...base.groups, ...groups],
    settings: [...base.settings, ...settings],
    sections: used.length ? [...baseSections, { ...SECTION, groups: groups.filter(group => sectionOf[group.id] === 'living').map(group => group.id) }] : baseSections,
    // A pack may also set a key of the main catalog that a Living world option needs (for example the bots' online
    // rotation for the density); Classic is made from the manifest only, so it never touches those.
    packs: packsOf(living, settings, refused, base.settings),
    refused,
    hidden: hiddenSettings.map(setting => setting.key),
  };
}

// The reason a value does not fit a setting, or null.
function valueProblem(setting, value) {
  if (/[\r\n"]/.test(value)) return 'no quotes or line breaks';
  if (setting.kind === 'bool') return ['0', '1'].includes(value) ? null : 'expected 0 or 1';
  if (setting.kind === 'choice') return setting.choices.some(choice => choice.value === value) ? null : 'not one of the choices';
  if (['int', 'float'].includes(setting.kind)) {
    const number = Number(value);
    if (value === '' || !Number.isFinite(number) || (setting.kind === 'int' && !Number.isInteger(number))) return 'expected a number';
    if ((setting.min !== undefined && number < setting.min) || (setting.max !== undefined && number > setting.max)) return 'out of min/max';
  }
  return null;
}

// Packs: a set of recommended values of the manifest's options, prepared by one click of the player (never applied by
// itself). A pack with a key that is not an option of the manifest, or a value that does not fit, is refused whole.
// Classic: the bots as before 3.0, every Living world option back to its default (made by the launcher, never written
// in the manifest).
const CLASSIC = {
  id: 'classic',
  title: { en: 'Classic', fr: 'Classique', ru: 'Классика', zh: '经典' },
  summary: { en: 'The bots as you know them: every living world feature off (the defaults).', fr: 'Les bots comme tu les connais : toutes les fonctions du monde vivant coupées (les valeurs par défaut).', ru: 'Боты как прежде: все функции «Живого мира» выключены (значения по умолчанию).', zh: '你熟悉的机器人：所有鲜活世界功能关闭（默认值）。' },
};

function packsOf(living, settings, refused, baseSettings = []) {
    // An option with "classic": false is left out of Classic (a value the player may have set before 3.0, that Classic must
  // not reset).
  const classic = settings.filter(setting => !setting.notClassic);
  const packs = classic.length ? [{ ...CLASSIC, builtin: true, changes: Object.fromEntries(classic.map(setting => [setting.key, setting.default])) }] : [];
  for (const pack of living.packs || []) {
    if (!pack || typeof pack.id !== 'string' || !/^[a-z0-9-]+$/.test(pack.id) || !text(pack.title) || !pack.changes || typeof pack.changes !== 'object' || packs.some(item => item.id === pack.id)) {
      refused.push(`pack ${pack?.id || '?'}: id, title and changes`);
      continue;
    }
    if (pack.id === CLASSIC.id) { refused.push('pack classic: made by the launcher'); continue; }
    const changes = {};
    let why = null;
    for (const [key, raw] of Object.entries(pack.changes)) {
      const setting = settings.find(item => item.key === key) || baseSettings.find(item => item.key === key);
      const bad = setting ? valueProblem(setting, asText(raw)) : 'not an option of the manifest or the catalog';
      if (bad) { why = `${key}: ${bad}`; break; }
      changes[key] = asText(raw);
    }
    // A pack announced for later (soon) shows greyed, may be empty, and cannot be prepared.
    if (why || (!Object.keys(changes).length && pack.soon !== true)) { refused.push(`pack ${pack.id}: ${why || 'no changes'}`); continue; }
    packs.push({ id: pack.id, title: text(pack.title), summary: text(pack.summary) || { en: '' }, changes, ...(pack.soon === true ? { soon: true } : {}) });
  }
  return packs;
}

module.exports = build();
module.exports.build = build;
