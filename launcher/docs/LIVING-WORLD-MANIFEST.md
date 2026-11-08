# Living world manifest

The launcher's **Living world** tab is built from one file: `launcher/src/data/living-world.json`.
To add an option to the tab, add an entry to that file. The interface code does not change.

The launcher reads the manifest at start (`src/catalog.cjs`) and adds its options to the server settings catalog.
Each group of the manifest becomes a tab under the **Living world** section of *Server settings*.
A tab only shows when the player's server has the `.conf` file of at least one of its options. A module that is not
installed shows nothing.

## The rule: a player's value is never changed

- Every option has a `default`. An option missing from the player's `.conf` is shown at that default, and its line is
  written only when the player changes it.
- An option already in the player's `.conf` is shown at the player's value, whatever the default says.
- A launcher update may add options. It never rewrites a value: changing a `default` in the manifest only changes what
  is shown for players who never set the option.
- New living world features are **off by default**: `default` is the value that keeps the feature off. The launcher
  enforces it: an option whose key ends in `.Enable` or `.Enabled` with a default other than 0/false is refused,
  unless its key is listed in `onByDefault`. That exception is only for a sub-switch under a master switch: the
  sub-switch needs `idleWhen` on a master whose default is 0 (it shows greyed and does nothing until the player turns
  the master on). Example: the Scourge, Legion and Ahn'Qiraj invasions under `CoaWorld.Invasions.Enable`.

## Format

```json
{
 "schema": 1,
 "onByDefault": [],
 "groups": [
  { "id": "lw-invasions", "icon": "swords", "label": { "en": "Invasions", "fr": "Invasions" } }
 ],
 "options": [
  {
   "key": "Living.Invasions.Enable",
   "file": "mod_living_world.conf",
   "group": "lw-invasions",
   "type": "bool",
   "default": 0,
   "when": "restart",
   "label": "Invasions",
   "help": "Off by default. On: elite groups attack a zone of the world from time to time."
  },
  {
   "key": "Living.Invasions.IntervalMinutes",
   "file": "mod_living_world.conf",
   "group": "lw-invasions",
   "type": "int",
   "default": 120,
   "min": 30,
   "max": 1440,
   "when": "reload",
   "label": { "en": "Minutes between two invasions", "fr": "Minutes entre deux invasions" }
  }
 ]
}
```

### Groups

| Field | Required | Meaning |
|---|---|---|
| `id` | yes | Unique id. Prefix it with `lw-`. It must not be the id of an existing group. |
| `label` | yes | A text (see Texts below). |
| `icon` | no | One of the launcher icons: `swords`, `chat`, `map`, `home`, `coin`, `gift`, `trophy`, `globe`, `shield`, `star`, `bot`, `user`, `heart`, `cart`, `book`, `bell`… Default: `globe`. |

The groups already declared, and what goes in them:

| Group | Contents |
|---|---|
| `lw-invasions` | World events (tab "World events"): invasions, gold rushes. |
| `lw-social` | Social bots, and the bot souls of 3.0 (no LLM): the share of each of the 5 archetypes (20/40/20/10/10 by default). |
| `lw-travellers` | Travellers. |
| `lw-citylife` | City life. |
| `lw-economy` | Economy and AHBot. |
| `lw-crafting` | Crafting on order. |
| `lw-population` | Population by time of day, density around the players, budget of borrowed bots (for example 10 %, at most 120). |
| `lw-pvp` | World PvP, duels, defence of the capitals. |
| `lw-loot` | Fine loot rules ("Bots need items" is the first one). |

Add a group only for a new family of features. The LLM options come with 3.1, not before.

### Options

| Field | Required | Meaning |
|---|---|---|
| `key` | yes | The exact key of the `.conf` file (letters, digits, `_` and `.`). |
| `file` | yes | The name of the `.conf` file, for example `mod_living_world.conf` or `playerbots.conf`. The launcher finds it in `Core/configs/modules` or `CoA-Bots/Core/configs/modules`, as well as `worldserver.conf` and `coa.conf` (through their template). |
| `group` | yes | The `id` of a group of this manifest. |
| `type` | yes | `bool` (0/1, shown as a switch), `int`, `float`, `choice` (a list), `text` (written between quotes), `ids` (numbers separated by commas). |
| `default` | yes | The value the module uses when the line is absent (the one in its `.conf.dist`). For `bool`, 0 or 1 (`false`/`true` are read as 0/1). `text` and `ids` may default to `""`. For `choice`, one of the `choices`. Within `min`/`max`. |
| `min`, `max` | no | Bounds for `int` and `float`. The launcher refuses a value outside them. |
| `choices` | for `choice` | `[{ "value": 1, "label": "Greed" }, …]`. |
| `onlyWhen` | no | `{ "key": "…", "values": [2] }`: the option is shown only while that `bool` or `choice` setting holds one of these values (hidden otherwise). Example: the list of family names, shown only when the surname mode is 2. |
| `idleWhen` | no | `{ "key": "…", "values": [0, 2] }`: the option has no effect while that `bool` or `choice` setting holds one of these values (shown greyed). Example: "Bots identify themselves", always on when the surname is not "Bot". One of `onlyWhen` / `idleWhen` per option. |
| `hidden` | no | `true`: the option is checked but not shown to the players yet (a feature waiting for a decision, for example the built-in AH bot while mod-ah-bot-plus is in the core). Remove it to show the option. |
| `when` | no | When the change applies: `restart` (default), `reload` (`.reload config`, no restart) or `new-bots` (only for bots made after the change). |
| `label` | yes | The name of the option (see Texts below). Short, without a final period. |
| `help` | no | The tooltip: what Off and On do, and what the default is. |

### Texts

A text is either a plain English string, or an object `{ "en": "…", "fr": "…", "ru": "…", "zh": "…" }` in which only
`en` is required. A missing language shows the English text. The Launcher session adds the translations.

## What the launcher refuses

An option is left out (never guessed) when:

- its `key`, `file`, `group`, `type` or `label` is missing or wrong;
- it has no `default`, or a `default` outside its bounds or its choices;
- it is a `.Enable`/`.Enabled` switch on by default and not listed in `onByDefault`;
- it is listed in `onByDefault` without an `idleWhen` on a master switch off by default;
- its key is already in the catalog.

The test `launcher/test/living-world.test.cjs` fails when an option of the shipped manifest is refused. Run it after
each change:

```
node --test "test/*.test.cjs"
```

## An existing key with new values

A key already shipped in the published `.conf` files (for example `AiPlayerbot.CoaBotSurname`, 0/1 until 3.0, 0/1/2 in
3.0) goes in the manifest with all its values. The player's 0 or 1 is shown and kept; the new value is one more
choice. A key of the main catalog (`server-settings.json`) cannot be declared again here: move it out of the catalog
into the manifest (the launcher reads the player's value either way).

## Packs: recommended values in one click

A pack is a set of recommended values of the manifest's options. Its card shows at the top of the Living world tabs.

```json
"packs": [
 {
  "id": "living",
  "title": { "en": "Living world, recommended", "fr": "Monde vivant recommandé" },
  "summary": "Invasions every two hours, travellers and city life on.",
  "changes": { "Living.Invasions.Enable": 1, "Living.Invasions.IntervalMinutes": 120 }
 }
]
```

- `id`: lowercase letters, digits and `-`. `title` is required, `summary` optional (Texts as above).
- `changes`: only keys of this manifest's options, each value fitting its option (0/1, one of the choices, within
  min/max, no quotes). A pack with one wrong key or value is refused whole. A pack may turn features on: that is its
  purpose, and the player chooses it.
- **Prepare** puts the values among the unsaved changes, as the "Ready-made settings" cards do: the player sees them,
  then saves or discards. Nothing is written before Save. A pack is never applied by itself (install, update, start).
- **Go back**: when the pack is saved, the launcher keeps the value each key had before (in
  `.coa-launcher/living-pack-undo.json`, per realm). "Go back" prepares those values again, saved the same way. Saving the
  pack a second time keeps the values of the first time.
- On a server without some of the keys, the pack shows with the keys it has; a pack with none of them is hidden.

## Who does what

- **Builder:** adds each option of the module to `living-world.json` as the work lands (key, file, type, default, bounds,
  English label and help), and gives the Launcher session the commit.
- **Launcher:** checks the manifest (tests), adds the translations, and ships it with the next launcher.
