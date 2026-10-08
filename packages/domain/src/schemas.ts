import { z } from "zod";
export const uuid = z.uuid();
export const instant = z.iso.datetime();
export const localDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => {
    const d = new Date(v + "T12:00:00Z");
    return !Number.isNaN(+d) && d.toISOString().slice(0, 10) === v;
  }, "Enter a valid calendar date.");
export const activity = z.enum(["walk", "run_walk", "mobility"]);
export const safetyFlag = z.enum([
  "chest_pain",
  "fainting",
  "unusual_breathlessness",
  "acute_illness",
  "exercise_limiting_pain",
  "needs_clinician_guidance",
]);
const flags = z.array(safetyFlag).max(6);
const rev = z.number().int().nonnegative();
export const profileFields = {
  adultConfirmed: z.boolean(),
  heightCm: z.number().min(50).max(260).nullable().default(null),
  weightKg: z.number().min(20).max(500).nullable().default(null),
  timezone: z
    .string()
    .max(100)
    .refine((v) => {
      try {
        new Intl.DateTimeFormat("en", { timeZone: v });
        return true;
      } catch {
        return false;
      }
    }, "Choose a valid IANA timezone."),
  experience: z.enum(["beginner", "recreational"]),
  baselineWeeklyMinutes: z.number().min(0).max(2000).nullable(),
  longestComfortableMinutes: z.number().int().min(1).max(300).nullable(),
  runningRegularly: z.boolean(),
  preferences: z.array(activity).min(1).max(3),
  outdoorPreferred: z.boolean(),
  availability: z
    .array(
      z.strictObject({
        weekday: z.number().int().min(1).max(7),
        maxMinutes: z.number().int().min(5).max(60),
      }),
    )
    .max(7),
  safetyFlags: flags,
  safetyScreenCompletedAt: instant.nullable(),
};
export const profileInput = z.strictObject({
  ...profileFields,
  expectedRevision: rev,
});
export const profileSchema = z.strictObject({
  ...profileFields,
  id: uuid,
  revision: rev,
  updatedAt: instant,
});
export const goalFields = {
  kind: z.enum(["build_consistency", "walk_more", "start_run_walk"]),
  targetDate: localDate.nullable(),
  desiredSessionsPerWeek: z.number().int().min(1).max(5),
};
export const goalInput = z.strictObject({
  ...goalFields,
  expectedRevision: rev,
});
export const goalSchema = z.strictObject({
  ...goalFields,
  id: uuid,
  profileId: uuid,
  revision: rev,
  status: z.enum(["active", "archived"]),
  createdAt: instant,
});
export const sessionSchema = z.strictObject({
  id: uuid,
  date: localDate,
  kind: z.enum(["walk", "run_walk", "mobility", "rest"]),
  catalogVariantId: z.string().nullable(),
  durationMinutes: z.number().int().nonnegative(),
  effort: z.enum(["easy", "moderate", "none"]),
  location: z.enum(["outdoor", "indoor", "either"]),
  instructionIds: z.array(z.string()),
});
export const planSchema = z.strictObject({
  id: uuid,
  profileId: uuid,
  goalId: uuid,
  revision: rev,
  parentPlanId: uuid.nullable(),
  startDate: localDate,
  endDate: localDate,
  status: z.enum(["draft", "accepted", "superseded", "discarded"]),
  sessions: z.array(sessionSchema).length(7),
  explanation: z.string().max(1000),
  changeReasons: z.array(z.string()),
  source: z.enum(["ollama", "fallback"]),
  modelTag: z.string().nullable(),
  promptVersion: z.string(),
  policyVersion: z.string(),
  inputRevision: rev,
  createdAt: instant,
  acceptedAt: instant.nullable(),
});
export const logFields = {
  planSessionId: uuid.nullable(),
  date: localDate,
  activity,
  status: z.enum(["completed", "partial", "skipped"]),
  durationMinutes: z.number().min(0).max(1440),
  distanceMeters: z.number().min(0).max(200000).nullable(),
  perceivedEffort: z.number().int().min(1).max(10).nullable(),
  outdoors: z.boolean().nullable(),
  safetyFlags: flags,
  note: z.string().max(500).nullable(),
};
export const logInput = z.strictObject(logFields);
export const logPatch = z
  .strictObject(logFields)
  .partial()
  .extend({ expectedRevision: rev });
export const logSchema = z.strictObject({
  ...logFields,
  id: uuid,
  profileId: uuid,
  revision: rev,
  source: z.enum([
    "manual",
    "fixture",
    "health_connect",
    "healthkit",
    "strava",
    "garmin",
  ]),
  externalId: z.string().nullable(),
  createdAt: instant,
  updatedAt: instant,
});
export const checkFields = {
  sleepHours: z.number().min(0).max(24).nullable(),
  energy: z.number().int().min(1).max(5).nullable(),
  soreness: z.number().int().min(0).max(10).nullable(),
  safetyFlags: flags,
};
export const checkInput = z.strictObject({
  ...checkFields,
  expectedRevision: rev,
});
export const checkSchema = z.strictObject({
  ...checkFields,
  id: uuid,
  profileId: uuid,
  revision: rev,
  date: localDate,
  createdAt: instant,
  updatedAt: instant,
});
export const jobSchema = z.strictObject({
  id: uuid,
  status: z.enum(["queued", "running", "completed", "failed"]),
  mode: z.enum(["generate", "adapt"]),
  inputRevision: rev,
  planId: uuid.nullable(),
  errorCode: z.string().nullable(),
  createdAt: instant,
  finishedAt: instant.nullable(),
});
export type Profile = z.infer<typeof profileSchema>;
export type Goal = z.infer<typeof goalSchema>;
export type Plan = z.infer<typeof planSchema>;
export type Session = z.infer<typeof sessionSchema>;
export type WorkoutLog = z.infer<typeof logSchema>;
export type CheckIn = z.infer<typeof checkSchema>;
export type Job = z.infer<typeof jobSchema>;
export type ProfileInput = z.infer<typeof profileInput>;
export type LogInput = z.infer<typeof logInput>;
