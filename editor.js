// ============================================================
// SOS Level Editor — редактор карт Sink or Swim (MAPxx.DAT)
// v2: тайлы хранятся ЛИНЕЙНО (1024 байта = 32x32 подряд, БЕЗ сетки).
// Подтверждено дизассемблированием GAME.EXE: offset = tile_id * 0x400.
// ============================================================

const TILE_PX = 32;
const HEADER_MAGIC = "MAP.";
const HEADER_RESERVED_LEN = 120;
const HEADER_TOTAL_LEN = 4 + 2 + 2 + HEADER_RESERVED_LEN; // = 128
const SPECIAL_THRESHOLD = 256;

// Соответствие байта темы (offset 9 в карте) -> набор графики.
// Порядок ТОЧНО из GAME.EXE (sub_11738): 0=BLOCKL1,1=ICE,2=FIRE,3=PURPLE(было RED),4=GREEN.
const THEME_BYTE_ORDER = ["BLOCKL1", "ICE", "FIRE", "PURPLE", "GREEN"];

// Расшифрованная формула (подтверждена на ВСЕХ 1607 спец-значениях всех 60 карт:
// младший байт всегда попадает в валидный диапазон tile_id 0-179):
//   value = (type << 8) | tile_id
// tile_id -- обычный индекс фонового тайла (та же графика, что и у фона).
// type -- код типа/поведения объекта. Расшифровано пока 4 штуки:
const KNOWN_TYPES = {
  20: { label: "EXIT",    color: "#39ff6a" },
  12: { label: "SWITCH",  color: "#37e6ff" },
  14: { label: "CONV-L",  color: "#ffb238" },
  16: { label: "CONV-R",  color: "#ffb238" },
};

// Известные объекты целиком (сырое значение = (type<<8)|tile_id) -- показываются
// в той же палитре, что и обычные тайлы, отмеченные цветной рамкой.
// ПРИМЕЧАНИЕ: авто-список из ВСЕХ значений карт пробовали -- оказалось слишком
// много (284 шт, много дублей по спрайту) и не давало пользы без знания типов.
// Вернулись к małenькому списку вручную опознанных.
const KNOWN_OBJECTS = [
  { value: 5289, label: "EXIT",   color: "#39ff6a" },
  { value: 3105, label: "SWITCH", color: "#37e6ff" },
  { value: 3732, label: "CONV-L", color: "#ffb238" },
  { value: 4252, label: "CONV-R", color: "#ffb238" },
];

let state = {
  width: 10,
  height: 9,
  reserved: new Uint8Array(HEADER_RESERVED_LEN),
  tiles: new Uint16Array(10 * 9),
  currentFamily: "BLOCKL1",
  currentBrush: 0, // может быть обычным tile_id (0-179) ИЛИ сырым значением объекта (>=256)
  zoom: 2,
  loadedFileName: null,
  fileHandle: null, // FileSystemFileHandle (если открыто через File System Access API) -- для быстрого сохранения
  levelNumber: null,   // номер уровня из имени файла MAPxx — для связей из EXE
  showLinks: true,
  cargoMode: false, // если включено -- клик ставит Cargo (тип 128) поверх выбранного тайла
  linkPickMode: null,       // null | "switch" | "target" -- режим создания новой связи кликом
  linkPickSwitchCell: null, // {row,col} запомненная точка выключателя при создании связи
  linkPickMousePos: null,   // {x,y} текущая позиция курсора в px канваса -- для резиновой линии
  debugShowHiddenTiles: false, // debug: показать статичные тайлы-дубли анимации в палитре
};

const tilesetImages = {}; // family -> HTMLImageElement (вертикальный стрип 32 x (nTiles*32))

function loadTilesetImages() {
  const names = Object.keys(TILESETS);
  const promises = names.map(name => new Promise((resolve) => {
    const img = new Image();
    img.onload = () => { tilesetImages[name] = img; resolve(); };
    img.src = TILESETS[name];
  }));
  // отдельный спрайт-лист сущностей (игрок/ящики) -- НЕ фоновый тайлсет
  promises.push(new Promise((resolve) => {
    const img = new Image();
    img.onload = () => { sprite1Image = img; resolve(); };
    img.src = (typeof SPRITE1_IMAGE !== "undefined") ? SPRITE1_IMAGE : "";
    if (!SPRITE1_IMAGE) resolve();
  }));
  return Promise.all(promises);
}

let sprite1Image = null;

// --------- парсинг / сериализация файла ---------
function parseMapFile(arrayBuffer) {
  const dv = new DataView(arrayBuffer);
  const magicBytes = new Uint8Array(arrayBuffer, 0, 4);
  const magic = String.fromCharCode(...magicBytes);
  if (magic !== HEADER_MAGIC) {
    throw new Error(currentLang === "ru"
      ? `Не похоже на карту SOS: ожидалась сигнатура "MAP.", найдено "${magic}"`
      : `Doesn't look like an SOS map: expected signature "MAP.", found "${magic}"`);
  }
  const width = dv.getUint16(4, true);
  const height = dv.getUint16(6, true);
  const reserved = new Uint8Array(arrayBuffer, 8, HEADER_RESERVED_LEN);
  const expectedLen = HEADER_TOTAL_LEN + width * height * 2;
  if (arrayBuffer.byteLength < expectedLen) {
    throw new Error(currentLang === "ru"
      ? `Размер файла (${arrayBuffer.byteLength}) меньше ожидаемого (${expectedLen}) для карты ${width}x${height}.`
      : `File size (${arrayBuffer.byteLength}) is smaller than expected (${expectedLen}) for a ${width}x${height} map.`
    );
  }
  const tiles = new Uint16Array(width * height);
  for (let i = 0; i < width * height; i++) {
    tiles[i] = dv.getUint16(HEADER_TOTAL_LEN + i * 2, true);
  }
  return { width, height, reserved: reserved.slice(), tiles, themeByte: reserved[0] };
}

function serializeMapFile(st) {
  const totalLen = HEADER_TOTAL_LEN + st.width * st.height * 2;
  const buf = new ArrayBuffer(totalLen);
  const dv = new DataView(buf);
  for (let i = 0; i < 4; i++) dv.setUint8(i, HEADER_MAGIC.charCodeAt(i));
  dv.setUint16(4, st.width, true);
  dv.setUint16(6, st.height, true);
  new Uint8Array(buf, 8, HEADER_RESERVED_LEN).set(st.reserved);
  for (let i = 0; i < st.width * st.height; i++) {
    dv.setUint16(HEADER_TOTAL_LEN + i * 2, st.tiles[i], true);
  }
  return buf;
}

function setStatus(msg, isErr) {
  const el = document.getElementById("status");
  el.textContent = msg;
  el.classList.toggle("err", !!isErr);
}

// --------- палитра тайлов (линейная нарезка) ---------
function rebuildPalette() {
  const wrap = document.getElementById("tilePalette");
  wrap.innerHTML = "";
  const meta = TILESET_META[state.currentFamily];
  const n = meta ? meta.nTiles : 180;
  const hiddenList = (typeof HIDDEN_TILE_IDS_BY_THEME !== "undefined")
    ? (HIDDEN_TILE_IDS_BY_THEME[state.currentFamily] || [])
    : [];
  const hidden = new Set(hiddenList);
  const showHidden = state.debugShowHiddenTiles;

  for (let t = 0; t < n; t++) {
    if (hidden.has(t) && !showHidden) continue; // скрыт как "бессмысленный без анимации"
    const c = document.createElement("canvas");
    c.width = TILE_PX; c.height = TILE_PX;
    c.className = "swatch" + (t === state.currentBrush ? " selected" : "");
    if (hidden.has(t)) c.style.opacity = "0.5"; // показан только в debug-режиме -- отметим визуально
    drawTileToCanvas(c, state.currentFamily, t);
    if (t === 177) {
      const ctx = c.getContext("2d");
      ctx.strokeStyle = "#39ff6a";
      ctx.lineWidth = 2;
      ctx.strokeRect(1, 1, TILE_PX - 2, TILE_PX - 2);
      ctx.fillStyle = "rgba(57,255,106,0.9)";
      ctx.font = "bold 7px monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("START", TILE_PX / 2, TILE_PX / 2);
    }
    c.title = t === 177 ? (currentLang === "ru" ? "Тайл #177 -- точка старта уровня (START)" : "Tile #177 -- level start point (START)")
      : (hidden.has(t)
          ? (currentLang === "ru" ? `Тайл #${t} (статичный дубль анимации -- debug)` : `Tile #${t} (static animation duplicate -- debug)`)
          : (currentLang === "ru" ? `Тайл #${t}` : `Tile #${t}`));
    c.addEventListener("click", () => {
      state.currentBrush = t;
      state.cargoMode = false;
      rebuildPalette();
    });
    wrap.appendChild(c);
  }

  // ВСЕ спец-объекты (выключатели/конвейеры/выход/декор) -- по одному на
  // уникальный тип (старший байт), только те, что реально встречаются в
  // картах с ТЕКУЩЕЙ выбранной темой (не смешиваем с другими наборами графики)
  const themeObjects = (typeof ALL_OBJECTS_BY_THEME !== "undefined")
    ? (ALL_OBJECTS_BY_THEME[state.currentFamily] || [])
    : [];
  themeObjects.forEach(value => {
    const typeCodeObj = value >> 8;
    const rawTileId = value & 0xFF;
    const tileId = (typeCodeObj in SPECIAL_TILE_OVERRIDES) ? SPECIAL_TILE_OVERRIDES[typeCodeObj] : rawTileId;
    const beh = getCellBehavior(state.currentFamily, value);
    const isCargo = typeCodeObj === 128;
    const c = document.createElement("canvas");
    c.width = TILE_PX; c.height = TILE_PX;
    c.className = "swatch" + (value === state.currentBrush ? " selected" : "");
    c.style.border = `2px solid ${isCargo ? "#ff3b3b" : ((beh && beh.color) || "#ff2eea")}`;
    if (isCargo && sprite1Image && typeof CARGO_TILE_INDEX !== "undefined") {
      const ctx = c.getContext("2d");
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(sprite1Image, 0, CARGO_TILE_INDEX * TILE_PX, TILE_PX, TILE_PX, 0, 0, TILE_PX, TILE_PX);
    } else {
      drawTileToCanvas(c, state.currentFamily, tileId % n);
    }
    c.title = isCargo
      ? (currentLang === "ru" ? "Объект: Cargo (ящик) -- автоматически встанет поверх тайла под курсором" : "Object: Cargo (crate) -- will automatically sit on top of the tile under the cursor")
      : (currentLang === "ru" ? `Объект: ${beh ? beh.name : "спец-тип"} (значение ${value})` : `Object: ${beh ? beh.name : "special type"} (value ${value})`);
    c.addEventListener("click", () => {
      state.currentBrush = value;
      state.cargoMode = isCargo;
      rebuildPalette();
    });
    wrap.appendChild(c);
  });
}

function drawTileToCanvas(canvas, family, tileId) {
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  const img = tilesetImages[family];
  if (!img) return;
  ctx.clearRect(0, 0, TILE_PX, TILE_PX);
  ctx.drawImage(img, 0, tileId * TILE_PX, TILE_PX, TILE_PX, 0, 0, TILE_PX, TILE_PX);
}

// Любая ячейка со старшим байтом != 0 -- это спец-объект (выключатель,
// конвейер, выход, декор-анимация и т.д. -- без разделения на категории,
// все обводятся одним цветом). Имя берём из таблицы анимации GAME.EXE, если
// известно, иначе просто номер типа.
const OBJECT_OUTLINE_COLOR = "#ff2eea";
// Некоторые типы в файле карты всегда хранят картинку 0 (не несут визуальной
// информации, реальный вид не в фоновом тайле) -- задаём вручную, какой тайл
// СВОЕЙ ЖЕ темы показывать вместо этого и в палитре, и на карте.
const SPECIAL_TILE_OVERRIDES = {
  56: 82,
};

function getCellBehavior(family, value) {
  if (value >= SPECIAL_THRESHOLD) {
    const typeCode = value >> 8;
    // Раньше показывали "анимация (декор) (тип N)" для не-функциональных объектов --
    // избыточно и не несёт пользы, просто показываем тип напрямую.
    return {
      code: typeCode,
      name: currentLang === "ru" ? `тип ${typeCode}` : `type ${typeCode}`,
      color: OBJECT_OUTLINE_COLOR,
      isObject: true,
    };
  }
  return null; // обычные тайлы НЕ подсвечиваем -- их роль зависит от контекста игры
}

// В палитре объекты отдельно не выделяем поведением (значения там < 256).
function getTileBehavior(family, tileId) {
  return null;
}

// --------- рендер карты ---------
function renderMap() {
  const canvas = document.getElementById("mapCanvas");
  const dispTile = Math.round(TILE_PX * state.zoom);
  canvas.width = state.width * dispTile;
  canvas.height = state.height * dispTile;
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  const img = tilesetImages[state.currentFamily];
  const meta = TILESET_META[state.currentFamily];
  const nTiles = meta ? meta.nTiles : 180;
  const showSpecial = document.getElementById("chkShowSpecial").checked;

  for (let r = 0; r < state.height; r++) {
    for (let c = 0; c < state.width; c++) {
      const v = state.tiles[r * state.width + c];
      const dx = c * dispTile, dy = r * dispTile;
      if (v < SPECIAL_THRESHOLD) {
        const tid = v % nTiles;
        if (img) {
          ctx.drawImage(img, 0, tid * TILE_PX, TILE_PX, TILE_PX, dx, dy, dispTile, dispTile);
        }
        if (v === 177 && showSpecial) {
          // тайл-маркер точки старта игрока (кроме уровня 1 -- там своя катсцена)
          ctx.fillStyle = "rgba(57,255,106,0.85)";
          ctx.font = `bold ${Math.max(9, Math.floor(dispTile / 5))}px monospace`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText("START", dx + dispTile / 2, dy + dispTile / 2);
          ctx.strokeStyle = "#39ff6a";
          ctx.lineWidth = 2;
          ctx.strokeRect(dx + 1, dy + 1, dispTile - 2, dispTile - 2);
        }
      } else {
        // спецобъект: рисуем ИМЕННО ту картинку, что реально в файле (как в игре
        // для СВОЕЙ темы) -- не подменяем на "универсальный" кадр, потому что
        // сравнивать имеет смысл только внутри родной темы этого объекта.
        // ИСКЛЮЧЕНИЯ:
        //  - тип 128 (Cargo) -- ящик стоит ПОВЕРХ фонового тайла, младший байт
        //    при этом остаётся картинкой фона ПОД ящиком.
        //  - другие типы из SPECIAL_TILE_OVERRIDES -- в файле картинка всегда 0
        //    (не несёт визуальной информации), реальный вид задаём вручную.
        const typeCodeCell = v >> 8;
        const rawTileId = v & 0xFF;
        const tileId = (typeCodeCell in SPECIAL_TILE_OVERRIDES) ? SPECIAL_TILE_OVERRIDES[typeCodeCell] : rawTileId;
        if (typeCodeCell === 128) {
          // сначала фон под ящиком (его картинка = младший байт)
          if (img) {
            ctx.drawImage(img, 0, (rawTileId % nTiles) * TILE_PX, TILE_PX, TILE_PX, dx, dy, dispTile, dispTile);
          }
          // затем сам ящик поверх
          if (sprite1Image && typeof CARGO_TILE_INDEX !== "undefined") {
            ctx.drawImage(sprite1Image, 0, CARGO_TILE_INDEX * TILE_PX, TILE_PX, TILE_PX, dx, dy, dispTile, dispTile);
          }
        } else if (img) {
          ctx.drawImage(img, 0, (tileId % nTiles) * TILE_PX, TILE_PX, TILE_PX, dx, dy, dispTile, dispTile);
        }
        if (showSpecial) {
          const beh = getCellBehavior(state.currentFamily, v);
          const color = typeCodeCell === 128 ? "#ff3b3b" : ((beh && beh.color) ? beh.color : "#ff2eea");
          ctx.strokeStyle = color;
          ctx.lineWidth = 2;
          ctx.strokeRect(dx + 1, dy + 1, dispTile - 2, dispTile - 2);
        }
      }
      ctx.strokeStyle = "rgba(255,255,255,0.06)";
      ctx.lineWidth = 1;
      ctx.strokeRect(dx + 0.5, dy + 0.5, dispTile - 1, dispTile - 1);
    }
  }

  // Связи выключатель→конвейер из таблицы EXE (для загруженного уровня)
  drawSwitchLinks(ctx, dispTile);
  drawLinkPickOverlay(ctx, dispTile);
}

function drawLinkPickOverlay(ctx, dispTile) {
  if (!state.linkPickMode) return;
  if (state.linkPickMode === "switch") return; // ждём первый клик, рисовать пока нечего
  const sw = state.linkPickSwitchCell;
  if (!sw) return;
  const ax = sw.col * dispTile + dispTile / 2;
  const ay = sw.row * dispTile + dispTile / 2;
  // подсветка стартовой клетки
  ctx.strokeStyle = "#ffe066";
  ctx.lineWidth = 3;
  ctx.strokeRect(sw.col * dispTile + 2, sw.row * dispTile + 2, dispTile - 4, dispTile - 4);
  // резиновая линия до курсора
  if (state.linkPickMousePos) {
    ctx.strokeStyle = "rgba(255,224,102,0.85)";
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(state.linkPickMousePos.x, state.linkPickMousePos.y);
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

function drawSwitchLinks(ctx, dispTile) {
  if (!state.showLinks || !state.levelNumber) return;

  // если загружен GAME.EXE и связи распознаны для текущего уровня -- используем
  // АКТУАЛЬНЫЙ редактируемый список (editorLinks), включая только что добавленные
  // или изменённые связи. Иначе -- статичные данные из оригинальной игры.
  let links;
  if (exeBytes && Array.isArray(editorLinks)) {
    links = editorLinks.map(l => ({
      switch: [l.switchCol, l.switchRow],
      target: [l.targetCol, l.targetRow],
    }));
  } else if (typeof SWITCH_LINKS !== "undefined" && SWITCH_LINKS[state.levelNumber]) {
    links = SWITCH_LINKS[state.levelNumber];
  } else {
    return;
  }

  const center = (cell) => ({
    x: cell[0] * dispTile + dispTile / 2,
    y: cell[1] * dispTile + dispTile / 2,
  });
  for (const link of links) {
    if (!link.switch || !link.target) continue;
    const a = center(link.switch);
    const b = center(link.target);
    // линия связи
    ctx.strokeStyle = "rgba(55,230,255,0.85)";
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.setLineDash([]);
    // маркер выключателя (кружок) и цели (квадрат)
    ctx.fillStyle = "rgba(55,230,255,0.9)";
    ctx.beginPath();
    ctx.arc(a.x, a.y, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(255,178,56,0.9)";
    ctx.fillRect(b.x - 5, b.y - 5, 10, 10);

    // проверка: на месте ли выключатель (сдвинут ли с рабочей позиции)
    const swVal = state.tiles[link.switch[1] * state.width + link.switch[0]];
    if ((swVal >> 8) !== 12 && (swVal >> 8) !== 13) {
      // выключатель НЕ на своём месте — предупреждающая обводка
      ctx.strokeStyle = "#ff4d6a";
      ctx.lineWidth = 3;
      ctx.strokeRect(a.x - dispTile/2 + 2, a.y - dispTile/2 + 2, dispTile - 4, dispTile - 4);
    }
  }
}

function cellFromEvent(e) {
  const canvas = document.getElementById("mapCanvas");
  const rect = canvas.getBoundingClientRect();
  const dispTile = Math.round(TILE_PX * state.zoom);
  const x = (e.clientX - rect.left) * (canvas.width / rect.width);
  const y = (e.clientY - rect.top) * (canvas.height / rect.height);
  const col = Math.floor(x / dispTile);
  const row = Math.floor(y / dispTile);
  if (col < 0 || row < 0 || col >= state.width || row >= state.height) return null;
  return { col, row };
}

function updateFileMeta() {
  const el = document.getElementById("fileMeta");
  const specials = Array.from(state.tiles).filter(v => v >= SPECIAL_THRESHOLD);
  const known = specials.filter(v => KNOWN_TYPES[v >> 8]).length;
  if (currentLang === "ru") {
    el.innerHTML = `
      <span>Файл: <b>${state.loadedFileName || "(новая карта)"}</b></span>
      <span>Размер: <b>${state.width}&times;${state.height}</b></span>
      <span>Ячеек: <b>${state.width * state.height}</b></span>
      <span>Спецобъектов: <b>${specials.length}</b> (тип известен: ${known})</span>
    `;
  } else {
    el.innerHTML = `
      <span>File: <b>${state.loadedFileName || "(new map)"}</b></span>
      <span>Size: <b>${state.width}&times;${state.height}</b></span>
      <span>Cells: <b>${state.width * state.height}</b></span>
      <span>Special objects: <b>${specials.length}</b> (known type: ${known})</span>
    `;
  }
  document.getElementById("mapH").value = state.height;
}

function setupEvents() {
  const familySelect = document.getElementById("tilesetSelect");
  Object.keys(TILESETS).forEach(name => {
    const opt = document.createElement("option");
    opt.value = name; opt.textContent = currentLang === "ru" ? `${name} (${TILESET_META[name].nTiles} тайлов)` : `${name} (${TILESET_META[name].nTiles} tiles)`;
    familySelect.appendChild(opt);
  });
  familySelect.value = state.currentFamily;
  familySelect.addEventListener("change", () => {
    state.currentFamily = familySelect.value;
    const themeIdx = THEME_BYTE_ORDER.indexOf(familySelect.value);
    if (themeIdx >= 0) state.reserved[0] = themeIdx; // сохраняем выбор темы в файл при сохранении
    rebuildPalette();
    renderMap();
  });

  document.getElementById("zoomSelect").addEventListener("change", (e) => {
    state.zoom = parseFloat(e.target.value);
    renderMap();
  });

  document.getElementById("chkShowSpecial").addEventListener("change", renderMap);

  const chkLinks = document.getElementById("chkShowLinks");
  if (chkLinks) {
    chkLinks.addEventListener("change", () => {
      state.showLinks = chkLinks.checked;
      renderMap();
    });
  }

  const canvas = document.getElementById("mapCanvas");
  canvas.addEventListener("mousemove", (e) => {
    const cell = cellFromEvent(e);
    if (!cell) return;
    const v = state.tiles[cell.row * state.width + cell.col];
    const tileId = v & 0xFF;
    const pos = `(${cell.col},${cell.row})`;
    if (v >= SPECIAL_THRESHOLD) {
      const beh = getCellBehavior(state.currentFamily, v);
      setStatus(currentLang === "ru"
        ? `${pos} значение ${v}: картинка #${tileId}, старший байт ${v>>8}${beh ? " — " + beh.name : ""}`
        : `${pos} value ${v}: picture #${tileId}, high byte ${v>>8}${beh ? " — " + beh.name : ""}`);
    } else {
      setStatus(currentLang === "ru" ? `${pos} тайл #${v}` : `${pos} tile #${v}`);
    }
  });
  canvas.addEventListener("click", (e) => {
    const cell = cellFromEvent(e);
    if (!cell) return;
    if (state.linkPickMode) {
      handleLinkPickClick(cell);
      return;
    }
    const i = cell.row * state.width + cell.col;
    if (state.cargoMode) {
      const existing = state.tiles[i];
      if (existing >= SPECIAL_THRESHOLD) {
        // клетка уже занята другим спец-объектом -- старший байт занят, Cargo сюда нельзя
        setStatus(currentLang === "ru"
          ? `Нельзя поставить Cargo: клетка (${cell.col},${cell.row}) уже занята объектом (значение ${existing}).`
          : `Cannot place Cargo: cell (${cell.col},${cell.row}) is already occupied by an object (value ${existing}).`, true);
        return;
      }
      // Cargo (тип 128) ставится ПОВЕРХ ТОГО тайла, что уже был на этой клетке --
      // не нужно ничего выбирать заранее, фон определяется автоматически
      state.tiles[i] = (128 << 8) | (existing & 0xFF);
    } else {
      state.tiles[i] = state.currentBrush;
    }
    renderMap();
    updateFileMeta();
  });
  canvas.addEventListener("mousemove", (e) => {
    if (state.linkPickMode === "target" && state.linkPickSwitchCell) {
      const rect = canvas.getBoundingClientRect();
      state.linkPickMousePos = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      renderMap();
    }
  });
  canvas.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    const cell = cellFromEvent(e);
    if (!cell) return;
    const i = cell.row * state.width + cell.col;
    const v = state.tiles[i];

    if (e.shiftKey) {
      // Shift+ПКМ -- ручной ввод сырого числа (для нерасшифрованных типов объектов)
      const tileId = v & 0xFF, typeCode = v >> 8;
      const info = currentLang === "ru"
        ? (v >= SPECIAL_THRESHOLD
            ? `tile_id=${tileId}, тип=${typeCode}${KNOWN_TYPES[typeCode] ? " (" + KNOWN_TYPES[typeCode].label + ")" : " (неизвестен)"}`
            : `обычный тайл #${v}`)
        : (v >= SPECIAL_THRESHOLD
            ? `tile_id=${tileId}, type=${typeCode}${KNOWN_TYPES[typeCode] ? " (" + KNOWN_TYPES[typeCode].label + ")" : " (unknown)"}`
            : `plain tile #${v}`);
      const promptText = currentLang === "ru"
        ? `Сырое значение ячейки = ${v}\n(${info})\nВведите новое число (0-65535):`
        : `Raw cell value = ${v}\n(${info})\nEnter a new number (0-65535):`;
      const nv = prompt(promptText, v);
      if (nv !== null && !isNaN(parseInt(nv, 10))) {
        state.tiles[i] = Math.max(0, Math.min(65535, parseInt(nv, 10)));
        renderMap();
        updateFileMeta();
      }
      return;
    }

    // обычная пипетка -- берём то, что на клетке, текущей кистью (тайл или объект)
    state.currentBrush = v;
    rebuildPalette();
    setStatus(currentLang === "ru"
      ? (v >= SPECIAL_THRESHOLD ? `Пипетка: взят объект (значение ${v})` : `Пипетка: взят тайл #${v}`)
      : (v >= SPECIAL_THRESHOLD ? `Eyedropper: picked object (value ${v})` : `Eyedropper: picked tile #${v}`));
  });

  document.getElementById("mapH").addEventListener("change", (e) => resizeMap(10, parseInt(e.target.value, 10)));

  document.getElementById("btnNew").addEventListener("click", () => {
    const w = 10; // все 60 уровней игры имеют ширину 10 -- другая ширина зависает игру
    const promptText = currentLang === "ru" ? "Высота новой карты (тайлов):" : "Height of the new map (tiles):";
    const h = parseInt(prompt(promptText, "9"), 10) || 9;
    state.width = w; state.height = h;
    state.reserved = new Uint8Array(HEADER_RESERVED_LEN);
    state.tiles = new Uint16Array(w * h);
    state.loadedFileName = null;
    state.fileHandle = null;
    document.getElementById("btnSave").disabled = false;
    document.getElementById("btnQuickSave").disabled = true;
    renderMap();
    updateFileMeta();
    setStatus(currentLang === "ru" ? `Создана новая карта ${w}x${h}. Все ячейки — тайл #0.` : `Created a new ${w}x${h} map. All cells are tile #0.`);
  });

  const fileInputEl = document.getElementById("fileInput");
  const fileInputBtn = document.getElementById("fileInputBtn");
  const fileInputName = document.getElementById("fileInputName");
  if (fileInputBtn) fileInputBtn.addEventListener("click", () => fileInputEl.click());
  fileInputEl.addEventListener("change", (e) => {
    const f = e.target.files[0];
    if (f && fileInputName) {
      fileInputName.removeAttribute("data-i18n");
      fileInputName.textContent = f.name;
    }
  });
  document.getElementById("fileInput").addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = parseMapFile(reader.result);
        state.width = parsed.width;
        state.height = parsed.height;
        state.reserved = parsed.reserved;
        state.tiles = parsed.tiles;
        state.loadedFileName = file.name;
        state.fileHandle = null; // открыто обычным способом -- быстрое сохранение недоступно
        document.getElementById("btnSave").disabled = false;
        document.getElementById("btnQuickSave").disabled = true;

        // номер уровня из имени файла (MAP01.DAT -> 1) для показа связей из EXE
        const m = file.name.match(/MAP(\d+)/i);
        state.levelNumber = m ? parseInt(m[1], 10) : null;
        refreshEditorLinksForCurrentLevel();
        const themeName = THEME_BYTE_ORDER[parsed.themeByte];
        const themeOk = themeName && TILESETS[themeName];
        if (themeOk) {
          state.currentFamily = themeName;
          document.getElementById("tilesetSelect").value = themeName;
        }

        rebuildPalette();
        renderMap();
        updateFileMeta();
        let themeNote;
        if (currentLang === "ru") {
          themeNote = themeOk
            ? ` — тема автоопределена: ${themeName} (байт=${parsed.themeByte})`
            : ` — не удалось определить тему (байт=${parsed.themeByte}), оставлен текущий набор`;
          setStatus(`Загружено: ${file.name} (${parsed.width}x${parsed.height})${themeNote}`);
        } else {
          themeNote = themeOk
            ? ` — theme auto-detected: ${themeName} (byte=${parsed.themeByte})`
            : ` — could not detect theme (byte=${parsed.themeByte}), keeping current set`;
          setStatus(`Loaded: ${file.name} (${parsed.width}x${parsed.height})${themeNote}`);
        }
      } catch (err) {
        setStatus((currentLang === "ru" ? "Ошибка загрузки: " : "Load error: ") + err.message, true);
      }
    };
    reader.readAsArrayBuffer(file);
  });

  document.getElementById("btnSave").addEventListener("click", () => {
    const buf = serializeMapFile(state);
    const blob = new Blob([buf], { type: "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = state.loadedFileName || `MAP_new_${state.width}x${state.height}.DAT`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setStatus(currentLang === "ru" ? `Сохранено: ${a.download} (${buf.byteLength} байт)` : `Saved: ${a.download} (${buf.byteLength} bytes)`);
  });

  // File System Access API -- открытие с сохранением дескриптора файла,
  // чтобы можно было быстро перезаписать тот же файл без диалога "сохранить как"
  const fsSupported = "showOpenFilePicker" in window;
  if (fsSupported) {
    document.getElementById("fsOpenGroup").style.display = "";
    document.getElementById("btnOpenFS").addEventListener("click", async () => {
      try {
        const [handle] = await window.showOpenFilePicker({
          types: [{ description: "SOS Map", accept: { "application/octet-stream": [".dat", ".DAT"] } }],
        });
        const file = await handle.getFile();
        const buf = await file.arrayBuffer();
        const parsed = parseMapFile(buf);
        state.width = parsed.width;
        state.height = parsed.height;
        state.reserved = parsed.reserved;
        state.tiles = parsed.tiles;
        state.loadedFileName = file.name;
        state.fileHandle = handle;
        document.getElementById("btnSave").disabled = false;
        document.getElementById("btnQuickSave").disabled = false;

        const m = file.name.match(/MAP(\d+)/i);
        state.levelNumber = m ? parseInt(m[1], 10) : null;
        refreshEditorLinksForCurrentLevel();
        const themeName = THEME_BYTE_ORDER[parsed.themeByte];
        const themeOk = themeName && TILESETS[themeName];
        if (themeOk) {
          state.currentFamily = themeName;
          document.getElementById("tilesetSelect").value = themeName;
        }
        rebuildPalette();
        renderMap();
        updateFileMeta();
        if (currentLang === "ru") {
          const themeNote = themeOk ? ` — тема автоопределена: ${themeName} (байт=${parsed.themeByte})` : "";
          setStatus(`Загружено: ${file.name} (${parsed.width}x${parsed.height})${themeNote}. Готово к быстрому сохранению.`);
        } else {
          const themeNote = themeOk ? ` — theme auto-detected: ${themeName} (byte=${parsed.themeByte})` : "";
          setStatus(`Loaded: ${file.name} (${parsed.width}x${parsed.height})${themeNote}. Ready for quick save.`);
        }
      } catch (err) {
        if (err.name !== "AbortError") setStatus((currentLang === "ru" ? "Ошибка открытия: " : "Open error: ") + err.message, true);
      }
    });
  }

  document.getElementById("btnQuickSave").addEventListener("click", async () => {
    if (!state.fileHandle) return;
    try {
      const buf = serializeMapFile(state);
      const writable = await state.fileHandle.createWritable();
      await writable.write(buf);
      await writable.close();
      setStatus(currentLang === "ru"
        ? `Быстро сохранено в тот же файл: ${state.loadedFileName} (${buf.byteLength} байт)`
        : `Quick-saved to the same file: ${state.loadedFileName} (${buf.byteLength} bytes)`);
    } catch (err) {
      setStatus((currentLang === "ru" ? "Ошибка быстрого сохранения: " : "Quick save error: ") + err.message, true);
    }
  });
}

function resizeMap(newW, newH) {
  newW = 10; // все 60 уровней игры имеют ширину 10 -- другая ширина зависает игру
  newH = Math.max(1, Math.min(256, newH || state.height));
  const newTiles = new Uint16Array(newW * newH);
  for (let r = 0; r < Math.min(newH, state.height); r++) {
    for (let c = 0; c < Math.min(newW, state.width); c++) {
      newTiles[r * newW + c] = state.tiles[r * state.width + c];
    }
  }
  state.width = newW;
  state.height = newH;
  state.tiles = newTiles;
  renderMap();
  updateFileMeta();
  setStatus(currentLang === "ru" ? `Высота карты изменена на ${newH} (ширина всегда 10).` : `Map height changed to ${newH} (width is always 10).`);
}

// ============================================================
// Патч GAME.EXE: связи выключателей (использует exe_patcher.js)
// ============================================================
let exeBytes = null;       // Uint8Array исходного (не пропатченного при загрузке) GAME.EXE
let exeFileName = null;    // имя загруженного файла -- для живого обновления счётчика связей
let exeParsedState = null; // результат parseExeState()
let editorLinks = [];      // текущий редактируемый список связей для state.levelNumber

// Пересчитать editorLinks для ТЕКУЩЕГО state.levelNumber из уже загруженного EXE
// (или из статичных данных оригинальной игры, если EXE не загружен).
// Вызывается и после загрузки EXE, и после загрузки/смены карты уровня.
function refreshEditorLinksForCurrentLevel() {
  const lvl = state.levelNumber;
  editorLinks = [];
  if (!lvl) { renderLinksList(); return; }

  if (exeParsedState && exeParsedState.levels[lvl]) {
    for (const e of exeParsedState.levels[lvl].entries) {
      const swCell = cellForAddr(e.switchAddr, true);
      const tgtCell = cellForAddr(e.target.address, false);
      if (swCell && tgtCell) {
        editorLinks.push({
          idx: e.idx,
          switchCol: swCell.col, switchRow: swCell.row,
          targetCol: tgtCell.col, targetRow: tgtCell.row,
          length: e.target.length,
        });
      }
    }
  } else if (typeof SWITCH_LINKS !== "undefined" && SWITCH_LINKS[lvl]) {
    // EXE ещё не загружен -- показываем статичные данные оригинальной игры (только чтение)
    for (const l of SWITCH_LINKS[lvl]) {
      if (l.switch && l.target) {
        editorLinks.push({
          switchCol: l.switch[0], switchRow: l.switch[1],
          targetCol: l.target[0], targetRow: l.target[1],
          length: l.len || 2,
          readOnly: true,
        });
      }
    }
  }
  renderLinksList();
  renderMap();
  const btnExportExe = document.getElementById("btnExportExe");
  if (btnExportExe) btnExportExe.disabled = !(exeBytes && lvl);
}

// Живое обновление текста над списком связей -- пересчитывается при КАЖДОМ
// изменении editorLinks (добавление/удаление), не только при загрузке файла.
function updateExeMeta() {
  const exeMeta = document.getElementById("exeMeta");
  if (!exeMeta || !exeBytes) return;
  const lvl = state.levelNumber;
  if (currentLang === "ru") {
    exeMeta.innerHTML = `Загружен: <b>${exeFileName}</b> (${exeBytes.length} байт). ` +
      `Уровень (по карте): <b>${lvl || "не определён -- загрузите карту MAPxx.DAT"}</b>. ` +
      `Найдено связей: <b>${editorLinks.length}</b>. ` +
      (exeParsedState && exeParsedState.patched ? "EXE уже был пропатчен ранее (продолжаем с того же места)." : "Пристин-файл.");
  } else {
    exeMeta.innerHTML = `Loaded: <b>${exeFileName}</b> (${exeBytes.length} bytes). ` +
      `Level (from map): <b>${lvl || "not detected -- load a MAPxx.DAT map"}</b>. ` +
      `Links found: <b>${editorLinks.length}</b>. ` +
      (exeParsedState && exeParsedState.patched ? "This EXE was already patched before (continuing from there)." : "Pristine file.");
  }
}

function renderLinksList() {
  updateExeMeta();
  const wrap = document.getElementById("linksList");
  if (!wrap) return;
  wrap.innerHTML = "";
  if (editorLinks.length === 0) {
    wrap.innerHTML = currentLang === "ru"
      ? `<div class="hint" style="margin-top:0;">Связей нет (или уровень/EXE не загружены).</div>`
      : `<div class="hint" style="margin-top:0;">No links (or level/EXE not loaded).</div>`;
    return;
  }
  editorLinks.forEach((link, i) => {
    const row = document.createElement("div");
    row.className = "row";
    row.style.alignItems = "center";
    row.style.fontSize = "11px";
    const tag = link.idx !== undefined ? `idx=${link.idx}` : (link.readOnly ? (currentLang === "ru" ? "оригинал" : "original") : (currentLang === "ru" ? "новая" : "new"));
    const lengthLabel = currentLang === "ru" ? "длина" : "length";
    row.innerHTML = `
      <span style="width:56px;color:var(--ink-dim);">${tag}</span>
      <span>Switch (${link.switchCol},${link.switchRow}) → Target (${link.targetCol},${link.targetRow}), ${lengthLabel} ${link.length}</span>
      ${link.readOnly ? "" : `<button data-remove="${i}" style="padding:2px 8px;margin-left:auto;">✕</button>`}
    `;
    if (!link.readOnly) {
      row.querySelector("button[data-remove]").addEventListener("click", () => {
        editorLinks.splice(i, 1);
        renderLinksList();
        renderMap();
      });
    }
    wrap.appendChild(row);
  });
}

// ---- Создание новой связи кликом по карте (вместо ручного ввода чисел) ----
// state.linkPickMode: null | "switch" | "target"
// state.linkPickSwitchCell: {row,col} -- запомненная первая точка (выключатель)
// state.linkPickMousePos: {x,y} в пикселях канваса -- для "резиновой" линии при наведении
function startLinkPicking() {
  if (!exeBytes) {
    setStatus(currentLang === "ru"
      ? "Сначала загрузите GAME.EXE — без него новую связь патчить некуда."
      : "Load GAME.EXE first — there's nowhere to patch a new link without it.", true);
    return;
  }
  state.linkPickMode = "switch";
  state.linkPickSwitchCell = null;
  setStatus(currentLang === "ru"
    ? "Кликните по клетке карты, где будет стоять ВЫКЛЮЧАТЕЛЬ."
    : "Click the map cell where the SWITCH will be.");
}

// вызывается из основного обработчика клика по карте (см. setupEvents), ДО обычной покраски
function handleLinkPickClick(cell) {
  if (state.linkPickMode === "switch") {
    state.linkPickSwitchCell = cell;
    state.linkPickMode = "target";
    setStatus(currentLang === "ru"
      ? `Выключатель: (${cell.col},${cell.row}). Теперь кликните клетку КОНВЕЙЕРА-цели.`
      : `Switch: (${cell.col},${cell.row}). Now click the target CONVEYOR's cell.`);
    return true;
  }
  if (state.linkPickMode === "target") {
    const sw = state.linkPickSwitchCell;
    const promptText = currentLang === "ru"
      ? "Длина конвейера (число сегментов, обычно 2-3):"
      : "Conveyor length (number of segments, usually 2-3):";
    const lengthStr = prompt(promptText, "2");
    const length = parseInt(lengthStr, 10);
    state.linkPickMode = null;
    state.linkPickSwitchCell = null;
    if (!lengthStr || isNaN(length) || length < 1) {
      setStatus(currentLang === "ru" ? "Отменено (некорректная длина)." : "Cancelled (invalid length).", true);
      renderMap();
      return true;
    }
    editorLinks.push({
      switchCol: sw.col, switchRow: sw.row,
      targetCol: cell.col, targetRow: cell.row,
      length,
    });
    renderLinksList();
    renderMap();
    setStatus(currentLang === "ru"
      ? `Связь добавлена: Switch (${sw.col},${sw.row}) → Target (${cell.col},${cell.row}), длина ${length}. Не забудьте нажать «Собрать GAME.EXE».`
      : `Link added: Switch (${sw.col},${sw.row}) → Target (${cell.col},${cell.row}), length ${length}. Don't forget to click "Build GAME.EXE".`);
    return true;
  }
  return false;
}


function setupExePatcherUI() {
  const exeInput = document.getElementById("exeFileInput");
  const exeMeta = document.getElementById("exeMeta");
  const btnAddLink = document.getElementById("btnAddLink");
  const btnExportExe = document.getElementById("btnExportExe");
  if (!exeInput) return;

  const exeFileInputBtn = document.getElementById("exeFileInputBtn");
  const exeFileInputName = document.getElementById("exeFileInputName");
  if (exeFileInputBtn) exeFileInputBtn.addEventListener("click", () => exeInput.click());

  exeInput.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (file && exeFileInputName) {
      exeFileInputName.removeAttribute("data-i18n");
      exeFileInputName.textContent = file.name;
    }
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        exeBytes = new Uint8Array(reader.result);
        exeFileName = file.name;
        exeParsedState = parseExeState(exeBytes);
        refreshEditorLinksForCurrentLevel(); // сама вызовет renderLinksList -> updateExeMeta
      } catch (err) {
        exeMeta.textContent = (currentLang === "ru" ? "Ошибка: " : "Error: ") + err.message;
      }
    };
    reader.readAsArrayBuffer(file);
  });

  btnAddLink.addEventListener("click", () => {
    startLinkPicking();
  });

  btnExportExe.addEventListener("click", () => {
    if (!exeBytes || !state.levelNumber) {
      setStatus(currentLang === "ru"
        ? "Сначала загрузите GAME.EXE и карту (номер уровня определяется по имени файла)."
        : "Load GAME.EXE and a map first (the level number is taken from the file name).", true);
      return;
    }
    try {
      const patched = buildPatchedExe(exeBytes, state.levelNumber, editorLinks);
      const blob = new Blob([patched], { type: "application/octet-stream" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "GAME.EXE";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setStatus(currentLang === "ru"
        ? `Собран патченый GAME.EXE (${patched.length} байт) для уровня ${state.levelNumber}.`
        : `Built patched GAME.EXE (${patched.length} bytes) for level ${state.levelNumber}.`);
    } catch (err) {
      setStatus((currentLang === "ru" ? "Ошибка сборки патча: " : "Patch build error: ") + err.message, true);
    }
  });
}

async function init() {
  applyLanguage("en");
  const langSelect = document.getElementById("langSelect");
  if (langSelect) {
    langSelect.value = "en";
    langSelect.addEventListener("change", () => {
      applyLanguage(langSelect.value);
      updateFileMeta();
      updateExeMeta();
    });
  }
  setStatus(t("status.loadingTilesets"));
  await loadTilesetImages();
  setupEvents();
  setupExePatcherUI();
  rebuildPalette();
  renderMap();
  updateFileMeta();
  setStatus(t("status.ready"));
}

init();
