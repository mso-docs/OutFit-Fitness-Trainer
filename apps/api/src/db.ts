import { DatabaseSync } from "node:sqlite";
import { readFileSync, mkdirSync, readdirSync, chmodSync } from "node:fs";
import { dirname } from "node:path";
import type {
  Profile,
  Goal,
  Plan,
  Session,
  WorkoutLog,
  CheckIn,
  Job,
} from "../../../packages/domain/src/schemas";
type Tables = {
  profiles: Profile;
  goals: Goal;
  plans: Plan;
  plan_sessions: Session;
  workout_logs: WorkoutLog;
  daily_check_ins: CheckIn;
  generation_jobs: Job;
};
export class Store {
  readonly db: DatabaseSync;
  constructor(path: string) {
    if (path !== ":memory:")
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    if (path !== ":memory:") chmodSync(path, 0o600);
    this.db.exec(
      "PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;",
    );
    this.db.exec(
      "CREATE TABLE IF NOT EXISTS migrations (version INTEGER PRIMARY KEY)",
    );
    const migrationRoot = new URL("../migrations/", import.meta.url);
    for (const file of readdirSync(migrationRoot)
      .filter((name) => /^\d+_.*\.sql$/.test(name))
      .sort()) {
      const version = Number(file.split("_")[0]);
      if (
        this.db
          .prepare("SELECT version FROM migrations WHERE version=?")
          .get(version)
      )
        continue;
      this.transaction(() => {
        this.db.exec(readFileSync(new URL(file, migrationRoot), "utf8"));
        this.db
          .prepare("INSERT OR IGNORE INTO migrations VALUES (?)")
          .run(version);
      });
    }
    for (const j of this.all("generation_jobs").filter(
      (j) => j.status === "queued" || j.status === "running",
    ))
      this.put("generation_jobs", {
        ...j,
        status: "failed",
        errorCode: "SERVER_RESTARTED",
        finishedAt: new Date().toISOString(),
      });
  }
  all<K extends keyof Tables>(table: K): Tables[K][] {
    return (
      this.db.prepare(`SELECT data FROM ${table}`).all() as { data: string }[]
    ).map((r) => JSON.parse(r.data));
  }
  get<K extends keyof Tables>(table: K, id: string): Tables[K] | null {
    const row = this.db
      .prepare(`SELECT data FROM ${table} WHERE id=?`)
      .get(id) as { data: string } | undefined;
    return row ? JSON.parse(row.data) : null;
  }
  put<K extends keyof Tables>(table: K, value: Tables[K], owner?: string) {
    const fields: Record<string, unknown> = {
      id: value.id,
      data: JSON.stringify(value),
    };
    if ("profileId" in value) fields.profile_id = value.profileId;
    if (table === "plan_sessions") fields.profile_id = owner;
    if (table === "plans") fields.goal_id = (value as Plan).goalId;
    if (table === "workout_logs")
      fields.session_id = (value as WorkoutLog).planSessionId;
    if (table === "plan_sessions" || table === "daily_check_ins")
      fields.date = (value as Session | CheckIn).date;
    const keys = Object.keys(fields);
    this.db
      .prepare(
        `INSERT INTO ${table} (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")}) ON CONFLICT(id) DO UPDATE SET ${keys
          .filter((k) => k !== "id")
          .map((k) => `${k}=excluded.${k}`)
          .join(",")}`,
      )
      .run(...(Object.values(fields) as (string | number | null)[]));
    if (table === "plans") {
      const p = value as Plan;
      for (const s of p.sessions) {
        const existing = this.get("plan_sessions", s.id);
        if (existing && JSON.stringify(existing) !== JSON.stringify(s))
          throw new Error("IMMUTABLE_SESSION");
        if (!existing) this.put("plan_sessions", s, p.profileId);
        this.db
          .prepare("INSERT OR IGNORE INTO plan_memberships VALUES (?,?)")
          .run(p.id, s.id);
      }
    }
  }
  supersededDates(): Record<string, string> {
    const rows = this.db
      .prepare("SELECT plan_id,cutoff_date FROM plan_supersessions")
      .all() as { plan_id: string; cutoff_date: string }[];
    return Object.fromEntries(
      rows.map((row) => [row.plan_id, row.cutoff_date]),
    );
  }
  supersede(id: string, date: string) {
    this.db
      .prepare("INSERT INTO plan_supersessions VALUES (?,?)")
      .run(id, date);
  }
  revision() {
    return (
      this.db
        .prepare("SELECT revision FROM aggregate_revision WHERE singleton=1")
        .get() as { revision: number }
    ).revision;
  }
  bump() {
    this.db.exec(
      "UPDATE aggregate_revision SET revision=revision+1 WHERE singleton=1",
    );
    return this.revision();
  }
  transaction<T>(fn: () => T) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const value = fn();
      this.db.exec("COMMIT");
      return value;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  setting(key: string) {
    return (
      (
        this.db.prepare("SELECT value FROM settings WHERE key=?").get(key) as
          { value: string } | undefined
      )?.value ?? null
    );
  }
  setSetting(key: string, value: string) {
    this.db
      .prepare(
        "INSERT INTO settings VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      )
      .run(key, value);
  }
  deleteLog(id: string) {
    this.db.prepare("DELETE FROM workout_logs WHERE id=?").run(id);
  }
  wipe() {
    for (const table of [
      "idempotency",
      "generation_jobs",
      "workout_logs",
      "daily_check_ins",
      "plan_memberships",
      "plan_supersessions",
      "plan_sessions",
      "plans",
      "goals",
      "profiles",
      "settings",
    ])
      this.db.exec(`DELETE FROM ${table}`);
    this.bump();
  }
}
