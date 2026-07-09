# Sink or Swim — how level objects work (reverse engineering)

This document records everything discovered by disassembling `GAME.EXE`
(unpacked from UPX) and experimenting with the DOSBox-X debugger.

Reverse engineering, debugging in DOSBox-X, and this editor were done by
**DarkSoL** (Discord: `darksol41`) with the help of the **Claude** AI.

## 1. Map file format (MAPxx.DAT)

```
Offset 0:    "MAP." (4 bytes, signature)
Offset 4:    width  (uint16 LE)  — always 10
Offset 6:    height (uint16 LE)  — 9..32
Offset 8:    level THEME (1 byte: 0=BLOCKL1, 1=ICE, 2=FIRE, 3=PURPLE, 4=GREEN)
Offset 9..127: unused (zeros)
Offset 128:  array of width*height cells, uint16 LE
```

Verified on all 60 maps: `128 + width*height*2 == filesize`, theme is strictly 0..4.
(Note: the byte-3 theme was originally called "RED" during reverse engineering;
this editor labels it "PURPLE" — same underlying game data, only the display
name changed.)

## 2. What a cell value means

Each cell is a 16-bit word:
- **low byte = tile_id** (picture number 0..179 in the theme's tileset);
- **high byte**:
  - for plain tiles = 0;
  - for special objects (value ≥ 256) = the object's **type/behavior code**.

A theme's tileset is the concatenation of three files (e.g. BLOCKL1A+B+C =
180 tiles of 32×32, 1024 bytes each, linear; confirmed via the blitter's
`mul 0x400`).

## 3. Tile behavior — what's known and what's NOT

### 3a. Tile physics (collisions) — by PICTURE

The EXE has a table (`21CF`, one per theme) that translates a tile's picture
into a code for the collision system (solid block / ladder / slippery surface
etc). In code: `sub_17B25`, `sub_176BC`.

IMPORTANT: the codes in this table are a SEPARATE numbering system for
physics — NOT related to the high bytes of special objects from the map file
(even though some numbers coincidentally match). Don't confuse the two.

### 3b. Special objects — by HIGH byte (partially)

For cells with value ≥256, the high byte is the object's code. From real map
values: 12/13 for switches, 14/16 for conveyor halves, 20 for the exit. This
is an observation from data; the exact role of every code in the game's code
has NOT been fully traced.

## 4. The "switch → conveyor" link — SOLVED

The link is **baked into the EXE as a separate table per level** (the user
was right from the very start — these are absolute coordinates in the code,
not in the map file).

Mechanism (functions `sub_18FB9` / `sub_18FEC`):
1. The player presses a switch. Its position in the working grid = `ds:1B3Eh`.
2. `sub_18FB9` takes the level number (`ds:14FCh`, 1..60) and uses it to pick
   the link table: pointer = `cs:[(level-1)*2 - 0x6FBA]`.
3. It walks the table of `(switch_position, target_index)` records until
   `0xFFFF`. If the position matches the pressed switch, the target index is used.
4. `sub_18FEC` uses the index to find the target record `(conveyor_address,
   length/direction)` and loops through toggling the conveyor tiles' type
   (7↔14, 8↔15, 9↔16 — a difference of +7), which reverses the direction the
   player moves along the conveyor.

Coordinates in the table are in the working grid: `addr = 0x3B68 + (row-2)*20 + col*2`
(2-row offset at the top — camera). Verified: **all switch coordinates from
the EXE table exactly match switch positions in the map files** (100%).

**Why moving breaks the mechanism:** the table checks the ABSOLUTE position of
the pressed switch. Move the switch or conveyor in the editor and the position
no longer matches the record in the EXE table → the link isn't found →
"animation plays, no effect." To get a working switch in a new spot you must
edit not only the map but also this table in GAME.EXE.

### Decorative animation (not gameplay mechanics)

Besides switches/conveyors, the high byte can encode **purely visual
animation**. Every game frame the engine (`sub_1121D`) walks the whole grid
and for any cell with a non-zero high byte substitutes a frame from the
animation table (`TABLE_3CE9`, indexed by the high byte). If the high byte is
0, the cell is skipped entirely (the picture stays static). Confirmed
experimentally: a bare picture with no type code doesn't animate, one with a
code does update.

**Important:** decorative objects in different levels/themes use different
specific (type, picture) combinations — they are NOT universal across themes.
That's why the editor only shows, for each graphics set (BLOCKL1/ICE/FIRE/
PURPLE/GREEN), the decorative objects that actually occur in levels with that
theme (see `decor_objects_data.js`, `ALL_OBJECTS_BY_THEME`) — mixing objects
between themes isn't valid, they'd show the wrong/meaningless picture outside
their own graphics set.

### Conveyor direction
The tile type determines the direction the player moves on it (from `sub_167xx`):
- types **7, 8, 9** — movement one way (3 segments: left/middle/right);
- types **14, 15, 16** — the same belt, reversed direction.
A switch adds/subtracts 7, flipping the belt.

The complete link table for all 50 levels that have switches was extracted
into `switch_links.json`.

## 5. Practical takeaway for the editor

- Editing graphics and tile layout works reliably.
- Moving switches/conveyors breaks their function, because the link is baked
  in as coordinates inside GAME.EXE. To get working mechanisms in a new spot
  you must patch the link table in the EXE in sync (function addresses and
  format above).
- The editor shows the links known from the EXE for the loaded level and
  highlights an object if it's been moved off its "working" position.

## Addresses found (offsets in the unpacked GAME.EXE's code segment)

| What | Address |
|------|---------|
| Level loader/parser | `sub_11738` |
| Inspect the cell under the player (3×3) | `sub_17B25` |
| Inspect an object's surroundings | `sub_176BC` |
| Conveyor state machine | `sub_1201C` |
| "Push/press" handling | `sub_18E33` |
| Per-theme behavior table (tile→type) | pointers at `[0x21BB + theme*2]` |
| Second property table | pointers at `[0x21C5 + theme*2]` |
| Base of the level's working grid | `0x3B68` (row stride `0x14`=20, column stride 2) |

## 6. Entity sprites (SPRITE1.DAT / SPRITE2.DAT)

Besides the background tilesets (BLOCKL1/ICE/FIRE/PURPLE/GREEN), there is
**one shared** sprite file `SPRITE1.DAT`/`SPRITE2.DAT` (same format: 60 tiles
of 1024 bytes, linear) — used for **movable interactive entities** (the
player, Cargo crates, etc.), not for backgrounds. Confirmed via pixel
comparison: the Cargo crate = **SPRITE1, tile #44** (match error MSE≈200 vs
>4500 for any other tile — a confident match). Since there's only one file
(not per theme), if the crate's look changes between themes in the game, it
would be a different tile index within the same file, not a different file
(this part hasn't been fully verified).

Type **128** (called "no animation" under the old classification) is the
Cargo crate: the picture in the map file is always 0 (empty background under
it), and the real visual is drawn separately as a sprite entity.

## 7. Level start point

The tile with value **177** is the start marker: the player appears at this
point at the start of the level. The only exception is level 1, which instead
plays a separate submarine-surfacing cutscene (`sub_12155`). In the editor
such a cell is marked with an outline and a `START` label.

## 8. Cargo (type 128) sits on top of the background tile

Confirmed by the user with 24 real examples from the maps: the low byte of a
value with type 128 is NOT always 0 — it's the background tile's picture
UNDER the crate (the crate is drawn as a separate sprite on top). For example
`(128<<8)|12` — a Cargo crate sitting where the background would be tile #12.
In the editor this is implemented as a dedicated mode: clicking Cargo in the
palette automatically detects and preserves whatever tile is already under
the cursor when you place it on the map.

All 24 such objects with a non-zero background were found across all 60 maps
(see chat history) — notably MAP31/MAP45, where `tile_id=27` repeats several
times on the same map.

## 9. EXE patching: moving and adding switches/conveyors — CONFIRMED WORKING

### Final, practically-verified algorithm

**Moving an existing switch/conveyor:**
- Find its record in the level's link table (`cs:[(level-1)*2 - 0x6FBA]` gives the table's address).
- Change the coordinate in place (2 bytes). Nothing else needs to be touched.
- **Switch** coordinate formula: `addr = 0x3B68 + (row-2)*20 + col*2` (with the -2 row correction!).
- **Target/conveyor** coordinate formula: `addr = 0x3B68 + row*20 + col*2` (WITHOUT the -2 correction!) — these are different formulas, don't mix them up.
- **Works without restrictions**, no side effects found.

**Adding a new switch+conveyor pair:**
1. All 60 levels' link tables are packed **back to back** — you can't just append a record in place.
2. We tried relocating (moving) a level's table elsewhere via its pointer — **this breaks the level**, even
   with byte-identical content. The cause was found in practice: some "zero" regions of the file are not free
   memory, but working areas the game actively uses at runtime (despite being zero in the file).
3. **Working solution:** don't touch the pointer of the level being edited — instead relocate the tables of
   ALL OTHER levels into a verified free zone, and append the new record right at the original location of the
   level being edited (where the terminator used to be).
4. A separate target record is needed (conveyor address+length) — the table of such records (indices 0..135)
   is packed back-to-back with the pointer array to it (the seemingly "free" next index, 136, actually overlaps
   the first word of record idx=0 — DO NOT use it!). Working solution: "borrow" an index belonging to some other,
   currently-untested level (that level temporarily loses its own conveyor — acceptable for a targeted edit).
5. **Simply appending bytes to the end of the file doesn't work** — real-mode x86 limits a segment to 64KB, and
   the end of the file (67233 bytes) is already beyond the 64KB window addressable via `cs:`. You need to use
   free space **inside** the first 64KB.
6. Not all "zero" regions inside the file are equally safe — verified empirically (memory dump in the DOSBox-X
   debugger right after level load, before any interaction) that specifically **`0x0D799` (CS address `0xD769`,
   12040 bytes) is actively used by the game** and does NOT work. Confirmed working zone: **`0x0327F`
   (CS address `0x324F`, 2507 bytes)** — genuinely empty when checked across different levels, patching there
   reliably works both for moved objects and for new switch/conveyor pairs.

### Limitations/risks
- There's no absolute guarantee that the `0x324F` zone is NEVER used ANYWHERE (across all 60 levels, all game
  states) — only verified on levels 1 and 2. When scaling this approach to many levels it's sensible to have a
  plan B (another zone from the candidate list) in case of a collision.
- "Donor" indices (for new targets) temporarily break the original conveyor of the level whose index was
  borrowed. A clean solution without this trade-off requires expanding the target-pointer array itself, which
  needs a constant patch in the CODE (not just data) — a separate, riskier task.

## 10. FINAL working algorithm for adding new pairs (no "donors")

The previous version (section 9, with "donors") is no longer needed —
expanding the target-pointer array turned out to work completely, the first
attempt just had a sign error in the constant. Final algorithm, verified
twice in practice:

### Constants
- `0x6FBA` — used to address a level's link-table pointer:
  `pointer_address = ((level-1)*2 - 0x6FBA) & 0xFFFF`, read/write directly.
- `0x6C1E` — the original constant for addressing the target-pointer array:
  `record_address = (idx*2 - 0x6C1E) & 0xFFFF` — equivalent to `(idx*2 + 0x93E2) & 0xFFFF`
  (i.e. **the original base address of the target-pointer array = `0x93E2`**, this
  is NOT a negative number — `-0x6C1E` is just how IDA nicely displays a
  negative disp16; the actual bytes in the instruction are the plain positive
  `0x93E2`).
- The instruction with this constant appears **only once** in the code:
  `2E 8B BF E2 93` (`cs: mov di,[bx+93E2h]`), see `sub_18FEC`.

### Patch steps
1. **Levels 2..60's link tables** are relocated wholesale (byte for byte, unchanged) into the verified safe
   zone at CS address **`0x324F`** (2507 bytes, confirmed empty at runtime on levels 1 and 2 via a debugger
   memory dump). Their 59 pointers are updated (the `0x6FBA` formula).
2. **Level 1's link table** (or whichever level is being edited) stays at its ORIGINAL location (don't touch its
   pointer!) — a new record `(switch_addr, idx)` is simply appended right after the old ones, followed by a new
   `0xFFFF` terminator.
3. **The target-pointer array** (136 records) is copied wholesale into the same safe zone (right after the
   relocated level tables), with some slack (e.g. +20 new slots).
4. **Patch a SINGLE instruction in the code**: the bytes `E2 93` (the old disp16, `0x93E2`) are changed to
   `new_array_address & 0xFFFF` (instruction file offset: search for bytes `2E 8B BF`, the disp16 is the next 2
   bytes). **The sign is DIRECT, no negation** (this was the one mistake that broke everything on the first try).
5. The new index (136, 137, ...) gets its own target record (`val0=0, address, length`) in the safe zone — the
   conveyor works independently, without "borrowing" anything from other levels.

### Coordinate formulas (important not to mix up!)
- Switch: `addr = 0x3B68 + (row-2)*20 + col*2` (the `-2` row correction — camera).
- Target/conveyor: `addr = 0x3B68 + row*20 + col*2` (NO correction). Point it at
  the LEFTMOST (for horizontal) or TOPMOST (for vertical) tile of the conveyor
  — that's the anchor point; the remaining segments are built out from there
  by length.
- ~~Row 0-1 restriction~~ — it was assumed a switch couldn't be in rows 0-1 (the
  address wraps to a negative offset when `row<2`). Tested in practice and
  **disproven**: it works fine in any row, the 16-bit addressing just wraps
  around and stays consistent. Real game levels simply never place a
  switch/conveyor that high up — not because it's technically broken.

Fully confirmed in practice on levels 1 and 2 (the original switches + an
added new switch→conveyor pair, no donors, no side effects).
