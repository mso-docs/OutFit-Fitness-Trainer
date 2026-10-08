import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import {
  snapshot,
  profile,
  goal,
  log,
  check,
  plan,
} from "../../../tests/fixtures/domain";
import {
  fallback,
  validateSessions,
  activeSafety,
  progress,
  restrictions,
  addDays,
  today,
  canonicalSessions,
} from "./planning";
import { catalog, assemble, variant } from "./catalog";
import { localDate, profileInput, logInput, planSchema } from "./schemas";
describe("deterministic activity policy", () => {
  it.each([null, 0])(
    "starts unknown/zero baseline %s at spaced short walks",
    (baseline) => {
      const s = snapshot({
        profile: profile({
          baselineWeeklyMinutes: baseline,
          experience: "recreational",
          preferences: ["run_walk"],
          runningRegularly: true,
        }),
      });
      const sessions = fallback(s, randomUUID);
      const active = sessions.filter((x) => x.kind !== "rest");
      expect(sessions).toHaveLength(7);
      expect(active.length).toBeLessThanOrEqual(3);
      expect(
        active.every(
          (x) =>
            x.kind === "walk" && x.durationMinutes <= 10 && x.effort === "easy",
        ),
      ).toBe(true);
      expect(validateSessions(s, sessions)).toEqual([]);
    },
  );
  it("honors consecutive-only availability without adjacent foundation walks", () => {
    const s = snapshot({
      profile: profile({
        availability: [1, 2, 3].map((weekday) => ({ weekday, maxMinutes: 60 })),
      }),
    });
    const a = fallback(s, randomUUID).filter((x) => x.kind !== "rest");
    expect(a.map((x) => x.date)).toEqual(["2026-10-05", "2026-10-07"]);
  });
  it("uses rest when no catalog activity fits", () => {
    const s = snapshot({
      profile: profile({
        baselineWeeklyMinutes: 3,
        longestComfortableMinutes: 2,
      }),
    });
    expect(fallback(s, randomUUID).every((x) => x.kind === "rest")).toBe(true);
  });
  it("supports no available days", () => {
    expect(
      fallback(
        snapshot({ profile: profile({ availability: [] }) }),
        randomUUID,
      ).every((x) => x.kind === "rest"),
    ).toBe(true);
  });
  it("caps weekly minutes, comfortable sessions and day limits", () => {
    const p = profile({
      baselineWeeklyMinutes: 37,
      longestComfortableMinutes: 11,
      availability: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
        weekday,
        maxMinutes: 60,
      })),
    });
    const s = snapshot({
      profile: p,
      goal: goal(p, { desiredSessionsPerWeek: 5 }),
    });
    const sessions = fallback(s, randomUUID);
    expect(
      sessions.reduce((n, x) => n + x.durationMinutes, 0),
    ).toBeLessThanOrEqual(37);
    expect(sessions.every((x) => x.durationMinutes <= 11)).toBe(true);
    expect(
      sessions.filter((x) => x.kind === "rest").length,
    ).toBeGreaterThanOrEqual(2);
  });
  it("defers running unless the profile is eligible", () => {
    const p = profile({
      baselineWeeklyMinutes: 90,
      longestComfortableMinutes: 30,
      runningRegularly: false,
    });
    const s = snapshot({
      profile: p,
      goal: goal(p, { kind: "start_run_walk" }),
    });
    expect(fallback(s, randomUUID).some((x) => x.kind === "run_walk")).toBe(
      false,
    );
  });
  it("spaces eligible runs across the previous week boundary", () => {
    const p = profile({
      baselineWeeklyMinutes: 90,
      longestComfortableMinutes: 30,
      runningRegularly: true,
    });
    const s = snapshot({
      profile: p,
      goal: goal(p, { kind: "start_run_walk" }),
    });
    const prior = plan(
      s,
      [assemble("2026-10-04", variant("run-walk-10")!, randomUUID(), true)],
      { endDate: "2026-10-04" },
    );
    s.plans = [prior];
    expect(fallback(s, randomUUID)[0].kind).not.toBe("run_walk");
  });
  it("catalog segments sum exactly and contain only known approved instructions", () => {
    for (const v of catalog)
      expect(v.segments.reduce((n, x) => n + x.minutes, 0)).toBe(v.duration);
  });
  it("strict schemas reject extras, invalid dates, infinity and missing null observations", () => {
    expect(localDate.safeParse("2026-02-30").success).toBe(false);
    const p = profile();
    const { id: _id, revision: _r, updatedAt: _u, ...fields } = p;
    expect(
      profileInput.safeParse({ ...fields, expectedRevision: 0, extra: true })
        .success,
    ).toBe(false);
    expect(
      profileInput.safeParse({
        ...fields,
        expectedRevision: 0,
        baselineWeeklyMinutes: Infinity,
      }).success,
    ).toBe(false);
    expect(
      logInput.safeParse({ date: "2026-10-05", durationMinutes: 0 }).success,
    ).toBe(false);
  });
  it("seven calendar dates survive DST and non-US timezones", () => {
    const s = snapshot({
      startDate: "2026-10-31",
      profile: profile({ timezone: "Asia/Kolkata" }),
    });
    expect(fallback(s, randomUUID).map((x) => x.date)).toEqual([
      "2026-10-31",
      "2026-11-01",
      "2026-11-02",
      "2026-11-03",
      "2026-11-04",
      "2026-11-05",
      "2026-11-06",
    ]);
    expect(today("America/New_York", new Date("2026-11-01T05:30:00Z"))).toBe(
      "2026-11-01",
    );
    expect(today("Asia/Kolkata", new Date("2026-10-07T20:00:00Z"))).toBe(
      "2026-10-08",
    );
  });
  it("persistently blocks symptoms until a later explicit screening", () => {
    const p = profile();
    const l = log(p, { safetyFlags: ["exercise_limiting_pain"] });
    expect(activeSafety(p, [l], [])).toContain("exercise_limiting_pain");
    expect(
      activeSafety(
        { ...p, safetyScreenCompletedAt: "2026-10-06T12:00:00Z" },
        [l],
        [],
      ),
    ).toEqual([]);
    expect(activeSafety({ ...p, adultConfirmed: false }, [], [])).toContain(
      "screen_required",
    );
  });
  it("rejects schema-valid unsafe proposals", () => {
    const s = snapshot();
    const sessions = fallback(s, randomUUID);
    sessions[0] = assemble(
      s.startDate,
      variant("walk-45")!,
      sessions[0].id,
      true,
    );
    expect(validateSessions(s, sessions)).toContain("VARIANT");
  });
  it("plan shapes round trip without losing links", () => {
    const s = snapshot();
    const value = plan(s, fallback(s, randomUUID));
    expect(planSchema.parse(JSON.parse(JSON.stringify(value)))).toEqual(value);
  });
});
describe("adaptation and progress", () => {
  it("low recovery rests today and reduces remaining minutes, preserving past and logged IDs", () => {
    const s = snapshot();
    const accepted = plan(s, fallback(s, randomUUID));
    const past = accepted.sessions[0];
    const future = accepted.sessions[4];
    s.mode = "adapt";
    s.current = accepted;
    s.date = "2026-10-07";
    s.checks = [check(s.profile, { date: s.date, energy: 2 })];
    s.logs = [
      log(s.profile, { planSessionId: past.id, date: past.date }),
      log(s.profile, {
        planSessionId: future.id,
        date: future.date,
        status: "skipped",
        durationMinutes: 0,
        perceivedEffort: null,
      }),
    ];
    const sessions = fallback(s, randomUUID);
    expect(sessions[0]).toEqual(past);
    expect(sessions[4]).toEqual(future);
    expect(sessions[2].kind).toBe("rest");
    expect(validateSessions(s, sessions)).toEqual([]);
  });
  it("missed sessions remove future workload without catch-up", () => {
    const s = snapshot();
    const accepted = plan(s, fallback(s, randomUUID));
    s.mode = "adapt";
    s.current = accepted;
    s.date = "2026-10-09";
    const r = restrictions(s);
    expect(r.poor).toBe(true);
    expect(fallback(s, randomUUID)[4].kind).toBe("rest");
  });
  it("favorable midweek observations cannot raise duration", () => {
    const s = snapshot();
    const accepted = plan(s, fallback(s, randomUUID));
    s.mode = "adapt";
    s.current = accepted;
    s.checks = [check(s.profile)];
    const changed = fallback(s, randomUUID);
    expect(
      changed.reduce((n, x) => n + x.durationMinutes, 0),
    ).toBeLessThanOrEqual(
      accepted.sessions.reduce((n, x) => n + x.durationMinutes, 0),
    );
  });
  it("rollover caps progression to actual volume plus at most 5% / 5 minutes", () => {
    const p = profile({
      baselineWeeklyMinutes: 150,
      longestComfortableMinutes: 45,
    });
    const initial = snapshot({ profile: p });
    const accepted = plan(initial, fallback(initial, randomUUID));
    const logs = accepted.sessions
      .filter((x) => x.kind !== "rest")
      .map((x) =>
        log(p, { planSessionId: x.id, date: x.date, durationMinutes: 10 }),
      );
    const checks = [0, 2, 6].map((i) =>
      check(p, { date: addDays(initial.startDate, i) }),
    );
    const next = snapshot({
      profile: p,
      plans: [accepted],
      logs,
      checks,
      startDate: "2026-10-12",
      date: "2026-10-12",
    });
    expect(restrictions(next).weekly).toBe(31);
    expect(
      fallback(next, randomUUID).reduce((n, x) => n + x.durationMinutes, 0),
    ).toBeLessThanOrEqual(31);
  });
  it("missing check-ins cannot increase a new week", () => {
    const p = profile({
      baselineWeeklyMinutes: 150,
      longestComfortableMinutes: 45,
    });
    const s = snapshot({ profile: p });
    const accepted = plan(s, fallback(s, randomUUID));
    const next = snapshot({
      profile: p,
      plans: [accepted],
      startDate: "2026-10-12",
      date: "2026-10-12",
    });
    expect(restrictions(next).weekly).toBeLessThanOrEqual(
      accepted.sessions.reduce((n, x) => n + x.durationMinutes, 0),
    );
  });
  it("a seven-day gap restarts walking foundation without silently clearing flags", () => {
    const p = profile({
      baselineWeeklyMinutes: 150,
      longestComfortableMinutes: 45,
    });
    const s = snapshot({
      profile: p,
      date: "2026-10-12",
      startDate: "2026-10-12",
      logs: [log(p, { date: "2026-10-05" })],
    });
    expect(restrictions(s).foundation).toBe(true);
  });
  it("partial and unplanned logs count actual minutes without marking planned completion", () => {
    const s = snapshot();
    const accepted = plan(s, fallback(s, randomUUID));
    const logs = [
      log(s.profile, {
        planSessionId: accepted.sessions[0].id,
        status: "partial",
        durationMinutes: 4,
      }),
      log(s.profile, { durationMinutes: 20, outdoors: null }),
    ];
    const result = progress(
      [accepted],
      logs,
      "2026-10-07",
      "2026-10-05",
      "2026-10-11",
    );
    expect(result.actualMinutes).toBe(24);
    expect(result.outdoorMinutes).toBe(4);
    expect(result.completedPlannedSessions).toBe(0);
    expect(result.eligiblePlannedSessions).toBe(2);
  });
  it("returns null adherence without eligible sessions", () => {
    expect(
      progress([], [], "2026-10-05", "2026-10-05", "2026-10-11").adherence,
    ).toBeNull();
  });
  it("counts retained IDs once and excludes future sessions superseded before their date", () => {
    const s = snapshot();
    const old = plan(s, fallback(s, randomUUID), { status: "superseded" });
    const newer = plan(s, fallback(s, randomUUID), {
      acceptedAt: "2026-10-07T12:00:00Z",
    });
    newer.sessions[0] = old.sessions[0];
    const history = canonicalSessions([old, newer], "2026-10-11", []);
    expect(history.filter((x) => x.id === old.sessions[0].id)).toHaveLength(1);
    expect(history.some((x) => x.id === old.sessions[4].id)).toBe(false);
  });
});

it("frozen supersession dates keep history fixed after a timezone change", () => {
  const s = snapshot();
  const old = plan(s, fallback(s, randomUUID), { status: "superseded" });
  const newer = plan(s, fallback(s, randomUUID), {
    acceptedAt: "2026-10-07T22:00:00Z",
  });
  const history = canonicalSessions(
    [old, newer],
    "2026-10-11",
    [],
    "Asia/Kolkata",
    { [old.id]: "2026-10-07" },
  );
  expect(history.some((x) => x.id === old.sessions[2].id)).toBe(false);
});
