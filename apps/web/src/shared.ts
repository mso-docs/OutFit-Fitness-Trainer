export const goalNames = {
  build_consistency: "Build consistency",
  walk_more: "Walk more",
  start_run_walk: "Start run / walk",
};
export const activityNames = {
  walk: "Easy walk",
  run_walk: "Gentle run / walk",
  mobility: "Gentle mobility",
  rest: "A little room to rest",
};
export const weekdayNames = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];
export const flagNames: Record<string, string> = {
  chest_pain: "Chest pain",
  fainting: "Fainting or dizziness",
  unusual_breathlessness: "Unusual breathlessness",
  acute_illness: "Acute illness",
  exercise_limiting_pain: "Pain that limits exercise",
  needs_clinician_guidance: "I need clinician guidance before exercising",
};
export const formatDate = (
  d: string,
  options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" },
) =>
  new Date(d + "T12:00:00Z").toLocaleDateString("en-US", {
    ...options,
    timeZone: "UTC",
  });
export const numberOrNull = (v: FormDataEntryValue | null) =>
  v === null || v === "" ? null : Number(v);
