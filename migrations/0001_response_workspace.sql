CREATE TABLE response_cases (
  id TEXT PRIMARY KEY NOT NULL,
  revision INTEGER NOT NULL CHECK (revision BETWEEN 1 AND 3),
  payload TEXT NOT NULL
    CHECK (json_valid(payload))
    CHECK (length(CAST(payload AS BLOB)) <= 1048576)
    CHECK (json_type(payload, '$.id') IS 'text' AND json_extract(payload, '$.id') IS id)
    CHECK (json_type(payload, '$.revision') IS 'integer' AND json_extract(payload, '$.revision') IS revision)
);

CREATE TABLE response_rate_budget (
  name TEXT PRIMARY KEY NOT NULL CHECK (name IN (
    'login-day', 'login-minute', 'mutation-day', 'mutation-minute'
  )),
  window_start INTEGER NOT NULL CHECK (window_start >= 0),
  used INTEGER NOT NULL CHECK (used BETWEEN 1 AND CASE name
    WHEN 'login-day' THEN 120 WHEN 'login-minute' THEN 20
    WHEN 'mutation-day' THEN 400 WHEN 'mutation-minute' THEN 30 END)
);
