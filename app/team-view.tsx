"use client";

import { useMemo, useState } from "react";
import {
  type TeamExercise,
  type TeamPlan,
  type TeamSession,
} from "./team-plan";

type TeamView = "session" | "week" | "load";
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

function countLabel(count: number, singular: string, plural: string) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function compactWeekDate(id: string) {
  const [, month, day] = id.split("-");
  return `${day} ${MONTH_NAMES[Number(month) - 1] ?? ""}`;
}

function localDateId(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Madrid",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function weekKey(id: string) {
  const date = new Date(`${id}T12:00:00`);
  const weekday = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - weekday);
  return date.toISOString().slice(0, 10);
}

function pickSession(sessions: TeamSession[]) {
  const today = localDateId();
  return (
    sessions.find((session) => session.id === today) ??
    sessions.find((session) => session.id > today) ??
    sessions.at(-1)
  );
}

function youtubeId(url?: string) {
  return (
    url?.match(
      /(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|shorts\/|embed\/))([\w-]{11})/,
    )?.[1] ?? ""
  );
}

export function TeamPlanView({
  plan,
  loading,
  onRefresh,
  onLogout,
}: {
  plan: TeamPlan;
  loading: boolean;
  onRefresh: () => void;
  onLogout: () => void;
}) {
  const initial = pickSession(plan.sessions) ?? plan.sessions[0];
  const [selectedId, setSelectedId] = useState(initial?.id ?? "");
  const [view, setView] = useState<TeamView>("session");
  const selected =
    plan.sessions.find((session) => session.id === selectedId) ??
    plan.sessions[0];
  const weekSessions = useMemo(
    () =>
      selected
        ? plan.sessions.filter(
            (session) => weekKey(session.id) === weekKey(selected.id),
          )
        : [],
    [plan.sessions, selected],
  );

  return (
    <main className="app-shell team-reader">
      <section className="brand-cover" aria-label="Centro Falguera">
        <img src="/centro-falguera-isotipo.png" alt="" />
        <div>
          <p>CENTRO FALGUERA</p>
          <h1>Preparación física</h1>
        </div>
        <span>SD CONXO</span>
      </section>

      <header className="topbar">
        <div className="athlete">
          <span>SC</span>
          <div>
            <p>PLAN DE ADESTRAMENTO</p>
            <h2>SD Conxo XUV Nacional</h2>
          </div>
        </div>
        <div className="top-actions">
          <button className="refresh" onClick={onRefresh} disabled={loading}>
            {loading ? "Actualizando…" : "Actualizar"}
          </button>
          <button className="logout" onClick={onLogout}>
            Saír
          </button>
        </div>
      </header>

      <section className="sync-note">
        <i />
        <span>Planificación do equipo sincronizada</span>
        <small>
          {new Intl.DateTimeFormat("gl-ES", {
            hour: "2-digit",
            minute: "2-digit",
          }).format(new Date(plan.updatedAt))}
        </small>
      </section>

      {selected ? (
        <>
          <section className="weekbar">
            <div>
              <p>SEMANA DO {compactWeekDate(weekKey(selected.id))}</p>
              <button
                onClick={() => {
                  const current = pickSession(plan.sessions);
                  if (current) setSelectedId(current.id);
                  setView("session");
                }}
              >
                Ir á sesión actual
              </button>
            </div>
            <div className="date-tabs">
              {weekSessions.map((session) => (
                <button
                  key={session.id}
                  className={selectedId === session.id ? "active" : ""}
                  onClick={() => {
                    setSelectedId(session.id);
                    setView("session");
                  }}
                >
                  <span>{session.day}</span>
                  <strong>{session.date.slice(0, 2)}</strong>
                  <small>{session.location}</small>
                </button>
              ))}
              <div className="session-count">
                <b>{weekSessions.length}</b>
                <span>{weekSessions.length === 1 ? "sesión" : "sesións"}</span>
              </div>
            </div>
          </section>

          <nav className="desktop-nav" aria-label="Vistas">
            <TeamNav view={view} setView={setView} />
          </nav>

          <div className="content">
            {view === "session" && <TeamSessionPanel session={selected} />}
            {view === "week" && (
              <TeamWeekPanel
                sessions={weekSessions}
                selected={selectedId}
                onSelect={(id) => {
                  setSelectedId(id);
                  setView("session");
                }}
              />
            )}
            {view === "load" && <TeamLoadPanel macro={plan.macro} />}
          </div>
        </>
      ) : (
        <section className="panel empty">
          <h3>Aínda non hai sesións publicadas</h3>
          <p>Aparecerán aquí ao completar a planificación do equipo.</p>
        </section>
      )}

      <nav className="mobile-nav team-mobile-nav" aria-label="Vistas">
        <TeamNav view={view} setView={setView} mobile />
      </nav>
    </main>
  );
}

function TeamNav({
  view,
  setView,
  mobile = false,
}: {
  view: TeamView;
  setView: (view: TeamView) => void;
  mobile?: boolean;
}) {
  const items = [
    ["session", "Sesión", "◌"],
    ["week", "Semana", "⌁"],
    ["load", "Carga", "▥"],
  ] as const;

  return (
    <>
      {items.map(([id, label, icon]) => (
        <button
          key={id}
          className={view === id ? "current" : ""}
          onClick={() => setView(id)}
        >
          <i>{icon}</i>
          {mobile ? <span>{label}</span> : label}
        </button>
      ))}
    </>
  );
}

function TeamSessionPanel({ session }: { session: TeamSession }) {
  const blocks = Array.from(
    new Set(session.exercises.map((exercise) => exercise.block)),
  );
  const isField = session.location === "Campo";

  return (
    <>
      <section className="session-hero">
        <p className="live">
          <i />
          {session.id === localDateId() ? "SESIÓN DE HOXE" : "SESIÓN PROGRAMADA"}{" "}
          · {session.day} · {session.date} · {session.location.toUpperCase()}
        </p>
        <div className="hero-copy">
          <div>
            <small>{isField ? "TRABALLO DE CAMPO" : "TRABALLO DE XIMNASIO"}</small>
            <h2>{session.title}</h2>
            <p>
              {isField
                ? "Todas as tarefas da sesión"
                : "Exercicios, series, repeticións e cargas"}
            </p>
          </div>
          <b>{isField ? "C" : "G"}</b>
        </div>
        <div className="hero-stats">
          <span>◷ {session.minutes || "—"} min</span>
          <span>◉ RPE {session.rpe}</span>
        </div>
      </section>

      {session.tasks.length > 0 && (
        <section className="panel">
          <div className="panel-head">
            <div>
              <p>PLAN DO DÍA</p>
              <h3>Orde da sesión</h3>
            </div>
            <span className="soft-tag">En orde</span>
          </div>
          <div className="task-list">
            {session.tasks.map((task, index) => (
              <article className="team-task" key={`${task.title}-${index}`}>
                <b>{String(index + 1).padStart(2, "0")}</b>
                <div>
                  <small>{task.phase || "TAREFA"}</small>
                  <h4>{task.title}</h4>
                  <p>
                    {[
                      task.objective,
                      task.format,
                      task.series && `${task.series} series`,
                      task.work,
                      task.rest && `pausa ${task.rest}`,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
                <aside>
                  <strong>{task.minutes || "—"}</strong>
                  <span>min</span>
                </aside>
              </article>
            ))}
          </div>
        </section>
      )}

      {blocks.length > 0 && (
        <section className="panel">
          <div className="panel-head">
            <div>
              <p>SESIÓN COMPLETA</p>
              <h3>Exercicios por bloques</h3>
            </div>
            <span className="soft-tag">Series · reps · peso</span>
          </div>
          <p className="hint">
            Respecta a orde, as repeticións, a carga e o RIR indicados.
          </p>
          <div className="exercise-blocks">
            {blocks.map((block, blockIndex) => {
              const exercises = session.exercises.filter(
                (exercise) => exercise.block === block,
              );
              return (
                <section className="exercise-block" key={block}>
                  <header>
                    <div>
                      <span>{String(blockIndex + 1).padStart(2, "0")}</span>
                      <h4>{block}</h4>
                    </div>
                    <small>
                      {countLabel(exercises.length, "exercicio", "exercicios")}
                    </small>
                  </header>
                  <div className="exercise-list">
                    {exercises.map((exercise, index) => (
                      <TeamExerciseCard
                        key={`${exercise.title}-${index}`}
                        exercise={exercise}
                        index={index}
                      />
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        </section>
      )}

      {!session.tasks.length && !session.exercises.length && (
        <section className="panel empty">
          <h3>Aínda non hai tarefas nesta sesión</h3>
          <p>Amosaranse automaticamente cando se complete a folla.</p>
        </section>
      )}
    </>
  );
}

function TeamExerciseCard({
  exercise,
  index,
}: {
  exercise: TeamExercise;
  index: number;
}) {
  const [videoOpen, setVideoOpen] = useState(false);
  const videoId = youtubeId(exercise.videoUrl);

  return (
    <article className="exercise team-exercise">
      <div className="exercise-number">
        <span>{String(index + 1).padStart(2, "0")}</span>
      </div>
      <div className="exercise-main">
        {exercise.content && <small>{exercise.content}</small>}
        <h4>{exercise.title}</h4>
        {exercise.note && <p>{exercise.note}</p>}
      </div>
      <div className="exercise-dose">
        <span>Series</span>
        <b>{exercise.series || "—"}</b>
      </div>
      <div className="exercise-dose prescription">
        <span>
          {exercise.load
            ? exercise.reps
              ? "Reps · peso"
              : "Peso"
            : exercise.time
              ? "Tempo"
              : "Reps"}
        </span>
        <b>
          {exercise.reps || (exercise.time ? `${exercise.time} s` : "")}
          {exercise.reps && exercise.load && <i>·</i>}
          {exercise.load && <small>{exercise.load} kg</small>}
        </b>
      </div>
      <div className="exercise-meta">
        {exercise.time && exercise.reps && <span>{exercise.time} s</span>}
        <span>RIR {exercise.rir || "—"}</span>
      </div>
      {videoId && (
        <div className="exercise-video">
          {videoOpen ? (
            <div className="video-player">
              <iframe
                src={`https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&playsinline=1&rel=0&modestbranding=1`}
                title={`Vídeo do exercicio: ${exercise.title}`}
                allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                loading="lazy"
                referrerPolicy="strict-origin-when-cross-origin"
              />
              <button type="button" onClick={() => setVideoOpen(false)}>
                Pechar vídeo
              </button>
            </div>
          ) : (
            <button
              className="video-preview"
              onClick={() => setVideoOpen(true)}
              type="button"
              aria-label={`Reproducir aquí o vídeo de ${exercise.title}`}
            >
              <img
                src={`https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`}
                alt=""
              />
              <span>
                <i>▶</i> Reproducir aquí
              </span>
            </button>
          )}
        </div>
      )}
    </article>
  );
}

function TeamWeekPanel({
  sessions,
  selected,
  onSelect,
}: {
  sessions: TeamSession[];
  selected: string;
  onSelect: (id: string) => void;
}) {
  const minutes = sessions.reduce(
    (total, session) => total + session.minutes,
    0,
  );

  return (
    <section className="panel week-panel">
      <div className="panel-head">
        <div>
          <p>PLANIFICACIÓN PUBLICADA</p>
          <h3>Vista semanal</h3>
        </div>
        <span className="soft-tag">Toca unha sesión</span>
      </div>
      <div className="timeline">
        {sessions.map((session) => (
          <button
            key={session.id}
            className={selected === session.id ? "selected" : ""}
            onClick={() => onSelect(session.id)}
          >
            <div className="day">
              <b>{session.day}</b>
              <span>{session.date}</span>
            </div>
            <div>
              <h4>{session.title}</h4>
              <p>
                {session.tasks.length
                  ? countLabel(session.tasks.length, "tarefa", "tarefas")
                  : countLabel(
                      session.exercises.length,
                      "exercicio",
                      "exercicios",
                    )}
              </p>
            </div>
            <aside>{session.location}</aside>
            <i>→</i>
          </button>
        ))}
      </div>
      <div className="week-total">
        <div>
          <b>{minutes} min</b>
          <span>volume programado</span>
        </div>
        <div>
          <b>{sessions.length}</b>
          <span>{sessions.length === 1 ? "sesión" : "sesións"}</span>
        </div>
      </div>
    </section>
  );
}

function TeamLoadPanel({ macro }: { macro: TeamPlan["macro"] }) {
  return (
    <>
      <section className="load-hero">
        <p>CARGA MACRO</p>
        <h2>
          {macro.load} <small>u.</small>
        </h2>
        <span>Carga planificada acumulada</span>
        <div>
          <p>
            Semanas con carga <b>{macro.weeks}</b>
          </p>
          <p>
            Intensidade media <b>{macro.intensity}</b>
          </p>
        </div>
      </section>
      <section className="panel">
        <div className="panel-head">
          <div>
            <p>LECTURA</p>
            <h3>Resumo automático</h3>
          </div>
        </div>
        <p className="hint">
          Os indicadores actualízanse ao abrir a web coa información publicada
          na folla do equipo.
        </p>
      </section>
    </>
  );
}
