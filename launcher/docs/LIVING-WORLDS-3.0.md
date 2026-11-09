# The three worlds of 3.0

At the first launch (and at the first launch of 3.0 for a player who updates), the launcher offers three
ready-made worlds. The same three cards stay in *Server settings > Presets > Ready-made settings*. Nothing applies by
itself: a card prepares values among the unsaved changes (Save or Discard), or asks before creating a realm.

| Card | What it does | State |
|---|---|---|
| **Classic** | Every Living world option back to its default: the bots as before 3.0. Pack `classic`, made by the launcher from the manifest (never written in it), so a new option is in it at once. | Done |
| **Living server** | Pack `living`: every shown switch of the manifest on (live, world, economy, artisans and craft orders, group combat), bots keep their bags (`RefreshClearsInventory = 0`), surname "None", Need on real upgrades (`LootNeedRollLevel = 2`); numbers stay at their defaults. Not in it: the merged AH bot and its options (hidden while mod-ah-bot-plus is in the core) and Server first (meant for a new realm). User's decision, 08/11: "we put EVERYTHING in for now", trimmed only if the consumption measure demands it. Classic does not touch the bags. | Done |
| **New living server** | A new realm beside the others, opening like an official server: mode `living` of src/realms.cjs, its own values from `livingOwn()`. Offered once the update tool of CoA Bots knows its databases. | Coded (local), waiting for the Builder's part |

### What the Living pack leaves out, and what is provisional (Pilote, 09/11)

- Left out: Need on epics only (user's decision: Need on a real upgrade, `LootNeedMinUpgradePct = 10`), the
  *Performance (many bots)* switches (technical, until their A/B bench), Pursuit stop and Telegraph (worse dungeon runs
  on the NUC bench: SFK 4/6 with 11 deaths instead of 6/6, Stockade mythic 3/6 instead of 5/6), Off-tank (two bot
  tanks fight over a monster without a Main Tank bar).
- In it, provisional until the Dungeon Clear raid bench: Breath guard, Stuck combat, Combat purge, Sunken Temple,
  Molten Core (11/11 so far), Blackwing Lair, Zul'Gurub, Ahn'Qiraj, Call of the Grave, Player led. They did no worse so
  far. Before the release the Pilote reviews the pack with the raid bench numbers; those not proven are taken out.

The choice window shows once (`livingChoice` in `public/js/core.js`). "Decide later" closes it; the cards stay in
Ready-made settings. A pack saved can be undone with "Go back" (see LIVING-WORLD-MANIFEST.md).

## New living server: design (coded on branch 3.0)

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
   - `AiPlayerbot.CoaWorld.ServerFirst.Enable = 1` (server first announcements, made for a new realm);
   - the **Solo self-found (1-59)** preset as it is (recipe `self-found-world`: CoaSelfFound, its max level, its share
     of bots, the XP rate, Dungeon Clear's self-found groups). Nothing is made again;
   - the values of the **Living server** pack (`living`);
   - the economy, as proposed by CoA Economie (08/11): an auction house that fills up gradually, is never empty and
     has no epics at first:
     - `playerbots.conf`: `CoaEconomy.Filter.Enable`, `Buyer.Enable`, `Market.Enable`, `Rarity.Enable`,
       `LaunchCurve.Enable`, `RpgSell.Enable`, `BotAuctions.Enable`, `Artisans.Enable`, `CraftOrders.Enable` = 1
       (CraftOrders with `CoaLive.Enable = 1`), `RefreshClearsInventory = 0`;
     - the launch curve tuned for a new realm (not in the manifest, written as the realm's own values):
       `CoaEconomy.LaunchCurve.LevelMargin = 5` (more choice on day 1), `StartStockPercent = 15` (never empty),
       `LaunchPremiumPercent = 100` (x2 at start); the other LaunchCurve keys stay as in the .dist (RareFromLevel 20,
       EpicFromLevel 50, AllowLegendary 0, FrontPercentile 80, TopCount 3, MinPopulation 20);
     - `mod_ahbot.conf`: `AuctionHouseBot.Enable = 1`, `AuctionHouseBot.EnableSeller = 1`,
       `AuctionHouseBot.Buyer.Enabled = 1`; MinItems/MaxItems as in the CoA preset (the launch curve scales them).
3. Imposed by the mode: `CoaFreshStart.Enable = 1`, the launch curve (`CoaEconomy.LaunchCurve.Enable = 1`), the
   databases, ports and bot prefix. The merged AH bot (`CoaEconomy.AHBot.Enable = 1`) joins only once mod-ah-bot-plus
   is out of the core (the Pilote's call): both at once would double the auction house.

The number of bots is not a new default: the realm takes what the Solo self-found preset gives (the preset does not
set a count today, so the usual realm count of `create()` applies). It will be adjusted with the A/B bench figures
(500 bots measured).

### The creation window

The "New living server" card opens a window that says what will be made (a realm, two databases of a few MB, one
more world running: about 1.5 to 2.5 GB of RAM with 150 bots), asks for the name, then creates it with progress
lines (the `notify` of `create()`). At the end, the realm shows in the Realms tab, started at the next start of the
server (autostart, as the other realms). Going back: switch the realm off (`setDisabled`). Deleting its databases is
left to the player.

### The hook for the update tool

The card and the Realms tab offer the realm only when `CoA-Bots/coa_common.py` lists `acore_characters_living` (`updaterKnows()`, as for the other realms). Until the Builder adds `acore_characters_living` and `acore_playerbots_living` there, the card stays greyed ("Coming soon") and `create()` refuses. The tests use a mock `coa_common.py` that lists them.

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
