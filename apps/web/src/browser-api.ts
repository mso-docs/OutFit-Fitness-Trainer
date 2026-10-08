import { z } from "zod";
import { APIError } from "./api";
import {
  profileInput,
  profileSchema,
  goalInput,
  goalSchema,
  logInput,
  logPatch,
  logSchema,
  checkInput,
  checkSchema,
  planSchema,
  jobSchema,
  localDate,
  type Profile,
  type Plan,
  type WorkoutLog,
  type CheckIn,
  type Job,
} from "../../../packages/domain/src/schemas";
import {
  activeSafety,
  today,
  addDays,
  fallback,
  restrictions,
  validateSessions,
  progress,
  type Snapshot,
} from "../../../packages/domain/src/planning";
import {
  instructions,
  safetyMessage,
  urgentMessage,
} from "../../../packages/domain/src/catalog";
import { createAI } from "../../api/src/ollama";
import { createTrainer, chatInput } from "../../api/src/trainer";
import {
  importedActivitySchema,
  reconcileFixture,
} from "../../api/src/adapters/fixture";
const key = `outfit:browser:v1:${new URL(".", location.href).pathname}`;
const database = z.object({
  revision: z.number().int().nonnegative(),
  idempotency: z
    .record(
      z.string(),
      z.object({ signature: z.string(), data: z.unknown(), at: z.number() }),
    )
    .default({}),
  profile: profileSchema.nullable(),
  goal: goalSchema.nullable(),
  plans: z.array(planSchema),
  logs: z.array(logSchema),
  checks: z.array(checkSchema),
  jobs: z.array(jobSchema),
  safetyLatch: z.array(z.string()),
  supersededDates: z.record(z.string(), z.string()),
  model: z.string(),
  ollamaURL: z.string(),
  imports: z.array(importedActivitySchema),
});
type Data = z.infer<typeof database>;
const empty = (): Data => ({
  revision: 0,
  idempotency: {},
  profile: null,
  goal: null,
  plans: [],
  logs: [],
  checks: [],
  jobs: [],
  safetyLatch: [],
  supersededDates: {},
  model: "",
  ollamaURL: "http://127.0.0.1:11434",
  imports: [],
});
const fail = (code: string, message: string): never => {
  throw new APIError(code, message);
};
function read(): Data {
  try {
    const raw = localStorage.getItem(key);
    return raw ? database.parse(JSON.parse(raw)) : empty();
  } catch {
    return fail(
      "STORAGE_INVALID",
      "Browser data is unreadable or storage is blocked. Export/recover your data before clearing site storage.",
    );
  }
}
function save(data: Data) {
  try {
    localStorage.setItem(key, JSON.stringify(database.parse(data)));
  } catch {
    return fail(
      "STORAGE_FULL",
      "Could not save browser data. Free browser storage and try again.",
    );
  }
}
const current = (d: Data) =>
  d.plans.find((p) => p.status === "accepted") ?? null;
const date = (d: Data) => today(d.profile?.timezone ?? "UTC");
const safety = (d: Data) => [
  ...new Set([...activeSafety(d.profile, d.logs, d.checks), ...d.safetyLatch]),
];
const requireProfile = (d: Data): Profile =>
  d.profile ?? fail("PROFILE_REQUIRED", "Set up your profile first.");
const revision = (d: Data, expected: number) => {
  if (d.revision !== expected)
    fail("STALE_INPUT", "Your data changed. Refresh before continuing.");
};
const safe = (d: Data) => {
  if (safety(d).length)
    fail(
      "SAFETY_BLOCKED",
      "Exercise recommendations are paused. Review your safety screen.",
    );
};
const latch = (d: Data, flags: string[]) => {
  d.safetyLatch = [...new Set([...d.safetyLatch, ...flags])];
};
const snap = (
  d: Data,
  mode: "generate" | "adapt",
  startDate: string,
): Snapshot => ({
  profile: requireProfile(d),
  goal: d.goal ?? fail("GOAL_REQUIRED", "Choose a goal first."),
  plans: d.plans,
  logs: d.logs,
  checks: d.checks,
  current: current(d),
  date: date(d),
  startDate,
  mode,
  inputRevision: d.revision,
});
function endpoint(input: string) {
  const u = new URL(input);
  if (
    !["http:", "https:"].includes(u.protocol) ||
    u.username ||
    u.password ||
    u.pathname !== "/" ||
    u.search ||
    u.hash
  )
    fail(
      "INVALID_ENDPOINT",
      "Use an HTTP(S) server origin without credentials or a path.",
    );
  return u.origin;
}
let generation: AbortController | null = null;
let chatting: AbortController | null = null;
const rate: number[] = [];
function throttle() {
  const t = Date.now();
  while (rate.length && rate[0] < t - 60000) rate.shift();
  if (rate.length >= 5)
    fail("RATE_LIMIT", "Wait a minute before another AI request.");
  rate.push(t);
}
const now = () => new Date().toISOString();
const id = () => crypto.randomUUID();
const page = <T>(items: T[]) => ({ items, nextCursor: null });
function validateLog(d: Data, log: z.infer<typeof logInput>, editing?: string) {
  requireProfile(d);
  if (log.date > date(d))
    fail("FUTURE_LOG", "Future activities cannot be logged.");
  if (
    log.status === "skipped" &&
    (log.durationMinutes !== 0 ||
      log.distanceMeters !== null ||
      log.perceivedEffort !== null)
  )
    fail(
      "INVALID_SKIP",
      "Skipped activities have zero minutes and no distance or effort.",
    );
  if (log.status !== "skipped" && log.durationMinutes <= 0)
    fail("INVALID_DURATION", "Record a positive duration.");
  if (log.planSessionId) {
    const session = d.plans
      .filter((p) => p.acceptedAt)
      .flatMap((p) => p.sessions)
      .find((s) => s.id === log.planSessionId);
    if (
      !session ||
      session.kind === "rest" ||
      session.date !== log.date ||
      session.kind !== log.activity
    )
      fail("INVALID_SESSION", "Match an accepted planned activity and date.");
    if (
      d.logs.some(
        (l) => l.id !== editing && l.planSessionId === log.planSessionId,
      )
    )
      fail("DUPLICATE_LOG", "Edit the existing session log instead.");
  }
}
async function runGeneration(
  jobId: string,
  s: Snapshot,
  base: string,
  model: string,
  controller: AbortController,
) {
  try {
    const result = await createAI(base, 60000).propose(
      s,
      model,
      fallback(s, id),
      controller.signal,
    );
    const commit = async () => {
      const d = read();
      const job = d.jobs.find((j) => j.id === jobId);
      if (!job || controller.signal.aborted) return;
      if (d.revision !== s.inputRevision || safety(d).length) {
        job.status = "failed";
        job.errorCode = "STALE_INPUT";
        save(d);
        return;
      }
      if (validateSessions(s, result.sessions).length)
        throw new Error("INVALID_PLAN");
      const r = restrictions(s);
      const p: Plan = {
        id: id(),
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
          result.source === "ollama"
            ? "Your AI selected activities within approved limits."
            : "AI was unavailable or invalid. This preview uses the fallback planner.",
        ].join(" "),
        changeReasons: r.reasons,
        source: result.source,
        modelTag: result.modelTag,
        promptVersion: "outfit-1",
        policyVersion: "outfit-1",
        inputRevision: s.inputRevision,
        createdAt: now(),
        acceptedAt: null,
      };
      d.plans.push(p);
      job.status = "completed";
      job.planId = p.id;
      job.finishedAt = now();
      save(d);
    };
    if (navigator.locks) await navigator.locks.request(key, commit);
    else await commit();
  } catch {
    const d = read();
    const job = d.jobs.find((j) => j.id === jobId);
    if (job) {
      job.status = "failed";
      job.errorCode = "GENERATION_FAILED";
      job.finishedAt = now();
      save(d);
    }
  } finally {
    if (generation === controller) generation = null;
  }
}
async function generate(
  jobId: string,
  s: Snapshot,
  base: string,
  model: string,
  controller: AbortController,
) {
  if (navigator.locks) {
    await navigator.locks.request(
      key + ":ai",
      { ifAvailable: true },
      async (lock) => {
        if (lock) return runGeneration(jobId, s, base, model, controller);
        const d = read();
        const job = d.jobs.find((j) => j.id === jobId);
        if (job) {
          job.status = "failed";
          job.errorCode = "AI_BUSY";
          job.finishedAt = now();
          save(d);
        }
        if (generation === controller) generation = null;
      },
    );
  } else await runGeneration(jobId, s, base, model, controller);
}
async function dispatch(
  path: string,
  method: string,
  body: unknown,
): Promise<unknown> {
  const d = read();
  const url = new URL(path, "http://local.invalid");
  const route = url.pathname;
  const part = route.split("/");
  const itemId = part[2];
  const stamp = now();
  if (method === "GET") {
    switch (route) {
      case "/profile":
        return d.profile;
      case "/goals/active":
        return d.goal;
      case "/plans/current":
        return current(d);
      case "/plans":
        return page([...d.plans].reverse());
      case "/logs":
        return page(
          d.logs.filter(
            (l) =>
              l.date >= (url.searchParams.get("from") ?? "") &&
              l.date <= (url.searchParams.get("to") ?? "9999"),
          ),
        );
      case "/check-ins":
        return d.checks.filter(
          (c) =>
            c.date >= (url.searchParams.get("from") ?? "") &&
            c.date <= (url.searchParams.get("to") ?? "9999"),
        );
      case "/state":
        return {
          inputRevision: d.revision,
          currentPlanId: current(d)?.id ?? null,
          safetyBlocked: !!safety(d).length,
          safetyFlags: safety(d),
          today: date(d),
        };
      case "/progress":
        return progress(
          d.plans,
          d.logs,
          date(d),
          url.searchParams.get("from")!,
          url.searchParams.get("to")!,
          d.profile?.timezone ?? "UTC",
          d.supersededDates,
        );
      case "/ai/models":
        return {
          ...(await createAI(endpoint(d.ollamaURL), 60000).models()),
          selectedModel: d.model || null,
        };
      case "/ai/connection":
        return { ollamaURL: d.ollamaURL };
      case "/health/activities":
        return d.imports.filter((a) => !a.deleted);
      case "/data/export":
        return {
          schemaVersion: 1,
          runtime: "browser",
          exportedAt: stamp,
          profile: d.profile,
          goals: d.goal ? [d.goal] : [],
          plans: d.plans,
          logs: d.logs,
          checkIns: d.checks,
          importedActivities: d.imports,
          planHistory: { supersededDates: d.supersededDates },
        };
    }
    if (part[1] === "plans")
      return (
        d.plans.find((p) => p.id === itemId) ??
        fail("NOT_FOUND", "Plan not found.")
      );
    if (part[1] === "jobs")
      return (
        d.jobs.find((j) => j.id === itemId) ??
        fail("NOT_FOUND", "Request not found.")
      );
  }
  if (route === "/profile" && method === "PUT") {
    const input = profileInput.parse(body);
    const old = d.profile;
    if (input.expectedRevision !== (old?.revision ?? 0))
      fail("REVISION_CONFLICT", "Refresh your profile before saving.");
    if (
      new Set(input.availability.map((a) => a.weekday)).size !==
      input.availability.length
    )
      fail("INVALID_AVAILABILITY", "Choose each weekday once.");
    if (input.safetyScreenCompletedAt && input.safetyScreenCompletedAt > stamp)
      fail("INVALID_SCREEN", "The screen cannot be in the future.");
    const screened =
      input.safetyScreenCompletedAt !== null &&
      input.safetyScreenCompletedAt !== old?.safetyScreenCompletedAt;
    if (
      old?.safetyFlags.some((f) => !input.safetyFlags.includes(f)) &&
      !screened
    )
      fail("SCREEN_REQUIRED", "Complete a new safety screen first.");
    const { expectedRevision: _revision, ...fields } = input;
    if (screened) {
      d.safetyLatch = [];
    }
    d.profile = {
      ...fields,
      id: old?.id ?? id(),
      revision: (old?.revision ?? 0) + 1,
      updatedAt: stamp,
    };
    latch(d, input.safetyFlags);
    d.revision++;
    save(d);
    return d.profile;
  }
  if (route === "/profile/measurements" && method === "PUT") {
    const p = requireProfile(d);
    const input = z
      .strictObject({
        expectedRevision: z.number().int(),
        heightCm: z.number().min(50).max(260).nullable(),
        weightKg: z.number().min(20).max(500).nullable(),
      })
      .parse(body);
    if (input.expectedRevision !== p.revision)
      fail("REVISION_CONFLICT", "Refresh before saving.");
    d.profile = {
      ...p,
      heightCm: input.heightCm,
      weightKg: input.weightKg,
      revision: p.revision + 1,
      updatedAt: stamp,
    };
    d.revision++;
    save(d);
    return d.profile;
  }
  if (route === "/goals/active" && method === "PUT") {
    const p = requireProfile(d);
    const input = goalInput.parse(body);
    if (input.expectedRevision !== (d.goal?.revision ?? 0))
      fail("REVISION_CONFLICT", "Refresh before saving your goal.");
    const { expectedRevision: _revision, ...fields } = input;
    d.goal = {
      ...fields,
      id: d.goal?.id ?? id(),
      profileId: p.id,
      revision: (d.goal?.revision ?? 0) + 1,
      status: "active",
      createdAt: d.goal?.createdAt ?? stamp,
    };
    d.revision++;
    save(d);
    return d.goal;
  }
  if (route === "/ai/connection" && method === "PUT") {
    const input = z
      .strictObject({ ollamaURL: z.string().max(500) })
      .parse(body);
    d.ollamaURL = endpoint(input.ollamaURL);
    d.model = "";
    d.revision++;
    save(d);
    return { ollamaURL: d.ollamaURL };
  }
  if (route === "/ai/model" && method === "PUT") {
    const { tag } = z
      .strictObject({ tag: z.string().min(1).max(200) })
      .parse(body);
    if (
      !(await createAI(endpoint(d.ollamaURL), 60000).models()).models.some(
        (m) => m.tag === tag,
      )
    )
      fail("MODEL_UNAVAILABLE", "Choose an installed model.");
    d.model = tag;
    d.revision++;
    save(d);
    return { selectedModel: tag };
  }
  if (
    method === "POST" &&
    (route === "/plans/generate" ||
      (part[1] === "plans" && part[3] === "adapt"))
  ) {
    const mode = part[3] === "adapt" ? "adapt" : "generate";
    const input = z
      .object({
        expectedInputRevision: z.number().int(),
        startDate: localDate.optional(),
      })
      .parse(body);
    revision(d, input.expectedInputRevision);
    safe(d);
    if (generation || chatting)
      fail("AI_BUSY", "Wait for your AI request to finish.");
    const old = current(d);
    if (mode === "adapt" && (!old || old.id !== itemId))
      fail("CURRENT_PLAN_REQUIRED", "Adjust your current plan.");
    const start =
      mode === "adapt" ? old!.startDate : localDate.parse(input.startDate);
    if (
      mode === "generate" &&
      (start < date(d) || start > addDays(date(d), 30))
    )
      fail("INVALID_START_DATE", "Start within the next 30 days.");
    if (mode === "generate" && old && start <= old.endDate)
      fail(
        "USE_ADAPTATION",
        "Adjust your current week or start after it ends.",
      );
    if (
      mode === "adapt" &&
      !old!.sessions.some(
        (x) =>
          x.date >= date(d) && !d.logs.some((l) => l.planSessionId === x.id),
      )
    )
      fail("NO_FUTURE_SESSIONS", "No remaining sessions to adjust.");
    throttle();
    const s = snap(d, mode, start);
    const job: Job = {
      id: id(),
      status: "running",
      mode,
      inputRevision: d.revision,
      planId: null,
      errorCode: null,
      createdAt: stamp,
      finishedAt: null,
    };
    d.jobs.push(job);
    save(d);
    const controller = new AbortController();
    generation = controller;
    setTimeout(() => {
      void generate(job.id, s, endpoint(d.ollamaURL), d.model, controller);
    }, 0);
    return { jobId: job.id };
  }
  if (part[1] === "plans" && method === "POST") {
    const p =
      d.plans.find((p) => p.id === itemId) ??
      fail("NOT_FOUND", "Plan not found.");
    if (part[3] === "discard") {
      if (p.status !== "draft")
        fail("NOT_DRAFT", "Only drafts can be discarded.");
      p.status = "discarded";
      save(d);
      return p;
    }
    if (part[3] === "accept") {
      const input = z
        .strictObject({
          expectedInputRevision: z.number().int(),
          expectedCurrentPlanId: z.uuid().nullable(),
        })
        .parse(body);
      revision(d, input.expectedInputRevision);
      safe(d);
      const old = current(d);
      if (
        p.status !== "draft" ||
        p.inputRevision !== d.revision ||
        p.goalId !== d.goal?.id
      )
        fail("STALE_DRAFT", "Prepare a fresh preview.");
      if (input.expectedCurrentPlanId !== (old?.id ?? null))
        fail("CURRENT_PLAN_CHANGED", "Your current plan changed.");
      const s = snap(d, p.parentPlanId ? "adapt" : "generate", p.startDate);
      if (validateSessions(s, p.sessions).length)
        fail("INVALID_PLAN", "Prepare a fresh preview.");
      if (old) {
        old.status = "superseded";
        d.supersededDates[old.id] = date(d);
      }
      p.status = "accepted";
      p.acceptedAt = stamp;
      p.revision++;
      d.revision++;
      save(d);
      return p;
    }
  }
  if (route === "/logs" && method === "POST") {
    const input = logInput.parse(body);
    validateLog(d, input);
    const log: WorkoutLog = {
      ...input,
      id: id(),
      profileId: requireProfile(d).id,
      revision: 1,
      source: "manual",
      externalId: null,
      createdAt: stamp,
      updatedAt: stamp,
    };
    d.logs.push(log);
    latch(d, log.safetyFlags);
    d.revision++;
    save(d);
    return log;
  }
  if (part[1] === "logs") {
    const old =
      d.logs.find((l) => l.id === itemId) ??
      fail("NOT_FOUND", "Log not found.");
    if (method === "PATCH") {
      const input = logPatch.parse(body);
      if (input.expectedRevision !== old.revision)
        fail("REVISION_CONFLICT", "Refresh before editing.");
      const { expectedRevision: _revision, ...fields } = input;
      validateLog(d, { ...old, ...fields }, old.id);
      Object.assign(old, fields, {
        revision: old.revision + 1,
        updatedAt: stamp,
      });
      latch(d, old.safetyFlags);
      d.revision++;
      save(d);
      return old;
    }
    if (method === "DELETE") {
      if (Number(url.searchParams.get("expectedRevision")) !== old.revision)
        fail("REVISION_CONFLICT", "Refresh before deleting.");
      d.logs = d.logs.filter((l) => l.id !== old.id);
      d.revision++;
      save(d);
      return undefined;
    }
  }
  if (part[1] === "check-ins" && method === "PUT") {
    const day = localDate.parse(itemId);
    if (day > date(d))
      fail("FUTURE_CHECK", "Future check-ins are unavailable.");
    const input = checkInput.parse(body);
    const old = d.checks.find((c) => c.date === day);
    if (input.expectedRevision !== (old?.revision ?? 0))
      fail("REVISION_CONFLICT", "Refresh before saving.");
    const { expectedRevision: _revision, ...fields } = input;
    const value: CheckIn = {
      ...fields,
      id: old?.id ?? id(),
      profileId: requireProfile(d).id,
      revision: (old?.revision ?? 0) + 1,
      date: day,
      createdAt: old?.createdAt ?? stamp,
      updatedAt: stamp,
    };
    d.checks = d.checks.filter((c) => c.date !== day);
    d.checks.push(value);
    latch(d, value.safetyFlags);
    d.revision++;
    save(d);
    return value;
  }
  if (route === "/health/activities/import" && method === "POST") {
    requireProfile(d);
    const { activities } = z
      .strictObject({ activities: z.array(importedActivitySchema).max(100) })
      .parse(body);
    const merged = reconcileFixture(
      new Map(d.imports.map((a) => [a.source + ":" + a.externalId, a])),
      activities,
    );
    if (merged.size > 2000)
      fail("IMPORT_LIMIT", "Limit imports to 2,000 records.");
    d.imports = [...merged.values()];
    save(d);
    return { activeRecords: d.imports.filter((a) => !a.deleted).length };
  }
  if (route === "/health/activities" && method === "DELETE") {
    d.imports = [];
    save(d);
    return { activeRecords: 0 };
  }
  if (route === "/trainer/chat" && method === "POST") {
    requireProfile(d);
    const { messages } = chatInput.parse(body);
    if (safety(d).length) return { source: "safety", answer: safetyMessage };
    if (
      messages.some(
        (m) =>
          m.role === "user" &&
          /chest[ _-]?pain|faint|breathless|can't breathe|cannot breathe/i.test(
            m.content,
          ),
      )
    )
      return { source: "safety", answer: urgentMessage };
    if (
      messages.some(
        (m) =>
          m.role === "user" &&
          /\b(?:injur\w*|pain|diagnos\w*|medicat\w*|pregnan\w*|calorie\w*|supplement\w*)\b/i.test(
            m.content,
          ),
      )
    )
      return { source: "safety", answer: safetyMessage };
    if (generation || chatting)
      fail("AI_BUSY", "Wait for your AI request to finish.");
    throttle();
    const controller = new AbortController();
    chatting = controller;
    try {
      const reply = await createTrainer(endpoint(d.ollamaURL), 60000)(
        messages,
        {
          date: date(d),
          goal: d.goal?.kind,
          experience: d.profile?.experience,
          acceptedSessions: current(d)?.sessions ?? [],
          recentActivity: progress(
            d.plans,
            d.logs,
            date(d),
            addDays(date(d), -6),
            date(d),
            d.profile?.timezone,
            d.supersededDates,
          ),
          instructions,
        },
        d.model,
        controller.signal,
      );
      if (read().revision !== d.revision || controller.signal.aborted)
        fail(
          "CONTEXT_CHANGED",
          "Your data changed. Start a fresh conversation.",
        );
      return reply;
    } finally {
      if (chatting === controller) chatting = null;
    }
  }
  if (route === "/data" && method === "DELETE") {
    z.strictObject({ confirmation: z.literal("DELETE_MY_DATA") }).parse(body);
    generation?.abort();
    chatting?.abort();
    generation = null;
    chatting = null;
    const fresh = empty();
    fresh.revision = d.revision + 1;
    save(fresh);
    return undefined;
  }
  return fail("NOT_SUPPORTED", "This action is unavailable in browser mode.");
}
export async function browserAPI<T>(
  path: string,
  method = "GET",
  body?: unknown,
  idempotencyKey?: string,
): Promise<T> {
  try {
    if (idempotencyKey) z.uuid().parse(idempotencyKey);
    const signature = idempotencyKey
      ? Array.from(
          new Uint8Array(
            await crypto.subtle.digest(
              "SHA-256",
              new TextEncoder().encode(JSON.stringify([path, method, body])),
            ),
          ),
        )
          .map((v) => v.toString(16).padStart(2, "0"))
          .join("")
      : "";
    const run = async () => {
      if (idempotencyKey) {
        const saved = read().idempotency[idempotencyKey];
        if (saved && Date.now() - saved.at < 86400000) {
          if (saved.signature !== signature)
            fail(
              "IDEMPOTENCY_CONFLICT",
              "Use a new request key for changed input.",
            );
          return saved.data;
        }
      }
      const result = await dispatch(path, method, body);
      if (idempotencyKey && result !== undefined) {
        const d = read();
        d.idempotency = Object.fromEntries(
          Object.entries(d.idempotency)
            .filter(([, v]) => Date.now() - v.at < 86400000)
            .slice(-49),
        );
        d.idempotency[idempotencyKey] = {
          signature,
          data: result,
          at: Date.now(),
        };
        save(d);
      }
      return result;
    };
    const result =
      method !== "GET" && path !== "/trainer/chat" && navigator.locks
        ? await navigator.locks.request(key, run)
        : await run();
    return result as T;
  } catch (e) {
    if (e instanceof APIError) throw e;
    if (e instanceof z.ZodError)
      throw new APIError(
        "INVALID_INPUT",
        e.issues[0]?.message ?? "Check your inputs.",
      );
    throw new APIError(
      "BROWSER_ERROR",
      "The browser operation failed. Your saved data was not intentionally cleared.",
    );
  }
}
