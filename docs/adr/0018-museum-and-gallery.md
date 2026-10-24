# ADR 0018: The Museum & Gallery

Status: accepted · 2026-10-24 · step 1 of 3

Commons needed reasons to come back that hold even when the town is quiet:
things to make, collect and be proud of, that other people see. The city
had a Museum block and a Gallery block, both "opening soon". They become
one building with a door on each block.

The rule for every part: **no content authored by the day.** What's new
each day comes from people (their paintings, their donations) and from
rules (the hour, the week, later the weather and the season), never from
someone writing a new thing for today.

## One building, two doors

- In by the **Museum** block's door, you're in the Grand Hall: the Hall of
  Fame on gilded stands, the curator's desk, and the Natural History room
  to the west.
- In by the **Gallery** block's door, you're in the Salon, with the Studio
  by the door.
- You leave by the door you choose. It's one zone (`museum`); the city's
  `door:gallery` and the building's `door:gallery` spot connect the second
  door (`place:gallery`).

## The Gallery

- **The Studio:**
  - Paint your own canvas in one of three sizes: **small 16×16, medium
    32×32 and large 64×64**. The big ones let people show real skill.
  - 32 colours (the park easels' 16, and 16 more).
  - Tools: pencil, fill, eraser, colour picker, brush size, mirror, grid,
    undo.
  - One draft per size, saved as you paint.
- **The Salon:**
  - You have **one entry per size**; a new one takes the last one's place.
    Entries retire after 28 days.
  - The walls hold 3 large, 6 medium and 12 small frames, and they **turn
    through every entry, a new set each hour**. The hour is worked out
    from the clock, so everyone sees the same wall, and your desk says
    when yours is next up ("on the wall at 15:00"). With hundreds of
    painters, everyone still gets wall time, and a reason to bring
    friends.
  - **The catalogue** shows everything on show by size, newest or most
    loved first. Nobody's work goes unseen.
- **Hearts:** one per painting per person, never for your own, and you
  can take one back.
- **The weekly theme:** one of 16, in turn ("The Lake at night", "My pet",
  …). The week's top 3 by hearts in each size go to the **Hall of Fame**
  for good, with 100, 60 or 30 coins. That's chosen once, by whoever looks
  first after the week ends (`museum_weeks`).
- **Safety:** a report takes a painting down at once until someone checks
  it. Titles go through the chat filter.

## Natural History

- Give the museum **one of each kind of fish**, from your bag.
- The first giver of each kind is named on its tank ("first given by Bo,
  24 Oct"). A tank stays empty until someone gives one, and the panel
  counts how many people have given each kind.

## Later

- **Step 2:** bug catching and mushroom foraging, and a Naturalist's
  Journal with a title for each completed section.
- **Step 3:** fossils, with personal dig spots each day, identifying,
  trading duplicates, and skeletons the town completes together.
