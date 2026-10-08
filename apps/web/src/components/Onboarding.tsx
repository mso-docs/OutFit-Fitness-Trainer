import { useState, useEffect, useRef, type FormEvent } from "react";
import {
  Leaf,
  ArrowRight,
  ArrowLeft,
  LoaderCircle,
  ShieldCheck,
  Heart,
} from "lucide-react";
import type {
  Profile,
  Goal,
  ProfileInput,
} from "../../../../packages/domain/src/schemas";
import { profileInput as validateProfile } from "../../../../packages/domain/src/schemas";
import { api } from "../api";
import { goalNames, activityNames, weekdayNames } from "../shared";
import { Landscape, SafetyFields } from "./ui";
export function Onboarding({
  profile,
  goal,
  onDone,
  onCancel,
}: {
  profile: Profile | null;
  goal: Goal | null;
  onDone: () => Promise<void>;
  onCancel?: () => void;
}) {
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [p, setP] = useState<ProfileInput>({
    adultConfirmed: profile?.adultConfirmed ?? false,
    heightCm: profile?.heightCm ?? null,
    weightKg: profile?.weightKg ?? null,
    timezone:
      profile?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
    experience: profile?.experience ?? "beginner",
    baselineWeeklyMinutes: profile?.baselineWeeklyMinutes ?? null,
    longestComfortableMinutes: profile?.longestComfortableMinutes ?? null,
    runningRegularly: profile?.runningRegularly ?? false,
    preferences: profile?.preferences ?? ["walk"],
    outdoorPreferred: profile?.outdoorPreferred ?? true,
    availability:
      profile?.availability ??
      [1, 3, 5].map((weekday) => ({ weekday, maxMinutes: 20 })),
    safetyFlags: profile?.safetyFlags ?? [],
    safetyScreenCompletedAt: profile?.safetyScreenCompletedAt ?? null,
    expectedRevision: profile?.revision ?? 0,
  });
  const [g, setG] = useState({
    kind: goal?.kind ?? "build_consistency",
    targetDate: goal?.targetDate ?? null,
    desiredSessionsPerWeek: goal?.desiredSessionsPerWeek ?? 3,
    expectedRevision: goal?.revision ?? 0,
  });
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, [step]);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (step === 0 && !p.adultConfirmed) {
      setError("Confirm adult use to continue.");
      return;
    }
    if (
      step === 1 &&
      (!p.availability.length ||
        g.desiredSessionsPerWeek > p.availability.length)
    ) {
      setError(
        "Choose at least one day and no more sessions than available days.",
      );
      return;
    }
    const validation = validateProfile.safeParse(p);
    if (!validation.success) {
      const issue = validation.error.issues[0];
      setError(
        issue.path[0] === "timezone"
          ? "Choose a valid IANA timezone, such as America/New_York."
          : issue.path[0] === "preferences"
            ? "Choose at least one activity."
            : issue.message,
      );
      return;
    }
    setBusy(true);
    if (step < 3) {
      try {
        const saved = await api<Profile>("/profile", "PUT", p);
        setP((v) => ({
          ...v,
          expectedRevision: saved.revision,
          safetyScreenCompletedAt: saved.safetyScreenCompletedAt,
        }));
        setStep(step + 1);
      } catch (e) {
        setError(
          e instanceof Error ? e.message : "Could not save your progress.",
        );
      } finally {
        setBusy(false);
      }
      return;
    }
    try {
      const saved = await api<Profile>("/profile", "PUT", {
        ...p,
        safetyScreenCompletedAt: new Date().toISOString(),
      });
      setP((v) => ({ ...v, expectedRevision: saved.revision }));
      const savedGoal = await api<Goal>("/goals/active", "PUT", g);
      setG((v) => ({ ...v, expectedRevision: savedGoal.revision }));
      await onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save your profile.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="onboarding">
      <a className="brand" href="#">
        <span className="brand-icon">
          <Leaf size={23} />
        </span>
        OutFit<span className="brand-dot">.</span>
      </a>
      <a className="onboard-help" href="./help.html">
        Help & documentation
      </a>
      <div className="onboard-layout">
        <aside className="onboard-aside">
          <span className="eyebrow">
            A LITTLE MOVEMENT. A LITTLE MORE OUTSIDE.
          </span>
          <h1>
            Make room
            <br />
            for yourself.
          </h1>
          <p>
            A week that meets you where you are.
            <br />
            Start small. Head outside. Find your rhythm.
          </p>
          <Landscape />
          <div className="privacy-line">
            <ShieldCheck size={18} /> Your plan. Your computer. Your data.
          </div>
        </aside>
        <section className="onboard-card">
          {import.meta.env.MODE === "pages" && (
            <p className="small muted">
              Browser mode: your profile and health data are saved on this
              device in this site’s browser storage. It is not encrypted, and
              scripts on the same website origin can read it. Use a trusted
              device, export backups, and clear your data on shared computers.
            </p>
          )}
          <div className="step-line">
            <span>LET’S GET TO KNOW YOU</span>
            <span>{step + 1} / 4</span>
          </div>
          <div className="step-bars">
            {[0, 1, 2, 3].map((n) => (
              <span key={n} className={n <= step ? "filled" : ""} />
            ))}
          </div>
          <form onSubmit={submit}>
            <h2 ref={heading} tabIndex={-1}>
              {
                [
                  "A good place to start",
                  "A week that works for you",
                  "What feels comfortable?",
                  "One quick safety check",
                ][step]
              }
            </h2>
            <p className="muted">
              {
                [
                  "About three minutes. No perfect starting point needed.",
                  "Small windows count. Your time limits are ceilings.",
                  "Unknown is a useful answer. We’ll start gently.",
                  "OutFit offers general fitness guidance for adults, not medical clearance.",
                ][step]
              }
            </p>
            {step === 0 && (
              <>
                <label className="checkbox-row prominent">
                  <input
                    type="checkbox"
                    checked={p.adultConfirmed}
                    onChange={(e) =>
                      setP({ ...p, adultConfirmed: e.target.checked })
                    }
                  />
                  I am 18 or older.
                </label>
                <label>
                  Timezone
                  <input
                    required
                    aria-label="Timezone"
                    aria-invalid={error.includes("timezone") || undefined}
                    aria-describedby={
                      error.includes("timezone") ? "timezone-error" : undefined
                    }
                    value={p.timezone}
                    onChange={(e) => setP({ ...p, timezone: e.target.value })}
                    placeholder="America/New_York"
                  />
                  {error.includes("timezone") && (
                    <small id="timezone-error" className="field-error">
                      {error}
                    </small>
                  )}
                </label>
                <fieldset>
                  <legend>What would you like to make room for?</legend>
                  {Object.entries(goalNames).map(([value, label]) => (
                    <label
                      className={
                        "choice-card " + (g.kind === value ? "selected" : "")
                      }
                      key={value}
                    >
                      <input
                        type="radio"
                        name="goal"
                        checked={g.kind === value}
                        onChange={() =>
                          setG({ ...g, kind: value as Goal["kind"] })
                        }
                      />
                      <span>
                        <strong>{label}</strong>
                        <small>
                          {value === "build_consistency"
                            ? "A sustainable routine, one small session at a time."
                            : value === "walk_more"
                              ? "More easy movement in your everyday week."
                              : "A walking foundation, with gentle running when eligible."}
                        </small>
                      </span>
                    </label>
                  ))}
                </fieldset>
                <p className="small muted">
                  Data stays in a local SQLite file on this computer. It is not
                  automatically encrypted.
                </p>
              </>
            )}
            {step === 1 && (
              <>
                <fieldset>
                  <legend>Which days could work?</legend>
                  <div className="availability">
                    {weekdayNames.map((label, i) => {
                      const a = p.availability.find((a) => a.weekday === i + 1);
                      return (
                        <div key={label}>
                          <label className="checkbox-row">
                            <input
                              type="checkbox"
                              checked={!!a}
                              onChange={(e) =>
                                setP({
                                  ...p,
                                  availability: e.target.checked
                                    ? [
                                        ...p.availability,
                                        { weekday: i + 1, maxMinutes: 20 },
                                      ]
                                    : p.availability.filter(
                                        (a) => a.weekday !== i + 1,
                                      ),
                                })
                              }
                            />
                            {label}
                          </label>
                          {a && (
                            <label className="minute-input">
                              <input
                                type="number"
                                aria-label={label + " time limit"}
                                min="5"
                                max="60"
                                required
                                value={a.maxMinutes}
                                onChange={(e) =>
                                  setP({
                                    ...p,
                                    availability: p.availability.map((x) =>
                                      x.weekday === i + 1
                                        ? {
                                            ...x,
                                            maxMinutes: Number(e.target.value),
                                          }
                                        : x,
                                    ),
                                  })
                                }
                              />{" "}
                              min
                            </label>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </fieldset>
                <div className="form-grid">
                  <label>
                    Preferred sessions per week
                    <input
                      type="number"
                      required
                      min="1"
                      max={Math.min(5, p.availability.length) || 1}
                      value={g.desiredSessionsPerWeek}
                      onChange={(e) =>
                        setG({
                          ...g,
                          desiredSessionsPerWeek: Number(e.target.value),
                        })
                      }
                    />
                  </label>
                  <label>
                    Motivational target date{" "}
                    <small>Optional; it won’t accelerate your plan.</small>
                    <input
                      type="date"
                      value={g.targetDate ?? ""}
                      onChange={(e) =>
                        setG({ ...g, targetDate: e.target.value || null })
                      }
                    />
                  </label>
                </div>
              </>
            )}
            {step === 2 && (
              <>
                <label>
                  Experience
                  <select
                    value={p.experience}
                    onChange={(e) =>
                      setP({
                        ...p,
                        experience: e.target.value as Profile["experience"],
                      })
                    }
                  >
                    <option value="beginner">I’m starting or returning</option>
                    <option value="recreational">
                      I exercise recreationally
                    </option>
                  </select>
                </label>
                <div className="form-grid">
                  <label>
                    Recent weekly activity (minutes)
                    <input
                      type="number"
                      min="0"
                      max="2000"
                      placeholder="Not sure"
                      value={p.baselineWeeklyMinutes ?? ""}
                      onChange={(e) =>
                        setP({
                          ...p,
                          baselineWeeklyMinutes:
                            e.target.value === ""
                              ? null
                              : Number(e.target.value),
                        })
                      }
                    />
                  </label>
                  <label>
                    Longest comfortable session (minutes)
                    <input
                      type="number"
                      min="1"
                      max="300"
                      placeholder="Not sure"
                      value={p.longestComfortableMinutes ?? ""}
                      onChange={(e) =>
                        setP({
                          ...p,
                          longestComfortableMinutes:
                            e.target.value === ""
                              ? null
                              : Number(e.target.value),
                        })
                      }
                    />
                  </label>
                </div>
                <fieldset>
                  <legend>Activities you enjoy</legend>
                  {(["walk", "run_walk", "mobility"] as const).map((a) => (
                    <label className="checkbox-row" key={a}>
                      <input
                        type="checkbox"
                        checked={p.preferences.includes(a)}
                        onChange={(e) =>
                          setP({
                            ...p,
                            preferences: e.target.checked
                              ? [...p.preferences, a]
                              : p.preferences.filter((x) => x !== a),
                          })
                        }
                      />
                      {activityNames[a]}
                    </label>
                  ))}
                </fieldset>
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={p.runningRegularly}
                    onChange={(e) =>
                      setP({ ...p, runningRegularly: e.target.checked })
                    }
                  />
                  I already run regularly.
                </label>
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={p.outdoorPreferred}
                    onChange={(e) =>
                      setP({ ...p, outdoorPreferred: e.target.checked })
                    }
                  />
                  I prefer to go outside when it feels suitable.
                </label>
              </>
            )}
            {step === 3 && (
              <>
                <SafetyFields
                  selected={p.safetyFlags}
                  onChange={(v) =>
                    setP({ ...p, safetyFlags: v as Profile["safetyFlags"] })
                  }
                />
                <div className="soft-note">
                  <Heart size={18} />
                  <p>
                    Start comfortably, stay conversational, and stop if symptoms
                    appear. OutFit cannot diagnose conditions or assess medical
                    fitness.
                  </p>
                </div>
                <p className="small muted">
                  If you select a flag, exercise recommendations will pause.
                  Re-screen after obtaining appropriate guidance.
                </p>
              </>
            )}
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <div className="form-actions">
              {step > 0 ? (
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => setStep(step - 1)}
                >
                  <ArrowLeft size={16} /> Back
                </button>
              ) : onCancel ? (
                <button
                  type="button"
                  className="button secondary"
                  onClick={onCancel}
                >
                  Cancel
                </button>
              ) : (
                <span />
              )}
              <button className="button" disabled={busy}>
                {busy ? <LoaderCircle className="spin" size={17} /> : null}
                {step === 3 ? "Save my profile" : "Continue"}
                <ArrowRight size={17} />
              </button>
            </div>
          </form>
        </section>
      </div>
      <footer className="onboard-footer">
        Built for a little more outside. <span>Local by design.</span>
      </footer>
    </main>
  );
}
