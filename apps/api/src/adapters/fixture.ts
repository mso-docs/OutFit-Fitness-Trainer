import { z } from "zod";
import { instant } from "../../../../packages/domain/src/schemas";
export const importedActivitySchema = z
  .strictObject({
    source: z.enum([
      "fixture",
      "health_connect",
      "healthkit",
      "strava",
      "garmin",
    ]),
    externalId: z.string().min(1).max(200),
    startedAt: instant,
    endedAt: instant,
    sourceTimezone: z.string().nullable(),
    activity: z.enum(["walk", "run_walk", "mobility", "other"]),
    durationSeconds: z.number().nonnegative().max(86400),
    distanceMeters: z.number().nonnegative().max(200000).nullable(),
    modifiedAt: instant,
    deleted: z.boolean(),
  })
  .refine((a) => a.endedAt >= a.startedAt, "Activity must end after it starts.")
  .refine((a) => {
    if (a.sourceTimezone === null) return true;
    try {
      new Intl.DateTimeFormat("en", { timeZone: a.sourceTimezone });
      return true;
    } catch {
      return false;
    }
  }, "Choose a valid source timezone.");
export type ImportedActivity = z.infer<typeof importedActivitySchema>;
export interface IntegrationAdapter {
  source: ImportedActivity["source"];
  capabilities(): { activities: boolean; sleep: boolean; steps: boolean };
  pull(input: {
    cursor: string | null;
    since: string;
  }): Promise<{ activities: ImportedActivity[]; nextCursor: string | null }>;
  revoke(): Promise<void>;
}
export function normalize(input: unknown) {
  const value = importedActivitySchema.parse(input);
  if (value.endedAt < value.startedAt) throw new Error("INVALID_INTERVAL");
  if (value.sourceTimezone !== null) {
    try {
      new Intl.DateTimeFormat("en", { timeZone: value.sourceTimezone });
    } catch {
      throw new Error("INVALID_TIMEZONE");
    }
  }
  return value;
}
// Tombstones remain in the index so an older record cannot resurrect deleted activity.
export function reconcileFixture(
  existing: Map<string, ImportedActivity>,
  incoming: unknown[],
) {
  const result = new Map(existing);
  for (const input of incoming) {
    const activity = normalize(input);
    const key = activity.source + ":" + activity.externalId;
    const old = result.get(key);
    if (!old || activity.modifiedAt > old.modifiedAt) result.set(key, activity);
  }
  return result;
}
export class FixtureAdapter implements IntegrationAdapter {
  readonly source = "fixture" as const;
  private revoked = false;
  constructor(
    private readonly batches: ImportedActivity[][],
    enabled = process.env.FIXTURE_ADAPTER_ENABLED === "true" &&
      process.env.NODE_ENV !== "production",
  ) {
    if (!enabled) throw new Error("FIXTURE_ADAPTER_DISABLED");
  }
  capabilities() {
    return { activities: true, sleep: false, steps: false };
  }
  async pull(input: { cursor: string | null; since: string }) {
    if (this.revoked) throw new Error("REVOKED");
    const index = Number(input.cursor ?? 0);
    if (!Number.isSafeInteger(index) || index < 0)
      throw new Error("INVALID_CURSOR");
    return {
      activities: (this.batches[index] ?? [])
        .map(normalize)
        .filter((a) => a.modifiedAt >= input.since),
      nextCursor: index + 1 < this.batches.length ? String(index + 1) : null,
    };
  }
  async revoke() {
    this.revoked = true;
  }
}
