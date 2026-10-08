> Naming clarification: **OutFit** is the project name. **Touch Grass** is the hackathon theme. The original supplied specification is preserved below.

# Touch Grass — Agent-ready MVP specification

Version: 1.0 · Date: October 7, 2026 · Status: ready for implementation

## 1. Product and goals

Touch Grass is a responsive, locally hosted web fitness trainer that helps an adult choose a realistic goal, get a seven-day activity plan, go outside, and adjust the plan using manually logged activity and recovery. Ollama runs inference on the same computer as the application server. The primary experience is a useful plan and a short daily action, rather than a chatbot.

**Core loop:** profile → goal → preview plan → accept → do activity → log → review suggested adjustment → accept.

Design for beginners and recreational exercisers who want consistency, more walking, or a gradual introduction to running. MVP goals are `build_consistency`, `walk_more`, and `start_run_walk`. A target date is motivational context, never a promise of readiness or a reason to accelerate training. Do not offer race performance, rehabilitation, or weight-loss prescriptions.

Success means a user can complete onboarding in about three minutes, understand today's activity in one screen, and log a completed session in under one minute. These are usability targets to verify with a walkthrough, not fabricated analytics results.

### Required scope

- One local user, one active goal, and one accepted plan at a time.
- Profile, weekly availability, recent activity baseline, activity preferences, and structured safety screening.
- Seven calendar days of activity/rest, with clear time, effort, and approved instructions.
- Local Ollama selection among permitted activities and explanatory personalization.
- Deterministic fallback plan if inference is unavailable or invalid.
- Manual workout logs, daily recovery check-ins, history, and simple progress summaries.
- Explicit plan acceptance and revision history; no silent replacement.
- Export all data as JSON and delete local data with an in-app confirmation.
- Responsive layouts, accessible forms, loading/error/empty states, local setup documentation, and meaningful automated tests.

### Excluded from MVP

Accounts, cloud hosting/inference, social features, payments, GPS routes, maps, weather, push reminders, calorie targets, nutrition, HR-based prescription, live wearable sync, medical diagnosis, unlimited coach chat, and native apps. No imported health metrics are required for the product to work. Future adapters are interfaces and a fixture implementation only.

## 2. Product flows and screens

1. **Onboarding:** confirm adult use; collect timezone, experience, baseline weekly minutes and longest comfortable session, goal, preferred activities, available weekdays/time limits, outdoor preference, and structured health flags. Explain local storage and the app's general fitness scope. Save progress with inline validation. A blocked safety screen still allows logging/history but prevents exercise prescriptions.
2. **Today:** date, accepted session, approved effort cue, start/log action, and optional recovery check-in. If no plan, show a create-plan action. If Ollama is offline, distinguish saved-plan access from fallback generation. A rest day is a complete daily recommendation.
3. **Plan:** seven-day list; show training minutes, rest days, goal, source (`ollama` or `fallback`), and why a revision changed. Preview before acceptance. Discarding a draft leaves the current plan intact.
4. **Log:** completed/partial/skipped, actual duration, optional distance and perceived effort, pain/symptoms, and optional note. Allow unplanned sessions. One tap to prefill planned duration; never auto-report completion.
5. **Progress:** completed planned sessions / eligible planned sessions, actual minutes, outdoor minutes, and a history list. Exclude rest days from adherence. Distinguish missing logs from skips; unknown effort/recovery stays unknown. No invented calorie or readiness scores.
6. **Settings:** edit profile/goal, select a locally installed model, view local AI status, export/delete data, and view integration placeholders marked unavailable.

Use calm, direct language. No punishment for missed days, streak guilt, or promises of health outcomes. At 360px width, use a single column and no horizontal overflow. Support keyboard navigation, visible focus, labelled inputs, inline errors, live status announcements, and sufficient contrast. Never require color alone to convey state.

## 3. Architecture and stack

Suggested implementation: TypeScript; React + Vite frontend; Fastify API; Zod runtime schemas; SQLite with Drizzle ORM and migrations; Vitest for domain/API tests; Playwright for critical browser flows. Use a supported Node LTS, compatible stable dependency versions, and a committed lockfile. These are implementation choices, not claims that a particular version is latest.

```text
Browser (desktop or phone)
    │ same-origin /api/v1
    ▼
Local Fastify server ── SQLite database
    │
    ├── Profile / Goal / Log services
    ├── Deterministic plan policy + approved activity catalog
    ├── Plan draft validator + revision service
    ├── Future adapter interface + fixture adapter
    └── Ollama client ── http://127.0.0.1:11434
```

Serve the built frontend and API from the same origin. During development, Vite proxies `/api` to the local API. Only the server calls Ollama; a phone's `localhost` points to the phone, not the user's laptop. Responsive UI does not imply phone-hosted inference or standalone offline phone access.

Default app bind address is `127.0.0.1`. A same-computer browser is the supported MVP runtime. For optional phone demos, document a trusted private network or secure tunnel with authentication; require an access token/session protection before opting into a non-loopback bind. Do not expose Ollama itself. An HTTPS context is needed if later adding service-worker capabilities; PWA/offline caching is outside MVP.

Configuration: `APP_HOST`, `APP_PORT`, `DATABASE_PATH`, `OLLAMA_BASE_URL` (default loopback), `OLLAMA_MODEL` (required local installed model), and `OLLAMA_TIMEOUT_MS` (default 60000). Fail startup for a non-loopback Ollama URL in MVP. Model choice depends on hardware and license; record the tested model tag/digest and Ollama version in the README rather than assuming all machines can run a particular model.

Suggested boundaries:

```text
apps/web/src/{pages,components,api}
apps/api/src/{routes,services,repositories,ollama,adapters}
packages/domain/src/{schemas,policy,catalog,planning,metrics}
apps/api/migrations/
tests/{fixtures,e2e}
```

Domain policy is pure and independently testable. Route handlers validate and delegate. SQLite foreign keys, transactions, unique constraints, and revision checks enforce ownership and consistency. Store timestamps in UTC; use the profile's IANA timezone to derive calendar dates. Explicit plan dates remain fixed if timezone changes; warn and regenerate future dates intentionally.

## 4. Typed domain models

The following TypeScript shapes are normative. Implement matching strict Zod schemas, reject unknown keys, and generate the transport JSON Schema from structural schemas. Cross-field rules must run separately in application code. IDs and revisions are server-owned. Missing optional numeric observations use `null`, never zero.

```ts
type UUID = string;
type Instant = string; // ISO 8601 UTC
type LocalDate = string; // YYYY-MM-DD, validated calendar date
type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7; // ISO Monday=1
type Activity = "walk" | "run_walk" | "mobility";
type GoalKind = "build_consistency" | "walk_more" | "start_run_walk";
type SafetyFlag =
  | "chest_pain"
  | "fainting"
  | "unusual_breathlessness"
  | "acute_illness"
  | "exercise_limiting_pain"
  | "needs_clinician_guidance";

interface Profile {
  id: UUID;
  revision: number;
  updatedAt: Instant;
  adultConfirmed: boolean;
  timezone: string;
  experience: "beginner" | "recreational";
  baselineWeeklyMinutes: number | null;
  longestComfortableMinutes: number | null;
  runningRegularly: boolean;
  preferences: Activity[];
  outdoorPreferred: boolean;
  availability: { weekday: Weekday; maxMinutes: number }[];
  safetyFlags: SafetyFlag[];
  safetyScreenCompletedAt: Instant | null;
}
interface Goal {
  id: UUID;
  profileId: UUID;
  revision: number;
  kind: GoalKind;
  targetDate: LocalDate | null;
  desiredSessionsPerWeek: number;
  status: "active" | "archived";
  createdAt: Instant;
}
interface PlanSession {
  id: UUID;
  date: LocalDate;
  kind: Activity | "rest";
  catalogVariantId: string | null;
  durationMinutes: number; // total incl. warm-up/cool-down; rest=0
  effort: "easy" | "moderate" | "none";
  location: "outdoor" | "indoor" | "either";
  instructionIds: string[]; // rendered from immutable catalog
}
interface Plan {
  id: UUID;
  profileId: UUID;
  goalId: UUID;
  revision: number;
  parentPlanId: UUID | null;
  startDate: LocalDate;
  endDate: LocalDate;
  status: "draft" | "accepted" | "superseded" | "discarded";
  sessions: PlanSession[];
  explanation: string;
  changeReasons: string[];
  source: "ollama" | "fallback";
  modelTag: string | null;
  promptVersion: string;
  policyVersion: string;
  inputRevision: number; // aggregate data revision, not profile revision
  createdAt: Instant;
  acceptedAt: Instant | null;
}
interface WorkoutLog {
  id: UUID;
  profileId: UUID;
  revision: number;
  planSessionId: UUID | null;
  date: LocalDate;
  activity: Activity;
  status: "completed" | "partial" | "skipped";
  durationMinutes: number;
  distanceMeters: number | null;
  perceivedEffort: number | null; // integer 1..10
  outdoors: boolean | null;
  safetyFlags: SafetyFlag[];
  note: string | null;
  source:
    "manual" | "fixture" | "health_connect" | "healthkit" | "strava" | "garmin";
  externalId: string | null;
  createdAt: Instant;
  updatedAt: Instant;
}
interface DailyCheckIn {
  id: UUID;
  profileId: UUID;
  revision: number;
  date: LocalDate;
  sleepHours: number | null;
  energy: number | null; // energy 1..5
  soreness: number | null; // 0..10
  safetyFlags: SafetyFlag[];
  createdAt: Instant;
  updatedAt: Instant;
}
interface GenerationJob {
  id: UUID;
  status: "queued" | "running" | "completed" | "failed";
  mode: "generate" | "adapt";
  inputRevision: number;
  planId: UUID | null;
  errorCode: string | null;
  createdAt: Instant;
  finishedAt: Instant | null;
}
```

Validation: unique availability weekdays; max duration 5–60 minutes; 1–5 desired weekly sessions bounded by available days; nonnegative baseline up to 2000 minutes; longest session 1–300 minutes; notes ≤500 characters; distance 0–200000m; logged duration 0–1440 minutes; sleep 0–24 hours. Reject NaN, infinity, invalid dates, future workout/check-in dates, and incompatible linked session dates. Skipped means zero minutes, null distance and effort; completed/partial means positive minutes. Allow logging beyond planned limits as an observation, not as authorization to prescribe more. Unique `(profileId,date)` check-in and at most one manual log per linked session. Multiple unplanned logs on one date are allowed. A linked log must reference a non-rest session belonging to this profile, with matching activity and date.

Persist profiles, goals, plans, plan_sessions, workout_logs, daily_check_ins, generation_jobs, settings, and singleton aggregate revision. Serialize versioned plan metadata without losing normalized session/log links. Every input mutation increments the aggregate revision in the same transaction.

## 5. API contracts

Base path `/api/v1`. JSON only, 32KB request body limit, strict schemas. Responses use `{data: T}`; errors use `{error: {code, message, fieldErrors?: Record<string,string[]>}, requestId}`. Never return SQL errors, prompts, raw model text, or health data in server diagnostic logs.

| Method and path           | Request                                                       | Success                                                                                                                                |
| ------------------------- | ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| GET `/health`             | none                                                          | 200 `{app:'ok', database:'ok', ollama:'available'\|'unavailable', modelAvailable:boolean}`; AI unavailable does not make app unhealthy |
| GET `/profile`            | none                                                          | 200 `Profile \| null`                                                                                                                  |
| PUT `/profile`            | editable Profile fields + `expectedRevision` (`0` for create) | 200 Profile                                                                                                                            |
| GET `/goals/active`       | none                                                          | 200 `Goal \| null`                                                                                                                     |
| PUT `/goals/active`       | `{kind,targetDate,desiredSessionsPerWeek,expectedRevision}`   | 200 Goal; archive old goal when kind changes                                                                                           |
| POST `/plans/generate`    | `{startDate,expectedInputRevision}`                           | 202 `{jobId}` + Location header                                                                                                        |
| POST `/plans/:id/adapt`   | `{expectedInputRevision}`                                     | 202 `{jobId}`; requires accepted plan with future sessions                                                                             |
| GET `/jobs/:id`           | none                                                          | 200 GenerationJob                                                                                                                      |
| GET `/plans/current`      | none                                                          | 200 accepted Plan or null                                                                                                              |
| GET `/plans/:id`          | none                                                          | 200 Plan                                                                                                                               |
| GET `/plans`              | `cursor?,limit?`                                              | 200 `{items:Plan[],nextCursor:string\|null}`                                                                                           |
| POST `/plans/:id/accept`  | `{expectedInputRevision,expectedCurrentPlanId:UUID\|null}`    | 200 accepted Plan                                                                                                                      |
| POST `/plans/:id/discard` | none                                                          | 200 discarded Plan                                                                                                                     |
| GET `/logs`               | `from,to,cursor?,limit?`                                      | 200 `{items:WorkoutLog[],nextCursor:string\|null}`                                                                                     |
| POST `/logs`              | editable log fields                                           | 201 WorkoutLog                                                                                                                         |
| PATCH `/logs/:id`         | edited fields + `expectedRevision`                            | 200 WorkoutLog                                                                                                                         |
| DELETE `/logs/:id`        | `expectedRevision` query                                      | 204                                                                                                                                    |
| GET `/check-ins`          | `from,to`                                                     | 200 DailyCheckIn[]                                                                                                                     |
| PUT `/check-ins/:date`    | editable fields + `expectedRevision`                          | 200 DailyCheckIn                                                                                                                       |
| GET `/progress`           | `from,to`                                                     | 200 `{actualMinutes,outdoorMinutes,completedPlannedSessions,eligiblePlannedSessions,adherence:number\|null}`                           |
| GET `/ai/models`          | none                                                          | 200 `{models:{tag:string}[],selectedModel:string\|null,available:boolean}`                                                             |
| PUT `/ai/model`           | `{tag}`                                                       | 200 selected installed model; increment input revision                                                                                 |
| GET `/state`              | none                                                          | 200 `{inputRevision,currentPlanId,safetyBlocked:boolean}`                                                                              |
| GET `/data/export`        | none                                                          | 200 versioned export as downloadable JSON                                                                                              |
| DELETE `/data`            | `{confirmation:'DELETE_MY_DATA'}`                             | 204; wipe app records, keep migrations/config                                                                                          |

Use 400 malformed JSON, 422 invalid fields, 404 unknown IDs, 409 revision/stale draft/duplicate conflicts, 403 failed origin/access checks, 429 excess generation requests, and 500 sanitized unexpected failure. A safety-blocked generation request returns 422 `SAFETY_BLOCKED` before calling Ollama. Model absence/unavailability normally completes a job with a fallback, not an HTTP failure.

Require `Idempotency-Key` UUID for job creation and log POST: same key/body returns the original result; key reused with different body returns 409. Persist key results for 24 hours. One active generation job per local user; a distinct concurrent request returns 409 `JOB_IN_PROGRESS`. Poll every two seconds while visible; stop at a terminal state or navigation. Recover queued/running jobs as failed `SERVER_RESTARTED` on server startup and permit explicit retry.

Plan acceptance atomically checks current IDs, all input revisions, goal identity and safety status, supersedes the previous accepted plan, and accepts the draft. Generation snapshots inputs before inference; if the aggregate revision changes before completion, fail `STALE_INPUT` without persisting a usable draft. Previously accepted historical sessions remain immutable. Adaptation drafts retain identical session IDs/content for past dates and logged sessions; only unlogged future sessions can change. Full regeneration archives the old plan without deleting its logs.

Example job creation:

```http
POST /api/v1/plans/generate
Content-Type: application/json
Idempotency-Key: 9e64f1e4-9c86-45b1-ae06-dd027fa70a19

{"startDate":"2026-10-08","expectedInputRevision":12}
```

```json
{ "data": { "jobId": "e413c53b-5c21-4fcf-8349-cc5b8b663231" } }
```

Export includes `schemaVersion`, export timestamp, profile, goals, plans, logs and check-ins. Import is outside MVP. Deletion cancels/invalidates running jobs so a late inference response cannot repopulate erased data.

## 6. Plan generation and Ollama contract

The app is a general activity coach. It does not determine whether a person is medically fit to exercise. Numeric thresholds below are conservative **product defaults**, not clinically validated guarantees. Before broader public use, have a qualified professional review the catalog and policy. Public guidance supports starting gradually; it does not establish one universal safe progression percentage. See [CDC getting started](https://www.cdc.gov/healthy-weight-growth/physical-activity/getting-started.html) and [US physical activity guidelines](https://www.cdc.gov/physical-activity/media/pdfs/Physical_Activity_Guidelines_2nd_edition.pdf).

### Deterministic policy (authoritative)

1. Block prescriptions if adult confirmation/screening is missing or a current profile safety flag is present. Acute illness, limiting pain, or concerning symptoms in the latest check-in/log also block. Show fixed guidance to pause and obtain appropriate help; do not ask the model to assess the condition. Screen again after a block; do not automatically clear it as time passes. History/logging remain available.
2. Chest pain, fainting, or unusual severe breathlessness show fixed stop-exercise guidance and advise urgent medical help for current/severe symptoms, including local emergency services when appropriate. Avoid diagnosis. These stop cues are consistent with [NHS exercise guidance](https://www.newcastle-hospitals.nhs.uk/services/newcastle-occupational-health-service/information-for-staff/physiotherapy/exercise-and-your-health-a-guide-to-getting-started/); the app cannot provide complete emergency triage.
3. A plan covers exactly seven consecutive local dates, at most one session per day, at least two rest days, available days only, and sessions within their day's time budget. No catch-up double sessions or compensatory punishment.
4. If baseline is unknown/zero, prescribe only easy walking: up to three sessions, 5–10 minutes each, with rest between sessions. If available days are fewer, use fewer sessions. Do not initialize at public-health weekly targets.
5. For nonzero baseline, initial weekly prescribed activity cannot exceed reported baseline or 150 minutes, whichever is lower. Session duration cannot exceed reported longest comfortable duration, 45 minutes, or availability. If longest duration is unknown, cap at 10 minutes. Budgets are ceilings, not targets that must be filled. Small baselines may result in fewer sessions than requested; explain this.
6. `start_run_walk` only permits catalog run/walk variants when `runningRegularly=true` and baseline/comfortable duration are known. Otherwise offer a walking foundation and explain that running is deferred. Beginners do not receive sprints, hard intervals, or race-distance targets. Eligible run/walk days must have a non-running day between them, including the previous accepted week's boundary.
7. All aerobic work stays easy/moderate with an approved conversational-effort cue. No HR zones, maximum-effort tests, heavy lifting, or exercise through pain. Mobility is optional and drawn from a short reviewed low-impact catalog. Outside preference permits an indoor alternative when conditions feel unsuitable; do not imply weather or route safety was checked.
8. Catalog variants define exact total duration, effort, warm-up/cool-down where appropriate, and instructions. The model cannot invent an exercise, duration, or instruction. Sum segment durations and validate them against the session total.

### Generation pipeline

1. Validate profile/goal and create a frozen input snapshot; evaluate blockers in code.
2. Compute allowed days, duration ceiling, weekly ceiling, and eligible catalog variants. Produce a valid deterministic fallback first.
3. Send a compact structured snapshot to Ollama: goal, schedule, experience, preferences, baseline and derived recovery/adherence. Exclude name, precise location, raw notes, and unrelated health history.
4. Ask Ollama for seven `{date,variantId}` selections (`rest` is a permitted variant), plus a short explanation. Schema has explicit enums and `additionalProperties:false`; service assigns IDs and assembles authoritative instructions from the catalog.
5. Parse the full response with strict Zod, then check dates, counts, allowed catalog IDs, availability, budgets, recovery rules, immutable sessions, and safety constraints. A schema-valid plan can still be unacceptable.
6. Allow one repair attempt for parsing/domain validation failure using sanitized error codes and the same constrained snapshot. Total generation has a 90-second deadline; each attempt is bounded by the configured timeout and remaining deadline. Offline/missing model fails fast to fallback. No infinite retries, regex extraction, tool calls, or executing model output.
7. Validate fallback through the exact same domain validator. If constraints cannot yield an activity, use rest with an explanation; if safety-blocked, produce no exercise plan. Persist a draft only, with source/prompt/policy/model metadata.

Use the server-side [Ollama chat API](https://docs.ollama.com/api/chat): `POST /api/chat`, configured local `model`, `messages`, `stream:false`, `format:<JSON Schema>`, and `options:{temperature:0}`. Parse `message.content`, not thinking text. Detect truncation/unfinished results. Consult model capabilities rather than unconditionally setting thinking options. Verify one real local model against fixtures. Ollama supports schema-constrained outputs and recommends separate parsing/validation: [official structured-output documentation](https://docs.ollama.com/capabilities/structured-outputs).

Treat all user notes and future imported content as untrusted data. The model has no database tools, network tools, or ability to alter policy. Render explanation as escaped plain text, not HTML/Markdown. It is non-authoritative commentary and cannot replace catalog instructions or safety messages. If it contains health assurances, numeric prescriptions contradicting the assembled plan, or instructions to ignore symptoms, discard it and show a deterministic explanation. Prefer fixed explanations for all safety and adaptation reasons.

## 7. Adaptation rules

Offer adaptation after a new log/check-in or profile schedule edit; do not run it on every page visit. User chooses whether to review and accept the draft. Safety blocks override today's accepted recommendation immediately even before a revision is accepted.

Compute using the current seven-day plan plus previous seven calendar days, with same-day check-ins as recovery inputs. A completed session counts for adherence; partial remains visible but does not count as completed. Unlogged past dates are unknown, not evidence of successful training. Rest days and future sessions are excluded from adherence denominator.

Priority order: safety block → immutable history → reduced availability → recovery downgrade → missed-session adjustment → progression eligibility → preferences. The strongest restriction wins.

| Trigger                                                                                                    | Deterministic effect                                                                                                        |
| ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Any active safety flag                                                                                     | Block exercise recommendation; no AI attempt                                                                                |
| Latest energy ≤2/5, sleep <6h, soreness ≥6/10, or recent effort ≥8/10                                      | No increase; replace today's unlogged session with rest; reduce remaining future minutes to ≤80% of prior remaining minutes |
| At least two skipped/past unlogged planned sessions, or adherence <60% with at least two eligible sessions | No catch-up; remove one future active session if present and do not raise remaining duration                                |
| Missing check-ins or insufficient workout history                                                          | Maintain or reduce; no inferred recovery and no progression                                                                 |
| Goal/schedule changed                                                                                      | Recompute within ceilings; do not force desired frequency when it conflicts with policy                                     |
| Favorable complete history at next weekly rollover                                                         | User may review a small duration increase; frequency and intensity stay fixed                                               |

Progression is only considered for a new seven-day plan, after a full accepted week with ≥80% completed planned sessions, at least two actual completed sessions, effort 2–6/10 on all completed sessions, ≥3 check-ins in that week including the latest day, and no recovery downgrade/safety flags. Cap the next week's minutes at previous week's actual minutes plus `min(5 minutes, 5% of actual minutes)`, rounded down to whole minutes. Also cap at the general weekly/session ceilings. A ceiling too small for the next catalog step means maintain; never round up to force progression. This heuristic is a testable product restriction, not a scientific safety guarantee.

Reductions can happen midweek; increases cannot. Never change logged or past sessions. After seven or more days without logged activity, restart with the walking-foundation limits until the user updates their baseline and screening. Explicitly list dates and changes in a revision preview, and preserve the previous plan if the draft is declined.

## 8. Manual logging and future adapters

Manual logs are the source of truth for MVP. Editing/deleting a log recomputes progress and invalidates outstanding drafts. Do not overwrite observations to fit a plan. A skip can be converted to partial/completed by editing the same linked log. An unplanned workout contributes to actual volume but never retroactively marks a different planned session completed.

Future normalized contract (not a live sync commitment):

```ts
type AdapterSource = Exclude<WorkoutLog["source"], "manual">;
interface ImportedActivity {
  source: AdapterSource;
  externalId: string;
  startedAt: Instant;
  endedAt: Instant;
  sourceTimezone: string | null;
  activity: Activity | "other";
  durationSeconds: number;
  distanceMeters: number | null;
  modifiedAt: Instant;
  deleted: boolean;
}
interface IntegrationAdapter {
  source: AdapterSource;
  capabilities(): { activities: boolean; sleep: boolean; steps: boolean };
  pull(input: { cursor: string | null; since: Instant }): Promise<{
    activities: ImportedActivity[];
    nextCursor: string | null;
  }>;
  revoke(): Promise<void>;
}
```

Implement a fixture adapter behind a development-only flag and a normalized-activity validator. No production import endpoint in MVP. Future sync must persist cursor and records transactionally; deduplicate by `(source,externalId)`, update by source modification timestamp, process tombstones, preserve provenance/timezones, and handle overlapping sources before counting volume. Never sum duplicate Garmin/Strava/Health Connect observations. Manual/import overlap requires explicit reconciliation; imported workouts do not automatically complete a planned session. Read permissions should be minimal and revocable; credentials belong in server secrets or native secure storage, never browser localStorage.

| Adapter                       | Future implementation boundary                                                                                                                                                                           |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Android Health Connect        | Native Android companion/bridge, explicit permissions, normalized upload to app server; not a browser API. See [Android documentation](https://developer.android.com/health-and-fitness/health-connect). |
| Apple HealthKit               | Native iOS companion with entitlements/permissions. See [Apple HealthKit](https://developer.apple.com/documentation/healthkit).                                                                          |
| Strava                        | Server OAuth, scopes, refresh/revoke, rate limits, sync/deletion handling; verify current official API requirements before building.                                                                     |
| Garmin                        | Approved official API access if available; defer eligibility/approval investigation. Do not scrape credentials or assume availability.                                                                   |
| Garmin via phone health layer | Only data actually present and permitted may be read. Do not promise Garmin fields, platform transfer, or fidelity until tested on target devices.                                                       |

Sleep/steps/HR extensions need separate normalized observation schemas, units, provenance and timestamps. Do not squeeze them into workout logs or allow them to bypass safety screening.

## 9. Security, privacy, and operational behavior

- No hosted AI, analytics, third-party fonts, external scripts, or remote health-data calls. Initial package/model downloads may need internet; normal use after setup does not.
- Bind locally by default, validate Host/Origin against the configured app origin, reject cross-origin mutations, and disable permissive CORS. Require JSON content type on mutations. Keep access control separate from CORS.
- SQLite contains sensitive personal observations. Local storage is not automatically encrypted; document its path, backup responsibility, and OS disk encryption recommendation. Do not claim HIPAA compliance or end-to-end encryption.
- Limit inference concurrency to one job, bound output/context size, and cap request frequency. Keep model names restricted to locally installed tags. No user-supplied arbitrary inference URLs.
- No prompts or raw health text in ordinary logs. Record job ID, duration, source, model/policy version and sanitized error code only. Export deliberately exposes the user's own data; use a download response with no-store headers.
- Data deletion removes exports only if stored by the application; separately downloaded backups remain under the user's control. No automatic backup uploads.

## 10. Acceptance criteria and test evidence

The MVP is complete only when all required items pass:

1. A fresh install migrates an empty SQLite database and loads onboarding; refresh/restart preserves saved state.
2. A beginner with unknown baseline and three available days gets at most three easy 5–10 minute walks, separated by rest. An advanced-looking note cannot override this.
3. Generation produces exactly seven consecutive calendar dates, fits availability, honors weekly/session ceilings, and contains only catalog instructions. Test a DST boundary and a non-US timezone.
4. One real local Ollama generation succeeds; record model/Ollama versions and observed duration. CI uses a fake provider and requires no model download/GPU.
5. Ollama offline, missing model, timeout, malformed JSON, extra keys, invalid enum, truncated output and unsafe domain proposal all yield a validated labelled fallback, or a clear blocked state where appropriate.
6. Safety flags block initial generation, adaptation, acceptance and today's activity display; rest/fallback does not bypass a block. Logging and export still work.
7. A completed, partial, skipped and unplanned log can be created/edited; duplicate submissions do not double-count. Partial and unknown sessions are reported accurately.
8. Low recovery reduces future workload; favorable history cannot cause a midweek increase; rollover progression stays within its cap; insufficient data cannot increase workload.
9. Adaptation preserves past/logged session IDs and content. Accepting a draft is atomic; declined drafts do not change the active plan.
10. A log/profile edit during generation or before acceptance causes a stale conflict. Concurrent accept requests cannot leave two accepted plans. Restart/deletion does not allow late jobs to write new data.
11. Progress uses actual duration and correct eligible-session denominator; zero eligible sessions gives null adherence, not 0% or NaN. Manual unplanned sessions do not complete planned ones. Progress uses the canonical accepted session history: retained session IDs across revisions count once, superseded future sessions are excluded, and past accepted sessions remain eligible even after full regeneration.
12. Desktop 1440px and mobile 360px layouts have no overflow; onboarding → accept → log → adapt is keyboard accessible. Verify focus and error/status announcements.
13. Export is valid versioned JSON. Delete clears profile, plans, logs and check-ins and returns to onboarding. A fixture adapter proves duplicate/update/tombstone handling at the normalization boundary without real provider credentials.
14. Cross-origin mutations, arbitrary Ollama URLs, invalid request fields and unsafe rendered content are rejected/escaped. No health text appears in diagnostic logs.

Testing scope: unit tests for policy, catalog totals, dates, metrics and normalization; API tests against temporary SQLite for revisions/idempotency/transactions; one browser flow for core loop and one for fallback/safety. Add fixtures for prompt-injection notes, 0-minute baseline, no available slots, conflicting revisions, and recovery reductions. Test policy outcomes, not exact stochastic wording. Run typecheck, lint, domain/API tests and browser smoke tests once at final integration; report real-model and manual accessibility evidence separately.

## 11. Implementation order

1. **Foundation:** inspect repository instructions, scaffold web/API/domain, configure same-origin serving, migrations and environment validation. Document local startup.
2. **Domain:** implement schemas, activity catalog, timezone helpers, metrics, safety policy and deterministic planner with boundary tests. Build the full loop without requiring AI.
3. **Persistence/API:** profile/goal/log/check-in repositories, aggregate revision, plans, transactions, jobs and idempotency; add contract tests.
4. **Usable UI:** onboarding, Today, plan preview/accept, manual logs and progress; responsive and accessible states.
5. **Ollama:** model status/selection, constrained proposal schema, bounded repair, timeout/fallback, prompt versioning and one real-model smoke test.
6. **Adaptation:** reductions, rollover rules, immutable history, revision diffs and stale/concurrent request handling.
7. **Finish:** export/delete, adapter interface/fixture, browser acceptance checks, privacy/setup docs and sample-data walkthrough.

Each milestone should leave a runnable application. Avoid adding frameworks for autonomous agents, vector databases, event buses or background infrastructure unless a requirement demonstrates a need. No live integrations or deployment are necessary to deliver the MVP.

## 12. Copy-paste coding-agent execution prompt

```text
Build Touch Grass from the attached touch-grass-mvp-spec.md. Treat it as the
implementation contract. Deliver a working responsive local web application,
not only a scaffold or design. Read repository instructions first and preserve
existing work. Use TypeScript, React/Vite, Fastify, strict Zod schemas, SQLite
with migrations, Vitest and Playwright unless the repository already has a
compatible stack; document any necessary substitution.

Implement the milestones in Section 11 in order. Start with domain safety,
catalog-based deterministic planning, persistence and manual logging. Then add
server-side local Ollama structured proposals, bounded validation/repair and
fallback. The server owns all IDs, dates, instructions, limits and persistence.
The model must never determine safety clearance or execute actions. Do not
remove safety, revision or validation checks to make a demo pass.

Complete profile/goals, seven-day plan preview/acceptance, Today, workout and
recovery logging, progress, adaptation, export/delete, and fixture adapter.
Honor timezone, idempotency, stale jobs, immutable historical sessions and
atomic acceptance. Bind to loopback by default. Use no hosted inference,
tracking, real health-provider integrations or cloud deployment.

Choose compatible stable dependencies and commit the lockfile. Make small,
coherent changes and continue autonomously through routine implementation
choices. Ask only for information that materially blocks work. Do not replace
required behavior with fake success responses. Keep app copy simple and avoid
exposing implementation terminology in user flows.

Run the acceptance checks in Section 10, using temporary databases and fake AI
for automated tests. If local Ollama is available, run and document one real
model smoke test. If it is unavailable, verify fallback and explicitly report
the untested real-inference step; never claim it passed. Verify desktop/mobile
layout and keyboard behavior. Fix failures before delivering.

Deliver source code, database migrations, example environment configuration,
setup/run/test README, fixture data and a short verification report mapping
acceptance criteria to evidence. Include the tested Node/Ollama/model versions,
known limitations and precise local startup instructions. Finish only when the
core loop works and all feasible required checks pass, or clearly identify an
external blocker with completed work preserved.
```

## 13. Research provenance and optional challenge context

Official references above establish the Ollama contract, gradual-activity principle and native health-integration boundaries. Exact budgets, recovery thresholds and API choices in this document are product decisions. The original referenced conversation was truncated; no unseen requirements were assumed.

### 🌐 Community Wisdom: [Ollama Structured Outputs in Practice — Getting Type-Safe JSON from Local LLMs with Pydantic](https://dev.to/jangwook_kim_e31e7291ad98/ollama-structured-outputs-in-practice-getting-type-safe-json-from-local-llms-with-pydantic-m38)

> **Source**: [jangwook_kim_e31e7291ad98](https://dev.to/jangwook_kim_e31e7291ad98)
> **Tags**: `ai`, `llm`, `python`, `tutorial`
>
> The author describes pairing constrained output with runtime validation and notes semantic weaknesses in nested/optional output. This supports a compact proposal schema and independent validation; their model/version performance figures are not adopted as guarantees. No comments were returned when checked.
>
> 🔗 [Read Full Discussion](https://dev.to/jangwook_kim_e31e7291ad98/ollama-structured-outputs-in-practice-getting-type-safe-json-from-local-llms-with-pydantic-m38)

### 🌐 Community Wisdom: [Structured output guarantees the shape, not the lengths](https://dev.to/robzepdev/structured-output-guarantees-the-shape-not-the-lengths-3p5)

> **Source**: [robzepdev](https://dev.to/robzepdev)
> **Tags**: `ai`, `llm`, `typescript`, `webdev`
>
> This separate production account shows why application validation must still enforce value and cross-field constraints. Its observed provider behavior is not a universal statement about every decoder. Together these two posts support validation rather than establish a broad community consensus. No comments were returned when checked.
>
> 🔗 [Read Full Discussion](https://dev.to/robzepdev/structured-output-guarantees-the-shape-not-the-lengths-3p5)

Optional: this concept matches the registered [Hacktoberfest Open-Source AI Challenge: Week 1](https://dev.to/events/challenges/hacktoberfest-week1-2026-10-05), whose theme is Touch Grass. The event listing gives a submission deadline of October 12, 2026 at 2:59 AM America/New_York (October 11 at 11:59 PM PDT). Eligibility/submission preparation is separate from this MVP implementation; nothing has been submitted or published.


## Authorized implementation update — tailnet inference

The user clarified that their Ollama server is another machine on their Tailscale tailnet. OutFit therefore supports a trusted server-configured HTTP(S) origin with explicit `OLLAMA_ALLOW_REMOTE=true`. Loopback remains the default. Credentials, URL paths, query strings, fragments, and redirects remain forbidden; browsers cannot choose the inference URL. This supersedes the same-computer-only inference constraint for this setup.
