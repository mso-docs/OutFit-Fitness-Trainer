import { it, expect } from "vitest";
import {
  FixtureAdapter,
  reconcileFixture,
  normalize,
  type ImportedActivity,
} from "./fixture";
const event: ImportedActivity = {
  source: "fixture",
  externalId: "a",
  startedAt: "2026-10-05T12:00:00Z",
  endedAt: "2026-10-05T12:10:00Z",
  sourceTimezone: "America/New_York",
  activity: "walk",
  durationSeconds: 600,
  distanceMeters: null,
  modifiedAt: "2026-10-05T12:11:00Z",
  deleted: false,
};
it("deduplicates updates and tombstones without resurrecting older observations", () => {
  const index = reconcileFixture(new Map(), [
    event,
    event,
    { ...event, modifiedAt: "2026-10-06T12:00:00Z", durationSeconds: 700 },
  ]);
  expect(index.size).toBe(1);
  expect(index.get("fixture:a")?.durationSeconds).toBe(700);
  const deleted = reconcileFixture(index, [
    { ...event, modifiedAt: "2026-10-07T12:00:00Z", deleted: true },
    event,
  ]);
  expect(deleted.get("fixture:a")?.deleted).toBe(true);
});
it("rejects intervals, units and unexpected fields", () => {
  expect(() =>
    normalize({ ...event, endedAt: "2026-10-04T12:00:00Z" }),
  ).toThrow();
  expect(() => normalize({ ...event, durationSeconds: -1 })).toThrow();
  expect(() => normalize({ ...event, calories: 1 })).toThrow();
});
it("is gated, supports cursors and revoke", async () => {
  expect(() => new FixtureAdapter([], false)).toThrow("DISABLED");
  const adapter = new FixtureAdapter([[event], [event]], true);
  const first = await adapter.pull({
    cursor: null,
    since: "2026-10-01T00:00:00Z",
  });
  expect(first.nextCursor).toBe("1");
  await adapter.revoke();
  await expect(
    adapter.pull({ cursor: null, since: "2026-10-01T00:00:00Z" }),
  ).rejects.toThrow("REVOKED");
});
