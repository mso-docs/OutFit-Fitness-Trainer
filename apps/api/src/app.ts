import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import { z, ZodError } from "zod";
import { randomUUID, createHash, timingSafeEqual } from "node:crypto";
import { Store } from "./db";
import { createAI, type AIProvider } from "./ollama";
import { chatInput, createTrainer, type Trainer } from "./trainer";
import {
  importedActivitySchema,
  reconcileFixture,
  type ImportedActivity,
} from "./adapters/fixture";
import type { Config } from "./config";
import {
  profileInput,
  goalInput,
  logInput,
  logPatch,
  checkInput,
  localDate,
  uuid,
  type Plan,
} from "../../../packages/domain/src/schemas";
import {
  activeSafety,
  today,
  addDays,
  fallback,
  restrictions,
  progress,
  validateSessions,
  type Snapshot,
} from "../../../packages/domain/src/planning";
import {
  instructions,
  safetyMessage,
  urgentMessage,
} from "../../../packages/domain/src/catalog";
class Fault extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
const fail = (status: number, code: string, message: string): never => {
  throw new Fault(status, code, message);
};
const now = () => new Date().toISOString();
const generateInput = z.strictObject({
  startDate: localDate,
  expectedInputRevision: z.number().int().nonnegative(),
});
const revisionInput = z.strictObject({
  expectedInputRevision: z.number().int().nonnegative(),
});
const acceptInput = revisionInput.extend({
  expectedCurrentPlanId: uuid.nullable(),
});
const idOf = (req: FastifyRequest) =>
  uuid.parse((req.params as { id: string }).id);
export function buildApp(c: Config, provider?: AIProvider, trainer?: Trainer) {
  const app = Fastify({ logger: false, bodyLimit: 32768 });
  const store = new Store(c.database);
  const ai = provider ?? createAI(c.ollamaURL, c.timeout);
  const coach = trainer ?? createTrainer(c.ollamaURL, c.timeout);
  let chatController: AbortController | null = null;
  const chatRate: number[] = [];
  const pending = new Set<Promise<void>>();
  let epoch = 0;
  let closed = false;
  let busy = false;
  let generationController: AbortController | null = null;
  const rate: number[] = [];
  const profile = () => {
    const p = store.all("profiles")[0];
    return p
      ? { ...p, heightCm: p.heightCm ?? null, weightKg: p.weightKg ?? null }
      : null;
  };
  const goal = () =>
    store.all("goals").find((g) => g.status === "active") ?? null;
  const current = () =>
    store.all("plans").find((p) => p.status === "accepted") ?? null;
  const date = () => today(profile()?.timezone ?? "UTC");
  const latchedFlags = (): string[] =>
    JSON.parse(store.setting("safetyLatch") ?? "[]");
  const latchSafety = (flags: string[]) => {
    if (flags.length)
      store.setSetting(
        "safetyLatch",
        JSON.stringify([...new Set([...latchedFlags(), ...flags])]),
      );
  };
  const safety = () => [
    ...new Set([
      ...activeSafety(
        profile(),
        store.all("workout_logs"),
        store.all("daily_check_ins"),
      ),
      ...latchedFlags(),
    ]),
  ];
  const requireProfile = () =>
    profile() ?? fail(422, "PROFILE_REQUIRED", "Set up your profile first.");
  const assertRevision = (expected: number) => {
    if (expected !== store.revision())
      fail(
        409,
        "STALE_INPUT",
        "Your data changed. Refresh and review a new plan.",
      );
  };
  const assertSafety = () => {
    if (safety().length)
      fail(
        422,
        "SAFETY_BLOCKED",
        "Exercise recommendations are paused. Complete your safety screen after obtaining appropriate guidance.",
      );
  };
  const snapshot = (
    mode: "generate" | "adapt",
    startDate: string,
  ): Snapshot => ({
    profile: requireProfile(),
    goal: goal() ?? fail(422, "GOAL_REQUIRED", "Choose a goal first."),
    logs: store.all("workout_logs"),
    checks: store.all("daily_check_ins"),
    plans: store.all("plans"),
    current: current(),
    date: date(),
    startDate,
    mode,
    inputRevision: store.revision(),
  });
  app.addHook("onRequest", async (req, reply) => {
    reply
      .header("Cache-Control", "no-store")
      .header("X-Content-Type-Options", "nosniff")
      .header("Referrer-Policy", "no-referrer")
      .header(
        "Content-Security-Policy",
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'",
      );
    const origins = [c.origin, ...(c.devOrigin ? [c.devOrigin] : [])];
    const hosts = origins.map((o) => new URL(o).host);
    if (!hosts.includes(req.headers.host ?? ""))
      fail(403, "HOST_REJECTED", "This host is not allowed.");
    if (c.accessToken && req.url.startsWith("/api/")) {
      const supplied = Buffer.from(
        (req.headers.authorization ?? "").replace(/^Bearer /, ""),
      );
      const expected = Buffer.from(c.accessToken);
      if (
        supplied.length !== expected.length ||
        !timingSafeEqual(supplied, expected)
      )
        fail(403, "ACCESS_REQUIRED", "Enter the access token for this server.");
    }
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      if (req.headers.origin && !origins.includes(req.headers.origin))
        fail(403, "ORIGIN_REJECTED", "Cross-origin changes are not allowed.");
      if (req.headers["sec-fetch-site"] === "cross-site")
        fail(403, "ORIGIN_REJECTED", "Cross-site changes are not allowed.");
      if (
        !req.headers["content-type"]
          ?.toLowerCase()
          .startsWith("application/json")
      )
        fail(422, "JSON_REQUIRED", "Send application/json.");
    }
  });
  app.setErrorHandler((e, req, reply) => {
    if (e instanceof ZodError) {
      const fields: Record<string, string[]> = {};
      for (const issue of e.issues) {
        const path = issue.path.join(".") || "form";
        (fields[path] ??= []).push(issue.message);
      }
      return reply.code(422).send({
        error: {
          code: "INVALID_FIELDS",
          message: "Check the highlighted fields.",
          fieldErrors: fields,
        },
        requestId: req.id,
      });
    }
    const error = e as Error & { statusCode?: number };
    const status =
      e instanceof Fault
        ? e.status
        : error.statusCode === 400
          ? 400
          : error.statusCode === 413
            ? 413
            : 500;
    return reply.code(status).send({
      error: {
        code:
          e instanceof Fault
            ? e.code
            : status === 400
              ? "MALFORMED_JSON"
              : status === 413
                ? "BODY_TOO_LARGE"
                : "INTERNAL_ERROR",
        message:
          e instanceof Fault
            ? e.message
            : status === 400
              ? "The request is not valid JSON."
              : status === 413
                ? "The request is too large."
                : "Something went wrong. Try again.",
      },
      requestId: req.id,
    });
  });
  app.setNotFoundHandler((req, reply) =>
    reply.code(404).send({
      error: { code: "NOT_FOUND", message: "This resource was not found." },
      requestId: req.id,
    }),
  );
  const get = (
    path: string,
    handler: (req: FastifyRequest, reply: FastifyReply) => unknown,
  ) =>
    app.get("/api/v1" + path, async (req, reply) => ({
      data: await handler(req, reply),
    }));
  function idempotent(
    req: FastifyRequest,
    reply: FastifyReply,
    action: () => { status: number; data: unknown },
  ) {
    const key = uuid.parse(req.headers["idempotency-key"]);
    const signature = createHash("sha256")
      .update(req.method + " " + req.url + " " + JSON.stringify(req.body))
      .digest("hex");
    return store.transaction(() => {
      store.db.prepare("DELETE FROM idempotency WHERE expires_at<?").run(now());
      const saved = store.db
        .prepare("SELECT * FROM idempotency WHERE key=?")
        .get(key) as
        { signature: string; response: string; status: number } | undefined;
      if (saved) {
        if (saved.signature !== signature)
          fail(
            409,
            "IDEMPOTENCY_CONFLICT",
            "This request key was already used for different data.",
          );
        reply.code(saved.status);
        const parsed = JSON.parse(saved.response);
        if (saved.status === 202)
          reply.header("Location", "/api/v1/jobs/" + parsed.jobId);
        return { data: parsed };
      }
      const result = action();
      store.db
        .prepare("INSERT INTO idempotency VALUES (?,?,?,?,?)")
        .run(
          key,
          signature,
          JSON.stringify(result.data),
          result.status,
          new Date(Date.now() + 86400000).toISOString(),
        );
      reply.code(result.status);
      if (result.status === 202)
        reply.header(
          "Location",
          "/api/v1/jobs/" + (result.data as { jobId: string }).jobId,
        );
      return { data: result.data };
    });
  }
  get("/health", async () => {
    const status = await ai.models();
    return {
      app: "ok",
      database: "ok",
      ollama: status.available ? "available" : "unavailable",
      modelAvailable: status.models.some(
        (m) => m.tag === (store.setting("model") ?? c.model),
      ),
    };
  });
  get("/profile", () => profile());
  app.put("/api/v1/profile/measurements", async (req) => {
    const input = z
      .strictObject({
        heightCm: z.number().min(50).max(260).nullable(),
        weightKg: z.number().min(20).max(500).nullable(),
        expectedRevision: z.number().int().nonnegative(),
      })
      .parse(req.body);
    const old = requireProfile();
    if (input.expectedRevision !== old.revision)
      fail(409, "REVISION_CONFLICT", "Refresh before saving measurements.");
    const saved = {
      ...old,
      heightCm: input.heightCm,
      weightKg: input.weightKg,
      revision: old.revision + 1,
      updatedAt: now(),
    };
    store.transaction(() => {
      store.put("profiles", saved);
      store.bump();
    });
    return { data: saved };
  });
  app.post("/api/v1/trainer/chat", async (req) => {
    const { messages } = chatInput.parse(req.body);
    const p = requireProfile();
    if (safety().length)
      return { data: { source: "safety", answer: safetyMessage } };
    if (
      messages.some(
        (m) =>
          m.role === "user" &&
          /chest[ _-]?pain|faint(?:ing|ed)?|breathless|can't breathe|cannot breathe/i.test(
            m.content,
          ),
      )
    )
      return { data: { source: "safety", answer: urgentMessage } };
    if (
      messages.some(
        (m) =>
          m.role === "user" &&
          /\b(?:injur\w*|pain|diagnos\w*|medicat\w*|pregnan\w*|calorie\w*|supplement\w*)\b/i.test(
            m.content,
          ),
      )
    )
      return {
        data: {
          source: "safety",
          answer:
            "I can help with motivation and your saved plan, but medical questions and nutrition targets need qualified guidance. " +
            safetyMessage,
        },
      };
    if (chatController || busy)
      fail(409, "AI_BUSY", "The AI is working. Try again after it finishes.");
    const time = Date.now();
    while (chatRate.length && chatRate[0] < time - 60000) chatRate.shift();
    if (chatRate.length >= 5)
      fail(
        429,
        "RATE_LIMIT",
        "Please wait a minute before sending more messages.",
      );
    chatRate.push(time);
    const controller = new AbortController();
    chatController = controller;
    const requestEpoch = epoch;
    const requestRevision = store.revision();
    try {
      const result = await coach(
        messages,
        {
          date: date(),
          goal: goal()?.kind ?? null,
          experience: p.experience,
          acceptedSessions: current()?.sessions ?? [],
          recentActivity: progress(
            store.all("plans"),
            store.all("workout_logs"),
            date(),
            addDays(date(), -6),
            date(),
            p.timezone,
            store.supersededDates(),
          ),
          instructions,
        },
        store.setting("model") ?? c.model,
        controller.signal,
      );
      if (
        epoch !== requestEpoch ||
        store.revision() !== requestRevision ||
        safety().length
      )
        fail(
          409,
          "CONTEXT_CHANGED",
          "Your data changed. Start a fresh conversation.",
        );
      return { data: result };
    } finally {
      if (chatController === controller) chatController = null;
    }
  });
  app.put("/api/v1/profile", async (req) => {
    const input = profileInput.parse(req.body);
    return store.transaction(() => {
      const old = profile();
      if (input.expectedRevision !== (old?.revision ?? 0))
        fail(
          409,
          "REVISION_CONFLICT",
          "Your profile changed. Refresh before saving.",
        );
      if (
        new Set(input.availability.map((a) => a.weekday)).size !==
        input.availability.length
      )
        fail(422, "INVALID_AVAILABILITY", "Choose each weekday once.");
      if (
        input.safetyScreenCompletedAt &&
        input.safetyScreenCompletedAt > now()
      )
        fail(
          422,
          "INVALID_SCREEN",
          "The safety screen cannot be in the future.",
        );
      const previousScreen = old?.safetyScreenCompletedAt ?? null;
      const screenedAgain =
        input.safetyScreenCompletedAt !== null &&
        input.safetyScreenCompletedAt !== previousScreen;
      if (
        old?.safetyFlags.some((flag) => !input.safetyFlags.includes(flag)) &&
        !screenedAgain
      )
        fail(
          422,
          "SCREEN_REQUIRED",
          "Complete a new safety screen before clearing a safety flag.",
        );
      const { expectedRevision: _expected, ...fields } = input;
      const value = {
        ...fields,
        id: old?.id ?? randomUUID(),
        revision: (old?.revision ?? 0) + 1,
        updatedAt: now(),
        safetyScreenCompletedAt: screenedAgain
          ? now()
          : fields.safetyScreenCompletedAt,
      };
      store.put("profiles", value);
      if (screenedAgain && !value.safetyFlags.length)
        store.setSetting("safetyLatch", "[]");
      store.bump();
      return { data: value };
    });
  });
  get("/goals/active", () => goal());
  app.put("/api/v1/goals/active", async (req) => {
    const input = goalInput.parse(req.body);
    return store.transaction(() => {
      const p = requireProfile();
      const old = goal();
      if (input.expectedRevision !== (old?.revision ?? 0))
        fail(
          409,
          "REVISION_CONFLICT",
          "Your goal changed. Refresh before saving.",
        );
      if (input.desiredSessionsPerWeek > p.availability.length)
        fail(
          422,
          "INVALID_FREQUENCY",
          "Choose no more sessions than available days.",
        );
      if (old && old.kind !== input.kind)
        store.put("goals", { ...old, status: "archived" });
      const same = old?.kind === input.kind;
      const { expectedRevision: _expected, ...fields } = input;
      const value = {
        ...fields,
        id: same ? old!.id : randomUUID(),
        profileId: p.id,
        revision: same ? old!.revision + 1 : 1,
        status: "active" as const,
        createdAt: same ? old!.createdAt : now(),
      };
      store.put("goals", value);
      store.bump();
      return { data: value };
    });
  });
  async function runJob(jobId: string, s: Snapshot, jobEpoch: number) {
    const job = store.get("generation_jobs", jobId);
    if (!job) return;
    try {
      store.put("generation_jobs", { ...job, status: "running" });
      const base = fallback(s, randomUUID);
      const model = store.setting("model") ?? c.model;
      generationController = new AbortController();
      const result = await ai.propose(
        s,
        model,
        base,
        generationController.signal,
      );
      if (closed || jobEpoch !== epoch) return;
      store.transaction(() => {
        const latest = store.get("generation_jobs", jobId);
        if (!latest) return;
        if (store.revision() !== s.inputRevision) {
          store.put("generation_jobs", {
            ...latest,
            status: "failed",
            errorCode: "STALE_INPUT",
            finishedAt: now(),
          });
          return;
        }
        assertSafety();
        const errors = validateSessions(s, result.sessions);
        if (errors.length) throw new Error("PROVIDER_INVALID");
        const r = restrictions(s);
        if (
          result.sessions.filter((x) => x.kind !== "rest").length <
          s.goal.desiredSessionsPerWeek
        )
          r.reasons.push(
            "Your time and activity limits allow fewer sessions than preferred.",
          );
        const changes =
          s.mode === "adapt"
            ? result.sessions.flatMap((x) => {
                const old = s.current!.sessions.find((o) => o.date === x.date)!;
                return JSON.stringify({ ...old, id: "" }) ===
                  JSON.stringify({ ...x, id: "" })
                  ? []
                  : [
                      `${x.date}: ${old.kind.replace("_", "/")} ${old.durationMinutes} min → ${x.kind.replace("_", "/")} ${x.durationMinutes} min`,
                    ];
              })
            : [];
        const plan: Plan = {
          id: randomUUID(),
          profileId: s.profile.id,
          goalId: s.goal.id,
          revision: 1,
          parentPlanId: s.mode === "adapt" ? s.current!.id : null,
          startDate: s.startDate,
          endDate: addDays(s.startDate, 6),
          status: "draft",
          sessions: result.sessions,
          explanation: [
            ...r.reasons,
            "Easy activity fits your available time. Rest is part of the plan.",
            result.source === "fallback"
              ? "Local AI was unavailable or its proposal did not pass validation. This plan uses the deterministic planner."
              : "Local AI selected these activities within your approved limits.",
          ].join(" "),
          changeReasons: [...r.reasons, ...changes],
          source: result.source,
          modelTag: result.modelTag,
          promptVersion: "outfit-1",
          policyVersion: "outfit-1",
          inputRevision: s.inputRevision,
          createdAt: now(),
          acceptedAt: null,
        };
        store.put("plans", plan);
        store.put("generation_jobs", {
          ...latest,
          status: "completed",
          planId: plan.id,
          finishedAt: now(),
        });
      });
    } catch {
      if (!closed && jobEpoch === epoch) {
        const latest = store.get("generation_jobs", jobId);
        if (latest)
          store.put("generation_jobs", {
            ...latest,
            status: "failed",
            errorCode: "GENERATION_FAILED",
            finishedAt: now(),
          });
      }
    } finally {
      if (jobEpoch === epoch) {
        busy = false;
        generationController = null;
      }
    }
  }
  function enqueue(
    req: FastifyRequest,
    reply: FastifyReply,
    mode: "generate" | "adapt",
  ) {
    const input =
      mode === "generate"
        ? generateInput.parse(req.body)
        : revisionInput.parse(req.body);
    return idempotent(req, reply, () => {
      assertRevision(input.expectedInputRevision);
      assertSafety();
      if (busy || chatController)
        fail(409, "JOB_IN_PROGRESS", "A plan is already being prepared.");
      const old = current();
      if (mode === "adapt" && (!old || old.id !== idOf(req)))
        fail(
          409,
          "CURRENT_PLAN_REQUIRED",
          "Only your current plan can be adjusted.",
        );
      if (
        mode === "adapt" &&
        !old!.sessions.some(
          (x) =>
            x.date >= date() &&
            !store.all("workout_logs").some((l) => l.planSessionId === x.id),
        )
      )
        fail(
          422,
          "NO_FUTURE_SESSIONS",
          "There are no remaining sessions to adjust.",
        );
      const start =
        mode === "generate"
          ? (input as z.infer<typeof generateInput>).startDate
          : old!.startDate;
      if (
        mode === "generate" &&
        (start < date() || start > addDays(date(), 30))
      )
        fail(
          422,
          "INVALID_START_DATE",
          "Choose a start date from today through the next 30 days.",
        );
      if (mode === "generate" && old && start <= old.endDate)
        fail(
          422,
          "USE_ADAPTATION",
          "To change the current week, review an adjustment. Start a new week after the current plan ends.",
        );
      while (rate.length && rate[0] < Date.now() - 60000) rate.shift();
      if (rate.length >= 5)
        fail(
          429,
          "RATE_LIMITED",
          "Wait a minute before preparing another plan.",
        );
      rate.push(Date.now());
      const s = snapshot(mode, start);
      const id = randomUUID();
      store.put("generation_jobs", {
        id,
        status: "queued",
        mode,
        inputRevision: s.inputRevision,
        planId: null,
        errorCode: null,
        createdAt: now(),
        finishedAt: null,
      });
      busy = true;
      const jobEpoch = epoch;
      setImmediate(() => {
        if (closed || jobEpoch !== epoch) return;
        const promise = runJob(id, s, jobEpoch);
        pending.add(promise);
        void promise.finally(() => pending.delete(promise));
      });
      return { status: 202, data: { jobId: id } };
    });
  }
  app.post("/api/v1/plans/generate", async (req, reply) =>
    enqueue(req, reply, "generate"),
  );
  app.post("/api/v1/plans/:id/adapt", async (req, reply) =>
    enqueue(req, reply, "adapt"),
  );
  get(
    "/jobs/:id",
    (req) =>
      store.get("generation_jobs", idOf(req)) ??
      fail(404, "NOT_FOUND", "That plan request was not found."),
  );
  get("/plans/current", () => current());
  get(
    "/plans/:id",
    (req) =>
      store.get("plans", idOf(req)) ??
      fail(404, "NOT_FOUND", "That plan was not found."),
  );
  function paginate<T extends { id: string }>(items: T[], query: unknown) {
    const q = z
      .strictObject({
        cursor: uuid.optional(),
        limit: z.coerce.number().int().min(1).max(100).default(30),
      })
      .parse(query);
    const index = q.cursor ? items.findIndex((x) => x.id === q.cursor) + 1 : 0;
    if (q.cursor && index === 0)
      fail(422, "INVALID_CURSOR", "The pagination cursor is invalid.");
    const result = items.slice(index, index + q.limit);
    return {
      items: result,
      nextCursor: index + q.limit < items.length ? result.at(-1)!.id : null,
    };
  }
  get("/plans", (req) => paginate(store.all("plans").reverse(), req.query));
  app.post("/api/v1/plans/:id/accept", async (req) => {
    const input = acceptInput.parse(req.body);
    return store.transaction(() => {
      assertRevision(input.expectedInputRevision);
      assertSafety();
      const plan =
        store.get("plans", idOf(req)) ??
        fail(404, "NOT_FOUND", "That plan was not found.");
      if (
        plan.status !== "draft" ||
        plan.inputRevision !== store.revision() ||
        plan.goalId !== goal()?.id
      )
        fail(
          409,
          "STALE_DRAFT",
          "This preview is out of date. Prepare a new one.",
        );
      const old = current();
      if ((old?.id ?? null) !== input.expectedCurrentPlanId)
        fail(
          409,
          "CURRENT_PLAN_CHANGED",
          "Your current plan changed. Refresh and review again.",
        );
      if (old) {
        store.supersede(old.id, date());
        store.put("plans", { ...old, status: "superseded" });
      }
      const accepted = {
        ...plan,
        status: "accepted" as const,
        acceptedAt: now(),
        revision: plan.revision + 1,
      };
      store.put("plans", accepted);
      store.bump();
      return { data: accepted };
    });
  });
  app.post("/api/v1/plans/:id/discard", async (req) => {
    z.strictObject({}).parse(req.body);
    const p =
      store.get("plans", idOf(req)) ??
      fail(404, "NOT_FOUND", "That plan was not found.");
    if (p.status !== "draft")
      fail(409, "NOT_DRAFT", "Only a preview can be discarded.");
    const value = { ...p, status: "discarded" as const };
    store.put("plans", value);
    return { data: value };
  });
  const range = (query: unknown) => {
    const q = z
      .strictObject({
        from: localDate,
        to: localDate,
        cursor: uuid.optional(),
        limit: z.coerce.number().int().min(1).max(100).optional(),
      })
      .parse(query);
    if (q.from > q.to)
      fail(
        422,
        "INVALID_RANGE",
        "The start date must come before the end date.",
      );
    return q;
  };
  get("/logs", (req) => {
    const q = range(req.query);
    return paginate(
      store
        .all("workout_logs")
        .filter((l) => l.date >= q.from && l.date <= q.to)
        .reverse(),
      { cursor: q.cursor, limit: q.limit },
    );
  });
  function validateLog(input: z.infer<typeof logInput>, editingId?: string) {
    const p = requireProfile();
    if (input.date > date())
      fail(422, "FUTURE_DATE", "Log only today or a past date.");
    if (
      input.status === "skipped" &&
      (input.durationMinutes !== 0 ||
        input.distanceMeters !== null ||
        input.perceivedEffort !== null)
    )
      fail(
        422,
        "INVALID_SKIP",
        "Skipped sessions have zero minutes and no distance or effort.",
      );
    if (input.status !== "skipped" && input.durationMinutes <= 0)
      fail(
        422,
        "INVALID_DURATION",
        "Completed and partial sessions need a positive duration.",
      );
    if (input.planSessionId) {
      const session = store.get("plan_sessions", input.planSessionId);
      const accepted = store
        .all("plans")
        .some(
          (x) =>
            x.acceptedAt &&
            x.profileId === p.id &&
            x.sessions.some((s) => s.id === input.planSessionId),
        );
      if (
        !session ||
        !accepted ||
        session.kind === "rest" ||
        session.date !== input.date ||
        session.kind !== input.activity
      )
        fail(
          422,
          "INVALID_SESSION",
          "The planned activity and date must match this log.",
        );
      if (
        store
          .all("workout_logs")
          .some(
            (l) =>
              l.id !== editingId &&
              l.planSessionId === input.planSessionId &&
              l.source === "manual",
          )
      )
        fail(
          409,
          "DUPLICATE_LOG",
          "This session already has a log. Edit that log instead.",
        );
    }
  }
  app.post("/api/v1/logs", async (req, reply) => {
    const input = logInput.parse(req.body);
    return idempotent(req, reply, () => {
      validateLog(input);
      const value = {
        ...input,
        id: randomUUID(),
        profileId: requireProfile().id,
        revision: 1,
        source: "manual" as const,
        externalId: null,
        createdAt: now(),
        updatedAt: now(),
      };
      store.put("workout_logs", value);
      latchSafety(value.safetyFlags);
      store.bump();
      return { status: 201, data: value };
    });
  });
  app.patch("/api/v1/logs/:id", async (req) => {
    const input = logPatch.parse(req.body);
    return store.transaction(() => {
      const old =
        store.get("workout_logs", idOf(req)) ??
        fail(404, "NOT_FOUND", "That log was not found.");
      if (old.revision !== input.expectedRevision)
        fail(
          409,
          "REVISION_CONFLICT",
          "This log changed. Refresh before editing.",
        );
      const { expectedRevision: _expected, ...fields } = input;
      validateLog({ ...old, ...fields }, old.id);
      const value = {
        ...old,
        ...fields,
        revision: old.revision + 1,
        updatedAt: now(),
      };
      store.put("workout_logs", value);
      latchSafety(value.safetyFlags);
      store.bump();
      return { data: value };
    });
  });
  app.delete("/api/v1/logs/:id", async (req, reply) => {
    const q = z
      .strictObject({ expectedRevision: z.coerce.number().int().nonnegative() })
      .parse(req.query);
    store.transaction(() => {
      const old =
        store.get("workout_logs", idOf(req)) ??
        fail(404, "NOT_FOUND", "That log was not found.");
      if (old.revision !== q.expectedRevision)
        fail(
          409,
          "REVISION_CONFLICT",
          "This log changed. Refresh before deleting.",
        );
      store.deleteLog(old.id);
      store.bump();
    });
    return reply.code(204).send();
  });
  get("/check-ins", (req) => {
    const q = range(req.query);
    return store
      .all("daily_check_ins")
      .filter((x) => x.date >= q.from && x.date <= q.to);
  });
  app.put("/api/v1/check-ins/:date", async (req) => {
    const d = localDate.parse((req.params as { date: string }).date);
    const input = checkInput.parse(req.body);
    return store.transaction(() => {
      if (d > date())
        fail(422, "FUTURE_DATE", "Check in only for today or a past date.");
      const old = store.all("daily_check_ins").find((x) => x.date === d);
      if (input.expectedRevision !== (old?.revision ?? 0))
        fail(
          409,
          "REVISION_CONFLICT",
          "This check-in changed. Refresh before saving.",
        );
      const { expectedRevision: _expected, ...fields } = input;
      const value = {
        ...fields,
        id: old?.id ?? randomUUID(),
        profileId: requireProfile().id,
        revision: (old?.revision ?? 0) + 1,
        date: d,
        createdAt: old?.createdAt ?? now(),
        updatedAt: now(),
      };
      store.put("daily_check_ins", value);
      latchSafety(value.safetyFlags);
      store.bump();
      return { data: value };
    });
  });
  get("/progress", (req) => {
    const q = range(req.query);
    return progress(
      store.all("plans"),
      store.all("workout_logs"),
      date(),
      q.from,
      q.to,
      profile()?.timezone,
      store.supersededDates(),
    );
  });
  get("/ai/models", async () => ({
    ...(await ai.models()),
    selectedModel: (store.setting("model") ?? c.model) || null,
  }));
  const imported = (): ImportedActivity[] =>
    JSON.parse(store.setting("importedActivities") ?? "[]");
  get("/health/activities", () => imported().filter((a) => !a.deleted));
  app.post("/api/v1/health/activities/import", async (req) => {
    requireProfile();
    const { activities } = z
      .strictObject({ activities: z.array(importedActivitySchema).max(100) })
      .parse(req.body);
    const merged = reconcileFixture(
      new Map(imported().map((a) => [a.source + ":" + a.externalId, a])),
      activities,
    );
    if (merged.size > 2000)
      fail(
        422,
        "IMPORT_LIMIT",
        "Keep at most 2,000 imported records in this prototype.",
      );
    store.setSetting(
      "importedActivities",
      JSON.stringify([...merged.values()]),
    );
    return {
      data: {
        activeRecords: [...merged.values()].filter((a) => !a.deleted).length,
      },
    };
  });
  app.delete("/api/v1/health/activities", async () => {
    store.setSetting("importedActivities", "[]");
    return { data: { activeRecords: 0 } };
  });
  app.put("/api/v1/ai/model", async (req) => {
    const { tag } = z
      .strictObject({ tag: z.string().min(1).max(200) })
      .parse(req.body);
    const status = await ai.models();
    if (!status.models.some((m) => m.tag === tag))
      fail(
        422,
        "MODEL_UNAVAILABLE",
        "Choose a model installed in local Ollama.",
      );
    store.transaction(() => {
      store.setSetting("model", tag);
      store.bump();
    });
    return { data: { selectedModel: tag } };
  });
  get("/state", () => ({
    inputRevision: store.revision(),
    currentPlanId: current()?.id ?? null,
    safetyBlocked: !!safety().length,
    safetyFlags: safety(),
    today: date(),
  }));
  get("/catalog", () => ({ instructions }));
  app.get("/api/v1/data/export", async (_req, reply) =>
    reply
      .header(
        "Content-Disposition",
        'attachment; filename="outfit-export.json"',
      )
      .send({
        data: {
          schemaVersion: 1,
          planHistory: { supersededDates: store.supersededDates() },
          exportedAt: now(),
          profile: profile(),
          goals: store.all("goals"),
          plans: store.all("plans"),
          logs: store.all("workout_logs"),
          checkIns: store.all("daily_check_ins"),
          importedActivities: imported(),
        },
      }),
  );
  app.delete("/api/v1/data", async (req, reply) => {
    z.strictObject({ confirmation: z.literal("DELETE_MY_DATA") }).parse(
      req.body,
    );
    epoch++;
    chatController?.abort();
    generationController?.abort();
    generationController = null;
    busy = false;
    store.transaction(() => store.wipe());
    return reply.code(204).send();
  });
  app.addHook("onClose", async () => {
    closed = true;
    epoch++;
    chatController?.abort();
    generationController?.abort();
    await Promise.allSettled([...pending]);
    store.db.close();
  });
  return { app, store };
}
