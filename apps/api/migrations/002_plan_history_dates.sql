-- Freeze the local date of supersession so a timezone edit cannot change history.
CREATE TABLE plan_supersessions (
  plan_id TEXT PRIMARY KEY REFERENCES plans(id) ON DELETE CASCADE,
  cutoff_date TEXT NOT NULL
);
