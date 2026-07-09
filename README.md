# SOS Level Editor v1.0

A browser-based level editor for **Sink or Swim** (DOS, 1993, Zeppelin Games) —
built entirely from reverse-engineered file formats and game logic. No
official documentation, SDK, or source code was used; everything here was
figured out from scratch by analyzing the game's files and disassembling its
executable.

**Made by DarkSoL** — reverse engineering, DOSBox-X debugging, and this
editor were done by DarkSoL with the help of the **Claude** AI (Anthropic).
Discord: **darksol41**

<sup>If you’d like to support me financially, BTC address: bc1qp476rmcaapl6n6xjvg2la50cfw3kwvxe8sj0m5

---

## What this is

Sink or Swim stores its 60 levels as simple `MAPxx.DAT` tile-grid files, but
the *behavior* of interactive objects (switches, conveyors, the exit, the
Cargo crate, decorative animations...) turned out to be split between the map
file and the game's executable (`GAME.EXE`) in some surprising ways. This
tool lets you:

- Open, view, and edit any `MAPxx.DAT` level file tile-by-tile.
- Paint background tiles and place recognized special objects (switches,
  conveyors, the exit, the Cargo crate, decorative animations) with the
  correct graphics for each of the 5 tilesets (BLOCKL1 / ICE / FIRE / PURPLE
  / GREEN).
- See exactly which switch is linked to which conveyor on the map, for the
  currently loaded level.
- **Patch `GAME.EXE` itself** to move existing switch↔conveyor links or add
  brand-new ones — something that can't be done by editing the map file
  alone, because that link is hard-coded into the executable per level (see
  `MECHANICS.md` for the full technical story of how this was found).

Everything runs client-side in your browser. No files are uploaded anywhere.

---

## Quick start

1. Open `editor.html` in a modern desktop browser (Chrome or Edge recommended
   — they support the File System Access API used for quick-save; other
   browsers fall back to regular download-based saving).
2. Click **Open MAPxx.DAT** and pick a level file from your game's `MAPS`
   folder (or use **New Map** to start from a blank 10-wide grid).
3. Pick a tile or object in the left palette, then click on the map to paint.
   Right-click is the eyedropper (picks up whatever is on that cell).
4. When you're done, use **Save As...** to download the edited file, or (if
   supported) **📂 Open (with quick save)** + **💾 Save to same file** to
   overwrite the original file directly without a save dialog each time.

The language selector in the toolbar switches the whole UI between English
(default) and Russian.

---

## The map canvas

- The map is always **10 tiles wide** (every one of the 60 official levels
  is) — the game hangs if you make it wider, so width editing is disabled.
  Height can be changed freely.
- Use the **Zoom** dropdown to scale the view.
- Hover any cell to see its raw value and meaning in the status bar at the
  bottom.
- **Shift + Right-click** a cell to type in a raw numeric value directly —
  useful for object types this editor doesn't have a friendly button for yet.

### Special objects (value ≥ 256)

Any cell value ≥ 256 encodes `(type << 8) | picture`. These are outlined in
pink on both the palette and the map. Recognized object types for the current
tileset are listed in the left palette, one entry per unique type, using
their real in-game picture.

### The Cargo crate

Cargo (type 128) is drawn as a real sprite (not a background tile) and always
sits **on top of** whatever background tile was already there. Just click the
Cargo swatch in the palette, then click any map cell — the editor
automatically keeps that cell's existing background tile underneath the
crate. It cannot be placed on a cell that's already a different special
object (the type byte is already taken).

### Level start point

The tile with value **177** is where the player spawns at the start of the
level (level 1 is the one exception — it plays its own submarine cutscene
instead). It's marked with a green outline and a `START` label so it's easy
to find.

### Hidden/debug tiles

Some pictures in a tileset are never used anywhere in the real 60 levels —
they're leftover animation-chain frames with no standalone meaning. These are
hidden from the normal palette to reduce clutter. Tick **Debug: show static
animation-duplicate tiles** to reveal them (shown semi-transparent).

---

## Switch → Conveyor links

This is the flagship feature. In the original game, pressing a switch doesn't
just look at nearby tiles — the game checks the switch's exact coordinates
against a lookup table **compiled into `GAME.EXE`**, per level. If you move a
switch or conveyor tile in the map file alone, the animation still plays but
nothing happens, because the EXE's table still points at the old coordinates.

### Viewing links

Once you've loaded a map, the **Switch → Conveyor Links** panel always shows
the known links for that level's number (parsed from the file name, e.g.
`MAP07.DAT` → level 7):
- Without a `GAME.EXE` loaded: a **read-only** list, sourced from the
  original, unpatched game.
- With a `GAME.EXE` loaded: the **live, editable** list, including any
  changes you've made in this session.

A dashed cyan line is drawn on the map between each switch and its target
conveyor. A red outline flags a switch whose map tile no longer matches a
real switch/conveyor type — a sign it's been moved without updating the EXE.

### Editing links

1. Load the unpacked `GAME.EXE` via **Load GAME.EXE (unpacked)** in the same
   panel (see [Getting an unpacked GAME.EXE](#getting-an-unpacked-gameexe)
   below).
2. Click **+ Add Link**, then:
   - Click the map cell where the switch should be.
   - Click the map cell for the conveyor (a yellow line follows your cursor
     while you decide).
   - Enter the conveyor's length (number of segments — usually 2 or 3).
3. To remove a link you've added, click the ✕ next to it in the list.
4. Click **Build GAME.EXE** to download a patched executable with your
   changes applied.

**Important:** when picking the conveyor cell, click its **leftmost** tile
(or **topmost**, if the conveyor is vertical) — that's the anchor point the
game uses; the remaining segments are inferred from the length you enter.

Existing (original) links can't have their numbers typed in directly, but you
can freely add new ones and remove ones you've added in this session. To
*move* an original link, add a new link at the desired new position/target
and remove the old one (or edit `GAME.EXE` again from scratch — patches are
cumulative and safe to re-load).

### Getting an unpacked GAME.EXE

The Switch → Conveyor patcher needs an **unpacked** `GAME.EXE` (the original
shipped executable is UPX-compressed). This editor does **not** include or
distribute any part of the original game — you need your own legally-owned
copy of Sink or Swim and must unpack its `GAME.EXE` yourself. It only takes a
minute:

1. Download **UPX** (the Ultimate Packer for eXecutables), a free, open-source
   tool: <https://upx.github.io/>.
2. Locate `GAME.EXE` inside your own copy of the game (typically in the
   `GAME` folder of the install).
3. Run, from a command prompt/terminal in the folder where you placed
   `upx.exe` (or with it on your `PATH`):
   ```
   upx -d GAME.EXE -o GAME_unpacked.EXE
   ```
4. Use `GAME_unpacked.EXE` both to actually run the game and to load into
   this editor's Switch → Conveyor panel — it runs identically to the
   original, DOS/DOSBox doesn't care that the file is larger unpacked.

### How the patch works (short version)

- Moving an existing switch or conveyor just overwrites its 2-byte coordinate
  in place — completely safe, no side effects.
- Adding a brand-new link is trickier under the hood (the per-level tables
  are packed with no free space) but has been fully solved and verified: the
  editor relocates other levels' tables into a confirmed-safe unused memory
  region inside the EXE, extends the edited level's table in place, and
  registers a new target record for the conveyor. See `MECHANICS.md` for the
  full, very detailed technical write-up (exact addresses, byte patterns,
  and the dead ends that didn't work).

---

## File list

| File | Purpose |
|------|---------|
| `editor.html` | Main page — layout, styling, all UI panels |
| `editor.js` | Core editor logic: map rendering, palette, tools, file I/O |
| `exe_patcher.js` | Parses and patches `GAME.EXE`'s switch↔conveyor link tables |
| `i18n.js` | English/Russian translation dictionary and language switcher |
| `tilesets_data.js` | Embedded tileset images (base64 PNG) for all 5 themes |
| `sprite1_data.js` | Embedded Cargo crate sprite |
| `object_type_info_data.js` | Auto-derived classification of all 256 possible type codes |
| `decor_objects_data.js` | Per-theme list of recognized objects and hidden/debug tiles |
| `switch_links_data.js` | Static switch↔conveyor link data from the original game (fallback when no EXE is loaded) |
| `MECHANICS.md` | Full technical deep-dive: file formats, disassembly findings, the EXE patch algorithm |
| `README.md` | This file |

---

## Known limitations

- Tested primarily on levels 1 and 2 for the EXE-patching feature; the "safe"
  memory zone used to store new data has not been exhaustively verified
  across all 60 levels and every possible game state.
- Adding a brand-new switch/conveyor pair works without "borrowing" from
  another level (see `MECHANICS.md` §10), so there's no known downside left
  — but as always with binary patching, keep a backup of your original
  `GAME.EXE` and map files before experimenting.
- Some background tile ↔ in-game appearance matches are inferred from
  pixel comparison and may not be 100% verified for every tile in every
  theme — compare with the actual game if something looks off.

---

## Credits

- **DarkSoL** (Discord: `darksol41`) — reverse engineering, DOSBox-X
  debugging, file format & EXE mechanics discovery, and this editor.
- **Claude** (Anthropic) — AI assistant used throughout the reverse
  engineering, debugging, and development process.
- **Sink or Swim** © 1993 Zeppelin Games. This is an unofficial fan tool;
  it is not affiliated with or endorsed by the original developers or
  publishers.
