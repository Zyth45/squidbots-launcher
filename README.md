# SquidBots Server (launcher)

An open-source launcher (MIT) for running a **Conquest of Azeroth server with playerbots on your own PC**.
One app installs the server from your own game client, starts and stops it, keeps it up to date and lets you tune
the bots, without editing config files by hand.

- **Install**: download [`SquidBots-Server-Setup.exe`](https://github.com/Zyth45/squidbots-updates/releases/download/launcher/SquidBots-Server-Setup.exe)
  (Windows 10/11, x64) and point it at your up-to-date Conquest of Azeroth client.
- **Discord**: help, news, bug reports and ideas: https://discord.gg/vBgHuef9k
- **Release notes**: [squidbots-updates releases](https://github.com/Zyth45/squidbots-updates/releases)

## What it does

- **Home**: start / stop the server (authserver, worldserver, MySQL), its state, the latest release notes, the
  bots' navigation maps and a live view of the bots.
- **Realms**: the main CoA realm plus extra realms you can add (Wildcard, Warcraft Reborn, Free Pick, living
  world realms), each with its own bots and settings; backups and restore, reset a world.
- **Modules**: SquidBots (mod-playerbots for CoA), Dungeon Clear and the other server modules, with their settings
  explained in four languages (English, French, Russian, Chinese). A value you changed yourself is never
  overwritten by an update.
- **Verification**: checks the server files and settings, with one-click fixes, and copies the
  versions for a bug report.
- **Settings** and **Console**: launcher options, a support report (passwords removed) and the server console.

## Updates, all signed

Every file the launcher installs or trusts from online is signed with Ed25519 (the public keys are in
`launcher.config.json`):

- **Server updates** (CoA Bots): one click, a backup is made first; your characters, bots and settings stay.
- **The launcher itself**: downloaded in the background, checked against its signature, installed on restart.
  A short "What's new" is shown once after an update.
- **Components**: the SquidBots addon (SquidBots Manager) and the dashboard are offered on the home page as
  soon as a new version is out, and installed in one click (the addon goes into your game folder too).

## No game data is distributed

The packages contain only server programs and our own code. **Everything that comes from the game is taken from your
own, up-to-date Conquest of Azeroth client, on your PC**:

1. The launcher downloads the server package (~160 MB: server executables, MySQL, Python, CoA Bots, configs, tools).
2. It extracts the game tables (DBC), terrain, cameras and buildings (vmaps) from your client with the AzerothCore
   extractors (built from the public core sources).
3. It builds the databases from the **public SQL of the CoA core** (`Conquest-of-AzerothCore/azerothcore-wotlk-coa`,
   at the commit given by the release), including its public world package, then installs the bots.
4. The bots' navigation maps (mmaps) are downloaded when they match your game (a few minutes), or built in the
   background on your PC (pause / resume on the home page).

About 30 minutes on a common PC.

## Already have a repack?

Point the launcher at your server folder: an update only brings our files. The core SQL are fetched from the public
repository at the release commit and checked file by file; your data, characters, bots and settings stay, a backup
is made first and an undo is provided.

## Layout

```
launcher/    the Electron app: src/ main process, public/ interface, test/
assembler/   coa_assemble.py (runs on the player's PC), make_base.py, sql_order.py, release_notes.py (release side)
tools/       signing and publishing: feed, launcher, updates, components, addons
```

## Build and test

```powershell
cd launcher
npm ci
npm test
node scripts/build-edition.cjs server
```

## Licences

The launcher and the assembler are MIT. The server executables are built from GPL-2.0 sources (AzerothCore and the
CoA core; sources public at the commits given in each release). MySQL, OpenSSL and Python keep their own licences.
