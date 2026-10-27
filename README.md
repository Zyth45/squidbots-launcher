# SquidBots Server (launcher)

An open-source launcher (MIT) for running a **Conquest of Azeroth server with playerbots on your own PC**:
SquidBots (mod-playerbots for CoA), Dungeon Clear, three realms (Conquest of Azeroth, Wildcard, Warcraft Reborn),
backups, updates, server settings, a live dashboard and the SquidBots Lite addon.

## No game data is distributed

The packages contain only server programs and our own code. **Everything that comes from the game is taken from your
own, up-to-date Conquest of Azeroth client, on your PC**:

1. The launcher downloads the server package (~150 MB: server executables, MySQL, Python, CoA Bots, configs, tools).
2. It extracts the game tables (DBC), terrain, cameras and buildings (vmaps) from your client with the AzerothCore
   extractors (built from the public core sources).
3. It builds the databases from the **public SQL of the CoA core** (`Conquest-of-AzerothCore/azerothcore-wotlk-coa`,
   at the commit given by the release), including its public world package, then installs the bots.
4. The bots' navigation maps (mmaps) are built in the background while you play (pause / resume on the home page).

About 30 minutes on a common PC, then the navigation maps take their time in the background.

## Already have a repack?

Point the launcher at your server folder: an update only brings our files (about 60 MB). The core SQL are fetched
from the public repository at the release commit and checked file by file; your data, characters, bots and settings
stay, a backup is made first and an undo is provided.

## Layout

```
launcher/    the Electron app: src/ main process, public/ interface, test/
assembler/   coa_assemble.py (runs on the player's PC), make_base.py, sql_order.py, release_notes.py (release side)
tools/       signing and publishing: feed, launcher, updates, addons
```

## Build and test

```powershell
cd launcher
npm install
npm test
node scripts/build-edition.cjs server
```

Everything the launcher reads (feed, updates, launcher updates) is signed with Ed25519; the public key is in
`launcher.config.json`.

## Licences

The launcher and the assembler are MIT. The server executables are built from GPL-2.0 sources (AzerothCore and the
CoA core; sources public at the commits given in each release). MySQL, OpenSSL and Python keep their own licences.

Discussions: CoA Modding Community — https://discord.gg/Vhg9NktJf
