// ============================================================
// SOS EXE Patcher — управление связями выключатель→конвейер
// прямо в GAME.EXE (распакованном из UPX).
//
// Вся механика подробно описана в MECHANICS.md (разделы 8-10).
// Кратко:
//  - У каждого уровня своя таблица связей (switch_addr -> idx),
//    указатель на неё в массиве по формуле (level-1)*2 - 0x6FBA.
//  - idx ведёт в общий массив указателей на записи-цели (конвейеры),
//    по формуле idx*2 + 0x93E2 (в пристине-файле).
//  - Адрес выключателя:  0x3B68 + (row-2)*20 + col*2  (поправка -2!)
//  - Адрес цели/конвейера: 0x3B68 + row*20 + col*2     (БЕЗ поправки)
//  - Безопасная зона для переноса данных: CS-адрес 0x324F (2507 байт),
//    подтверждено практикой пустая во время выполнения игры.
// ============================================================

const EXE_HDRSIZE = 0x30;
const LEVEL_PTR_CONST = 0x6FBA;
const ARRAY_CONST_ORIG = 0x93E2;
const GRID_BASE = 0x3B68;
const ROW_STRIDE = 20;
const SAFE_ZONE = 0x324F;
const SAFE_ZONE_SIZE = 2507;
const N_TARGETS_ORIG = 136;
const MAGIC = [0x53, 0x4F, 0x53, 0x50]; // "SOSP" -- признак того, что EXE уже пропатчен нашим инструментом
// Файловый offset (НЕ CS-адрес!) инструкции "cs: mov di,[bx+XXXX]" -- единственное
// место в коде, читающее массив указателей целей по индексу. Сам адрес инструкции
// НЕ меняется никогда (меняется только её операнд disp16), поэтому используем
// точно проверенный фиксированный offset, а не хрупкий поиск по короткому
// байтовому паттерну (он совпадает ещё в 7 местах файла как данные/другой код).
const ARRAY_INSTR_FILE_OFFSET = 0x9022;

function findArrayInstruction(bytes) {
  const fo = ARRAY_INSTR_FILE_OFFSET;
  if (bytes[fo] !== 0x2E || bytes[fo + 1] !== 0x8B || bytes[fo + 2] !== 0xBF) {
    throw new Error(typeof currentLang !== "undefined" && currentLang === "ru" ? "По ожидаемому адресу не найдена инструкция чтения массива целей — это точно тот же GAME_unpacked.EXE?" : "Expected instruction not found at the anticipated address — is this really the same GAME_unpacked.EXE?");
  }
  const dispOff = fo + 3;
  const constVal = bytes[dispOff] | (bytes[dispOff + 1] << 8);
  return { fileOffset: fo, dispFileOffset: dispOff, constVal };
}

function exeRd16(bytes, cs_addr) {
  const fo = (cs_addr & 0xFFFF) + EXE_HDRSIZE;
  return bytes[fo] | (bytes[fo + 1] << 8);
}
function exeWr16(bytes, cs_addr, val) {
  const fo = (cs_addr & 0xFFFF) + EXE_HDRSIZE;
  bytes[fo] = val & 0xFF;
  bytes[fo + 1] = (val >> 8) & 0xFF;
}
function exeRd8(bytes, cs_addr) {
  return bytes[(cs_addr & 0xFFFF) + EXE_HDRSIZE];
}
function exeWr8(bytes, cs_addr, val) {
  bytes[(cs_addr & 0xFFFF) + EXE_HDRSIZE] = val & 0xFF;
}

// Координаты клетки <-> адрес в рабочей сетке уровня
function switchAddrForCell(row, col) {
  return (GRID_BASE + (row - 2) * ROW_STRIDE + col * 2) & 0xFFFF;
}
function targetAddrForCell(row, col) {
  return (GRID_BASE + row * ROW_STRIDE + col * 2) & 0xFFFF;
}
function cellForAddr(addr, isSwitch) {
  const rel = addr - GRID_BASE; // может быть ОТРИЦАТЕЛЬНЫМ для выключателя в рядах 0-1 -- это нормально!
  if (rel % 2 !== 0) return null; // нечётное смещение -- точно не наша ячейка
  const cell = rel / 2;
  // корректное floor-деление/остаток для ОТРИЦАТЕЛЬНЫХ cell тоже (JS % может дать отрицательный остаток)
  let row = Math.floor(cell / 10);
  const col = cell - row * 10;
  if (isSwitch) row += 2;
  return { row, col };
}

// Проверка: пропатчен ли уже этот EXE нашим инструментом (есть магическая метка)
function isAlreadyPatched(bytes) {
  const fo = (SAFE_ZONE & 0xFFFF) + EXE_HDRSIZE;
  return MAGIC.every((b, i) => bytes[fo + i] === b);
}

// Прочитать таблицу связей одного уровня (список {switchAddr, idx})
function readLevelTable(bytes, tablePtr) {
  const entries = [];
  let off = tablePtr;
  while (true) {
    const sw = exeRd16(bytes, off);
    if (sw === 0xFFFF) break;
    const idx = exeRd16(bytes, off + 2);
    entries.push({ switchAddr: sw, idx });
    off += 4;
  }
  return entries;
}

// Прочитать запись-цель по индексу (используя ТЕКУЩУЮ константу массива)
function readTargetByIndex(bytes, arrayConst, idx) {
  const recAddr = exeRd16(bytes, (idx * 2 + arrayConst) & 0xFFFF);
  const val0 = exeRd16(bytes, recAddr);
  const address = exeRd16(bytes, recAddr + 2);
  const length = exeRd16(bytes, recAddr + 4);
  return { recAddr, val0, address, length };
}

// ============================================================
// Полный разбор состояния EXE: указатели всех 60 уровней + их записи,
// плюс текущее состояние массива целей (сколько всего слотов и где он).
// ============================================================
function parseExeState(bytes) {
  const instr = findArrayInstruction(bytes);
  if (!instr) throw new Error(typeof currentLang !== "undefined" && currentLang === "ru"
    ? "Не найдена инструкция чтения массива целей — это точно распакованный GAME.EXE?"
    : "Target-array read instruction not found — is this really an unpacked GAME.EXE?");

  const levels = {};
  for (let level = 1; level <= 60; level++) {
    const ptrSlot = ((level - 1) * 2 - LEVEL_PTR_CONST) & 0xFFFF;
    const tablePtr = exeRd16(bytes, ptrSlot);
    const entries = readLevelTable(bytes, tablePtr).map(e => {
      const t = readTargetByIndex(bytes, instr.constVal, e.idx);
      return { ...e, target: t };
    });
    levels[level] = { ptrSlot, tablePtr, entries };
  }

  const patched = isAlreadyPatched(bytes);
  let nextFreeIdx = N_TARGETS_ORIG;
  let arrayTotalSlots = N_TARGETS_ORIG;
  if (patched) {
    const fo = (SAFE_ZONE & 0xFFFF) + EXE_HDRSIZE;
    arrayTotalSlots = bytes[fo + 4] | (bytes[fo + 5] << 8);
    nextFreeIdx = bytes[fo + 6] | (bytes[fo + 7] << 8);
  }

  return { instr, levels, patched, arrayConst: instr.constVal, arrayTotalSlots, nextFreeIdx };
}

// ============================================================
// Построить пропатченный EXE с учётом правок для ОДНОГО уровня.
// editedLinks: массив {switchRow, switchCol, targetRow, targetCol, length, idx?}
// idx указывается для СУЩЕСТВУЮЩИХ связей (чтобы переиспользовать их target-запись,
// просто подвинув координаты); для НОВЫХ связей idx не указывается -- патчер сам
// заведёт новый индекс и новую запись-цель.
// ============================================================
function buildPatchedExe(origBytes, levelNumber, editedLinks) {
  const bytes = new Uint8Array(origBytes); // копия, не трогаем оригинал
  const state = parseExeState(bytes);

  const RESERVE_NEW_SLOTS = 30; // запас под будущие новые индексы при первой перестройке

  if (!state.patched) {
    // ===== Первая перестройка "с нуля": переносим таблицы ВСЕХ уровней кроме
    // редактируемого, и весь массив указателей целей, в безопасную зону =====
    let cursor = SAFE_ZONE;

    // резервируем место под наш маленький заголовок (магия + метаданные), 10 байт:
    // 0-3 MAGIC, 4-5 totalSlots, 6-7 nextFreeIdx, 8-9 cursor (текущая позиция записи)
    const headerAt = cursor;
    cursor += 10;

    // таблицы уровней (все, кроме levelNumber, остаются на прежнем месте нетронутыми)
    const newLevelPtrs = {};
    for (let level = 1; level <= 60; level++) {
      if (level === levelNumber) continue;
      const entries = state.levels[level].entries;
      newLevelPtrs[level] = cursor;
      for (const e of entries) {
        exeWr16(bytes, cursor, e.switchAddr);
        exeWr16(bytes, cursor + 2, e.idx);
        cursor += 4;
      }
      exeWr16(bytes, cursor, 0xFFFF);
      cursor += 2;
    }
    for (const [level, ptr] of Object.entries(newLevelPtrs)) {
      const slot = ((Number(level) - 1) * 2 - LEVEL_PTR_CONST) & 0xFFFF;
      exeWr16(bytes, slot, ptr);
    }

    // массив указателей целей: копируем 136 старых + резерв под новые
    const newArrayBase = cursor;
    for (let i = 0; i < N_TARGETS_ORIG; i++) {
      const oldPtr = exeRd16(bytes, (i * 2 + ARRAY_CONST_ORIG) & 0xFFFF);
      exeWr16(bytes, newArrayBase + i * 2, oldPtr);
    }
    const totalSlots = N_TARGETS_ORIG + RESERVE_NEW_SLOTS;
    for (let i = N_TARGETS_ORIG; i < totalSlots; i++) {
      exeWr16(bytes, newArrayBase + i * 2, 0); // пока не используются
    }
    cursor = newArrayBase + totalSlots * 2;

    // патчим инструкцию на новую базу массива (ПРЯМОЕ значение, без отрицания!)
    bytes[state.instr.dispFileOffset] = newArrayBase & 0xFF;
    bytes[state.instr.dispFileOffset + 1] = (newArrayBase >> 8) & 0xFF;

    // пишем нашу метку в начале зоны: MAGIC + totalSlots(2) + nextFreeIdx(2) + arrayBase(2)
    const fo = (headerAt & 0xFFFF) + EXE_HDRSIZE;
    MAGIC.forEach((b, i) => { bytes[fo + i] = b; });
    bytes[fo + 4] = totalSlots & 0xFF; bytes[fo + 5] = (totalSlots >> 8) & 0xFF;
    bytes[fo + 6] = N_TARGETS_ORIG & 0xFF; bytes[fo + 7] = (N_TARGETS_ORIG >> 8) & 0xFF;

    // сохраняем указатель на массив и курсор в СОСТОЯНИИ (не в файле) для шага ниже
    state._newArrayBase = newArrayBase;
    state._cursor = cursor;
    state._nextFreeIdx = N_TARGETS_ORIG;
    state._arrayTotalSlots = totalSlots;
  } else {
    // уже пропатчено раньше -- продолжаем с того места, где остановились
    const fo = (SAFE_ZONE & 0xFFFF) + EXE_HDRSIZE;
    state._arrayTotalSlots = bytes[fo + 4] | (bytes[fo + 5] << 8);
    state._nextFreeIdx = bytes[fo + 6] | (bytes[fo + 7] << 8);
    state._newArrayBase = state.arrayConst; // текущая константа УЖЕ является базой массива
    // находим конец уже записанных данных, чтобы знать, куда писать новые записи-цели;
    // храним это как ещё один счётчик в заголовке (offset+8..9)
    state._cursor = (bytes[fo + 8] | (bytes[fo + 9] << 8)) || (state._newArrayBase + state._arrayTotalSlots * 2);
  }

  // ===== Собираем НОВУЮ таблицу для редактируемого уровня целиком с нуля,
  // прямо на её ТЕКУЩЕМ месте (указатель уровня НЕ трогаем!) =====
  const lvlPtr = state.levels[levelNumber].tablePtr;
  let off = lvlPtr;
  for (const link of editedLinks) {
    const swAddr = switchAddrForCell(link.switchRow, link.switchCol);
    let idx = link.idx;
    if (idx === undefined || idx === null) {
      // новая связь -- заводим новый индекс и новую запись-цель
      idx = state._nextFreeIdx;
      if (idx >= state._arrayTotalSlots) {
        throw new Error(typeof currentLang !== "undefined" && currentLang === "ru"
          ? `Кончился запас индексов целей (${state._arrayTotalSlots}). Нужно увеличить резерв.`
          : `Ran out of target index slots (${state._arrayTotalSlots}). Need to increase the reserve.`);
      }
      const tgtAddr = targetAddrForCell(link.targetRow, link.targetCol);
      const recAddr = state._cursor;
      exeWr16(bytes, recAddr, 0);
      exeWr16(bytes, recAddr + 2, tgtAddr);
      exeWr16(bytes, recAddr + 4, link.length);
      exeWr16(bytes, state._newArrayBase + idx * 2, recAddr);
      state._cursor += 6;
      state._nextFreeIdx++;
    } else {
      // существующая связь -- просто обновляем её запись-цель на новые координаты
      const recAddr = exeRd16(bytes, (idx * 2 + state._newArrayBase) & 0xFFFF);
      const tgtAddr = targetAddrForCell(link.targetRow, link.targetCol);
      exeWr16(bytes, recAddr + 2, tgtAddr);
      exeWr16(bytes, recAddr + 4, link.length);
    }
    exeWr16(bytes, off, swAddr);
    exeWr16(bytes, off + 2, idx);
    off += 4;
  }
  exeWr16(bytes, off, 0xFFFF);

  // обновляем счётчики в заголовке безопасной зоны
  const fo = (SAFE_ZONE & 0xFFFF) + EXE_HDRSIZE;
  bytes[fo + 6] = state._nextFreeIdx & 0xFF; bytes[fo + 7] = (state._nextFreeIdx >> 8) & 0xFF;
  bytes[fo + 8] = state._cursor & 0xFF; bytes[fo + 9] = (state._cursor >> 8) & 0xFF;

  return bytes;
}
