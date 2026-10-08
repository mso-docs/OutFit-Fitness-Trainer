import type {
  Profile,
  Goal,
  Plan,
  Session,
  WorkoutLog,
  CheckIn,
} from "./schemas";
import { catalog, variant, assemble } from "./catalog";
export function today(timezone: string, now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}
export function addDays(date: string, n: number) {
  const d = new Date(date + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export function weekday(date: string) {
  return new Date(date + "T12:00:00Z").getUTCDay() || 7;
}
export interface Snapshot {
  profile: Profile;
  goal: Goal;
  logs: WorkoutLog[];
  checks: CheckIn[];
  plans: Plan[];
  current: Plan | null;
  date: string;
  startDate: string;
  mode: "generate" | "adapt";
  inputRevision: number;
}
export function activeSafety(
  p: Profile | null,
  logs: WorkoutLog[],
  checks: CheckIn[],
) {
  if (!p || !p.adultConfirmed || !p.safetyScreenCompletedAt)
    return ["screen_required"];
  const recent = [...logs, ...checks]
    .filter(
      (x) => x.safetyFlags.length && x.updatedAt >= p.safetyScreenCompletedAt!,
    )
    .flatMap((x) => x.safetyFlags);
  return [...new Set([...p.safetyFlags, ...recent])];
}
export function canonicalSessions(
  plans: Plan[],
  date: string,
  logs: WorkoutLog[],
  timezone = "UTC",
  supersededDates: Record<string, string> = {},
) {
  const m = new Map<string, Session>();
  const linked = new Set(logs.map((l) => l.planSessionId));
  const accepted = plans
    .filter((p) => p.acceptedAt)
    .sort((a, b) => a.acceptedAt!.localeCompare(b.acceptedAt!));
  for (let i = 0; i < accepted.length; i++) {
    const p = accepted[i];
    const next = accepted[i + 1];
    const cutoff =
      supersededDates[p.id] ??
      (next ? today(timezone, new Date(next.acceptedAt!)) : date);
    for (const s of p.sessions) {
      if (p.status === "accepted" || s.date < cutoff || linked.has(s.id))
        m.set(s.id, s);
    }
  }
  return [...m.values()];
}
export function progress(
  plans: Plan[],
  logs: WorkoutLog[],
  date: string,
  from: string,
  to: string,
  timezone = "UTC",
  supersededDates: Record<string, string> = {},
) {
  const observations = logs.filter((l) => l.date >= from && l.date <= to);
  const eligible = canonicalSessions(
    plans,
    date,
    logs,
    timezone,
    supersededDates,
  ).filter(
    (s) =>
      s.kind !== "rest" && s.date <= date && s.date >= from && s.date <= to,
  );
  const completed = eligible.filter((s) =>
    logs.some((l) => l.planSessionId === s.id && l.status === "completed"),
  ).length;
  return {
    actualMinutes: observations.reduce((n, l) => n + l.durationMinutes, 0),
    outdoorMinutes: observations.reduce(
      (n, l) => n + (l.outdoors === true ? l.durationMinutes : 0),
      0,
    ),
    completedPlannedSessions: completed,
    eligiblePlannedSessions: eligible.length,
    adherence: eligible.length ? completed / eligible.length : null,
  };
}
export function restrictions(s: Snapshot) {
  const { profile: p, goal: g, current, logs, checks, date } = s;
  const completed = logs
    .filter((l) => l.durationMinutes > 0 && l.date <= date)
    .sort((a, b) => b.date.localeCompare(a.date));
  const last = completed[0];
  const screenedSinceLast =
    last &&
    p.safetyScreenCompletedAt &&
    p.safetyScreenCompletedAt > last.updatedAt;
  const restart = !!last && addDays(last.date, 7) <= date && !screenedSinceLast;
  const foundation = !p.baselineWeeklyMinutes || restart;
  let weekly = foundation ? 30 : Math.min(p.baselineWeeklyMinutes!, 150);
  const cap = foundation ? 10 : Math.min(p.longestComfortableMinutes ?? 10, 45);
  const latest = checks
    .filter((c) => c.date <= date)
    .sort((a, b) => b.date.localeCompare(a.date))[0];
  const recentEffort = logs
    .filter((l) => l.date >= addDays(date, -7) && l.date <= date)
    .some((l) => l.perceivedEffort !== null && l.perceivedEffort >= 8);
  const low =
    (!!latest &&
      ((latest.energy !== null && latest.energy <= 2) ||
        (latest.sleepHours !== null && latest.sleepHours < 6) ||
        (latest.soreness !== null && latest.soreness >= 6))) ||
    recentEffort;
  const eligible =
    current?.sessions.filter((x) => x.kind !== "rest" && x.date < date) ?? [];
  const missed = eligible.filter(
    (x) =>
      !logs.some((l) => l.planSessionId === x.id && l.status !== "skipped"),
  ).length;
  const adherence = eligible.length
    ? eligible.filter((x) =>
        logs.some((l) => l.planSessionId === x.id && l.status === "completed"),
      ).length / eligible.length
    : null;
  const poor =
    missed >= 2 ||
    (eligible.length >= 2 && adherence !== null && adherence < 0.6);
  const mutable =
    current?.sessions.filter(
      (x) => x.date >= date && !logs.some((l) => l.planSessionId === x.id),
    ) ?? [];
  let remaining = weekly;
  let maxSessions = Math.min(g.desiredSessionsPerWeek, foundation ? 3 : 5);
  const reasons: string[] = [];
  if (foundation)
    reasons.push(
      restart
        ? "Returning after a break: start with short easy walks."
        : "A walking foundation keeps the first week small.",
    );
  if (
    g.kind === "start_run_walk" &&
    (!p.runningRegularly || foundation || p.longestComfortableMinutes === null)
  )
    reasons.push(
      "Running is deferred. Build a comfortable walking foundation first.",
    );
  if (low) {
    reasons.push(
      "Recovery is low: rest today and reduce the remaining activity.",
    );
    if (current)
      remaining = Math.floor(
        mutable.reduce((n, x) => n + x.durationMinutes, 0) * 0.8,
      );
  }
  if (poor) {
    reasons.push(
      "Make room for a smaller week; missed sessions do not need to be made up.",
    );
    if (current)
      maxSessions = Math.max(
        0,
        mutable.filter((x) => x.kind !== "rest").length - 1,
      );
  }
  if (current && s.mode === "adapt") {
    remaining = Math.min(
      remaining,
      mutable.reduce((n, x) => n + x.durationMinutes, 0),
    );
    maxSessions = Math.min(
      maxSessions,
      mutable.filter((x) => x.kind !== "rest").length,
    );
  }
  // A new week cannot increase prescribed volume without complete favorable observations.
  const previous = s.plans
    .filter((x) => x.acceptedAt && x.endDate < s.startDate)
    .sort(
      (a, b) =>
        b.endDate.localeCompare(a.endDate) ||
        b.acceptedAt!.localeCompare(a.acceptedAt!),
    )[0];
  if (previous && s.mode === "generate") {
    const sessions = previous.sessions.filter((x) => x.kind !== "rest");
    const actual = logs.filter(
      (l) =>
        l.date >= previous.startDate &&
        l.date <= previous.endDate &&
        l.status === "completed",
    );
    const weekChecks = checks.filter(
      (c) => c.date >= previous.startDate && c.date <= previous.endDate,
    );
    const favorable =
      previous.endDate === addDays(s.startDate, -1) &&
      sessions.length >= 2 &&
      sessions.filter((x) => actual.some((l) => l.planSessionId === x.id))
        .length /
        sessions.length >=
        0.8 &&
      actual.length >= 2 &&
      actual.every(
        (l) =>
          l.perceivedEffort !== null &&
          l.perceivedEffort >= 2 &&
          l.perceivedEffort <= 6 &&
          !l.safetyFlags.length,
      ) &&
      weekChecks.length >= 3 &&
      weekChecks.some((c) => c.date === previous.endDate) &&
      weekChecks.every(
        (c) =>
          c.energy !== null &&
          c.energy > 2 &&
          c.sleepHours !== null &&
          c.sleepHours >= 6 &&
          c.soreness !== null &&
          c.soreness < 6 &&
          !c.safetyFlags.length,
      ) &&
      !low;
    const actualMinutes = actual.reduce((n, l) => n + l.durationMinutes, 0);
    const priorMinutes = sessions.reduce((n, x) => n + x.durationMinutes, 0);
    weekly = Math.min(
      weekly,
      favorable
        ? Math.floor(actualMinutes + Math.min(5, actualMinutes * 0.05))
        : priorMinutes,
    );
    maxSessions = Math.min(maxSessions, sessions.length);
    if (!favorable)
      reasons.push(
        "Keep the week steady: there is not enough complete recovery and activity history to increase it.",
      );
  }
  return {
    foundation,
    weekly,
    cap,
    remaining,
    maxSessions,
    low,
    poor,
    reasons,
    run:
      !foundation &&
      g.kind === "start_run_walk" &&
      p.runningRegularly &&
      p.longestComfortableMinutes !== null,
  };
}
export function allowedVariants(s: Snapshot, date: string) {
  const r = restrictions(s);
  const time =
    s.profile.availability.find((a) => a.weekday === weekday(date))
      ?.maxMinutes ?? 0;
  const old = s.current?.sessions.find((x) => x.date === date);
  if (
    s.mode === "adapt" &&
    old &&
    (date < s.date || s.logs.some((l) => l.planSessionId === old.id))
  )
    return [variant(old.catalogVariantId ?? "rest")!];
  return catalog.filter(
    (v) =>
      v.kind === "rest" ||
      (!(r.low && date === s.date) &&
        v.duration <=
          Math.min(
            r.cap,
            time,
            s.mode === "adapt" ? (old?.durationMinutes ?? 0) : 45,
          ) &&
        (r.foundation
          ? v.kind === "walk"
          : v.kind === "walk" ||
            (v.kind === "run_walk" && r.run) ||
            (v.kind === "mobility" &&
              s.profile.preferences.includes("mobility")))),
  );
}
export function immutable(s: Snapshot, x: Session) {
  return (
    s.mode === "adapt" &&
    (x.date < s.date || s.logs.some((l) => l.planSessionId === x.id))
  );
}
export function validateSessions(s: Snapshot, sessions: Session[]) {
  const errors: string[] = [];
  const r = restrictions(s);
  let total = 0,
    mutableMinutes = 0,
    count = 0,
    mutableCount = 0;
  let lastRun: string | null = null,
    lastWalk: string | null = null;
  const before = s.plans
    .filter((p) => p.acceptedAt)
    .flatMap((p) => p.sessions)
    .filter((x) => x.date === addDays(s.startDate, -1));
  if (before.some((x) => x.kind === "run_walk"))
    lastRun = addDays(s.startDate, -1);
  if (sessions.length !== 7) errors.push("SEVEN_DAYS");
  for (let i = 0; i < 7; i++) {
    const x = sessions[i];
    if (!x || x.date !== addDays(s.startDate, i)) {
      errors.push("DATES");
      continue;
    }
    const old = s.current?.sessions.find((o) => o.date === x.date);
    if (old && immutable(s, old)) {
      if (JSON.stringify(old) !== JSON.stringify(x)) errors.push("IMMUTABLE");
      continue;
    }
    const v = variant(x.catalogVariantId ?? "rest");
    if (!v || !allowedVariants(s, x.date).some((a) => a.id === v.id)) {
      errors.push("VARIANT");
      continue;
    }
    const expected = assemble(x.date, v, x.id, s.profile.outdoorPreferred);
    if (JSON.stringify(x) !== JSON.stringify(expected))
      errors.push("CATALOG_CONTENT");
    if (x.kind !== "rest") {
      count++;
      mutableCount++;
      total += x.durationMinutes;
      mutableMinutes += x.durationMinutes;
    }
    if (x.kind === "run_walk") {
      if (lastRun === addDays(x.date, -1)) errors.push("RUN_SPACING");
      lastRun = x.date;
    }
    if (r.foundation && x.kind === "walk") {
      if (lastWalk === addDays(x.date, -1)) errors.push("WALK_SPACING");
      lastWalk = x.date;
    }
  }
  const fixed = sessions.filter((x) => immutable(s, x));
  const active = sessions.filter((x) => x.kind !== "rest").length;
  if (active > 5) errors.push("REST_DAYS");
  if (s.mode === "adapt") {
    if (mutableMinutes > r.remaining || mutableCount > r.maxSessions)
      errors.push("ADAPT_BUDGET");
  } else if (total > r.weekly || count > r.maxSessions) errors.push("BUDGET");
  // Immutable sessions retain their original approved content even when the schedule changes.
  if (fixed.some((x) => x.kind === "run_walk")) {
    for (let i = 1; i < sessions.length; i++)
      if (
        sessions[i - 1].kind === "run_walk" &&
        sessions[i].kind === "run_walk"
      )
        errors.push("RUN_SPACING");
  }
  return [...new Set(errors)];
}
export function fallback(s: Snapshot, newId: () => string) {
  const r = restrictions(s);
  let budget = s.mode === "adapt" ? r.remaining : r.weekly,
    count = 0,
    lastActive: string | null = null,
    lastRun: string | null = s.plans.some(
      (p) =>
        p.acceptedAt &&
        p.sessions.some(
          (x) => x.date === addDays(s.startDate, -1) && x.kind === "run_walk",
        ),
    )
      ? addDays(s.startDate, -1)
      : null;
  const sessions: Session[] = [];
  for (let i = 0; i < 7; i++) {
    const date = addDays(s.startDate, i);
    const old = s.current?.sessions.find((x) => x.date === date);
    if (old && immutable(s, old)) {
      sessions.push(old);
      if (old.kind === "run_walk") lastRun = date;
      if (old.kind !== "rest") lastActive = date;
      continue;
    }
    const choices = allowedVariants(s, date).filter(
      (v) =>
        v.kind !== "rest" &&
        v.duration <= budget &&
        (!r.foundation || lastActive !== addDays(date, -1)) &&
        (v.kind !== "run_walk" || lastRun !== addDays(date, -1)),
    );
    const preferred = r.run
      ? "run_walk"
      : s.profile.preferences.includes("walk") || r.foundation
        ? "walk"
        : "mobility";
    const max = Math.min(
      r.cap,
      r.foundation
        ? 10
        : Math.max(5, Math.floor(budget / Math.max(1, r.maxSessions - count))),
    );
    const v =
      count < r.maxSessions
        ? (choices
            .filter((v) => v.kind === preferred && v.duration <= max)
            .sort((a, b) => b.duration - a.duration)[0] ??
          choices
            .filter((v) => v.kind === "walk" && v.duration <= max)
            .sort((a, b) => b.duration - a.duration)[0])
        : undefined;
    const result = assemble(
      date,
      v ?? variant("rest")!,
      newId(),
      s.profile.outdoorPreferred,
    );
    sessions.push(result);
    if (v) {
      budget -= v.duration;
      count++;
      lastActive = date;
      if (v.kind === "run_walk") lastRun = date;
    }
  }
  const errors = validateSessions(s, sessions);
  if (errors.length) throw new Error("FALLBACK_INVALID:" + errors.join(","));
  return sessions;
}
