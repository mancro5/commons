//! The Concert Hall (ADR 0015): its own zone behind its door on the Theater
//! block. A stage across the front (the performer stands on it), a velvet
//! backdrop, the microphone stand where you take the stage, speakers either
//! side, and rows of seats facing it with an aisle down the middle.

use super::Builder;
use commons_sim::map::MapFile;

pub fn hall() -> MapFile {
    let (w, h) = (28u16, 20u16);
    let mut b = Builder::new(w, h);
    b.rect(0, 0, w, h, "theatre_carpet");
    let door = (13u16, 2u16);
    for x in 0..w {
        b.decor(x, 0, "theatre_wall");
        if !(door.0..door.0 + door.1).contains(&x) {
            b.decor(x, h - 1, "theatre_wall");
        }
    }
    for y in 0..h {
        b.decor(0, y, "theatre_wall");
        b.decor(w - 1, y, "theatre_wall");
    }
    // Brass sconces along the back wall, either side of the stage.
    for x in [2u16, 25] {
        b.object("concert_sconce", x, 0, 1, 1, None, true);
    }
    // The backdrop and the stage in front of it (walked on: the performer
    // stands there, so it's a marker drawn flat, not a wall).
    // The microphone stands at the front of the stage: listed before the
    // stage, so a tap on it finds the microphone, not the boards.
    b.object("concert_mic", 14, 5, 1, 1, Some("Microphone"), true);
    b.object("concert_curtain", 6, 1, 16, 1, Some("Stage"), true);
    b.object("concert_stage", 6, 2, 16, 4, Some("Stage"), false);
    b.object("spot", 14, 3, 1, 1, Some("stage_spot"), false);
    // Gilded columns framing the stage, the PA stacks outside them.
    for x in [5u16, 22] {
        b.object("concert_pillar", x, 1, 1, 1, None, true);
    }
    for x in [3u16, 24] {
        b.object("concert_speaker", x, 2, 1, 2, None, true);
    }
    // The lit runner up the aisle, rows of velvet seats either side, facing the stage.
    b.rect(13, 7, 2, h - 8, "theatre_aisle");
    for y in (8..16u16).step_by(2) {
        for x in (3..12u16).chain(16..25) {
            b.decor(x, y, "theatre_seat");
        }
    }
    for (x, y) in [(1u16, 1u16), (26, 1), (1, 17), (26, 17)] {
        b.decor(x, y, "potted_plant");
    }
    // The sound desk at the back.
    b.object("concert_desk", 20, 16, 3, 1, Some("Sound desk"), true);
    b.object(
        "signpost",
        16,
        h - 3,
        1,
        1,
        Some("Concert Hall: take the stage at the microphone, and everyone in the hall hears you (16 and over)."),
        true,
    );
    b.object(
        "concert_exit",
        door.0,
        h - 1,
        door.1,
        1,
        Some("To the city"),
        true,
    );
    b.finish("Concert Hall", (13, h - 3))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_stage_the_mic_and_every_seat_can_be_reached() {
        let map = hall();
        let grid = map.grid();
        let from = (map.spawn.x, map.spawn.y);
        for to in [(14, 3), (14, 6), (3, 9), (24, 15)] {
            assert!(
                commons_sim::find_path(&grid, from, to, 100_000).is_some(),
                "{to:?} unreachable"
            );
        }
    }
}
