import type { Session } from "./schemas";
export const instructions: Record<string, string> = {
  easy: "Keep a comfortable pace. You should be able to talk in full sentences.",
  outside:
    "Choose a familiar, comfortable place. An indoor walk is fine when outside feels unsuitable. Conditions and routes have not been checked.",
  stop: "Stop if you feel pain, dizziness, chest discomfort, or unusual breathlessness.",
  warm: "Begin with easy walking to warm up; finish with easy walking to cool down.",
  run: "Alternate a short gentle jog with easy walking. Stay conversational and return to walking whenever you need.",
  mobility:
    "Move gently within a comfortable range: shoulder rolls, ankle circles, and seated upper-body turns. No bouncing or stretching through pain.",
  rest: "Rest today. There is nothing to catch up on.",
};
export interface Variant {
  id: string;
  kind: Session["kind"];
  duration: number;
  effort: Session["effort"];
  instructions: string[];
  segments: { label: string; minutes: number }[];
}
export const catalog: Variant[] = [
  {
    id: "rest",
    kind: "rest",
    duration: 0,
    effort: "none",
    instructions: ["rest"],
    segments: [],
  },
  ...[5, 10, 15, 20, 25, 30, 35, 40, 45].map((n) => ({
    id: `walk-${n}`,
    kind: "walk" as const,
    duration: n,
    effort: "easy" as const,
    instructions: ["easy", "outside", "stop"],
    segments: [{ label: "Easy walk", minutes: n }],
  })),
  ...[10, 15, 20, 25, 30].map((n) => ({
    id: `run-walk-${n}`,
    kind: "run_walk" as const,
    duration: n,
    effort: "easy" as const,
    instructions: ["easy", "warm", "run", "outside", "stop"],
    segments: [
      { label: "Warm-up walk", minutes: 3 },
      { label: "Repeat: gentle jog 1 min, walk 2 min", minutes: n - 6 },
      { label: "Cool-down walk", minutes: 3 },
    ],
  })),
  {
    id: "mobility-5",
    kind: "mobility",
    duration: 5,
    effort: "easy",
    instructions: ["mobility", "stop"],
    segments: [{ label: "Gentle mobility", minutes: 5 }],
  },
];
export const variant = (id: string) => catalog.find((v) => v.id === id);
export function assemble(
  date: string,
  v: Variant,
  id: string,
  outdoor: boolean,
): Session {
  return {
    id,
    date,
    kind: v.kind,
    catalogVariantId: v.kind === "rest" ? null : v.id,
    durationMinutes: v.duration,
    effort: v.effort,
    location:
      v.kind === "rest"
        ? "either"
        : v.kind === "mobility"
          ? "indoor"
          : outdoor
            ? "outdoor"
            : "either",
    instructionIds: [...v.instructions],
  };
}
export const safetyMessage =
  "Pause exercise recommendations and complete your safety screen again after obtaining appropriate guidance. Logging and history remain available.";
export const urgentMessage =
  "Stop exercise. For current or severe chest pain, fainting, or unusual severe breathlessness, seek urgent medical help, including local emergency services when appropriate.";
