# ADR 0019: Bugs, mushrooms and the Naturalist's Journal

Status: accepted · 2026-10-24 · step 2 of the Museum (ADR 0018)

Collecting needs a reason to go out today that is different from
yesterday's, even on an empty server, without anyone writing new content.
Nature does that by itself: what's out depends on the hour, the weather,
the season and the moon.

## What's out, and where

- **33 bugs** (butterflies, moths, beetles, bees, dragonflies, crickets,
  snails, spiders and more) and **21 mushrooms**, each a catalogue item
  (`bug`, ids 1000–1032; `shroom`, ids 1050–1070), from Common to Mythical.
- Each kind lives in some of five **habitats**: the Meadow, the Woods, the
  Orchard, the water's edge (pond and lake) and the Park. Each comes out:
  - at certain **hours** (any, by day, at dusk, at night);
  - in certain **weather** (any, sunny, dry, in or after rain, misty mornings);
  - in certain **seasons**.
- The Ghost Glowcap comes up only on full-moon nights.
- The rules live in `commons_sim::nature`. The weather is the client's
  own (`weatherAt`, ported bit for bit, with a test that the hashes
  match), and the moon is worked out from the date.
- **Spots:** mapgen puts 118 `forage` spots in the six green blocks:
  `bug:<habitat>` on grass, flowers or sand, and `shroom:<habitat>` beside
  trees and logs. A bug spot near water belongs to the water's edge.
- **When things turn up:**
  - Every ten minutes, each bug spot rolls (same for everyone) whether
    something's there and what, weighted by rarity, from the kinds whose
    hours, weather and season fit.
  - Mushrooms roll once per weather spell (two hours), and more often after
    rain.
  - There's always something about in every season. A test checks that
    every kind can be found somewhere, sometime.

## Catching and picking

- **Mushrooms** need nothing: walk up and pick.
- **Bugs:**
  - **The net:** you need a bug net (40 coins from the Museum's curator).
  - **Creeping up:** you can't be on wheels. Come at a run and most bugs
    may fly off.
  - **The swing:** beside the bug, a ring pulses round it. Swing when it's
    on the line; rarer bugs have a thinner line and a quicker ring. A
    miss and it's away.
- **Woozy mushrooms:** two of them, the Giggle Cap and the Wobble Puff,
  make you laugh or dance and set the world swaying for a little while.
  This is purely cosmetic and respects reduced motion.
- **No competition:** each bug or mushroom can be taken **once by each
  player** (`forage_claims`: player, spot, slot). Nobody takes one away
  from anyone else, and two friends can both catch the butterfly they
  spotted together.
- **The server decides:**
  - The client is told what's out (`GET /nature/out`, minus what you've
    already taken) and asks to take it (`POST /nature/catch`).
  - The server checks that you're in the city, that it's out at that spot in
    that slot (or the one just gone, within 45 s), that you have a net for a
    bug, and that you haven't had it already.
  - Your catch then goes into your bag through the economy, keyed for
    idempotence.
- **Selling and donating:** bugs and mushrooms sell for a little at the
  market cart (like fish) and go into the album. The museum takes one of
  each.

## The Naturalist's Journal

The album becomes the journal (the 📔 button, L).

- **Sections:** Fish, Bugs, Mushrooms and Garden, each with how many
  you've found.
- **Entries:** what you've never found is a silhouette with "???", but
  every entry shows **where and when to look** (the server's hints), so
  you know what to go after.
- **Titles:** each section has three, for a quarter, two thirds and all of
  it found:
  - Fish: Angler's Apprentice, Keen Angler, Master Angler;
  - Bugs: Bug Spotter, Bug Hunter, Entomologist;
  - Mushrooms: Mushroom Picker, Forager, Mycologist;
  - Garden: Seedling, Green Thumb, Master Gardener.
  
  Complete fish, bugs and mushrooms for "Naturalist of the Commons".
- **Also shown:** what you've given the museum (🏛), and today's weather,
  season and moon.

## Natural History

- **The cases:** the room gains four bug cases and three mushroom cases,
  nine places each, below the fish tanks.
- **Donating:** the first giver of each kind is named, and the specimen is
  pinned in its place for everyone.
- **The panel:** it has a tab for each of fish, bugs and mushrooms.

## Later

Step 3: fossils.
