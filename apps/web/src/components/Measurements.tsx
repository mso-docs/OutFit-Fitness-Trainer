import { useState } from "react";
import type { Profile } from "../../../../packages/domain/src/schemas";
import { api } from "../api";
export function Measurements({
  profile,
  onSaved,
}: {
  profile: Profile;
  onSaved: () => Promise<void>;
}) {
  const [unit, setUnit] = useState<"metric" | "imperial">("metric");
  const [height, setHeight] = useState(
    profile.heightCm == null ? "" : String(profile.heightCm),
  );
  const [weight, setWeight] = useState(
    profile.weightKg == null ? "" : String(profile.weightKg),
  );
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  function switchUnit(next: "metric" | "imperial") {
    if (next === unit) return;
    const factor = next === "metric";
    if (height)
      setHeight(
        String(
          Math.round(Number(height) * (factor ? 2.54 : 1 / 2.54) * 100) / 100,
        ),
      );
    if (weight)
      setWeight(
        String(
          Math.round(
            Number(weight) * (factor ? 1 / 2.2046226218 : 2.2046226218) * 100,
          ) / 100,
        ),
      );
    setUnit(next);
    setNotice("");
  }
  return (
    <section className="card">
      <h2>
        Body measurements <span className="muted small">Optional</span>
      </h2>
      <p className="muted">
        A little more context, on your terms. These values stay in your profile
        and export. They don’t set calorie targets or change exercise limits,
        and aren’t sent to trainer chat automatically.
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setNotice("");
          try {
            await api("/profile/measurements", "PUT", {
              expectedRevision: profile.revision,
              heightCm:
                height === ""
                  ? null
                  : Number(height) * (unit === "metric" ? 1 : 2.54),
              weightKg:
                weight === ""
                  ? null
                  : Number(weight) / (unit === "metric" ? 1 : 2.2046226218),
            });
            await onSaved();
            setNotice("Measurements saved.");
          } catch (e) {
            setNotice(
              e instanceof Error ? e.message : "Could not save measurements.",
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          Measurement units
          <select
            value={unit}
            onChange={(e) => switchUnit(e.target.value as typeof unit)}
            disabled={busy}
          >
            <option value="metric">Metric (cm / kg)</option>
            <option value="imperial">Imperial (in / lb)</option>
          </select>
        </label>
        <div className="measurement-fields">
          <label>
            Height ({unit === "metric" ? "cm" : "in"})
            <input
              type="number"
              step="any"
              min={unit === "metric" ? 50 : 50 / 2.54}
              max={unit === "metric" ? 260 : 260 / 2.54}
              value={height}
              onChange={(e) => setHeight(e.target.value)}
              disabled={busy}
            />
          </label>
          <label>
            Weight ({unit === "metric" ? "kg" : "lb"})
            <input
              type="number"
              step="any"
              min={unit === "metric" ? 20 : 20 * 2.2046226218}
              max={unit === "metric" ? 500 : 500 * 2.2046226218}
              value={weight}
              onChange={(e) => setWeight(e.target.value)}
              disabled={busy}
            />
          </label>
        </div>
        <p className="small muted">Leave a field blank to remove it.</p>
        <button className="button secondary" disabled={busy}>
          Save measurements
        </button>
        <p role="status">{notice}</p>
      </form>
    </section>
  );
}
