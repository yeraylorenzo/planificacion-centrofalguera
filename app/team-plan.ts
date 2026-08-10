export type TeamTask = {
  phase: string;
  title: string;
  objective: string;
  format: string;
  series: string;
  work: string;
  rest: string;
  minutes: number;
};

export type TeamExercise = {
  block: string;
  content: string;
  title: string;
  series: string;
  reps: string;
  load: string;
  time: string;
  rir: string;
  note: string;
  videoUrl?: string;
};

export type TeamSession = {
  id: string;
  date: string;
  day: string;
  location: "Campo" | "Ximnasio";
  title: string;
  minutes: number;
  rpe: string;
  tasks: TeamTask[];
  exercises: TeamExercise[];
};

export type TeamPlan = {
  sessions: TeamSession[];
  macro: {
    weeks: string;
    load: string;
    intensity: string;
  };
  updatedAt: string;
};

const PUBLICATION =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vRuCuFspkZP_sDs1aXwqt7uJRwh6PSxW2eugiRK9DdgwTfmfM0LVWyTaLiDbcT6Kq2WkMyj4mN5vq3_";
const GIDS = [
  1493100356, 2100000001, 2100000002, 2100000003, 2100000004, 2100000005,
  2100000006,
];
const EXERCISES_GID = 605054788;
const MACRO_GID = 1143449359;
const DAYS = ["DOM", "LUN", "MAR", "MÉR", "XOV", "VEN", "SÁB"];
const MONTHS = [
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
    .replace(/[^A-Z0-9]/gi, "")
    .toUpperCase();
}

function displayDate(raw: string) {
  const [day, month] = raw.split("/");
  return day && month
    ? `${day.padStart(2, "0")} ${MONTHS[Number(month) - 1] ?? ""}`
    : raw;
}

function sessionId(raw: string) {
  const [day, month, rawYear] = raw.split("/");
  const year = rawYear?.length === 2 ? `20${rawYear}` : rawYear;
  return `${year}-${month?.padStart(2, "0")}-${day?.padStart(2, "0")}`;
}

function dayOf(raw: string) {
  const [day, month, rawYear] = raw.split("/");
  const year = Number(rawYear?.length === 2 ? `20${rawYear}` : rawYear);
  const date = new Date(year, Number(month) - 1, Number(day));
  return DAYS[date.getDay()] ?? "";
}

function toNumber(text: string) {
  return Number(text.replace(",", ".")) || 0;
}

async function publishedCsv(gid: number) {
  const response = await fetch(
    `${PUBLICATION}/pub?gid=${gid}&single=true&output=csv&cb=${Date.now()}`,
    { cache: "no-store" },
  );
  if (!response.ok) {
    throw new Error("Non se puido ler a planificación publicada");
  }
  return csv(await response.text());
}

function exerciseLibrary(rows: string[][]) {
  const links = new Map<string, string>();
  rows.slice(1).forEach((row) => {
    if (value(row, 0) && value(row, 1).startsWith("http")) {
      links.set(normalise(value(row, 0)), value(row, 1));
    }
  });
  return links;
}

function parseMicrocycle(
  rows: string[][],
  library: Map<string, string>,
) {
  const sessions: TeamSession[] = [];

  for (let start = 0; start < 70; start += 10) {
    const date = value(rows[6], start + 2);
    if (!/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(date)) continue;

    const tasks: TeamTask[] = [];
    for (let rowIndex = 10; rowIndex <= 17; rowIndex += 1) {
      const title = value(rows[rowIndex], start + 2);
      const phase = value(rows[rowIndex], start + 1);
      if (
        value(rows[rowIndex], start).toUpperCase() === "FORZA" ||
        phase.toUpperCase() === "ORIENTACIÓN"
      ) {
        break;
      }
      if (!title) continue;
      tasks.push({
        phase,
        title,
        objective: value(rows[rowIndex], start + 3),
        format: value(rows[rowIndex], start + 4),
        series: value(rows[rowIndex], start + 6),
        work: value(rows[rowIndex], start + 7),
        rest: value(rows[rowIndex], start + 8),
        minutes: toNumber(value(rows[rowIndex], start + 9)),
      });
    }

    const exercises: TeamExercise[] = [];
    let activeBlock = "";
    let readingExercises = false;

    for (let rowIndex = 18; rowIndex < rows.length; rowIndex += 1) {
      const heading = value(rows[rowIndex], start).toUpperCase();
      if (heading === "QUECEMENTO") {
        activeBlock = "Quecemento";
        readingExercises = false;
        continue;
      }
      if (heading.includes("PARTE PRINCIPAL- B1")) {
        activeBlock = "B1 · Bloque principal";
        readingExercises = false;
        continue;
      }
      if (heading.includes("PARTE PRINCIPAL- B2")) {
        activeBlock = "B2 · Bloque complementario";
        readingExercises = false;
        continue;
      }
      if (
        heading.includes("PLIOMETRÍA") ||
        heading.includes("CONDICIONAL") ||
        heading.includes("CARGA VHSR") ||
        heading.includes("RESUMEN CARGA")
      ) {
        readingExercises = false;
        continue;
      }
      if (
        value(rows[rowIndex], start + 1).toUpperCase() === "EXERCICIO" &&
        activeBlock
      ) {
        readingExercises = true;
        continue;
      }
      if (!readingExercises || !value(rows[rowIndex], start + 1)) continue;

      const title = value(rows[rowIndex], start + 1);
      if (["EXERCICIO", "ORIENTACIÓN"].includes(title.toUpperCase())) continue;
      if (
        !value(rows[rowIndex], start + 2) ||
        !value(rows[rowIndex], start + 6)
      ) {
        continue;
      }

      exercises.push({
        block: activeBlock,
        content: value(rows[rowIndex], start),
        title,
        series: value(rows[rowIndex], start + 2),
        reps: value(rows[rowIndex], start + 3),
        load: value(rows[rowIndex], start + 4),
        time: value(rows[rowIndex], start + 5),
        rir: value(rows[rowIndex], start + 6),
        note: value(rows[rowIndex], start + 7),
        videoUrl: library.get(normalise(title)),
      });
    }

    if (!tasks.length && !exercises.length) continue;
    const isGym = exercises.length > 0;
    const minutes =
      tasks.reduce((sum, item) => sum + item.minutes, 0) || (isGym ? 35 : 0);

    sessions.push({
      id: sessionId(date),
      date: displayDate(date),
      day: dayOf(date),
      location: isGym ? "Ximnasio" : "Campo",
      title: tasks[0]?.title || "Sesión de ximnasio",
      minutes,
      rpe: tasks.length ? "—" : "6",
      tasks,
      exercises,
    });
  }

  return sessions;
}

export async function loadPublishedTeam(): Promise<TeamPlan> {
  const [libraryRows, ...published] = await Promise.all([
    publishedCsv(EXERCISES_GID),
    ...GIDS.map(publishedCsv),
    publishedCsv(MACRO_GID),
  ]);
  const library = exerciseLibrary(libraryRows);
  const sessions = published
    .slice(0, GIDS.length)
    .flatMap((rows) => parseMicrocycle(rows, library))
    .sort((a, b) => a.id.localeCompare(b.id));
  const macroRows = published[GIDS.length];

  if (!sessions.length) {
    throw new Error("Aínda non hai sesións publicadas");
  }

  return {
    sessions,
    macro: {
      weeks: value(macroRows[5], 0) || "—",
      load: value(macroRows[5], 5) || "—",
      intensity: value(macroRows[5], 15) || "—",
    },
    updatedAt: new Date().toISOString(),
  };
}
