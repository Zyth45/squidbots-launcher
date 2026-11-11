# 3.0 screens plan (after the user's beta.2 screenshots, 11/11) — proposal, nothing coded

Decisions it follows (user, via the Pilote): no Classic; the living world is the base, applied as a layer on an
existing server (levels and gear untouched); SquidBots-AH on by default; one "Bot chat" switch; the Living World
realm stays in Realms; the player's real choice is the bots' gear. Open questions are listed at the end, not decided.

| Screen | Stays | Goes | New (EN text) |
|---|---|---|---|
| First launch | — | "What kind of world?" popup (3 cards) | One offer: **"New: Living World realm"** — "A fresh realm beside yours, opening like an official server: 1000 bots from level 1, self-loot, a growing auction house. Your realm is not touched." Buttons: **"Create it"** / **"Later"** (stays in Realms). |
| Realms | Living World card (realm 2) | "150 bots", "Comes with CoA Bots 2.6" | "Living World — New server: 1000 bots from level 1, self-loot." Its own bot count, editable like the other realms. |
| Server settings, left column | every setting, still editable | 30 entries at once; Classic / Living server cards at the top of the Living world tabs; Presets > Living world section; "Go back" of packs | Two levels: **Essentials** (default, 6 entries) and an **"Advanced settings"** switch that shows the 30 entries of today. |
| Essentials | — | — | 1) **Get started** (wizard) 2) **Bots** (count, levels around me) 3) **Bot gear** (Classic / Self-loot) 4) **Living world** (the "Bot chat" switch first, then one line per theme: events, guilds, economy, combat, with a link to its advanced tab) 5) **Realm and rates** 6) **Dashboard**. |
| Living world | the 9 tabs (Advanced) | pack cards | Banner: **"Bot chat"** — "Bots talk in the chat channels, greet and answer. Everything else of the living world stays on." (switch: CoaLive.Enable + Guilds.Greetings, after SquidBot confirms CoaLive.Enable only drives chat). |
| Wizard (Get started) | bot count, levels | "fresh start" = reset of the existing realm | Step **"Bot gear"**: **"Classic"** — "Bots get gear made for their level (our item level rules)." / **"Self-loot"** — "Bots only wear what they loot or craft; nothing is generated." Levels are never changed on an existing server; a fresh start is the Living World realm. |
| Modules | SquidBots-AH settings, Dungeon Clear, etc. | SquidBots-AH switch to turn it on | "SquidBots-AH — on by default" with its settings button. |
| Updates (CoA Bots 3.0) | — | — | Line shown from coa_update: "New auction house bot: SquidBots-AH replaces the old module, with our recommended settings. The old bot's auctions are cleared once; players' auctions are never touched." |

Cost: about one day (catalog and packs, server.js/realms.js/core.js, the essentials view, locales fr/ru/zh, tests),
then a beta.3 for the user's screenshots.

Open (questions put to the user, not decided here): gear already generated when an existing server goes Self-loot
(the current card rebuilds the bots at level 1); the "Recommended settings" and "Bots around my level" cards; AI gear
choice on the Living World realm; 1000 bots by default on a modest PC with two worlds running.
