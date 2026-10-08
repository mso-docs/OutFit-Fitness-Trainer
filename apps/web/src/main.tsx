import React, { useState, useEffect } from "react";
import { createRoot } from "react-dom/client";
import {
  MessageCircle,
  ArrowUpRight,
  ArrowRight,
  Leaf,
  Footprints,
  Sun,
  Moon,
  CalendarDays,
  ChartNoAxesColumn,
  Settings,
  Plus,
  Check,
  MapPin,
  Clock,
  ChevronRight,
  X,
  Download,
  Heart,
  Activity,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import type {
  Profile,
  Goal,
  Plan,
  Session,
  WorkoutLog,
  CheckIn,
  Job,
} from "../../../packages/domain/src/schemas";
import { today, addDays } from "../../../packages/domain/src/planning";
import {
  instructions,
  safetyMessage,
  urgentMessage,
} from "../../../packages/domain/src/catalog";
import { api, APIError, setToken, allPages } from "./api";
import { goalNames, activityNames, weekdayNames, formatDate } from "./shared";
import { Badge, Landscape, Modal } from "./components/ui";
import { Onboarding } from "./components/Onboarding";
import { PlanView } from "./components/PlanView";
import { LogModal, CheckModal } from "./components/Logs";
import { BrowserConnection } from "./components/BrowserConnection";
import { HealthData } from "./components/HealthData";
import { TrainerChat } from "./components/TrainerChat";
import { Measurements } from "./components/Measurements";
import "./style.css";
const browserMode = import.meta.env.MODE === "pages";
type Page =
  "Today" | "My plan" | "Progress" | "Health data" | "Trainer" | "Settings";
type State = {
  inputRevision: number;
  currentPlanId: string | null;
  safetyBlocked: boolean;
  safetyFlags: string[];
  today: string;
};
type Models = {
  models: { tag: string }[];
  selectedModel: string | null;
  available: boolean;
};
type Metrics = {
  actualMinutes: number;
  outdoorMinutes: number;
  completedPlannedSessions: number;
  eligiblePlannedSessions: number;
  adherence: number | null;
};
function App() {
  const [page, setPage] = useState<Page>("Today");
  const [profile, setProfile] = useState<Profile | null>(null);
  const [goal, setGoal] = useState<Goal | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [logs, setLogs] = useState<WorkoutLog[]>([]);
  const [checks, setChecks] = useState<CheckIn[]>([]);
  const [state, setState] = useState<State | null>(null);
  const [models, setModels] = useState<Models>({
    models: [],
    selectedModel: null,
    available: false,
  });
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editProfile, setEditProfile] = useState(false);
  const [draft, setDraft] = useState<Plan | null>(null);
  const [job, setJob] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [modal, setModal] = useState<"log" | "check" | "delete" | null>(null);
  const [logSession, setLogSession] = useState<Session | null>(null);
  const [editingLog, setEditingLog] = useState<WorkoutLog | null>(null);
  const [startDate, setStartDate] = useState("");
  const [needsToken, setNeedsToken] = useState(false);
  const [displayDate, setDisplayDate] = useState("");
  useEffect(() => {
    const heading = document.querySelector<HTMLElement>("#main-content h1");
    if (heading) {
      heading.setAttribute("tabindex", "-1");
      heading.focus();
      window.scrollTo(0, 0);
    }
  }, [page, !!profile, editProfile]);
  async function load() {
    try {
      const [p, g, pl, s, m, history, ls, cs] = await Promise.all([
        api<Profile | null>("/profile"),
        api<Goal | null>("/goals/active"),
        api<Plan | null>("/plans/current"),
        api<State>("/state"),
        api<Models>("/ai/models"),
        allPages<Plan>("/plans"),
        allPages<WorkoutLog>("/logs?from=2000-01-01&to=2099-12-31"),
        api<CheckIn[]>("/check-ins?from=2000-01-01&to=2099-12-31"),
      ]);
      setProfile(p);
      setGoal(g);
      setPlan(pl);
      setState(s);
      setModels(m);
      setPlans(history);
      setLogs(ls);
      setChecks(cs);
      const nextStart =
        pl && pl.endDate >= s.today ? addDays(pl.endDate, 1) : s.today;
      setStartDate((v) => (v && v >= nextStart ? v : nextStart));
      setDisplayDate((v) => v || s.today);
      setMetrics(
        await api<Metrics>(
          `/progress?from=${addDays(s.today, -6)}&to=${s.today}`,
        ),
      );
      setNeedsToken(false);
    } catch (e) {
      if (e instanceof APIError && e.code === "ACCESS_REQUIRED")
        setNeedsToken(true);
      else
        setError(
          e instanceof Error ? e.message : "Could not connect to the server.",
        );
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  useEffect(() => {
    if (!job) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      if (!active) return;
      if (document.visibilityState === "hidden") {
        timer = setTimeout(poll, 2000);
        return;
      }
      try {
        const result = await api<Job>("/jobs/" + job);
        if (!active) return;
        if (result.status === "completed" && result.planId) {
          setDraft(await api<Plan>("/plans/" + result.planId));
          setJob(null);
          setNotice("Your plan preview is ready. Review it before accepting.");
          await load();
        } else if (result.status === "failed") {
          setJob(null);
          setError(
            result.errorCode === "STALE_INPUT"
              ? "Your data changed while preparing this plan. Prepare a fresh preview."
              : "The plan could not be prepared. Please retry.",
          );
        } else timer = setTimeout(poll, 2000);
      } catch (e) {
        if (active) {
          setJob(null);
          setError(
            e instanceof Error
              ? e.message
              : "Could not check the plan request.",
          );
        }
      }
    }
    void poll();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [job]);
  async function act(fn: () => Promise<void>) {
    setError("");
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }
  async function generate(adapt = false) {
    if (!state) return;
    await act(async () => {
      const result = await api<{ jobId: string }>(
        adapt ? "/plans/" + plan!.id + "/adapt" : "/plans/generate",
        "POST",
        adapt
          ? { expectedInputRevision: state.inputRevision }
          : { startDate, expectedInputRevision: state.inputRevision },
        crypto.randomUUID(),
      );
      setJob(result.jobId);
      setNotice("Preparing your week. You can keep using OutFit.");
    });
  }
  function openLog(s: Session | null = null, l: WorkoutLog | null = null) {
    setLogSession(s);
    setEditingLog(l);
    setModal("log");
  }
  function navigate(p: Page) {
    setPage(p);
    setJob(null);
    setNotice("");
    setError("");
  }
  const currentDate = state?.today ?? today(profile?.timezone ?? "UTC");
  const session = plan?.sessions.find((s) => s.date === displayDate);
  const sessionLog = logs.find((l) => l.planSessionId === session?.id);
  const loggedIds = new Set(logs.map((l) => l.planSessionId));
  const todayCheck = checks.find((c) => c.date === currentDate);
  const incomplete = profile !== null && !goal;
  const blocked = state?.safetyBlocked ?? true;
  if (loading)
    return (
      <div className="full-state">
        <Leaf size={32} />
        <h1>OutFit</h1>
        <p role="status">Opening your space…</p>
      </div>
    );
  if (needsToken)
    return (
      <div className="full-state">
        <h1>Connect to OutFit</h1>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setToken(String(new FormData(e.currentTarget).get("token")));
            void load();
          }}
        >
          <label>
            Server access token
            <input name="token" type="password" required />
          </label>
          <button className="button">Connect</button>
        </form>
      </div>
    );
  if (!state)
    return (
      <div className="full-state">
        <h1>Let’s get connected</h1>
        <p role="alert">{error}</p>
        <p>Start the OutFit API on this computer, then try again.</p>
        <button className="button" onClick={() => void load()}>
          Retry
        </button>
      </div>
    );
  if (!profile || editProfile || incomplete)
    return (
      <Onboarding
        profile={profile}
        goal={goal}
        onCancel={profile && goal ? () => setEditProfile(false) : undefined}
        onDone={async () => {
          setEditProfile(false);
          setPage("Today");
          await load();
        }}
      />
    );
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            navigate("Today");
          }}
        >
          <span className="brand-icon">
            <Leaf size={23} />
          </span>
          OutFit<span className="brand-dot">.</span>
        </a>
        <div className="sidebar-label">YOUR EVERYDAY OUTSIDE</div>
        <nav aria-label="Main navigation">
          {(
            [
              { label: "Today", icon: Sun },
              { label: "My plan", icon: CalendarDays },
              { label: "Progress", icon: ChartNoAxesColumn },
              { label: "Trainer", icon: MessageCircle },
              { label: "Health data", icon: Activity },
              { label: "Settings", icon: Settings },
            ] as const
          ).map(({ label, icon: Icon }) => (
            <button
              key={label}
              className={"nav-item " + (page === label ? "active" : "")}
              onClick={() => navigate(label)}
              aria-label={label}
              aria-current={page === label ? "page" : undefined}
            >
              <Icon size={20} />
              {label}
              {page === label && <span className="nav-dot" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="tiny-landscape">
            <Landscape />
          </div>
          <p>
            A small step is still
            <br />a step outside.
          </p>
          <div className="local-label">
            <span className="status-dot" />
            Local & private
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <span>
            <span className="topbar-name">YOUR SPACE</span>
            <span className="topbar-divider">/</span>
            {page}
          </span>
          <div className="topbar-right">
            <span className="local-ai">
              <span
                className={"status-dot " + (models.available ? "" : "offline")}
              />
              {models.available ? "Local AI connected" : "Local AI offline"}
            </span>
            <span className="avatar" aria-label="Local user">
              YOU
            </span>
          </div>
        </header>
        <main id="main-content" className="content">
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                {page === "Today"
                  ? formatDate(currentDate, {
                      weekday: "long",
                      month: "long",
                      day: "numeric",
                    }).toUpperCase()
                  : page === "My plan"
                    ? "YOUR NEXT SMALL STEPS"
                    : page === "Progress"
                      ? "EVERY BIT OF MOVEMENT COUNTS"
                      : page === "Trainer"
                        ? "YOUR TRAINER"
                        : page === "Health data"
                          ? "YOUR ACTIVITY SOURCES"
                          : "MAKE THIS SPACE YOURS"}
              </div>
              <h1>
                {page === "Today"
                  ? "A little outside goes a long way."
                  : page === "My plan"
                    ? "A week at your pace."
                    : page === "Progress"
                      ? "Look how far you’ve come."
                      : page === "Trainer"
                        ? "A little encouragement, whenever you need it."
                        : page === "Health data"
                          ? "A clearer picture of your movement."
                          : "Keep it personal."}
              </h1>
              <p className="muted">
                {page === "Today"
                  ? "Less planning. More fresh air. Here’s your next small step."
                  : page === "My plan"
                    ? "A realistic rhythm, with room to rest and adjust."
                    : page === "Progress"
                      ? "An honest picture of your activity. No streaks, no pressure."
                      : page === "Trainer"
                        ? "Ask a question. Find your next small step."
                        : page === "Health data"
                          ? "Activity from your health apps, with its source kept visible."
                          : "Your routine, your data, and your local AI."}
              </p>
            </div>
            {page === "Today" && (
              <button className="button secondary" onClick={() => openLog()}>
                <Plus size={17} />
                Log activity
              </button>
            )}
          </div>
          {error && (
            <div className="alert error" role="alert">
              {error}
              <button
                className="icon-button"
                aria-label="Dismiss error"
                onClick={() => setError("")}
              >
                <X size={17} />
              </button>
            </div>
          )}
          <div className="live-notice" role="status" aria-live="polite">
            {notice}
          </div>
          {blocked && (
            <div className="alert safety">
              <Heart size={22} />
              <div>
                <strong>Exercise recommendations are paused</strong>
                <p>
                  {state.safetyFlags.some((f) =>
                    [
                      "chest_pain",
                      "fainting",
                      "unusual_breathlessness",
                    ].includes(f),
                  )
                    ? urgentMessage
                    : safetyMessage}
                </p>
              </div>
              <button
                className="button secondary"
                onClick={() => setEditProfile(true)}
              >
                Review safety screen
              </button>
            </div>
          )}
          {job && (
            <div className="alert info" role="status">
              <LoaderCircle className="spin" size={20} />
              Preparing a plan preview. Local AI may take up to 90 seconds; a
              validated fallback is available.
            </div>
          )}
          {page === "Trainer" && <TrainerChat />}
          {page === "Health data" && <HealthData timezone={profile.timezone} />}
          {page === "Today" && (
            <>
              <div className="today-grid">
                <section className="today-card">
                  <div className="card-top">
                    <span className="eyebrow">
                      {displayDate === currentDate
                        ? "TODAY’S LITTLE ADVENTURE"
                        : formatDate(displayDate, {
                            weekday: "long",
                            month: "short",
                            day: "numeric",
                          }).toUpperCase()}
                    </span>
                    <Badge tone={blocked ? "sand" : "green"}>
                      {blocked
                        ? "Paused"
                        : session?.kind === "rest"
                          ? "Rest day"
                          : sessionLog
                            ? sessionLog.status[0].toUpperCase() +
                              sessionLog.status.slice(1)
                            : session
                              ? "Your plan"
                              : "Fresh start"}
                    </Badge>
                  </div>
                  <div className="today-card-body">
                    <div className="activity-circle">
                      {session?.kind === "rest" ? (
                        <Moon size={35} />
                      ) : (
                        <Footprints size={35} />
                      )}
                    </div>
                    <h2>
                      {blocked
                        ? "Take a pause."
                        : session
                          ? activityNames[session.kind]
                          : "Your first step starts here."}
                    </h2>
                    <p>
                      {blocked
                        ? "Give yourself space to get appropriate guidance."
                        : session?.kind === "rest"
                          ? "Let today be a quiet one. Rest belongs in your routine."
                          : session
                            ? "An easy pace, a little fresh air, and time for yourself."
                            : "Choose a small, realistic plan for the next seven days."}
                    </p>
                    {session && !blocked && session.kind !== "rest" && (
                      <div className="session-details">
                        <span>
                          <Clock size={17} />
                          {session.durationMinutes} minutes
                        </span>
                        <span>
                          <Activity size={17} />
                          Conversational pace
                        </span>
                        <span>
                          <MapPin size={17} />
                          {session.location === "outdoor"
                            ? "Outside or indoor alternative"
                            : session.location === "indoor"
                              ? "Indoors"
                              : "Your choice"}
                        </span>
                      </div>
                    )}
                    {!blocked && session ? (
                      <>
                        {session.kind !== "rest" && (
                          <button
                            className="button"
                            disabled={displayDate > currentDate}
                            onClick={() => openLog(session, sessionLog ?? null)}
                          >
                            {sessionLog
                              ? "Edit activity log"
                              : "Log this activity"}
                            <ArrowUpRight size={17} />
                          </button>
                        )}
                        <p className="effort-note">
                          {instructions[session.instructionIds[0]]}
                        </p>
                      </>
                    ) : !blocked ? (
                      <button
                        className="button"
                        onClick={() => setPage("My plan")}
                      >
                        Create my first plan
                        <ArrowRight size={17} />
                      </button>
                    ) : (
                      <button
                        className="button secondary"
                        onClick={() => openLog()}
                      >
                        Log an observation
                      </button>
                    )}
                  </div>
                  <Landscape />
                </section>
                <aside className="right-stack">
                  <section className="card check-card">
                    <div className="card-title">
                      <span className="mini-icon">
                        <Heart size={20} />
                      </span>
                      <h2>A moment for you</h2>
                    </div>
                    <p className="muted">
                      How are you feeling today? Your plan can make room for
                      recovery.
                    </p>
                    <div className="energy-dots">
                      {[1, 2, 3, 4, 5].map((n) => (
                        <span
                          key={n}
                          className={todayCheck?.energy === n ? "chosen" : ""}
                        >
                          {["Very low", "Low", "Okay", "Good", "Great"][n - 1]}
                        </span>
                      ))}
                    </div>
                    <button
                      className="text-button"
                      onClick={() => setModal("check")}
                    >
                      {todayCheck
                        ? "Update your check-in"
                        : "Take a quick check-in"}
                      <ArrowRight size={16} />
                    </button>
                    {todayCheck && (
                      <span className="small muted">
                        Saved for today ·{" "}
                        {todayCheck.energy === null
                          ? "Energy unknown"
                          : "Energy " + todayCheck.energy + "/5"}
                      </span>
                    )}
                  </section>
                  <section className="card week-summary">
                    <span className="eyebrow">THE LAST SEVEN DAYS</span>
                    <div className="summary-number">
                      {metrics?.actualMinutes ?? 0}
                      <span>minutes of movement</span>
                    </div>
                    <div className="summary-rule" />
                    <div className="summary-row">
                      <span>
                        <Sun size={17} />
                        Outside time
                      </span>
                      <strong>{metrics?.outdoorMinutes ?? 0} min</strong>
                    </div>
                    <div className="summary-row">
                      <span>
                        <Check size={17} />
                        Planned sessions completed
                      </span>
                      <strong>
                        {metrics?.completedPlannedSessions ?? 0} /{" "}
                        {metrics?.eligiblePlannedSessions ?? 0}
                      </strong>
                    </div>
                    <button
                      className="text-button"
                      onClick={() => setPage("Progress")}
                    >
                      See your progress
                      <ArrowUpRight size={16} />
                    </button>
                  </section>
                </aside>
              </div>
              <section className="week-section">
                <div className="section-heading">
                  <div>
                    <h2>Your week, at a glance</h2>
                    <p className="muted">Some movement. Some breathing room.</p>
                  </div>
                  <button
                    className="text-button"
                    onClick={() => setPage("My plan")}
                  >
                    View full plan
                    <ChevronRight size={16} />
                  </button>
                </div>
                {plan ? (
                  <div className="week-strip">
                    {plan.sessions.map((s) => (
                      <button
                        key={s.id}
                        className={
                          "day-card " +
                          (s.date === displayDate ? "selected" : "") +
                          (s.kind === "rest" ? " rest" : "")
                        }
                        onClick={() => setDisplayDate(s.date)}
                        aria-pressed={s.date === displayDate}
                      >
                        <span className="day-label">
                          {formatDate(s.date, { weekday: "short" })}
                          <strong>
                            {formatDate(s.date, { day: "numeric" })}
                          </strong>
                        </span>
                        <span className="day-icon">
                          {loggedIds.has(s.id) ? (
                            <Check size={20} />
                          ) : s.kind === "rest" ? (
                            <Moon size={20} />
                          ) : (
                            <Footprints size={20} />
                          )}
                        </span>
                        <strong>
                          {blocked
                            ? "Paused"
                            : s.kind === "rest"
                              ? "Rest"
                              : s.kind === "walk"
                                ? "Walk"
                                : s.kind === "mobility"
                                  ? "Mobility"
                                  : "Run / walk"}
                        </strong>
                        <span className="small">
                          {blocked
                            ? "—"
                            : s.kind === "rest"
                              ? "Room to recover"
                              : s.durationMinutes + " min · easy"}
                        </span>
                        {s.date === currentDate && (
                          <span className="today-label">Today</span>
                        )}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="empty-inline">
                    <CalendarDays size={24} />
                    <span>
                      Your week will appear here after you accept a plan.
                    </span>
                  </div>
                )}
              </section>
              {plan &&
                !blocked &&
                state.inputRevision > plan.inputRevision + 1 && (
                  <div className="adjust-banner">
                    <RefreshCw size={21} />
                    <div>
                      <strong>Your plan can move with you.</strong>
                      <p>
                        You’ve added new information. Review an adjustment when
                        you’re ready.
                      </p>
                    </div>
                    <button
                      className="button secondary"
                      disabled={busy || !!job}
                      onClick={() => void generate(true)}
                    >
                      Review adjustment
                    </button>
                  </div>
                )}
              <div className="gentle-footer">
                <Leaf size={16} />
                Progress can be quiet. A walk around the block counts.
              </div>
            </>
          )}
          {page === "My plan" && (
            <>
              <div className="plan-controls card">
                <div>
                  <Badge>{goalNames[goal!.kind]}</Badge>
                  <p className="muted">
                    Preview first. Your current week changes only when you
                    accept.
                  </p>
                </div>
                <div className="plan-create">
                  <label>
                    Start date
                    <input
                      type="date"
                      required
                      min={
                        plan && plan.endDate >= currentDate
                          ? addDays(plan.endDate, 1)
                          : currentDate
                      }
                      max={addDays(currentDate, 30)}
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                    />
                  </label>
                  <button
                    className="button"
                    disabled={blocked || busy || !!job || !startDate}
                    onClick={() => void generate()}
                  >
                    <Plus size={17} />
                    {plan ? "Preview a new week" : "Create my plan"}
                  </button>
                  {plan && (
                    <button
                      className="button secondary"
                      disabled={
                        blocked ||
                        busy ||
                        !!job ||
                        !plan.sessions.some(
                          (s) => s.date >= currentDate && !loggedIds.has(s.id),
                        )
                      }
                      onClick={() => void generate(true)}
                    >
                      <RefreshCw size={17} />
                      Adjust this week
                    </button>
                  )}
                </div>
              </div>
              {plan ? (
                <>
                  <PlanView
                    plan={plan}
                    blocked={blocked}
                    logs={logs}
                    onLog={(s) =>
                      openLog(
                        s,
                        logs.find((l) => l.planSessionId === s.id) ?? null,
                      )
                    }
                    currentDate={currentDate}
                  />
                </>
              ) : (
                <div className="empty-card">
                  <CalendarDays size={36} />
                  <h2>Let’s make a little room.</h2>
                  <p>
                    Prepare a seven-day preview based on your available time.
                    <br />
                    If local AI is offline, the deterministic planner still
                    works.
                  </p>
                </div>
              )}
              <section className="card history-card">
                <h2>Plan history</h2>
                {plans.length ? (
                  plans.map((p) => (
                    <div className="history-row" key={p.id}>
                      <div>
                        <strong>
                          {formatDate(p.startDate)} – {formatDate(p.endDate)}
                        </strong>
                        <span className="muted small">
                          {p.source === "ollama"
                            ? "Local AI"
                            : "Fallback planner"}{" "}
                          · {p.parentPlanId ? "Adjustment" : "New week"}
                        </span>
                      </div>
                      <Badge tone={p.status === "accepted" ? "green" : "sand"}>
                        {p.status}
                      </Badge>
                      {p.status === "draft" && (
                        <button
                          className="text-button"
                          onClick={() => setDraft(p)}
                        >
                          Review
                          <ChevronRight size={16} />
                        </button>
                      )}
                    </div>
                  ))
                ) : (
                  <p className="muted">
                    Your plan previews and accepted weeks will appear here.
                  </p>
                )}
              </section>
            </>
          )}
          {page === "Progress" && (
            <>
              <div className="metrics-grid">
                {[
                  {
                    label: "Actual movement",
                    value: metrics?.actualMinutes ?? 0,
                    unit: "minutes",
                    icon: Footprints,
                  },
                  {
                    label: "Time outside",
                    value: metrics?.outdoorMinutes ?? 0,
                    unit: "minutes recorded outdoors",
                    icon: Sun,
                  },
                  {
                    label: "Planned sessions",
                    value: `${metrics?.completedPlannedSessions ?? 0} / ${metrics?.eligiblePlannedSessions ?? 0}`,
                    unit: "completed / eligible",
                    icon: Check,
                  },
                  {
                    label: "Plan adherence",
                    value:
                      metrics?.adherence === null ||
                      metrics?.adherence === undefined
                        ? "—"
                        : Math.round(metrics.adherence * 100) + "%",
                    unit: "Rest and future days excluded",
                    icon: CalendarDays,
                  },
                ].map(({ label, value, unit, icon: Icon }) => (
                  <section className="card metric" key={label}>
                    <Icon size={22} />
                    <span>{label}</span>
                    <strong>{value}</strong>
                    <small>{unit}</small>
                  </section>
                ))}
              </div>
              <div className="section-heading">
                <div>
                  <h2>The last seven days</h2>
                  <p className="muted">
                    {formatDate(addDays(currentDate, -6))} –{" "}
                    {formatDate(currentDate)} · Unknown effort and recovery
                    remain unknown.
                  </p>
                </div>
                <button className="button secondary" onClick={() => openLog()}>
                  <Plus size={16} />
                  Log activity
                </button>
              </div>
              <section className="card movement-chart">
                <div className="chart-bars">
                  {Array.from({ length: 7 }, (_, i) =>
                    addDays(currentDate, i - 6),
                  ).map((d) => {
                    const minutes = logs
                      .filter((l) => l.date === d)
                      .reduce((sum, l) => sum + l.durationMinutes, 0);
                    const max = Math.max(
                      10,
                      ...Array.from({ length: 7 }, (_, i) =>
                        logs
                          .filter((l) => l.date === addDays(currentDate, i - 6))
                          .reduce((sum, l) => sum + l.durationMinutes, 0),
                      ),
                    );
                    return (
                      <div className="chart-column" key={d}>
                        <span>{minutes} min</span>
                        <div className="bar-track">
                          <div
                            className="bar"
                            style={{ height: (minutes / max) * 100 + "%" }}
                          />
                        </div>
                        <span>{formatDate(d, { weekday: "short" })}</span>
                      </div>
                    );
                  })}
                </div>
              </section>
              <section className="card history-card">
                <h2>Activity history</h2>
                <p className="muted small">
                  Partial sessions stay visible. Unplanned activity contributes
                  minutes without completing a planned session.
                </p>
                {logs.length ? (
                  logs.map((l) => (
                    <div className="history-row" key={l.id}>
                      <span className="mini-icon">
                        <Footprints size={19} />
                      </span>
                      <div className="history-info">
                        <strong>{activityNames[l.activity]}</strong>
                        <span className="small muted">
                          {formatDate(l.date)} · {l.durationMinutes} min ·{" "}
                          {l.planSessionId ? "Planned" : "Unplanned"} ·{" "}
                          {l.outdoors === null
                            ? "Location unknown"
                            : l.outdoors
                              ? "Outside"
                              : "Inside"}{" "}
                          ·{" "}
                          {l.perceivedEffort === null
                            ? "Effort unknown"
                            : "Effort " + l.perceivedEffort + "/10"}
                        </span>
                        {l.note && <span className="small">{l.note}</span>}
                      </div>
                      <Badge tone={l.status === "completed" ? "green" : "sand"}>
                        {l.status}
                      </Badge>
                      <button
                        className="text-button"
                        onClick={() => openLog(null, l)}
                      >
                        Edit
                      </button>
                    </div>
                  ))
                ) : (
                  <div className="empty-inline">
                    <Footprints size={24} />
                    Your first logged activity will appear here.
                  </div>
                )}
              </section>
            </>
          )}
          {page === "Settings" && (
            <div className="settings-grid">
              {browserMode && <BrowserConnection onSaved={load} />}
              <Measurements key={profile.id} profile={profile} onSaved={load} />
              <section className="card">
                <div className="card-title">
                  <span className="mini-icon">
                    <Leaf size={20} />
                  </span>
                  <h2>Your routine</h2>
                </div>
                <dl className="settings-details">
                  <dt>Goal</dt>
                  <dd>{goalNames[goal!.kind]}</dd>
                  <dt>Timezone</dt>
                  <dd>{profile.timezone}</dd>
                  <dt>Available days</dt>
                  <dd>
                    {profile.availability
                      .map((a) => weekdayNames[a.weekday - 1].slice(0, 3))
                      .join(", ")}
                  </dd>
                  <dt>Weekly baseline</dt>
                  <dd>
                    {profile.baselineWeeklyMinutes === null
                      ? "Unknown"
                      : profile.baselineWeeklyMinutes + " min"}
                  </dd>
                </dl>
                <p className="muted small">
                  Changing timezone keeps existing plan dates fixed. Preview a
                  new week intentionally.
                </p>
                <button
                  className="button secondary"
                  onClick={() => setEditProfile(true)}
                >
                  Edit profile & goal
                  <ArrowUpRight size={16} />
                </button>
              </section>
              <section className="card">
                <div className="card-title">
                  <span className="mini-icon">
                    <Activity size={20} />
                  </span>
                  <h2>AI, close to home</h2>
                </div>
                <Badge tone={models.available ? "green" : "sand"}>
                  {models.available ? "Ollama available" : "Ollama offline"}
                </Badge>
                <p className="muted">
                  {browserMode
                    ? "Your browser calls Ollama directly."
                    : "Inference runs on your configured AI server."}{" "}
                  If a model is unavailable, your saved plan remains accessible
                  and new plans use the validated fallback.
                </p>
                <label>
                  Locally installed model
                  <select
                    disabled={!models.models.length || busy}
                    value={models.selectedModel ?? ""}
                    onChange={(e) =>
                      void act(async () => {
                        await api("/ai/model", "PUT", { tag: e.target.value });
                        await load();
                        setNotice("Local model selected.");
                      })
                    }
                  >
                    <option value="" disabled>
                      Select a model
                    </option>
                    {models.models.map((m) => (
                      <option key={m.tag}>{m.tag}</option>
                    ))}
                  </select>
                </label>
                <button className="text-button" onClick={() => void load()}>
                  <RefreshCw size={16} />
                  Refresh AI status
                </button>
              </section>
              <section className="card">
                <div className="card-title">
                  <span className="mini-icon">
                    <ShieldCheck size={20} />
                  </span>
                  <h2>Your data belongs to you</h2>
                </div>
                <p className="muted">
                  {browserMode
                    ? "Stored in this browser. Other apps on the same website origin can access browser storage; it is not encrypted by OutFit."
                    : "Stored in a local database on this computer."}{" "}
                  No analytics or third-party health sync. Chat and plan context
                  go to your configured AI server. The database is not
                  automatically encrypted.
                </p>
                <div className="form-actions">
                  <button
                    className="button secondary"
                    onClick={() =>
                      void act(async () => {
                        const data = await api("/data/export");
                        const url = URL.createObjectURL(
                          new Blob([JSON.stringify(data, null, 2)], {
                            type: "application/json",
                          }),
                        );
                        const a = document.createElement("a");
                        a.href = url;
                        a.download = "outfit-export.json";
                        a.click();
                        setTimeout(() => URL.revokeObjectURL(url), 1000);
                        setNotice("Your data was exported.");
                      })
                    }
                  >
                    <Download size={16} />
                    Export JSON
                  </button>
                  <button
                    className="text-button danger-text"
                    onClick={() => setModal("delete")}
                  >
                    Delete local data
                  </button>
                </div>
              </section>
              <section className="card">
                <h2>A little further down the trail</h2>
                <p className="muted">
                  Live health-app connections are not implemented yet. You can
                  import normalized activity files in Health data.
                </p>
                {["Health Connect", "Apple HealthKit", "Strava", "Garmin"].map(
                  (name) => (
                    <div className="integration-row" key={name}>
                      <span>{name}</span>
                      <Badge tone="sand">Unavailable</Badge>
                    </div>
                  ),
                )}
              </section>
            </div>
          )}
          <footer className="app-footer">
            <span>OutFit · Make room for outside.</span>
            <span>General fitness guidance for adults.</span>
          </footer>
        </main>
      </div>
      {draft && (
        <Modal title="Your week, for review" onClose={() => setDraft(null)}>
          <p className="muted">
            Nothing changes until you accept this preview.
          </p>
          {draft.inputRevision !== state.inputRevision && (
            <p className="error" role="alert">
              Your data changed. Discard this preview and prepare a fresh one.
            </p>
          )}
          <PlanView
            plan={draft}
            blocked={blocked}
            logs={logs}
            currentDate={currentDate}
          />
          <div className="form-actions sticky-actions">
            <button
              className="button secondary"
              disabled={busy}
              onClick={() =>
                void act(async () => {
                  await api("/plans/" + draft.id + "/discard", "POST", {});
                  setDraft(null);
                  await load();
                  setNotice(
                    "Preview discarded. Your current plan is unchanged.",
                  );
                })
              }
            >
              Discard preview
            </button>
            <button
              className="button"
              disabled={
                busy || blocked || draft.inputRevision !== state.inputRevision
              }
              onClick={() =>
                void act(async () => {
                  await api("/plans/" + draft.id + "/accept", "POST", {
                    expectedInputRevision: state.inputRevision,
                    expectedCurrentPlanId: state.currentPlanId,
                  });
                  setDraft(null);
                  await load();
                  setNotice("Your plan is accepted. One small step at a time.");
                })
              }
            >
              <Check size={17} />
              Accept this plan
            </button>
          </div>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </Modal>
      )}
      {modal === "log" && (
        <LogModal
          session={logSession}
          log={editingLog}
          date={currentDate}
          onClose={() => setModal(null)}
          onSaved={async () => {
            setModal(null);
            await load();
            setNotice(
              "Activity saved. Review a plan adjustment when you’re ready.",
            );
          }}
        />
      )}
      {modal === "check" && (
        <CheckModal
          date={currentDate}
          check={todayCheck ?? null}
          onClose={() => setModal(null)}
          onSaved={async () => {
            setModal(null);
            await load();
            setNotice("Check-in saved. Your plan can make room for recovery.");
          }}
        />
      )}
      {modal === "delete" && (
        <Modal title="Delete your local data?" onClose={() => setModal(null)}>
          <p>
            This clears your profile, goals, plans, activity logs, and recovery
            check-ins. Downloaded exports remain on your computer.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void act(async () => {
                await api("/data", "DELETE", {
                  confirmation: "DELETE_MY_DATA",
                });
                setModal(null);
                setDraft(null);
                setJob(null);
                setDisplayDate("");
                setStartDate("");
                await load();
              });
            }}
          >
            <label>
              Type DELETE_MY_DATA to confirm
              <input
                name="confirmation"
                pattern="DELETE_MY_DATA"
                required
                autoComplete="off"
              />
            </label>
            <div className="form-actions">
              <button
                type="button"
                className="button secondary"
                onClick={() => setModal(null)}
              >
                Keep my data
              </button>
              <button className="button danger" disabled={busy}>
                Delete local data
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
