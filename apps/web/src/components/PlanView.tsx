import { Moon, Footprints, Plus } from "lucide-react";
import type {
  Plan,
  Session,
  WorkoutLog,
} from "../../../../packages/domain/src/schemas";
import { instructions } from "../../../../packages/domain/src/catalog";
import { formatDate, activityNames } from "../shared";
import { Badge } from "./ui";
export function PlanView({
  plan,
  blocked,
  logs,
  currentDate,
  onLog,
}: {
  plan: Plan;
  blocked: boolean;
  logs: WorkoutLog[];
  currentDate: string;
  onLog?: (s: Session) => void;
}) {
  return (
    <div className="plan-view">
      <div className="plan-meta">
        <strong>
          {formatDate(plan.startDate)} – {formatDate(plan.endDate)}
        </strong>
        <Badge tone={plan.source === "fallback" ? "sand" : "green"}>
          {plan.source === "fallback" ? "Fallback planner" : "Local AI plan"}
        </Badge>
        <span className="muted small">
          {plan.sessions.reduce((n, s) => n + s.durationMinutes, 0)} training
          min · {plan.sessions.filter((s) => s.kind === "rest").length} rest
          days
        </span>
      </div>
      <p className="plan-explanation">{plan.explanation}</p>
      {plan.parentPlanId && (
        <div className="revision-reasons">
          <strong>What changed</strong>
          {plan.changeReasons.map((r, i) => (
            <p key={i}>{r}</p>
          ))}
        </div>
      )}
      <div className="plan-list">
        {plan.sessions.map((s) => {
          const l = logs.find((l) => l.planSessionId === s.id);
          return (
            <article
              className={"plan-row " + (s.kind === "rest" ? "rest" : "")}
              key={s.id}
            >
              <div className="plan-date">
                <strong>{formatDate(s.date, { weekday: "short" })}</strong>
                <span>{formatDate(s.date)}</span>
              </div>
              <span className="mini-icon">
                {s.kind === "rest" ? (
                  <Moon size={21} />
                ) : (
                  <Footprints size={21} />
                )}
              </span>
              <div className="plan-row-content">
                <h3>
                  {blocked ? "Recommendation paused" : activityNames[s.kind]}
                </h3>
                {!blocked && (
                  <>
                    <p className="small muted">
                      {s.kind === "rest"
                        ? "0 min · rest"
                        : s.durationMinutes +
                          " min · easy · " +
                          (s.location === "outdoor"
                            ? "outside or indoor alternative"
                            : s.location)}
                    </p>
                    <ul>
                      {s.instructionIds.map((id) => (
                        <li key={id}>{instructions[id]}</li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
              {l ? (
                <Badge tone={l.status === "completed" ? "green" : "sand"}>
                  {l.status}
                </Badge>
              ) : s.kind !== "rest" && onLog && s.date <= currentDate ? (
                <button className="text-button" onClick={() => onLog(s)}>
                  Log
                  <Plus size={15} />
                </button>
              ) : null}
            </article>
          );
        })}
      </div>
    </div>
  );
}
