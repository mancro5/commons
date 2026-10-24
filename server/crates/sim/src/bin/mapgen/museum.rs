//! The Museum & Gallery (ADR 0018): one building, two doors. In from the
//! Museum block, you're in the Grand Hall, with the Hall of Fame on its
//! stands and the curator's desk; the Natural History room is to the west
//! (a tank for each kind of fish, filled by donations). In from the Gallery
//! block, you're in the Salon to the east: stands for the large, medium and
//! small paintings (they turn through every entry, hour by hour), and the
//! Studio's easels and the catalogue by its door.

use super::Builder;
use commons_sim::map::MapFile;

/// The building's size.
pub const W: u16 = 52;
pub const H: u16 = 26;
/// Tanks in the Natural History room, and the Salon's stands per size.
pub const TANKS: u16 = 16;
pub const LARGE: u16 = 3;
pub const MEDIUM: u16 = 6;
pub const SMALL: u16 = 12;
pub const FAME: u16 = 6;

pub fn building() -> MapFile {
    let mut b = Builder::new(W, H);
    b.rect(0, 0, W, H, "marble");
    // The Salon and the Studio in warm parquet; a runner through the Grand Hall.
    b.rect(29, 1, W - 30, H - 2, "parquet");
    b.rect(20, 12, 4, H - 13, "rug");
    let museum_door = (20u16, 2u16);
    let gallery_door = (45u16, 2u16);
    for x in 0..W {
        b.decor(x, 0, "library_wall");
        let door = (museum_door.0..museum_door.0 + museum_door.1).contains(&x)
            || (gallery_door.0..gallery_door.0 + gallery_door.1).contains(&x);
        if !door {
            b.decor(x, H - 1, "library_wall");
        }
    }
    for y in 0..H {
        b.decor(0, y, "library_wall");
        b.decor(W - 1, y, "library_wall");
    }
    // The rooms' walls, open at the south end so you can walk through.
    for y in 1..17 {
        b.decor(14, y, "library_wall");
        b.decor(28, y, "library_wall");
    }

    // Natural History: a tank for each kind of fish, in rows.
    for i in 0..TANKS {
        let (col, row) = (i % 4, i / 4);
        b.object(
            "fish_tank",
            2 + col * 3,
            3 + row * 4,
            2,
            1,
            Some(&i.to_string()),
            true,
        );
    }
    b.object(
        "signpost",
        7,
        19,
        1,
        1,
        Some("Natural History: one of each kind, given by the town. The first to give a kind is named on its tank."),
        true,
    );

    // The Grand Hall: the Hall of Fame's stands, the curator's desk.
    for i in 0..FAME {
        let (col, row) = (i % 3, i / 3);
        b.object(
            "fame_stand",
            16 + col * 4,
            5 + row * 5,
            2,
            1,
            Some(&i.to_string()),
            true,
        );
    }
    b.object("museum_desk", 18, 16, 6, 2, Some("Curator"), true);
    for (x, y) in [(15u16, 1u16), (27, 1), (15, 22), (27, 22)] {
        b.decor(x, y, "potted_plant");
    }

    // The Salon: large paintings at the back, then medium, then two rows of
    // small; each frame with room around it.
    for i in 0..LARGE {
        b.object(
            "salon_l",
            31 + i * 6,
            6,
            4,
            1,
            Some(&format!("l:{i}")),
            true,
        );
    }
    for i in 0..MEDIUM {
        b.object(
            "salon_m",
            31 + i * 3,
            10,
            2,
            1,
            Some(&format!("m:{i}")),
            true,
        );
    }
    for i in 0..SMALL {
        let (col, row) = (i % 6, i / 6);
        b.object(
            "salon_s",
            31 + col * 3,
            13 + row * 3,
            1,
            1,
            Some(&format!("s:{i}")),
            true,
        );
    }
    // The Studio: easels to paint at, and the catalogue of everything on show.
    for i in 0..4u16 {
        b.object("studio_easel", 31 + i * 3, 21, 1, 1, Some("Studio"), true);
    }
    b.object("art_catalogue", 47, 20, 2, 1, Some("Catalogue"), true);
    for (x, y) in [(29u16, 1u16), (50, 1), (50, 22)] {
        b.decor(x, y, "potted_plant");
    }

    // The doors out, and where you come in by each.
    b.object(
        "museum_exit",
        museum_door.0,
        H - 1,
        museum_door.1,
        1,
        Some("To the Museum block"),
        true,
    );
    b.object(
        "gallery_exit",
        gallery_door.0,
        H - 1,
        gallery_door.1,
        1,
        Some("To the Gallery block"),
        true,
    );
    b.object("spot", 45, H - 3, 1, 1, Some("door:gallery"), false);
    b.finish("Museum & Gallery", (21, H - 3))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_tank_stand_easel_and_door_can_be_reached() {
        let map = building();
        let grid = map.grid();
        let from = (map.spawn.x, map.spawn.y);
        for o in map
            .objects
            .iter()
            .filter(|o| o.kind != "signpost" && o.kind != "spot")
        {
            let to = if o.y + o.h >= map.height {
                (o.x, o.y - 1)
            } else {
                (o.x, o.y + o.h)
            };
            assert!(
                commons_sim::find_path(&grid, from, to, 100_000).is_some(),
                "{} {:?} unreachable",
                o.kind,
                o.label
            );
        }
        let count = |k: &str| map.objects.iter().filter(|o| o.kind == k).count() as u16;
        assert_eq!(
            (
                count("salon_s"),
                count("salon_m"),
                count("salon_l"),
                count("fish_tank")
            ),
            (SMALL, MEDIUM, LARGE, TANKS)
        );
    }
}
