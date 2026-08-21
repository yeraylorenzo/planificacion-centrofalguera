type TeamConfig = {
  type: "team";
  athlete: string;
};

type IndividualPlan = {
  ok: true;
  type: "individual";
  athlete: string;
  tabs: string[];
  libraryTab: string | null;
  sheets: Record<string, string[][]>;
  updatedAt: string;
};

type ObservationRequestBody = {
  action?: unknown;
  p?: unknown;
  code?: unknown;
  clave?: unknown;
  observation?: unknown;
  rpe?: unknown;
  session?: {
    id?: unknown;
    date?: unknown;
    day?: unknown;
    title?: unknown;
    planTab?: unknown;
  };
};

const GOOGLE_PLAN_SERVICE_URL =
  "https://script.google.com/macros/s/AKfycbxCi7YD5EAdXD66EfJaL_-elQdtpNGb6m_U0i1zaddPCWLsN329XWXW-QJ5rdPauG2a/exec";

// La caché persistente está en Apps Script. Esta caché de instancia evita
// solicitudes duplicadas sin mantener una planificación desactualizada horas.
const EDGE_PLAN_FRESH_MS = 2 * 60_000;
const EDGE_PLAN_STALE_MS = 24 * 60 * 60_000;
const GOOGLE_PLAN_TIMEOUT_MS = 45_000;

const planCache = new Map<
  string,
  { payload: IndividualPlan; freshUntil: number; staleUntil: number }
>();
const pendingPlans = new Map<string, Promise<IndividualPlan>>();

function normalizeAccessCode(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function responseHeaders() {
  return {
    "Cache-Control": "private, no-store, max-age=0",
    "X-Robots-Tag": "noindex, nofollow",
  };
}

async function fetchIndividualPlan(
  rawCode: string,
  normalizedCode: string,
  forceRefresh: boolean,
) {
  const cached = planCache.get(normalizedCode);
  if (!forceRefresh && cached && cached.freshUntil > Date.now()) {
    return cached.payload;
  }

  const pending = pendingPlans.get(normalizedCode);
  if (pending) return pending;

  const request = (async () => {
    const controller = new AbortController();
    // La respuesta normal ya llega desde la caché de Apps Script. Si Google no
    // responde pronto, devolvemos la última versión disponible en esta instancia.
    const timeout = setTimeout(() => controller.abort(), GOOGLE_PLAN_TIMEOUT_MS);

    try {
      const serviceUrl = new URL(GOOGLE_PLAN_SERVICE_URL);
      serviceUrl.searchParams.set("p", rawCode);
      if (forceRefresh) serviceUrl.searchParams.set("refresh", "1");
      const response = await fetch(serviceUrl, {
        cache: "no-store",
        redirect: "follow",
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });

      if (!response.ok) throw new Error("Google service unavailable");

      const payload = (await response.json()) as
        | IndividualPlan
        | { ok?: false; error?: string };

      if (
        !("type" in payload) ||
        payload.type !== "individual" ||
        payload.ok !== true
      ) {
        const message = "error" in payload ? payload.error ?? "" : "";
        throw new Error(
          /c[oó]digo/i.test(message)
            ? "INVALID_CODE"
            : "GOOGLE_SERVICE_UNAVAILABLE",
        );
      }

      planCache.set(normalizedCode, {
        payload,
        freshUntil: Date.now() + EDGE_PLAN_FRESH_MS,
        staleUntil: Date.now() + EDGE_PLAN_STALE_MS,
      });
      return payload;
    } finally {
      clearTimeout(timeout);
      pendingPlans.delete(normalizedCode);
    }
  })();

  pendingPlans.set(normalizedCode, request);
  return request;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const rawCode = url.searchParams.get("p")?.trim() ?? "";
  const normalizedCode = normalizeAccessCode(rawCode);
  const forceRefresh = url.searchParams.get("refresh") === "1";

  if (!normalizedCode) {
    return Response.json(
      { error: "Falta el código de acceso" },
      { status: 400, headers: responseHeaders() },
    );
  }

  if (normalizedCode === "xuvnacional" || normalizedCode === "xuv26") {
    const team: TeamConfig = {
      type: "team",
      athlete: "SD Conxo XUV Nacional",
    };
    return Response.json(team, { headers: responseHeaders() });
  }

  try {
    const plan = await fetchIndividualPlan(
      rawCode,
      normalizedCode,
      forceRefresh,
    );
    return Response.json(plan, { headers: responseHeaders() });
  } catch (error) {
    const cached = planCache.get(normalizedCode);
    // Un fallo de Google no debe dejar al deportista sin su planificación,
    // ni siquiera cuando acaba de pulsar "Actualizar".
    if (cached && cached.staleUntil > Date.now()) {
      return Response.json(cached.payload, { headers: responseHeaders() });
    }
    const timedOut = error instanceof Error && error.name === "AbortError";
    const invalidCode =
      error instanceof Error && error.message === "INVALID_CODE";
    return Response.json(
      {
        error: timedOut
          ? "La planificación está tardando demasiado en responder"
          : invalidCode
            ? "Código de acceso incorrecto"
            : "No se pudo conectar con Google",
      },
      {
        status: timedOut ? 504 : invalidCode ? 404 : 502,
        headers: responseHeaders(),
      },
    );
  }
}

function textValue(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

export async function POST(request: Request) {
  let body: ObservationRequestBody;

  try {
    body = (await request.json()) as ObservationRequestBody;
  } catch {
    return Response.json(
      { ok: false, error: "A observación non ten un formato válido." },
      { status: 400, headers: responseHeaders() },
    );
  }

  const rawCode = textValue(body.p ?? body.code ?? body.clave, 120);
  const observation = textValue(body.observation, 1500);
  const rpe = Number(body.rpe);
  const rawSession = body.session;
  const session = {
    id: textValue(rawSession?.id, 10),
    date: textValue(rawSession?.date, 24),
    day: textValue(rawSession?.day, 16),
    title: textValue(rawSession?.title, 180),
    planTab: textValue(rawSession?.planTab, 80),
  };

  if (
    body.action !== "save_observation" ||
    !rawCode ||
    !Number.isInteger(rpe) ||
    rpe < 1 ||
    rpe > 10 ||
    !/^\d{4}-\d{2}-\d{2}$/.test(session.id) ||
    !session.title
  ) {
    return Response.json(
      { ok: false, error: "Faltan datos para gardar a observación." },
      { status: 400, headers: responseHeaders() },
    );
  }

  const normalizedCode = normalizeAccessCode(rawCode);
  if (normalizedCode === "xuvnacional" || normalizedCode === "xuv26") {
    return Response.json(
      {
        ok: false,
        error: "As observacións individuais non están dispoñibles neste plan.",
      },
      { status: 400, headers: responseHeaders() },
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);

  try {
    const serviceResponse = await fetch(GOOGLE_PLAN_SERVICE_URL, {
      method: "POST",
      cache: "no-store",
      redirect: "follow",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        action: "save_observation",
        p: rawCode,
        observation,
        rpe,
        session,
      }),
      signal: controller.signal,
    });

    const payload = (await serviceResponse.json().catch(() => null)) as
      | {
          ok?: boolean;
          error?: string;
          savedAt?: string;
          type?: string;
        }
      | null;

    if (
      !serviceResponse.ok ||
      payload?.ok !== true ||
      payload.type !== "observation"
    ) {
      const invalidCode = /c[oó]digo/i.test(payload?.error ?? "");
      return Response.json(
        {
          ok: false,
          error: invalidCode
            ? "O código de acceso xa non é válido. Volve entrar no portal."
            : "Non se puido gardar a observación en Drive.",
        },
        {
          status: invalidCode ? 401 : 502,
          headers: responseHeaders(),
        },
      );
    }

    return Response.json(
      { ok: true, savedAt: payload.savedAt ?? new Date().toISOString() },
      { headers: responseHeaders() },
    );
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "AbortError";
    return Response.json(
      {
        ok: false,
        error: timedOut
          ? "Drive tardou demasiado en responder. Volve intentalo."
          : "Non se puido gardar a observación en Drive.",
      },
      {
        status: timedOut ? 504 : 502,
        headers: responseHeaders(),
      },
    );
  } finally {
    clearTimeout(timeout);
  }
}
