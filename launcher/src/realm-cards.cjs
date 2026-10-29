'use strict';
// The realm cards of the game's realm list (the Ascension client): for each realm its game mode, background, description
// and the expansion shown, as on the official realms (Vol'jin, Darkmoon, Bronzebeard). The choice is kept in
// Settings/realm-cards.json and written to the authserver's config before every start, like the network choice.
// The client draws a card from "name!expansion!gamemode!image!unlocked!page!index!descriptionSpell".
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

const FILE = 'Settings/realm-cards.json';
const VERSION = 1;
// Enum.RealmGameMode of the client (found on 24/10 on the LAPTOP, one value per card).
const GAME_MODES = [
  { id: 11, name: 'Conquest of Azeroth' }, { id: 6, name: 'Wildcard' }, { id: 12, name: 'Warcraft Reborn' },
  { id: 9, name: 'Free-Pick (Limited Qualities)' }, { id: 10, name: 'Build Draft' }, { id: 4, name: 'Draft' },
  { id: 5, name: 'Resolute' }, { id: 7, name: 'Felforged' }, { id: 8, name: 'Nightmare' },
];
// Interface\Glues\RealmList\<image>.blp in the client (patch-A); title: the client draws RealmTitles\<image> as the
// realm's name instead of the text name.
const IMAGES = [
  { id: 'Voljin', title: true }, { id: 'Darkmoon', title: true }, { id: 'Bronzebeard', title: true }, { id: 'Rexxar', title: true },
  { id: 'Area52', title: true }, { id: 'GrizzlyHills', title: true }, { id: 'Dawnrise', title: true }, { id: 'Elune', title: true },
  { id: 'Malfurion', title: true }, { id: 'Default', title: false }, { id: 'Thrall1', title: false }, { id: 'Thrall2', title: false },
  { id: 'Malganis', title: false }, { id: 'Archimonde', title: false }, { id: 'Alar', title: false }, { id: 'Daggerspine', title: false },
  { id: 'Pilgrims', title: false }, { id: 'HallowsEnd', title: false },
];
// Spells of the client whose description is a realm overview (Spell.dbc, read on 24/10); 0 = no text.
const DESCRIPTIONS = [
  { id: 13977864, name: 'Conquest of Azeroth (Vol\'jin / Rexxar)' }, { id: 13977904, name: 'Wildcard (Darkmoon)' },
  { id: 1397607, name: 'Warcraft Reborn (Bronzebeard)' }, { id: 13977920, name: 'Free-Pick (theorycrafting)' },
  { id: 13977862, name: 'Area 52' }, { id: 13977866, name: 'Thrall (Season 8)' }, { id: 1397605, name: 'Elune (Season 9)' }, { id: 0, name: '' },
];
const EXPANSIONS = [0, 1, 2];
const DEFAULTS = {
  expansion: 0,
  realms: {
    coa: { mode: 11, image: 'Voljin', description: 13977864, name: '', subtitle: '' },
    wildcard: { mode: 6, image: 'Darkmoon', description: 13977904, name: 'Darkmoon', subtitle: '' },
    reborn: { mode: 12, image: 'Bronzebeard', description: 1397607, name: 'Bronzebeard', subtitle: 'Warcraft Reborn' },
    dawnrise: { mode: 9, image: 'Dawnrise', description: 13977920, name: 'Dawnrise', subtitle: 'Free Pick' },
  },
};
const NAME = /^[\w '().]{0,24}$/;

function clean(value) {
  const out = { expansion: EXPANSIONS.includes(Number(value?.expansion)) ? Number(value.expansion) : DEFAULTS.expansion, realms: {} };
  for (const [key, base] of Object.entries(DEFAULTS.realms)) {
    const realm = value?.realms?.[key] || {};
    out.realms[key] = {
      mode: GAME_MODES.some(item => item.id === Number(realm.mode)) ? Number(realm.mode) : base.mode,
      image: IMAGES.some(item => item.id === realm.image) ? realm.image : base.image,
      description: DESCRIPTIONS.some(item => item.id === Number(realm.description)) ? Number(realm.description) : base.description,
      // The name of the realm list (no "-": the client cuts the name there for its subtitle).
      name: typeof realm.name === 'string' && NAME.test(realm.name.trim()) ? realm.name.trim() : base.name,
      subtitle: typeof realm.subtitle === 'string' && NAME.test(realm.subtitle.trim()) ? realm.subtitle.trim() : base.subtitle,
    };
  }
  return out;
}

// The choice saved; none yet (first start of a launcher that knows the cards): the defaults, marked as new.
async function read(root) {
  try {
    const saved = JSON.parse(await fsp.readFile(path.join(root, FILE), 'utf8'));
    return { ...clean(saved), version: Number(saved.version) || 0 };
  } catch { return { ...clean(DEFAULTS), version: 0 }; }
}

async function save(root, value) {
  const cards = { version: VERSION, ...clean(value) };
  await fsp.mkdir(path.join(root, 'Settings'), { recursive: true });
  const file = path.join(root, FILE);
  await fsp.writeFile(`${file}.tmp`, JSON.stringify(cards, null, 2));
  await fsp.rename(`${file}.tmp`, file);
  return cards;
}

// The authserver of this repack draws one image and one description per realm only from the core that reads
// RealmCards.Realm.<id>.Image / .DescriptionSpell (looked for in authserver.exe); before it, every card gets the
// realm's game mode and the expansion, with the default background and no text.
function perRealmSupported(root) {
  try { return fs.readFileSync(path.join(root, 'Core', 'authserver.exe')).includes(Buffer.from('.DescriptionSpell')); } catch { return false; }
}

// The lines written to the authserver's config: the global ones, then one block per realm id.
function configLines(cards, ids, { perRealm }) {
  const lines = { 'RealmCards.Expansion': String(cards.expansion), 'RealmCards.Image': '"Default"' };
  for (const [key, id] of Object.entries(ids)) {
    const realm = cards.realms[key];
    if (!realm || !id) continue;
    lines[`RealmCards.Realm.${id}.GameMode`] = String(realm.mode);
    if (perRealm) {
      lines[`RealmCards.Realm.${id}.Image`] = `"${realm.image}"`;
      lines[`RealmCards.Realm.${id}.DescriptionSpell`] = String(realm.description);
    }
  }
  return lines;
}

// Rewrites the RealmCards lines of a config text: the global keys in place, every per-realm line replaced by ours
// (written after RealmCards.Image).
function rewrite(text, lines) {
  let out = text.replace(/^RealmCards\.Realm\.\d+\.\w+\s*=.*(\r?\n|$)/gm, '');
  const realmLines = [];
  for (const [key, value] of Object.entries(lines)) {
    if (key.startsWith('RealmCards.Realm.')) { realmLines.push(`${key} = ${value}`); continue; }
    const pattern = new RegExp(`^(${key.replace(/\./g, '\\.')}\\s*=\\s*).*$`, 'm');
    out = pattern.test(out) ? out.replace(pattern, `$1${value}`) : `${out.replace(/\s*$/, '')}\n${key} = ${value}\n`;
  }
  const eol = out.includes('\r\n') ? '\r\n' : '\n';
  if (realmLines.length) out = out.replace(/^(RealmCards\.Image\s*=.*)$/m, `$1${eol}${realmLines.join(eol)}`);
  return out;
}

// Applied before every start: the authserver's template and its live config (a running authserver reads them
// at its next start). Returns the files changed.
async function apply(root, ids) {
  const cards = await read(root);
  if (!cards.version) return [];
  const lines = configLines(cards, ids, { perRealm: perRealmSupported(root) });
  const changed = [];
  for (const relative of ['Settings/authserver.conf.template', 'Core/configs/authserver.conf']) {
    const file = path.join(root, relative);
    const text = await fsp.readFile(file, 'utf8').catch(() => null);
    if (text === null || !/^RealmCards\.Enable/m.test(text)) continue;
    const next = rewrite(text, lines);
    if (next === text) continue;
    await fsp.writeFile(`${file}.tmp-${process.pid}`, next);
    await fsp.rename(`${file}.tmp-${process.pid}`, file);
    changed.push(relative);
  }
  return changed;
}

// The full name shown in the realm list: "Bronzebeard - Warcraft Reborn" (the client shows the part after " - "
// under the title).
const listName = realm => (realm.subtitle ? `${realm.name} - ${realm.subtitle}` : realm.name);

module.exports = { read, save, apply, clean, rewrite, configLines, perRealmSupported, listName, DEFAULTS, GAME_MODES, IMAGES, DESCRIPTIONS, EXPANSIONS, VERSION, FILE };
