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
  const groups = (living.groups || []).filter(group => group && typeof group.id === 'string' && text(group.label) && !base.groups.some(item => item.id === group.id))
    .map(group => ({ id: group.id, icon: group.icon || 'globe', label: text(group.label) }));
  const ids = new Set(groups.map(group => group.id));
  const keys = new Set(base.settings.map(setting => `${setting.file}\u0000${setting.key}`));
  const refused = [];
  const settings = [];
  for (const option of living.options || []) {
    const why = problem(option, ids, keys, new Set(living.onByDefault || []));
    if (why) { refused.push(`${option?.key || '?'}: ${why}`); continue; }
    keys.add(`${option.file}\u0000${option.key}`);
    const setting = { key: option.key, file: option.file, group: option.group, living: true, kind: TYPES[option.type], when: option.when || 'restart', default: asText(option.default), label: text(option.label) };
    if (option.help !== undefined) setting.help = text(option.help);
    if (option.min !== undefined) setting.min = option.min;
    if (option.max !== undefined) setting.max = option.max;
    if (option.type === 'choice') setting.choices = option.choices.map(choice => ({ value: String(choice.value), label: text(choice.label) }));
    if (option.onlyWhen !== undefined) setting.onlyWhen = option.onlyWhen;
    settings.push(setting);
  }
  // onlyWhen { key, values }: the option is shown only while that bool or choice setting holds one of the values. It
  // becomes the catalog's offWhen (the other values), hidden rather than greyed.
  for (const setting of [...settings]) {
    const rule = setting.onlyWhen;
    if (rule === undefined) continue;
    delete setting.onlyWhen;
    const other = [...base.settings, ...settings].find(item => item.key === rule?.key);
    const all = other?.kind === 'bool' ? ['0', '1'] : other?.kind === 'choice' ? other.choices.map(choice => String(choice.value)) : null;
    const values = Array.isArray(rule?.values) ? rule.values.map(asText) : [];
    if (!all || !values.length || values.some(value => !all.includes(value))) {
      refused.push(`${setting.key}: onlyWhen (a bool or choice key, and some of its values)`);
      settings.splice(settings.indexOf(setting), 1);
      continue;
    }
    setting.offWhen = { key: rule.key, values: all.filter(value => !values.includes(value)) };
    setting.hideOff = true;
  }
  const used = groups.filter(group => settings.some(setting => setting.group === group.id));
  return {
    ...base,
    groups: [...base.groups, ...groups],
    settings: [...base.settings, ...settings],
    sections: used.length ? [...(base.sections || []), { ...SECTION, groups: groups.map(group => group.id) }] : base.sections || [],
    refused,
  };
}

module.exports = build();
module.exports.build = build;
