# The three worlds of 3.0

At the first launch (and at the first launch of 3.0 for a player who updates), the launcher offers three
ready-made worlds. The same three cards stay in *Server settings > Presets > Ready-made settings*. Nothing applies by
itself: a card prepares values among the unsaved changes (Save or Discard), or asks before creating a realm.

| Card | What it does | State |
|---|---|---|
| **Classic** | Every Living world option back to its default: the bots as before 3.0. Pack `classic`, made by the launcher from the manifest (never written in it), so a new option is in it at once. | Done |
| **Living server** | Pack `living`: every Living world brick measured on the A/B bench, on the realm as it is (characters kept). Surname "None". | Announced (`soon`), values after the bench |
| **New living server** | A new realm beside the others, opening like an official server. Design below. | Announced, design |

The choice window shows once (`livingChoice` in `public/js/core.js`). "Decide later" closes it; the cards stay in
Ready-made settings. A pack saved can be undone with "Go back" (see LIVING-WORLD-MANIFEST.md).

## New living server: design

### What the player gets

A new realm in the realm list, with its own name, beside CoA and the other realms. Same account, no character yet.
Bots from level 1 that grow with the age of the server, solo self-found, an empty auction house at the start,
"server first" announcements. The CoA realm and the other realms are not touched.

### How the launcher makes it: the multi-realm code, one more mode

`src/realms.cjs` already creates realms (Wildcard, Reborn, Free Pick). The new living server is one more entry of
`MODES`:

```js
living: {
  id: 5, name: 'Living world', prefix: 'rndlv', step: 4,
  keys: {
    // Imposed (layer 3): the launch mode of SquidBot, only on this realm.
    'playerbots.conf': {
      'AiPlayerbot.CoaFreshStart.Enable': '1',
      // An auction house filled artificially from the start, but small: level and quality caps that follow the
      // population, low quantities at first, no epics on day one.
      'AiPlayerbot.CoaEconomy.AHBot.Enable': '1',
      'AiPlayerbot.CoaEconomy.LaunchCurve.Enable': '1',
    },
  },
},
```

- **Databases** (as `create()` does today):
  - `acore_characters_living`: the schema of `acore_characters` without its rows, plus the `SEED_TABLES` only. No
    character, no guild, no auction. The auction house then fills slowly through the launch curve (below).
  - `acore_playerbots_living`: a copy of `acore_playerbots`, its bot state emptied (`playerbots_random_bots`…): the bots
    are made again with the prefix `rndlv`, at level 1 under the launch mode.
  - `acore_world` and `acore_auth` are shared: same world data, same accounts, one more line in
    `acore_auth.realmlist`.
- **Ports**: CoA's ports + `step × 100`: world 8485 and RA 3843 on a default install. `create()` refuses if a port is
  already taken by another program.
- **Realm id**: 5, or the next free id if 5 is taken (as `create()` does).
- **Name**: "Living world" by default, translated, renamed by the player in the creation window (`setRealmName`), and
  unique in the realm list.
- **Folder**: `Royaumes\living` (configs, logs), like the other realms.

### Its settings (the three layers of a realm)

1. The CoA bot server's settings of the moment (never changed by the realm).
2. The realm's own values, written once at creation and changed later by the player like any realm setting:
   - the **Solo self-found (1-59)** preset as it is (recipe `self-found-world`: CoaSelfFound, its max level, its share
     of bots, the XP rate, Dungeon Clear's self-found groups). Nothing is made again;
   - the values of the **Living server** pack (`living`);
   - the economy options (built-in AH bot, filter, buyer) once they are shown (not while mod-ah-bot-plus is in the
     core).
3. Imposed by the mode: `CoaFreshStart.Enable = 1`, the built-in AH bot with its launch curve
   (`CoaEconomy.AHBot.Enable = 1`, `CoaEconomy.LaunchCurve.Enable = 1`), the databases, ports and bot prefix.

The number of bots is not a new default: the realm takes what the Solo self-found preset gives (the preset does not
set a count today, so the usual realm count of `create()` applies). It will be adjusted with the A/B bench figures
(500 bots measured).

### The creation window

The "New living server" card opens a window that says what will be made (a realm, two databases of a few MB, one
more world running: about 1.5 to 2.5 GB of RAM with 150 bots), asks for the name, then creates it with progress
lines (the `notify` of `create()`). At the end, the realm shows in the Realms tab, started at the next start of the
server (autostart, as the other realms). Going back: switch the realm off (`setDisabled`). Deleting its databases is
left to the player.

### What other sessions must deliver first

- **CoA SquidBot**: `AiPlayerbot.CoaFreshStart.Enable` (bots created at level 1 that grow with the age of the
  server, server-first announcements), read per realm from its configs.
- **Builder / CoA Bots**: the update tool (`coa_update`) must know `acore_characters_living` and
  `acore_playerbots_living` (`updaterKnows()` refuses the creation otherwise), as for the other realms.
- **Pilote**: the values of the `living` pack, after the A/B bench.

### Rule for the implementation: never write in another realm

The creation reads `acore_characters` and `acore_playerbots` (schema, seed tables) and writes only into
`acore_characters_living`, `acore_playerbots_living`, its line of `acore_auth.realmlist` and the grants of those two
databases. The test of the creation records every SQL statement and fails on any write (INSERT, UPDATE, DELETE,
TRUNCATE, DROP, ALTER, CREATE) aimed at a database of the CoA realm or of another realm.

### Decided (Pilote, 08/11)

- Auction house at the start: a small stock that grows (LaunchCurve), not the AH bot off.
- Bot count: the Solo self-found preset as it is, no new default.
- The characters database of the new realm: schema only.

### Still to deliver

- The AH options (LaunchCurve included, in the manifest since 086ccbfc) shown once
  mod-ah-bot-plus has left the core.
