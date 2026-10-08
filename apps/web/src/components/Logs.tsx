import { useState, useRef, type FormEvent } from "react";
import { Check } from "lucide-react";
import type {
  Session,
  WorkoutLog,
  CheckIn,
  LogInput,
} from "../../../../packages/domain/src/schemas";
import { api } from "../api";
import { numberOrNull, activityNames } from "../shared";
import { Modal, SafetyFields } from "./ui";
export function LogModal({
  session,
  log,
  date,
  onClose,
  onSaved,
}: {
  session: Session | null;
  log: WorkoutLog | null;
  date: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [status, setStatus] = useState<WorkoutLog["status"]>(
    log?.status ?? "completed",
  );
  const [flags, setFlags] = useState<string[]>(log?.safetyFlags ?? []);
  const [minutes, setMinutes] = useState<string>(
    String(log?.durationMinutes ?? ""),
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const key = useRef(crypto.randomUUID());
  const [lastBody, setLastBody] = useState("");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const fd = new FormData(e.currentTarget);
    const body: LogInput = {
      planSessionId: log?.planSessionId ?? session?.id ?? null,
      date: String(fd.get("date")),
      activity: String(fd.get("activity")) as WorkoutLog["activity"],
      status,
      durationMinutes: status === "skipped" ? 0 : Number(minutes),
      distanceMeters:
        status === "skipped" ? null : numberOrNull(fd.get("distance")),
      perceivedEffort:
        status === "skipped" ? null : numberOrNull(fd.get("effort")),
      outdoors:
        fd.get("outdoors") === "unknown" ? null : fd.get("outdoors") === "yes",
      safetyFlags: flags as WorkoutLog["safetyFlags"],
      note: String(fd.get("note")) || null,
    };
    const serialized = JSON.stringify(body);
    if (lastBody && lastBody !== serialized) key.current = crypto.randomUUID();
    setLastBody(serialized);
    try {
      if (log)
        await api("/logs/" + log.id, "PATCH", {
          ...body,
          expectedRevision: log.revision,
        });
      else await api("/logs", "POST", body, key.current);
      await onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save activity.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={log ? "Edit activity" : "A little movement, recorded"}
      onClose={onClose}
    >
      <form onSubmit={submit}>
        <p className="muted">
          Record what happened. It doesn’t have to match the plan.
        </p>
        <div className="form-grid">
          <label>
            Date
            <input
              name="date"
              type="date"
              required
              max={date}
              defaultValue={log?.date ?? session?.date ?? date}
              readOnly={!!(log?.planSessionId || session)}
            />
          </label>
          <label>
            Activity
            <select
              name="activity"
              defaultValue={log?.activity ?? session?.kind ?? "walk"}
              disabled={false}
            >
              {(["walk", "run_walk", "mobility"] as const)
                .filter(
                  (a) =>
                    !(log?.planSessionId || session) ||
                    a === (log?.activity ?? session?.kind),
                )
                .map((a) => (
                  <option key={a} value={a}>
                    {activityNames[a]}
                  </option>
                ))}
            </select>
          </label>
        </div>
        <fieldset>
          <legend>How did it go?</legend>
          <div className="segmented">
            {(["completed", "partial", "skipped"] as const).map((v) => (
              <label className={status === v ? "selected" : ""} key={v}>
                <input
                  type="radio"
                  name="status"
                  checked={status === v}
                  onChange={() => setStatus(v)}
                />
                {v[0].toUpperCase() + v.slice(1)}
              </label>
            ))}
          </div>
        </fieldset>
        {status !== "skipped" && (
          <>
            <div className="form-grid">
              <label>
                Actual minutes
                <input
                  type="number"
                  required
                  min="0.1"
                  max="1440"
                  step="any"
                  value={minutes}
                  onChange={(e) => setMinutes(e.target.value)}
                />
                {session && (
                  <button
                    type="button"
                    className="text-button small"
                    onClick={() => setMinutes(String(session.durationMinutes))}
                  >
                    Use planned {session.durationMinutes} minutes
                  </button>
                )}
              </label>
              <label>
                Distance (meters) <small>Optional</small>
                <input
                  name="distance"
                  type="number"
                  min="0"
                  max="200000"
                  step="any"
                  defaultValue={log?.distanceMeters ?? ""}
                />
              </label>
            </div>
            <label>
              Perceived effort (1–10){" "}
              <small>Optional · 1 is very easy, 10 is maximum effort.</small>
              <input
                name="effort"
                type="number"
                min="1"
                max="10"
                defaultValue={log?.perceivedEffort ?? ""}
              />
            </label>
          </>
        )}
        <label>
          Were you outside?
          <select
            name="outdoors"
            defaultValue={
              log?.outdoors === null || log?.outdoors === undefined
                ? "unknown"
                : log.outdoors
                  ? "yes"
                  : "no"
            }
          >
            <option value="unknown">Not recorded</option>
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </select>
        </label>
        <details>
          <summary>Pain or symptoms</summary>
          <SafetyFields selected={flags} onChange={setFlags} />
        </details>
        <label>
          Anything to remember? <small>Optional · up to 500 characters</small>
          <textarea
            name="note"
            maxLength={500}
            defaultValue={log?.note ?? ""}
            rows={2}
          />
        </label>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <div className="form-actions">
          {log ? (
            <button
              type="button"
              className="text-button danger-text"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await api(
                    "/logs/" + log.id + "?expectedRevision=" + log.revision,
                    "DELETE",
                    {},
                  );
                  await onSaved();
                } catch (e) {
                  setError(
                    e instanceof Error ? e.message : "Could not delete log.",
                  );
                } finally {
                  setBusy(false);
                }
              }}
            >
              Delete log
            </button>
          ) : (
            <span />
          )}
          <button className="button" disabled={busy}>
            <Check size={16} />
            {busy ? "Saving…" : "Save activity"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
export function CheckModal({
  date,
  check,
  onClose,
  onSaved,
}: {
  date: string;
  check: CheckIn | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [flags, setFlags] = useState<string[]>(check?.safetyFlags ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    const fd = new FormData(e.currentTarget);
    try {
      await api("/check-ins/" + date, "PUT", {
        sleepHours: numberOrNull(fd.get("sleep")),
        energy: numberOrNull(fd.get("energy")),
        soreness: numberOrNull(fd.get("soreness")),
        safetyFlags: flags,
        expectedRevision: check?.revision ?? 0,
      });
      await onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save check-in.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="How are you, today?" onClose={onClose}>
      <form onSubmit={submit}>
        <p className="muted">A quick check-in, with room for “not sure”.</p>
        <label>
          Last night’s sleep (hours)
          <input
            name="sleep"
            type="number"
            min="0"
            max="24"
            step="0.5"
            placeholder="Not recorded"
            defaultValue={check?.sleepHours ?? ""}
          />
        </label>
        <label>
          Energy
          <select name="energy" defaultValue={check?.energy ?? ""}>
            <option value="">Not recorded</option>
            {["Very low", "Low", "Okay", "Good", "Great"].map((label, i) => (
              <option key={label} value={i + 1}>
                {i + 1} · {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Soreness (0–10)
          <input
            name="soreness"
            type="number"
            min="0"
            max="10"
            placeholder="Not recorded"
            defaultValue={check?.soreness ?? ""}
          />
        </label>
        <details>
          <summary>Pain or symptoms</summary>
          <SafetyFields selected={flags} onChange={setFlags} />
        </details>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="form-actions">
          <span />
          <button className="button" disabled={busy}>
            <Check size={16} />
            {busy ? "Saving…" : "Save check-in"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
