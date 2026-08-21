"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  type Exercise,
  loadServicePlan,
  type PublishedPlanPayload,
  type Session,
} from "./plan-parser";
import { loadPublishedTeam, type TeamPlan } from "./team-plan";
import { TeamPlanView } from "./team-view";

type View = "today" | "week";

type PlanResponse = {
  athlete: string;
  sessions: Session[];
  updatedAt: string;
  observationsEnabled: boolean;
};

type ObservationState = "idle" | "saving" | "saved" | "error";

const STORAGE_KEY = "centro-falguera-plan-code";
const PLAN_CACHE_KEY = "centro-falguera-plan-cache-v2";
// Conserva una apertura inmediata sin ocultar cambios de planificación durante horas.
const PLAN_CACHE_TTL = 5 * 60_000;
const TEAM_CODES = new Set(["xuvnacional", "xuv26"]);
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

function normaliseAccessCode(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

async function fetchIndividualPlan(
  accessCode: string,
  forceRefresh: boolean,
) {
  const serviceUrl = new URL("/api/plan", window.location.origin);
  serviceUrl.searchParams.set("p", accessCode);
  if (forceRefresh) serviceUrl.searchParams.set("refresh", "1");

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 55_000);

  try {
    const response = await fetch(serviceUrl, {
      cache: "no-store",
      redirect: "follow",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });

    const payload = (await response.json()) as
      | PublishedPlanPayload
      | { ok?: false; error?: string };

    if (!response.ok) {
      if (response.status === 404) throw new Error("INVALID_CODE");
      if (response.status === 504) throw new Error("TIMEOUT");
      throw new Error("SERVICE_UNAVAILABLE");
    }

    if (
      !("type" in payload) ||
      payload.type !== "individual" ||
      payload.ok !== true
    ) {
      const serviceError = "error" in payload ? payload.error ?? "" : "";
      throw new Error(
        /c[oó]digo/i.test(serviceError)
          ? "INVALID_CODE"
          : "SERVICE_UNAVAILABLE",
      );
    }

    return payload;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("TIMEOUT");
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

async function saveSessionObservation(
  accessCode: string,
  session: Session,
  observation: string,
  rpe: number,
) {
  const response = await fetch("/api/plan", {
    method: "POST",
    cache: "no-store",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      action: "save_observation",
      p: accessCode,
      observation,
      rpe,
      session: {
        id: session.id,
        date: session.date,
        day: session.day,
        title: session.title,
        planTab: session.planTab,
      },
    }),
  });

  const payload = (await response.json().catch(() => null)) as
    | { ok?: boolean; error?: string }
    | null;

  if (!response.ok || payload?.ok !== true) {
    throw new Error(payload?.error || "OBSERVATION_UNAVAILABLE");
  }
}

function readCachedPlan(accessCode: string) {
  try {
    const raw = window.sessionStorage.getItem(PLAN_CACHE_KEY);
    if (!raw) return null;
    const cached = JSON.parse(raw) as {
      code?: string;
      savedAt?: number;
      payload?: PublishedPlanPayload;
    };
    if (
      cached.code !== normaliseAccessCode(accessCode) ||
      typeof cached.savedAt !== "number" ||
      Date.now() - cached.savedAt > PLAN_CACHE_TTL ||
      cached.payload?.ok !== true ||
      cached.payload.type !== "individual"
    ) {
      return null;
    }
    return cached.payload;
  } catch {
    return null;
  }
}

function writeCachedPlan(accessCode: string, payload: PublishedPlanPayload) {
  try {
    window.sessionStorage.setItem(
      PLAN_CACHE_KEY,
      JSON.stringify({
        code: normaliseAccessCode(accessCode),
        savedAt: Date.now(),
        payload,
      }),
    );
  } catch {
    // A caché do navegador é unha mellora, non un requisito para entrar.
  }
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

function mondayOf(id: string) {
  const date = new Date(`${id}T12:00:00`);
  const weekday = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - weekday);
  return localDateId(date);
}

function compactDate(id: string) {
  const [, month, day] = id.split("-");
  return `${day} ${MONTH_NAMES[Number(month) - 1] ?? ""}`;
}

function pickInitialSession(sessions: Session[]) {
  const today = localDateId();
  const currentWeek = mondayOf(today);
  const sessionsThisWeek = sessions.filter(
    (session) => mondayOf(session.id) === currentWeek,
  );
  return (
    sessions.find((session) => session.id === today) ??
    sessionsThisWeek.find((session) => session.id > today) ??
    sessionsThisWeek.at(-1) ??
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

export default function Home() {
  const [accessCode, setAccessCode] = useState("");
  const [plan, setPlan] = useState<PlanResponse | null>(null);
  const [teamPlan, setTeamPlan] = useState<TeamPlan | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [view, setView] = useState<View>("today");
  const [loading, setLoading] = useState(false);
  const [slowLoading, setSlowLoading] = useState(false);
  const [error, setError] = useState("");

  const loadPlan = useCallback(async (code: string, forceRefresh = false) => {
    const cleanCode = code.trim();
    if (!cleanCode) return;

    setAccessCode(cleanCode);
    setLoading(true);
    setSlowLoading(false);
    setError("");
    const slowTimer = window.setTimeout(() => setSlowLoading(true), 6000);
    try {
      if (TEAM_CODES.has(normaliseAccessCode(cleanCode))) {
        const nextTeamPlan = await loadPublishedTeam();
        setTeamPlan(nextTeamPlan);
        setPlan(null);
        setSelectedId("");
      } else {
        const config =
          (!forceRefresh && readCachedPlan(cleanCode)) ||
          (await fetchIndividualPlan(cleanCode, forceRefresh));
        writeCachedPlan(cleanCode, config);
        const sessions = loadServicePlan(config);
        if (!sessions.length) throw new Error("EMPTY_PLAN");
        const nextPlan: PlanResponse = {
          athlete: config.athlete,
          sessions,
          updatedAt: config.updatedAt,
          observationsEnabled: config.capabilities?.observations === true,
        };
        const initial = pickInitialSession(nextPlan.sessions);
        setPlan(nextPlan);
        setTeamPlan(null);
        setSelectedId((current) =>
          nextPlan.sessions.some((session) => session.id === current)
            ? current
            : initial?.id ?? "",
        );
      }
      window.localStorage.setItem(STORAGE_KEY, cleanCode);
      window.history.replaceState({}, "", "/");
    } catch (caughtError) {
      // Si una actualización puntual falla, mantenemos el último plan visible
      // para no expulsar al deportista mientras Google se recupera.
      if (!forceRefresh) {
        setPlan(null);
        setTeamPlan(null);
        if (window.localStorage.getItem(STORAGE_KEY) === cleanCode) {
          window.localStorage.removeItem(STORAGE_KEY);
        }
      }
      const message =
        caughtError instanceof Error ? caughtError.message : "";
      setError(
        message === "INVALID_CODE"
          ? "Ese código de acceso non coincide con ningunha planificación publicada."
          : message === "TIMEOUT"
            ? "Google está tardando máis do habitual. Agarda un momento e volve premer Entrar."
            : message === "EMPTY_PLAN"
              ? "A planificación existe, pero aínda non contén sesións para amosar."
              : "Non puidemos conectar con Google neste momento. Volve premer Entrar.",
      );
    } finally {
      window.clearTimeout(slowTimer);
      setLoading(false);
      setSlowLoading(false);
    }
  }, []);

  useEffect(() => {
    const code =
      new URLSearchParams(window.location.search).get("p") ??
      window.localStorage.getItem(STORAGE_KEY) ??
      "";
    if (!code) return;
    const timeout = window.setTimeout(() => {
      void loadPlan(code);
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [loadPlan]);

  const logout = () => {
    window.localStorage.removeItem(STORAGE_KEY);
    window.history.replaceState({}, "", "/");
    setPlan(null);
    setTeamPlan(null);
    setAccessCode("");
    setError("");
  };

  const selected = useMemo(
    () =>
      plan?.sessions.find((session) => session.id === selectedId) ??
      plan?.sessions[0],
    [plan, selectedId],
  );

  const weekSessions = useMemo(() => {
    if (!plan || !selected) return [];
    const week = mondayOf(selected.id);
    return plan.sessions.filter((session) => mondayOf(session.id) === week);
  }, [plan, selected]);

  const availableWeeks = useMemo(() => {
    if (!plan) return [];
    return Array.from(
      new Set(plan.sessions.map((session) => mondayOf(session.id))),
    ).sort();
  }, [plan]);

  const selectedWeek = selected ? mondayOf(selected.id) : "";
  const selectedWeekIndex = availableWeeks.indexOf(selectedWeek);

  const changeWeek = (direction: -1 | 1) => {
    if (!plan || selectedWeekIndex < 0) return;
    const nextWeek = availableWeeks[selectedWeekIndex + direction];
    if (!nextWeek) return;
    const firstSession = plan.sessions.find(
      (session) => mondayOf(session.id) === nextWeek,
    );
    if (firstSession) setSelectedId(firstSession.id);
  };

  const goToday = () => {
    if (!plan) return;
    const target = pickInitialSession(plan.sessions);
    if (target) setSelectedId(target.id);
    setView("today");
  };

  if (teamPlan) {
    return (
      <TeamPlanView
        plan={teamPlan}
        loading={loading}
        onRefresh={() => loadPlan(accessCode)}
        onLogout={logout}
      />
    );
  }

  if (!plan) {
    return (
      <main className="access-shell">
        <section className="access-card">
          <BrandMark />
          <div className="access-copy">
            <p>PORTAL DE PLANIFICACIÓN</p>
            <h1>A túa sesión, clara e sempre actualizada.</h1>
            <span>
              Abre a ligazón que che enviou Centro Falguera ou introduce o teu
              código para acceder ao plan do teu equipo ou á túa readaptación.
            </span>
          </div>
          <form
            onSubmit={(event: FormEvent) => {
              event.preventDefault();
              loadPlan(accessCode);
            }}
          >
            <label htmlFor="access">Código de acceso</label>
            <div>
              <input
                id="access"
                value={accessCode}
                onChange={(event) => setAccessCode(event.target.value)}
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                placeholder="Introduce o teu código persoal"
              />
              <button disabled={loading || !accessCode.trim()}>
                {loading
                  ? slowLoading
                    ? "Cargando o teu plan…"
                    : "Abrindo…"
                  : "Entrar"}
              </button>
            </div>
          </form>
          {!loading && (
            <div className="access-wait-note">
              <span aria-hidden="true">i</span>
              <p>
                <strong>Normalmente ábrese en poucos segundos.</strong>
                A primeira carga tras unha actualización pode tardar algo máis.
              </p>
            </div>
          )}
          {loading && (
            <div className="access-loading" role="status" aria-live="polite">
              <i aria-hidden="true" />
              <p>
                <strong>
                  {slowLoading
                    ? "Seguimos cargando a túa planificación…"
                    : "Estamos abrindo a túa planificación…"}
                </strong>
                A primeira lectura tras un cambio pode tardar ata 1 minuto. Non
                peches nin recargues esta pantalla.
              </p>
            </div>
          )}
          {error && <p className="access-error">{error}</p>}
          <small>Centro Falguera · Preparación física e readaptación</small>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <section className="brand-cover" aria-label="Centro Falguera">
        <img src="/centro-falguera-isotipo.png" alt="" />
        <div>
          <p>CENTRO FALGUERA</p>
          <h1>Planificación individual</h1>
        </div>
        <span>READAPTACIÓN</span>
      </section>

      <header className="topbar">
        <div className="athlete">
          <span>{plan.athlete.slice(0, 1)}</span>
          <div>
            <p>PLAN DE ADESTRAMENTO</p>
            <h2>{plan.athlete}</h2>
          </div>
        </div>
        <div className="top-actions">
          <button
            className="refresh"
            onClick={() => loadPlan(accessCode, true)}
            disabled={loading}
          >
            {loading ? "Actualizando…" : "Actualizar"}
          </button>
          <button className="logout" onClick={logout}>
            Saír
          </button>
        </div>
      </header>

      <section
        className={error ? "sync-note sync-warning" : "sync-note"}
        role={error ? "status" : undefined}
        aria-live="polite"
      >
        <i />
        <span>{error || "Planificación sincronizada"}</span>
        {!error && (
          <small>
            {new Intl.DateTimeFormat("gl-ES", {
              hour: "2-digit",
              minute: "2-digit",
            }).format(new Date(plan.updatedAt))}
          </small>
        )}
      </section>

      {selected ? (
        <>
          <section className="weekbar">
            <div className="week-navigation">
              <button
                className="week-arrow"
                onClick={() => changeWeek(-1)}
                disabled={selectedWeekIndex <= 0}
                aria-label="Ver a semana anterior"
                title="Semana anterior"
              >
                ‹
              </button>
              <div className="week-heading">
                <p>SEMANA DO {compactDate(selectedWeek)}</p>
                <button className="week-current" onClick={goToday}>
                  Ir á sesión actual
                </button>
              </div>
              <button
                className="week-arrow"
                onClick={() => changeWeek(1)}
                disabled={selectedWeekIndex >= availableWeeks.length - 1}
                aria-label="Ver a semana seguinte"
                title="Semana seguinte"
              >
                ›
              </button>
            </div>
            <div className="date-tabs">
              {weekSessions.map((session) => (
                <button
                  key={session.id}
                  className={selectedId === session.id ? "active" : ""}
                  onClick={() => {
                    setSelectedId(session.id);
                    setView("today");
                  }}
                >
                  <span>{session.day}</span>
                  <strong>{session.displayDate.slice(0, 2)}</strong>
                  <small>
                    {countLabel(
                      session.exercises.length,
                      "exercicio",
                      "exercicios",
                    )}
                  </small>
                </button>
              ))}
              <div className="session-count">
                <b>{weekSessions.length}</b>
                <span>{weekSessions.length === 1 ? "sesión" : "sesións"}</span>
              </div>
            </div>
          </section>

          <nav className="desktop-nav" aria-label="Vistas">
            <button
              className={view === "today" ? "current" : ""}
              onClick={() => setView("today")}
            >
              <i>◌</i> Sesión
            </button>
            <button
              className={view === "week" ? "current" : ""}
              onClick={() => setView("week")}
            >
              <i>⌁</i> Semana
            </button>
          </nav>

          <div className="content">
            {view === "today" ? (
              <SessionPanel
                session={selected}
                accessCode={accessCode}
                athlete={plan.athlete}
                observationsEnabled={plan.observationsEnabled}
              />
            ) : (
              <WeekPanel
                sessions={weekSessions}
                selected={selectedId}
                onSelect={(id) => {
                  setSelectedId(id);
                  setView("today");
                }}
              />
            )}
          </div>
        </>
      ) : (
        <section className="panel empty">
          <h3>Aínda non hai sesións publicadas</h3>
          <p>Aparecerán aquí cando se complete a planificación.</p>
        </section>
      )}

      <nav className="mobile-nav" aria-label="Vistas">
        <button
          className={view === "today" ? "current" : ""}
          onClick={() => setView("today")}
        >
          <i>◌</i>
          <span>Sesión</span>
        </button>
        <button
          className={view === "week" ? "current" : ""}
          onClick={() => setView("week")}
        >
          <i>⌁</i>
          <span>Semana</span>
        </button>
      </nav>
    </main>
  );
}

function BrandMark() {
  return (
    <div className="brand-mark">
      <img src="/centro-falguera-isotipo.png" alt="" />
      <div>
        <p>CENTRO FALGUERA</p>
        <span>Readaptación e rendemento</span>
      </div>
    </div>
  );
}

function SessionPanel({
  session,
  accessCode,
  athlete,
  observationsEnabled,
}: {
  session: Session;
  accessCode: string;
  athlete: string;
  observationsEnabled: boolean;
}) {
  const blocks = Array.from(
    new Set(session.exercises.map((exercise) => exercise.block)),
  );
  const today = session.id === localDateId();

  return (
    <>
      <section className="session-hero">
        <p className="live">
          <i />
          {today ? "SESIÓN DE HOXE" : "SESIÓN PROGRAMADA"} · {session.day} ·{" "}
          {session.displayDate}
        </p>
        <div className="hero-copy">
          <div>
            <small>{session.location.toUpperCase()}</small>
            <h2>{session.title}</h2>
            <p>Todos os exercicios e doses da sesión</p>
          </div>
          <b>{session.exercises.length}</b>
        </div>
        <div className="hero-stats">
          <span>
            ◉ {countLabel(session.exercises.length, "exercicio", "exercicios")}
          </span>
          <span>✓ Plan actualizado</span>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <div>
            <p>SESIÓN COMPLETA</p>
            <h3>Exercicios por bloques</h3>
          </div>
          <span className="soft-tag">En orde</span>
        </div>
        <p className="hint">
          Respecta a orde, as cargas e as observacións indicadas en cada
          exercicio.
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
                    <ExerciseCard
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

      {observationsEnabled && (
        <SessionObservationForm
          key={session.id}
          accessCode={accessCode}
          athlete={athlete}
          session={session}
        />
      )}
    </>
  );
}

function SessionObservationForm({
  accessCode,
  athlete,
  session,
}: {
  accessCode: string;
  athlete: string;
  session: Session;
}) {
  const [observation, setObservation] = useState("");
  const [rpe, setRpe] = useState("");
  const [status, setStatus] = useState<ObservationState>("idle");

  const submitObservation = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = observation.trim();
    const selectedRpe = Number(rpe);
    if (!selectedRpe || status === "saving") return;

    setStatus("saving");
    try {
      await saveSessionObservation(accessCode, session, text, selectedRpe);
      setObservation("");
      setRpe("");
      setStatus("saved");
    } catch {
      setStatus("error");
    }
  };

  const fieldId = `observacion-${session.id}`;
  const rpeId = `rpe-${session.id}`;

  return (
    <section className="panel observation-panel">
      <div className="panel-head">
        <div>
          <p>AO REMATAR A SESIÓN</p>
          <h3>Rexistra como che foi</h3>
        </div>
        <span className="soft-tag">{athlete}</span>
      </div>
      <p className="hint">
        Ao acabar, indica o esforzo percibido e deixa, se o precisas,
        molestias, dificultade, cambios de carga ou calquera dato relevante.
      </p>
      <form className="observation-form" onSubmit={submitObservation}>
        <div className="feedback-fields">
          <div>
            <label htmlFor={rpeId}>RPE da sesión <span>(obrigatorio)</span></label>
            <select
              id={rpeId}
              value={rpe}
              onChange={(event) => {
                setRpe(event.target.value);
                if (status !== "saving") setStatus("idle");
              }}
              disabled={status === "saving"}
              required
            >
              <option value="">Escolle un valor do 1 ao 10</option>
              {Array.from({ length: 10 }, (_, index) => index + 1).map(
                (value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ),
              )}
            </select>
          </div>
        </div>
        <label htmlFor={fieldId}>
          Observacións da sesión <span>(opcional)</span>
        </label>
        <textarea
          id={fieldId}
          value={observation}
          onChange={(event) => {
            setObservation(event.target.value);
            if (status !== "saving") setStatus("idle");
          }}
          placeholder="Ex.: sen dor, pero a última serie resultou máis esixente."
          maxLength={1500}
          disabled={status === "saving"}
        />
        <div className="observation-actions">
          <small>
            {rpe ? `RPE ${rpe} · ` : ""}
            {observation.length}/1500
          </small>
          <button
            type="submit"
            disabled={!rpe || status === "saving"}
          >
            {status === "saving" ? "Gardando…" : "Gardar rexistro"}
          </button>
        </div>
      </form>
      <p
        className={`observation-feedback ${status}`}
        aria-live="polite"
        role={status === "error" ? "alert" : undefined}
      >
        {status === "saved"
          ? "RPE e observacións gardados en Drive."
          : status === "error"
            ? "Non se puido gardar o rexistro. Volve intentalo."
            : ""}
      </p>
    </section>
  );
}

function ExerciseCard({
  exercise,
  index,
}: {
  exercise: Exercise;
  index: number;
}) {
  const [videoOpen, setVideoOpen] = useState(false);
  const id = youtubeId(exercise.videoUrl);

  return (
    <article className="exercise">
      <div className="exercise-number">
        <span>{String(index + 1).padStart(2, "0")}</span>
      </div>
      <div className="exercise-main">
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
              ? "Reps · carga"
              : "Carga"
            : "Reps"}
        </span>
        <b>
          {exercise.reps || (!exercise.load ? "—" : "")}
          {exercise.reps && exercise.load && <i>·</i>}
          {exercise.load && <small>{exercise.load} kg</small>}
        </b>
      </div>
      {exercise.dose.length > 0 && (
        <div className="exercise-meta">
          {exercise.dose.map((item) => (
            <span key={item}>{item}</span>
          ))}
        </div>
      )}
      {id && (
        <div className="exercise-video">
          {videoOpen ? (
            <div className="video-player">
              <iframe
                src={`https://www.youtube-nocookie.com/embed/${id}?autoplay=1&playsinline=1&rel=0&modestbranding=1`}
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
                src={`https://i.ytimg.com/vi/${id}/hqdefault.jpg`}
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

function WeekPanel({
  sessions,
  selected,
  onSelect,
}: {
  sessions: Session[];
  selected: string;
  onSelect: (id: string) => void;
}) {
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
              <span>{session.displayDate}</span>
            </div>
            <div>
              <h4>{session.title}</h4>
              <p>
                {countLabel(
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
          <b>{sessions.length}</b>
          <span>{sessions.length === 1 ? "sesión" : "sesións"}</span>
        </div>
        <div>
          <b>
            {sessions.reduce(
              (total, session) => total + session.exercises.length,
              0,
            )}
          </b>
          <span>exercicios programados</span>
        </div>
      </div>
    </section>
  );
}
