# Launcher release notes for CoA Bots 3.0 (draft)

Draft of the GitHub release text of the launcher that ships with CoA Bots 3.0 (English, published with the release;
nothing is published without the user's go). Lines are added as the 3.0 work lands.

## Changes

- The old AH bot module is replaced by SquidBots-AH, with our recommended settings. The Modules tab shows
  SquidBots-AH on a CoA Bots 3.0 server; the old module (mod-ah-bot-plus) is no longer shown.
- Living world: a new section of Server settings with the options of SquidBots, the world, the economy and group
  combat, and three ready-made worlds at the first launch: Classic, Living server, New living server.
- The launcher's own update: a host that is down no longer shows an error; the launcher tries again later.
- Two-socket machines (several NUMA nodes): the world and MySQL now stay on one node (the one with the most free memory,
  or the one chosen in Services), which avoids ticks several times slower. Nothing changes on a one-node PC.
