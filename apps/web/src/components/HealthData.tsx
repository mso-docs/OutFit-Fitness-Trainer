import { useEffect, useState } from "react";
import { api } from "../api";
import type { ImportedActivity } from "../../../api/src/adapters/fixture";
import { Badge } from "./ui";
const providers = [
  {
    name: "Strava",
    detail:
      "Web connection via OAuth, then activity sync. Requires an API application and your permission.",
  },
  {
    name: "Apple Health",
    detail:
      "An iPhone companion reads permitted HealthKit records and sends normalized activity to OutFit.",
  },
  {
    name: "Health Connect",
    detail:
      "An Android companion reads permitted records and sends normalized activity to OutFit.",
  },
  {
    name: "Garmin",
    detail:
      "A provider integration requires approved API access. No live connection is implemented.",
  },
];
export function HealthData({ timezone }: { timezone: string }) {
  const [records, setRecords] = useState<ImportedActivity[]>([]);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  async function load() {
    setRecords(await api<ImportedActivity[]>("/health/activities"));
  }
  useEffect(() => {
    void load().catch(() => setNotice("Could not load imported activity."));
  }, []);
  const minutes = records.reduce((n, a) => n + a.durationSeconds / 60, 0);
  return (
    <>
      <section className="card">
        <h2>Your health apps, in one place</h2>
        <p className="muted">
          Imported activity has its own timeline and source labels. Live sync is
          not connected yet. Imported records stay separate from logged progress
          so the same workout isn’t counted twice.
        </p>
        <div className="health-provider-grid">
          {providers.map((p) => (
            <div key={p.name} className="health-provider">
              <div className="card-title">
                <h3>{p.name}</h3>
                <Badge tone="sand">Not connected</Badge>
              </div>
              <p className="small muted">{p.detail}</p>
            </div>
          ))}
        </div>
      </section>
      <section className="card">
        <h2>Import normalized activity</h2>
        <p className="muted">
          Upload OutFit-format JSON from an adapter or export tool. A provider’s
          raw export needs conversion first. Up to 100 records per file (32 KB),
          2,000 stored. This does not authorize access to any health app.
        </p>
        <label>
          Activity JSON file
          <input
            type="file"
            accept=".json,application/json"
            disabled={busy}
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              setBusy(true);
              setNotice("");
              try {
                if (file.size > 32768)
                  throw new Error("Choose a JSON file under 32 KB.");
                const body: unknown = JSON.parse(await file.text());
                await api("/health/activities/import", "POST", body);
                await load();
                setNotice(
                  "Import saved. Updated records replace older versions; duplicates are not added.",
                );
              } catch (e) {
                setNotice(
                  e instanceof Error ? e.message : "Could not import activity.",
                );
              } finally {
                setBusy(false);
              }
            }}
          />
        </label>
        <details>
          <summary>View the import format</summary>
          <pre className="import-example">
            {JSON.stringify(
              {
                activities: [
                  {
                    source: "strava",
                    externalId: "example-activity",
                    startedAt: "2026-10-08T12:00:00Z",
                    endedAt: "2026-10-08T12:10:00Z",
                    sourceTimezone: "UTC",
                    activity: "walk",
                    durationSeconds: 600,
                    distanceMeters: 800,
                    modifiedAt: "2026-10-08T12:10:00Z",
                    deleted: false,
                  },
                ],
              },
              null,
              2,
            )}
          </pre>
        </details>
        <p role="status">{notice}</p>
      </section>
      <section className="card">
        <div className="card-title">
          <h2>Imported activity</h2>
          <Badge>
            {records.length} records · {Math.round(minutes)} min
          </Badge>
        </div>
        <p className="small muted">
          All imported dates · displayed in {timezone}. Steps, sleep, and
          heart-rate data have no connector yet and are not inferred from
          workouts.
        </p>
        {records.length ? (
          <>
            <div className="imported-list">
              {[...records]
                .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
                .map((a) => (
                  <article
                    className="history-row"
                    key={a.source + ":" + a.externalId}
                  >
                    <div>
                      <strong>
                        {a.activity === "run_walk" ? "Run / walk" : a.activity}
                      </strong>
                      <span className="muted small">
                        {new Intl.DateTimeFormat(undefined, {
                          dateStyle: "medium",
                          timeStyle: "short",
                          timeZone: timezone,
                        }).format(new Date(a.startedAt))}{" "}
                        · {a.source.replaceAll("_", " ")} · file import
                      </span>
                    </div>
                    <span>
                      {Math.round(a.durationSeconds / 60)} min
                      {a.distanceMeters == null
                        ? ""
                        : ` · ${(a.distanceMeters / 1000).toFixed(2)} km`}
                    </span>
                  </article>
                ))}
            </div>
            <button
              className="text-button danger-text"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await api("/health/activities", "DELETE", {});
                  await load();
                  setNotice("Imported records removed.");
                } catch {
                  setNotice("Could not remove imports.");
                } finally {
                  setBusy(false);
                }
              }}
            >
              Remove imported records
            </button>
          </>
        ) : (
          <p className="muted">
            No imported activity yet. Manual logs remain available in Progress.
          </p>
        )}
      </section>
    </>
  );
}
