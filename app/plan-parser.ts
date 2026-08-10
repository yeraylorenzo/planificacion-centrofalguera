export type PlanConfig = {
  athlete: string;
  spreadsheetId: string;
  tabs: string[];
};

export type PublishedPlanPayload = {
  ok: true;
  type: "individual";
  athlete: string;
  tabs: string[];
  libraryTab: string | null;
  sheets: Record<string, string[][]>;
  capabilities?: {
    observations?: boolean;
  };
  updatedAt: string;
};

export type Exercise = {
  block: string;
  title: string;
  series: string;
  reps: string;
  load: string;
  dose: string[];
  note: string;
  videoUrl?: string;
};

export type Session = {
  id: string;
  date: string;
  displayDate: string;
  day: string;
  location: string;
  title: string;
  planTab: string;
  exercises: Exercise[];
};

const DAY_NAMES = ["DOM", "LUN", "MAR", "MÉR", "XOV", "VEN", "SÁB"];
const MONTH_NAMES = [
  "XAN",
  "FEB",
  "MAR",
  "ABR",
  "MAI",
  "XUN",
  "XUL",
  "AGO",
  "SET",
  "OUT",
  "NOV",
  "DEC",
];

function csv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      row.push(cell.trim());
      cell = "";
    } else if (
      (character === "\n" || character === "\r") &&
      !quoted
    ) {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(cell.trim());
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += character;
    }
  }

  if (cell || row.length) {
    row.push(cell.trim());
    rows.push(row);
  }
  return rows;
}

function value(row: string[] | undefined, column: number) {
  return row?.[column]?.trim() ?? "";
}

function normalise(text: string) {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Z0-9%]/gi, "")
    .toUpperCase();
}

function dateId(raw: string) {
  const match = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (!match) return "";
  const [, day, month, rawYear] = match;
  const year = rawYear.length === 2 ? `20${rawYear}` : rawYear;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

function displayDate(id: string) {
  const [year, month, day] = id.split("-");
  return `${day} ${MONTH_NAMES[Number(month) - 1] ?? ""} ${year}`;
}

function sectionName(raw: string) {
  const heading = normalise(raw);
  if (heading === "QUECEMENTO") return "Quecemento";
  if (heading === "PLIOMETRIA") return "Pliometría";
  if (heading.includes("PLANIFICACIONFV")) return "Forza–velocidade";
  if (heading.includes("PARTEPRINCIPALB1")) return "Forza principal";
  if (heading.includes("PARTEPRINCIPALB2"))
    return "Forza complementaria";
  if (heading.includes("CONDICIONAL")) return "Traballo condicional";
  if (heading.includes("CARGAVHSR") || heading.includes("SPRINT"))
    return "Carreira e sprint";
  return "";
}

function isBoundary(raw: string) {
  const heading = normalise(raw);
  return Boolean(
    sectionName(raw) ||
      heading.includes("RESUMENCARGA") ||
      heading === "RESUMENSEMANAL",
  );
}

function columnIndex(headers: string[], patterns: string[]) {
  return headers.findIndex((header) =>
    patterns.some((pattern) => header.includes(pattern)),
  );
}

function loadColumnIndex(
  headers: string[],
  repsIndex: number,
  timeIndex: number,
  heightIndex: number,
) {
  const exactIndex = columnIndex(headers, [
    "CARGAKG",
    "PESOKG",
    "LASTREKG",
  ]);
  if (exactIndex >= 0) return exactIndex;

  const semanticIndex = headers.findIndex(
    (header) =>
      (header === "KG" ||
        header.includes("CARGA") ||
        header.includes("PESO") ||
        header.includes("LASTRE")) &&
      !header.includes("PERCIBIDA") &&
      !header.includes("TOTAL"),
  );
  if (semanticIndex >= 0) return semanticIndex;

  if (
    repsIndex >= 0 &&
    timeIndex === repsIndex + 2 &&
    !headers[repsIndex + 1]
  ) {
    return repsIndex + 1;
  }

  if (heightIndex >= 0 && !headers[heightIndex + 1]) {
    return heightIndex + 1;
  }

  return -1;
}

function cleanNumeric(raw: string) {
  if (!raw || raw === "0" || raw === "0,00") return "";
  return raw;
}

function parseExercise(
  row: string[],
  column: number,
  block: string,
  headers: string[],
  library: Map<string, string>,
) {
  const local = Array.from({ length: 10 }, (_, index) =>
    value(row, column + index),
  );
  const titleIndex = columnIndex(headers, ["EXERCICIO"]);
  const contentIndex = columnIndex(headers, ["CONTIDO"]);
  const actualTitleIndex = titleIndex >= 0 ? titleIndex : contentIndex;
  if (actualTitleIndex < 0) return null;

  const title = local[actualTitleIndex];
  const normalisedTitle = normalise(title);
  if (
    !title ||
    ["EXERCICIO", "CONTIDO", "ORIENTACION"].includes(normalisedTitle) ||
    isBoundary(title)
  )
    return null;

  const seriesIndex = columnIndex(headers, ["SERIES"]);
  const repsIndex = columnIndex(headers, ["REPS", "REPETICIONS"]);
  const timeIndex = columnIndex(headers, [
    "TEMPOTRABALL",
    "TEMPOS",
    "TEMPOSEG",
  ]);
  const heightIndex = headers.findIndex((header) => header === "HM");
  const loadIndex = loadColumnIndex(
    headers,
    repsIndex,
    timeIndex,
    heightIndex,
  );
  const rirIndex = columnIndex(headers, ["RIR"]);
  const rpeIndex = columnIndex(headers, ["RPE"]);
  const noteIndex = columnIndex(headers, ["OBSERVACIONS"]);
  const distanceIndex = columnIndex(headers, ["DISTANCIA"]);
  const speedIndex = columnIndex(headers, ["VELOCIDADE"]);
  const percentIndex = columnIndex(headers, ["%PV"]);

  const series = cleanNumeric(local[seriesIndex] ?? "");
  const reps = cleanNumeric(local[repsIndex] ?? "");
  const dose: string[] = [];
  const load = cleanNumeric(local[loadIndex] ?? "");
  const time = cleanNumeric(local[timeIndex] ?? "");
  const rir = cleanNumeric(local[rirIndex] ?? "");
  const rpe = cleanNumeric(local[rpeIndex] ?? "");
  const distance = cleanNumeric(local[distanceIndex] ?? "");
  const speed = cleanNumeric(local[speedIndex] ?? "");
  const height = cleanNumeric(local[heightIndex] ?? "");
  const percent = cleanNumeric(local[percentIndex] ?? "");

  if (time)
    dose.push(
      `${time} ${headers[timeIndex]?.includes("MIN") ? "min" : "s"}`,
    );
  if (distance) dose.push(`${distance} m`);
  if (speed) dose.push(`${speed} m/s`);
  if (height) dose.push(`${height} m`);
  if (percent) dose.push(`${percent}% PV`);
  if (rir) dose.push(`RIR ${rir}`);
  if (rpe) dose.push(`RPE ${rpe}`);

  const meaningful = [
    series,
    reps,
    load,
    ...dose,
    local[noteIndex] ?? "",
  ].some(Boolean);
  if (!meaningful) return null;

  return {
    block,
    title,
    series,
    reps,
    load,
    dose,
    note: local[noteIndex] ?? "",
    videoUrl: library.get(normalisedTitle),
  } satisfies Exercise;
}

function parseMicrocycle(
  rows: string[][],
  library: Map<string, string>,
  planTab: string,
) {
  const sessions: Session[] = [];
  const weekStarts = rows
    .map((row, index) => (normalise(value(row, 0)) === "SEMANA" ? index : -1))
    .filter((index) => index >= 0);

  for (let weekIndex = 0; weekIndex < weekStarts.length; weekIndex += 1) {
    const start = weekStarts[weekIndex];
    const end = weekStarts[weekIndex + 1] ?? rows.length;
    const dateRow = Array.from(
      { length: Math.min(9, end - start) },
      (_, offset) => start + offset,
    ).find((rowIndex) => normalise(value(rows[rowIndex], 1)) === "DATA");
    if (dateRow === undefined) continue;

    for (let column = 0; column < 70; column += 10) {
      const id = dateId(value(rows[dateRow], column + 2));
      if (!id) continue;

      const exercises: Exercise[] = [];
      let block = "";
      let headers: string[] = [];

      for (let rowIndex = dateRow + 2; rowIndex < end; rowIndex += 1) {
        const firstCell = value(rows[rowIndex], column);
        const nextBlock = sectionName(firstCell);
        if (nextBlock) {
          block = nextBlock;
          headers = [];
          continue;
        }
        if (normalise(firstCell).includes("RESUMENCARGA")) break;
        if (!block) continue;

        const candidateHeaders = Array.from({ length: 10 }, (_, offset) =>
          normalise(value(rows[rowIndex], column + offset)),
        );
        const isHeader =
          candidateHeaders.includes("EXERCICIO") ||
          (candidateHeaders.includes("CONTIDO") &&
            (candidateHeaders.includes("SERIES") ||
              candidateHeaders.includes("REPETICIONS")));
        if (isHeader) {
          headers = candidateHeaders;
          continue;
        }
        if (!headers.length || isBoundary(firstCell)) continue;

        const exercise = parseExercise(
          rows[rowIndex],
          column,
          block,
          headers,
          library,
        );
        if (exercise) exercises.push(exercise);
      }

      if (!exercises.length) continue;
      const date = new Date(`${id}T12:00:00`);
      const blocks = Array.from(new Set(exercises.map((item) => item.block)));
      const title =
        blocks.length <= 2
          ? blocks.join(" + ")
          : `${blocks[0]} + ${blocks.length - 1} bloques`;

      sessions.push({
        id,
        date: value(rows[dateRow], column + 2),
        displayDate: displayDate(id),
        day: DAY_NAMES[date.getDay()] ?? "",
        location: value(rows[dateRow], column + 4) ? "Centro" : "Autónoma",
        title,
        planTab,
        exercises,
      });
    }
  }

  return sessions;
}

async function publishedCsv(spreadsheetId: string, tab: string) {
  const url = new URL(
    `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq`,
  );
  url.searchParams.set("tqx", "out:csv");
  url.searchParams.set("sheet", tab);
  url.searchParams.set("_", String(Date.now()));
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`Non se puido ler ${tab}`);
  return csv(await response.text());
}

function exerciseLibrary(rows: string[][]) {
  const library = new Map<string, string>();
  rows.slice(1).forEach((row) => {
    const title = value(row, 0);
    const url = value(row, 1);
    if (title && url.startsWith("http")) library.set(normalise(title), url);
  });
  return library;
}

export async function loadPublishedPlan(config: PlanConfig) {
  const [libraryRows, ...microcycles] = await Promise.all([
    publishedCsv(config.spreadsheetId, "BASE_EJERCICIOS"),
    ...config.tabs.map((tab) => publishedCsv(config.spreadsheetId, tab)),
  ]);
  const library = exerciseLibrary(libraryRows);
  const allSessions = microcycles.flatMap((rows, index) =>
    parseMicrocycle(rows, library, config.tabs[index] ?? ""),
  );
  const deduplicated = new Map<string, Session>();

  allSessions.forEach((session) => {
    const previous = deduplicated.get(session.id);
    if (!previous || session.exercises.length >= previous.exercises.length) {
      deduplicated.set(session.id, session);
    }
  });

  return Array.from(deduplicated.values()).sort((a, b) =>
    a.id.localeCompare(b.id),
  );
}

export function loadServicePlan(payload: PublishedPlanPayload) {
  const libraryRows = payload.libraryTab
    ? payload.sheets[payload.libraryTab] ?? []
    : [];
  const library = exerciseLibrary(libraryRows);
  const allSessions = payload.tabs.flatMap((tab) =>
    parseMicrocycle(payload.sheets[tab] ?? [], library, tab),
  );
  const deduplicated = new Map<string, Session>();

  allSessions.forEach((session) => {
    const previous = deduplicated.get(session.id);
    if (!previous || session.exercises.length >= previous.exercises.length) {
      deduplicated.set(session.id, session);
    }
  });

  return Array.from(deduplicated.values()).sort((a, b) =>
    a.id.localeCompare(b.id),
  );
}
