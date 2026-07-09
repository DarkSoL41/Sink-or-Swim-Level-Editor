// ============================================================
// SOS Level Editor -- i18n dictionary (EN default, RU optional)
// ============================================================
const I18N = {
  // ---- header ----
  "header.subtitle": { en: "Sink or Swim (DOS, 1993) &middot; maps/*.dat tile tool", ru: "Sink or Swim (DOS, 1993) &middot; редактор карт maps/*.dat" },
  "header.brand": { en: "reverse-engineered format<br>unofficial fan tool<br>made by DarkSoL &middot; Discord: darksol41", ru: "формат разгадан ревёрс-инжинирингом<br>неофициальный фан-инструмент<br>сделано DarkSoL &middot; Discord: darksol41" },

  // ---- common (custom file pickers) ----
  "common.chooseFile": { en: "Choose File", ru: "Выберите файл" },
  "common.noFileChosen": { en: "No file chosen", ru: "Файл не выбран" },

  // ---- toolbar ----
  "toolbar.openLabel": { en: "Open MAPxx.DAT", ru: "Открыть MAPxx.DAT" },
  "toolbar.newMap": { en: "New Map", ru: "Новая карта" },
  "toolbar.saveAs": { en: "Save As...", ru: "Сохранить как..." },
  "toolbar.quickSaveTitle": { en: "Overwrite the same file it was loaded from", ru: "Перезаписать тот же файл, из которого загружено" },
  "toolbar.quickSave": { en: "💾 Save to same file", ru: "💾 Сохранить в тот же файл" },
  "toolbar.openFS": { en: "📂 Open (with quick save)", ru: "📂 Открыть (с быстрым сохранением)" },
  "toolbar.showLinksTitle": { en: "Blue line = switch→conveyor link (from EXE or original game). Circle = switch, square = target. Red outline = switch moved off its working position.", ru: "Голубая линия = связь выключатель→конвейер (из EXE или оригинальной игры). Кружок = выключатель, квадрат = цель. Красная рамка = выключатель сдвинут с рабочей позиции." },
  "toolbar.showLinks": { en: "Show links", ru: "Показывать связи" },
  "toolbar.showSpecialTitle": { en: "Pink outline around a cell = special object (value ≥256: switch/conveyor/exit/decor animation). Hover a map cell to see details in the status bar.", ru: "Розовая рамка вокруг клетки = спец-объект (значение ≥256: выключатель/конвейер/выход/декор-анимация). Наведите курсор на клетку карты, чтобы увидеть подробности в статус-строке." },
  "toolbar.showSpecial": { en: "Outline special objects", ru: "Обводить спец-объекты" },
  "toolbar.noFile": { en: "No file loaded.", ru: "Файл не загружен." },
  "toolbar.language": { en: "Language", ru: "Язык" },

  // ---- left panel: tileset ----
  "left.tilesetHeader": { en: "Tileset & Objects", ru: "Тайлсет и объекты" },
  "left.tilesetLabel": { en: "Graphics set", ru: "Набор графики" },
  "left.hint1": {
    en: "Click a map cell to paint the current tile/object (LMB). RMB — eyedropper. Tiles with a pink outline in the palette and on the map are special objects. The Cargo crate (red outline) is placed ON TOP of the background tile.",
    ru: "Клик по клетке карты красит текущим тайлом/объектом (ЛКМ). ПКМ — пипетка. Тайлы с розовой рамкой в палитре и на карте — спец-объекты. Ящик Cargo (выделен красной рамкой) ставится ПОВЕРХ фонового тайла."
  },

  // ---- main: map size controls ----
  "main.width": { en: "Width (tiles)", ru: "Ширина (тайлы)" },
  "main.widthFixed": { en: "10 (fixed)", ru: "10 (фиксировано)" },
  "main.height": { en: "Height (tiles)", ru: "Высота (тайлы)" },
  "main.zoom": { en: "Zoom", ru: "Масштаб" },

  // ---- right panel: start point ----
  "right.startHeader": { en: "Level Start Point", ru: "Точка старта уровня" },
  "right.startHint": {
    en: "The tile with value <b>177</b> is where the player appears at the start of the level (except level 1 -- it has its own surfacing cutscene). Marked with a green outline and a <b>START</b> label for clarity.",
    ru: "Тайл со значением <b>177</b> — точка, где появляется игрок в начале уровня (кроме уровня 1 — там отдельная катсцена всплытия). Отмечена зелёной рамкой с подписью <b>START</b> для наглядности."
  },

  // ---- right panel: EXE patcher ----
  "right.patchHeader": { en: "Patch GAME.EXE: Switch Links", ru: "Патч GAME.EXE: связи выключателей" },
  "right.patchLoadLabel": { en: "Load GAME.EXE (unpacked)", ru: "Загрузить GAME.EXE (распакованный)" },
  "right.patchNoExe": { en: "GAME.EXE not loaded.", ru: "EXE не загружен." },
  "right.addLink": { en: "+ Add Link", ru: "+ Добавить связь" },
  "right.exportExe": { en: "Build GAME.EXE", ru: "Собрать GAME.EXE" },
  "right.patchHint": {
    en: "The level number is taken from the loaded map's file name (MAPxx.DAT). The link list is always shown (even without an EXE loaded -- then it's read-only, from the original game). \"Add Link\" button: click the cell with the switch, then the target conveyor's cell (a yellow line follows your cursor), and enter the length. <b>Important:</b> for a conveyor, click its LEFTMOST tile (or topmost, if vertical) -- that's the anchor point.",
    ru: "Номер уровня берётся из имени загруженной карты (MAPxx.DAT). Список связей показывается всегда (даже без EXE — тогда только для просмотра, из оригинальной игры). Кнопка «Добавить связь»: кликните клетку с выключателем, затем — клетку конвейера-цели (тянется жёлтая линия), укажите длину. <b>Важно:</b> для конвейера кликайте по его САМОМУ ЛЕВОМУ (или верхнему, если конвейер вертикальный) тайлу — это точка привязки."
  },

  // ---- right panel: format reference ----
  "right.formatHeader": { en: "Format (reference)", ru: "Формат (справка)" },
  "right.formatHint": {
    en: 'Header: <b>"MAP."</b> + width(u16) + height(u16) + 120&nbsp;reserved bytes.<br>Then: width&times;height cells, 2 bytes each (LE).<br>Background tile = index into a LINEAR array of 32&times;32px blocks, 1024 bytes each (confirmed via disassembly: offset = id&times;0x400). Level 1 uses the BLOCKL1A+B+C bank (0-179).',
    ru: 'Заголовок: <b>"MAP."</b> + width(u16) + height(u16) + 120&nbsp;байт резерва.<br>Далее: width&times;height ячеек по 2 байта (LE).<br>Тайл фона = индекс в ЛИНЕЙНОМ массиве 32&times;32px блоков по 1024 байта (подтверждено дизасмом: offset = id&times;0x400). Уровень 1 использует банк BLOCKL1A+B+C (0-179).'
  },

  // ---- status bar (initial) ----
  "status.initial": { en: "Ready. Load MAPxx.DAT or create a new map.", ru: "Готов. Загрузите MAPxx.DAT или создайте новую карту." },
  "status.loadingTilesets": { en: "Loading tilesets...", ru: "Загрузка тайлсетов..." },
  "status.ready": { en: "Ready. NOTE: exact matching of some background tiles is not fully verified yet -- compare with the game and report discrepancies.", ru: "Готов. ВНИМАНИЕ: точное сопоставление некоторых фоновых тайлов ещё не до конца проверено — сверяйте с игрой и сообщайте о расхождениях." },
};

let currentLang = "en";

function t(key) {
  const entry = I18N[key];
  if (!entry) return key;
  return entry[currentLang] || entry.en || key;
}

function applyLanguage(lang) {
  currentLang = lang;
  document.querySelectorAll("[data-i18n]").forEach(el => {
    const key = el.getAttribute("data-i18n");
    el.innerHTML = t(key);
  });
  document.querySelectorAll("[data-i18n-title]").forEach(el => {
    const key = el.getAttribute("data-i18n-title");
    el.setAttribute("title", t(key));
  });
  document.documentElement.lang = lang;
  // динамические части интерфейса (палитра/список связей/подсказки), если редактор уже инициализирован
  if (typeof rebuildPalette === "function" && typeof state !== "undefined" && state.currentFamily) {
    try { rebuildPalette(); } catch (e) {}
  }
  if (typeof renderLinksList === "function") {
    try { renderLinksList(); } catch (e) {}
  }
}
