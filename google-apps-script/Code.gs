/**
 * Servicio optimizado para Planificacións Readaptacións.
 * Sustituye por completo el Code.gs de la implementación actual.
 */

const WEB_APP_CONFIG = Object.freeze({
  folderId: '1rQAiCIVP6KILZHFhoLcrSD91mZru6yZp',
  settingsSheet: 'WEB',
  exerciseLibrarySheet: 'BASE_EJERCICIOS',
  observationsSheet: 'OBSERVACIÓNS WEB',
  // El índice de deportistas cambia poco y evita escanear toda la carpeta.
  indexCacheSeconds: 21600, // 6 horas
  // La planificación activa se sirve ligera; 10 min equilibra rapidez y actualización.
  planCacheSeconds: 600,
});

function doGet(e) { return handleWebRequest_(e); }
function doPost(e) { return handleWebRequest_(e); }

function handleWebRequest_(e) {
  try {
    const body = requestBody_(e);
    if (normalizeLabel_(body.action) === 'SAVEOBSERVATION') {
      return saveObservation_(e, body);
    }

    const code = requestCode_(e, body);
    const forceRefresh = String((e && e.parameter && e.parameter.refresh) || '') === '1';
    if (!code) return jsonOutput_({ ok: true, service: 'planificacions-readaptacions' });

    const normalizedCode = normalizeCode_(code);
    if (!forceRefresh) {
      const cachedPlan = readCachedPlan_(normalizedCode);
      if (cachedPlan) return jsonOutput_(cachedPlan);
    }

    const match = findPlanByCode_(normalizedCode);
    if (!match) return jsonOutput_({ ok: false, error: 'Código de acceso incorrecto.' });

    const payload = buildPlanPayload_(match);
    writeCachedPlan_(normalizedCode, payload);
    return jsonOutput_(payload);
  } catch (error) {
    console.error(error && error.stack ? error.stack : error);
    return jsonOutput_({ ok: false, error: 'No se pudo cargar la planificación.' });
  }
}

function requestBody_(e) {
  if (!e || !e.postData || !e.postData.contents) return {};
  try {
    const body = JSON.parse(e.postData.contents);
    return body && typeof body === 'object' ? body : {};
  } catch (_) {
    return {};
  }
}

function requestCode_(e, body) {
  const p = (e && e.parameter) || {};
  let code = p.p || p.code || p.clave || '';
  if (!code) code = body && (body.p || body.code || body.clave) || '';
  return String(code).trim();
}

function saveObservation_(e, body) {
  const code = requestCode_(e, body);
  const observation = cleanText_(body.observation, 1500);
  const rpe = rpeValue_(body.rpe);
  const session = sessionDetails_(body.session);

  if (!code) {
    return jsonOutput_({ ok: false, error: 'Falta o código de acceso.' });
  }
  if (!rpe || !session) {
    return jsonOutput_({ ok: false, error: 'Faltan datos para gardar o rexistro da sesión.' });
  }

  const match = findPlanByCode_(normalizeCode_(code));
  if (!match) {
    return jsonOutput_({ ok: false, error: 'Código de acceso incorrecto.' });
  }

  const savedAt = appendObservation_(match, session, observation, rpe);
  return jsonOutput_({
    ok: true,
    type: 'observation',
    savedAt: savedAt,
  });
}

function rpeValue_(value) {
  const rpe = Number(value);
  return Number.isInteger(rpe) && rpe >= 1 && rpe <= 10 ? rpe : 0;
}

function sessionDetails_(value) {
  const source = value && typeof value === 'object' ? value : {};
  const id = cleanText_(source.id, 10);
  const date = cleanText_(source.date, 24);
  const day = cleanText_(source.day, 16);
  const title = cleanText_(source.title, 180);
  const planTab = cleanText_(source.planTab, 80);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(id) || !title) return null;
  return {
    id: id,
    date: date || id,
    day: day,
    title: title,
    planTab: planTab,
  };
}

function appendObservation_(match, session, observation, rpe) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const spreadsheet = SpreadsheetApp.openById(match.spreadsheetId);
    const sheet = observationSheet_(spreadsheet);
    const timestamp = new Date();
    sheet.appendRow([
      timestamp,
      match.athlete,
      session.planTab,
      session.date,
      session.day,
      session.title,
      observation,
      rpe,
    ]);
    sheet.getRange(sheet.getLastRow(), 1).setNumberFormat('dd/MM/yyyy HH:mm');
    SpreadsheetApp.flush();
    return timestamp.toISOString();
  } finally {
    lock.releaseLock();
  }
}

function observationSheet_(spreadsheet) {
  const expected = normalizeLabel_(WEB_APP_CONFIG.observationsSheet);
  const existing = spreadsheet.getSheets().find(function (sheet) {
    return normalizeLabel_(sheet.getName()) === expected;
  });
  if (existing) {
    ensureObservationHeaders_(existing);
    return existing;
  }

  const sheet = spreadsheet.insertSheet(WEB_APP_CONFIG.observationsSheet);
  sheet.getRange(1, 1, 1, 8).setValues([[
    'Rexistrado o',
    'Deportista',
    'Pestana',
    'Data da sesión',
    'Día',
    'Sesión',
    'Observacións',
    'RPE da sesión',
  ]]);
  sheet.getRange(1, 1, 1, 8)
    .setBackground('#286A75')
    .setFontColor('#FFFFFF')
    .setFontWeight('bold');
  sheet.setFrozenRows(1);
  sheet.setColumnWidth(1, 145);
  sheet.setColumnWidth(2, 170);
  sheet.setColumnWidth(3, 110);
  sheet.setColumnWidth(4, 115);
  sheet.setColumnWidth(5, 75);
  sheet.setColumnWidth(6, 240);
  sheet.setColumnWidth(7, 420);
  sheet.setColumnWidth(8, 110);
  return sheet;
}

function ensureObservationHeaders_(sheet) {
  const headers = sheet.getRange(1, 1, 1, 8).getDisplayValues()[0];
  if (normalizeLabel_(headers[7]) === 'RPEDASESION') return;
  sheet.getRange(1, 8).setValue('RPE da sesión')
    .setBackground('#286A75')
    .setFontColor('#FFFFFF')
    .setFontWeight('bold');
  sheet.setColumnWidth(8, 110);
}

function cleanText_(value, maxLength) {
  return String(value == null ? '' : value)
    .replace(/\u0000/g, '')
    .replace(/\r\n?/g, '\n')
    .trim()
    .slice(0, maxLength);
}

function findPlanByCode_(wantedCode) {
  // Incluso al actualizar una planificación reutilizamos el índice. Solo se
  // reconstruye si falta el código o la pestaña WEB cambió de verdad.
  let index = readCacheJson_('plans-index-v2') || [];
  let match = uniqueMatch_(index, wantedCode);
  if (match && verifyIndexEntry_(match, wantedCode)) return match;

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    index = readCacheJson_('plans-index-v2') || [];
    match = uniqueMatch_(index, wantedCode);
    if (match && verifyIndexEntry_(match, wantedCode)) return match;

    index = buildIndex_();
    writeCacheJson_('plans-index-v2', index, WEB_APP_CONFIG.indexCacheSeconds);
    match = uniqueMatch_(index, wantedCode);
    return match && verifyIndexEntry_(match, wantedCode) ? match : null;
  } finally {
    lock.releaseLock();
  }
}

function buildIndex_() {
  const files = DriveApp.getFolderById(WEB_APP_CONFIG.folderId)
    .getFilesByType(MimeType.GOOGLE_SHEETS);
  const index = [];
  while (files.hasNext()) {
    const file = files.next();
    try {
      const spreadsheet = SpreadsheetApp.openById(file.getId());
      const settings = readWebSettings_(spreadsheet);
      if (!settings || !settings.publish || !settings.code) continue;
      index.push({
        spreadsheetId: spreadsheet.getId(),
        athlete: settings.athlete || spreadsheet.getName(),
        normalizedCode: normalizeCode_(settings.code),
      });
    } catch (error) {
      console.warn('No se pudo indexar ' + file.getName() + ': ' + error);
    }
  }
  return index;
}

function uniqueMatch_(index, wantedCode) {
  const matches = (index || []).filter(function (entry) {
    return entry.normalizedCode === wantedCode;
  });
  return matches.length === 1 ? matches[0] : null;
}

function verifyIndexEntry_(entry, wantedCode) {
  try {
    const spreadsheet = SpreadsheetApp.openById(entry.spreadsheetId);
    const settings = readWebSettings_(spreadsheet);
    return !!(settings && settings.publish && normalizeCode_(settings.code) === wantedCode);
  } catch (_) { return false; }
}

function readWebSettings_(spreadsheet) {
  const sheet = spreadsheet.getSheets().find(function (candidate) {
    return normalizeLabel_(candidate.getName()) === 'WEB';
  });
  if (!sheet) return null;
  const range = sheet.getDataRange();
  const raw = range.getValues();
  const display = range.getDisplayValues();
  return {
    publish: booleanValue_(settingValue_(raw, display, ['PUBLICAR', 'PUBLICADO'])),
    athlete: stringValue_(settingValue_(raw, display, ['DEPORTISTA', 'ATLETA', 'NOMBRE', 'NOME'])),
    code: stringValue_(settingValue_(raw, display, ['CLAVE', 'CODIGO', 'CODIGODEACCESO'])),
  };
}

function settingValue_(raw, display, labels) {
  for (let r = 0; r < display.length; r += 1) {
    for (let c = 0; c < display[r].length; c += 1) {
      if (labels.indexOf(normalizeLabel_(display[r][c])) === -1) continue;
      if (hasValue_(raw[r] && raw[r][c + 1])) return raw[r][c + 1];
      if (hasValue_(display[r] && display[r][c + 1])) return display[r][c + 1];
      if (hasValue_(raw[r + 1] && raw[r + 1][c])) return raw[r + 1][c];
      if (hasValue_(display[r + 1] && display[r + 1][c])) return display[r + 1][c];
    }
  }
  return '';
}

function buildPlanPayload_(match) {
  const spreadsheet = SpreadsheetApp.openById(match.spreadsheetId);
  const sheets = spreadsheet.getSheets();
  const library = sheets.find(function (sheet) {
    return normalizeLabel_(sheet.getName()) === normalizeLabel_(WEB_APP_CONFIG.exerciseLibrarySheet);
  });
  const planning = activePlanningSheets_(sheets);
  if (!planning.length) throw new Error('La hoja no contiene pestañas de planificación.');

  const data = {};
  if (library) data[library.getName()] = readUsedRows_(library);
  planning.forEach(function (sheet) { data[sheet.getName()] = readUsedRows_(sheet); });
  return {
    ok: true,
    type: 'individual',
    athlete: match.athlete,
    tabs: planning.map(function (sheet) { return sheet.getName(); }),
    libraryTab: library ? library.getName() : null,
    sheets: data,
    capabilities: {
      observations: true,
    },
    updatedAt: DriveApp.getFileById(match.spreadsheetId).getLastUpdated().toISOString(),
  };
}

function isPlanningSheet_(sheet) {
  const name = normalizeLabel_(sheet.getName());
  return name !== 'WEB' && name !== 'BASEEJERCICIOS' &&
    (/^MS\d/.test(name) || name.indexOf('POSTRTP') !== -1);
}

function activePlanningSheets_(sheets) {
  const planning = sheets.filter(isPlanningSheet_);
  if (!planning.length) return [];

  const today = Utilities.formatDate(
    new Date(),
    Session.getScriptTimeZone(),
    'yyyy-MM-dd'
  );
  const dated = planning.map(function (sheet) {
    return {
      sheet: sheet,
      order: planningOrder_(sheet),
      startsOn: planningStartDate_(sheet),
    };
  });

  // Elegimos el bloque que ya ha comenzado más recientemente. Si el siguiente
  // mes está preparado de antemano, el deportista seguirá viendo su MS actual.
  const current = dated
    .filter(function (entry) { return entry.startsOn && entry.startsOn <= today; })
    .sort(function (a, b) {
      return a.startsOn === b.startsOn
        ? a.order - b.order
        : a.startsOn.localeCompare(b.startsOn);
    });
  if (current.length) return [current[current.length - 1].sheet];

  // Antes de iniciar una planificación, enseñamos la siguiente disponible.
  const upcoming = dated
    .filter(function (entry) { return entry.startsOn && entry.startsOn > today; })
    .sort(function (a, b) {
      return a.startsOn === b.startsOn
        ? a.order - b.order
        : a.startsOn.localeCompare(b.startsOn);
    });
  if (upcoming.length) return [upcoming[0].sheet];

  // Compatibilidad con plantillas antiguas sin fecha visible en las primeras
  // filas: mantenemos el comportamiento de servir el último MS disponible.
  dated.sort(function (a, b) { return a.order - b.order; });
  return [dated[dated.length - 1].sheet];
}

function planningOrder_(sheet) {
  const match = normalizeLabel_(sheet.getName()).match(/^MS(\d+)/);
  return match ? Number(match[1]) : -1;
}

function planningStartDate_(sheet) {
  const rowCount = Math.min(sheet.getLastRow(), 80);
  const columnCount = Math.min(sheet.getLastColumn(), 70);
  if (!rowCount || !columnCount) return '';

  const rows = sheet.getRange(1, 1, rowCount, columnCount).getDisplayValues();
  let earliest = '';
  rows.forEach(function (row) {
    // Es la misma marca que utiliza el lector de sesiones; así no confundimos
    // una fecha escrita en una observación con el inicio de un microciclo.
    if (normalizeLabel_(row[1]) !== 'DATA') return;
    for (let column = 2; column < row.length; column += 10) {
      const value = planningDateKey_(row[column]);
      if (value && (!earliest || value < earliest)) earliest = value;
    }
  });
  return earliest;
}

function planningDateKey_(value) {
  const match = String(value || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (!match) return '';
  const year = match[3].length === 2 ? '20' + match[3] : match[3];
  return year + '-' + ('0' + match[2]).slice(-2) + '-' + ('0' + match[1]).slice(-2);
}

function readUsedRows_(sheet) {
  const lastRow = sheet.getLastRow();
  const lastColumn = sheet.getLastColumn();
  if (!lastRow || !lastColumn) return [];

  const rows = sheet.getRange(1, 1, lastRow, lastColumn).getDisplayValues();
  while (rows.length && rows[rows.length - 1].every(function (v) { return v === ''; })) {
    rows.pop();
  }
  if (!rows.length) return [];

  // Las plantillas suelen tener fórmulas o formato mucho más allá del bloque
  // utilizado. No enviamos columnas que no aporten ningún valor visible.
  let usedColumns = 0;
  rows.forEach(function (row) {
    for (let column = row.length - 1; column >= 0; column -= 1) {
      if (row[column] !== '') {
        usedColumns = Math.max(usedColumns, column + 1);
        break;
      }
    }
  });
  return usedColumns ? rows.map(function (row) { return row.slice(0, usedColumns); }) : [];
}

function readCachedPlan_(code) { return readCacheJson_('plan-v3-' + code); }

function writeCachedPlan_(code, payload) {
  writeCacheJson_('plan-v3-' + code, payload, WEB_APP_CONFIG.planCacheSeconds);
}

function readCacheJson_(key) {
  try {
    const cache = CacheService.getScriptCache();
    const value = cache.get(key);
    if (value) return JSON.parse(value);
    const parts = Number(cache.get(key + '-parts') || 0);
    if (!parts) return null;
    const keys = Array.from({ length: parts }, function (_, index) {
      return key + '-part-' + index;
    });
    const chunks = cache.getAll(keys);
    if (keys.some(function (partKey) { return !chunks[partKey]; })) return null;
    return JSON.parse(keys.map(function (partKey) { return chunks[partKey]; }).join(''));
  } catch (_) { return null; }
}

function writeCacheJson_(key, value, seconds) {
  try {
    const cache = CacheService.getScriptCache();
    const json = JSON.stringify(value);
    if (json.length < 90000) {
      cache.put(key, json, seconds);
      return;
    }
    const chunks = json.match(/[\s\S]{1,85000}/g) || [];
    if (chunks.length > 20) return;
    const values = {};
    chunks.forEach(function (chunk, index) { values[key + '-part-' + index] = chunk; });
    cache.putAll(values, seconds);
    cache.put(key + '-parts', String(chunks.length), seconds);
  } catch (_) {}
}

function normalizeCode_(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]/g, '');
}
function normalizeLabel_(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toUpperCase().replace(/[^A-Z0-9]/g, '');
}
function booleanValue_(value) {
  if (value === true) return true;
  return ['TRUE', 'VERDADERO', 'SI', '1', 'X', 'ACTIVO'].indexOf(normalizeLabel_(value)) >= 0;
}
function stringValue_(value) { return value == null ? '' : String(value).trim(); }
function hasValue_(value) { return value !== '' && value != null; }
function jsonOutput_(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}
