'use strict';
// The 21 Conquest of Azeroth classes and their specializations (id, name, d = damage, h = healer, t = tank), as the
// bots module knows them (src/Ai/Coa/CoaSpecStrategies.h): the « Bot damage » settings write these names and ids.
const COA_CLASSES = [
  { id: 12, name: "Barbarian", specs: [[2, "Brutality", 'd'], [3, "Ancestry", 'd'], [1, "Headhunting", 'd']] },
  { id: 13, name: "Witch Doctor", specs: [[4, "Shadowhunting", 'd'], [6, "Brewing", 'h'], [5, "Voodoo", 'd']] },
  { id: 14, name: "Felsworn", specs: [[8, "Slayer", 'd'], [7, "Infernal", 'd'], [9, "Tyrant", 't']] },
  { id: 15, name: "Witch Hunter", specs: [[10, "Boltslinger", 'd'], [97, "Black Knight", 't'], [11, "Houndmaster", 'd'], [12, "Inquisition", 'd']] },
  { id: 16, name: "Stormbringer", specs: [[15, "Lightning", 'd'], [14, "Maelstrom", 'd'], [13, "Wind", 'd']] },
  { id: 17, name: "Knight of Xoroth", specs: [[18, "War", 'd'], [17, "Defiance", 't'], [16, "Hellfire", 'd']] },
  { id: 18, name: "Guardian", specs: [[19, "Gladiator", 'd'], [20, "Inspiration", 'd'], [21, "Vanguard", 't']] },
  { id: 19, name: "Templar", specs: [[24, "Crusader", 'd'], [22, "Oathkeeper", 't'], [23, "Zealot", 'd']] },
  { id: 20, name: "Bloodmage", specs: [[26, "Sanguine", 'd'], [27, "Accursed", 'd'], [99, "Eternal", 't'], [25, "Fleshweaver", 'h']] },
  { id: 21, name: "Ranger", specs: [[28, "Archery", 'd'], [30, "Brigand", 'd'], [29, "Farstrider", 'd']] },
  { id: 22, name: "Chronomancer", specs: [[32, "Infinite", 'd'], [33, "Artificer", 'd'], [31, "Time", 'h']] },
  { id: 23, name: "Necromancer", specs: [[35, "Animation", 'd'], [34, "Death", 'd'], [36, "Rime", 'd']] },
  { id: 24, name: "Pyromancer", specs: [[39, "Draconic", 'd'], [37, "Flameweaving", 'h'], [38, "Incineration", 'd']] },
  { id: 25, name: "Cultist", specs: [[42, "Godblade", 'd'], [41, "Corruption", 'd'], [96, "Dreadnought", 't'], [40, "Heretic", 'h']] },
  { id: 26, name: "Starcaller", specs: [[44, "Sentinel", 'd'], [100, "Moon Guard", 't'], [43, "Moon Priest", 'h'], [45, "Warden", 'd']] },
  { id: 27, name: "Sun Cleric", specs: [[46, "Piety", 'd'], [98, "Blessings", 'h'], [48, "Seraphim", 't'], [47, "Valkyrie", 'd']] },
  { id: 28, name: "Tinker", specs: [[49, "Demolition", 'd'], [51, "Invention", 'h'], [50, "Mechanics", 'd']] },
  { id: 29, name: "Venomancer", specs: [[54, "Rot", 'd'], [52, "Fortitude", 't'], [53, "Stalking", 'd'], [101, "Vizier", 'h']] },
  { id: 30, name: "Reaper", specs: [[56, "Harvest", 'd'], [57, "Domination", 't'], [55, "Soul", 'd']] },
  { id: 31, name: "Primalist", specs: [[59, "Wildwalker", 'd'], [95, "Geomancy", 'd'], [58, "Grovekeeper", 'd'], [60, "Mountain King", 't']] },
  { id: 32, name: "Runemaster", specs: [[62, "Glyphic", 'd'], [61, "Engravement", 'd'], [63, "Riftblade", 'd']] },
];
