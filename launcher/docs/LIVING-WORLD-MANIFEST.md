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
- New living world features are **off by default**: `default` is the value that keeps the feature off.

## Format

```json
{
 "schema": 1,
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

The groups already declared are `lw-invasions`, `lw-social`, `lw-travellers`, `lw-citylife`, `lw-economy`,
`lw-crafting` and `lw-loot`. Add a group only for a new family of features.

### Options

| Field | Required | Meaning |
|---|---|---|
| `key` | yes | The exact key of the `.conf` file (letters, digits, `_` and `.`). |
| `file` | yes | The name of the `.conf` file, for example `mod_living_world.conf` or `playerbots.conf`. The launcher finds it in `Core/configs/modules` or `CoA-Bots/Core/configs/modules`, as well as `worldserver.conf` and `coa.conf` (through their template). |
| `group` | yes | The `id` of a group of this manifest. |
| `type` | yes | `bool` (0/1, shown as a switch), `int`, `float`, `choice` (a list), `text` (written between quotes), `ids` (numbers separated by commas). |
| `default` | yes | The value the module uses when the line is absent (the one in its `.conf.dist`). For `bool`, 0 or 1. For `choice`, one of the `choices`. Within `min`/`max`. |
| `min`, `max` | no | Bounds for `int` and `float`. The launcher refuses a value outside them. |
| `choices` | for `choice` | `[{ "value": 1, "label": "Greed" }, …]`. |
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
- its key is already in the catalog.

The test `launcher/test/living-world.test.cjs` fails when an option of the shipped manifest is refused. Run it after
each change:

```
node --test "test/*.test.cjs"
```

## Who does what

- **Builder:** adds each option of the module to `living-world.json` as the work lands (key, file, type, default, bounds,
  English label and help), and gives the Launcher session the commit.
- **Launcher:** checks the manifest (tests), adds the translations, and ships it with the next launcher.
