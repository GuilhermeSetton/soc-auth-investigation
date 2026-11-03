-- Initial schema (contract v1). Applied in one transaction by `python -m app.migrate up`.
-- Event identity is the SHA-256 of the original line; alert identity is a stable UUID.

CREATE TABLE imports (
    id uuid PRIMARY KEY,
    filename text NOT NULL CHECK (char_length(filename) BETWEEN 1 AND 255),
    received_at timestamptz NOT NULL DEFAULT now(),
    total_lines integer NOT NULL CHECK (total_lines >= 0),
    imported_events integer NOT NULL DEFAULT 0 CHECK (imported_events >= 0),
    duplicate_events integer NOT NULL DEFAULT 0 CHECK (duplicate_events >= 0),
    invalid_lines jsonb NOT NULL DEFAULT '[]'::jsonb
);

CREATE TABLE events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    line_sha256 char(64) NOT NULL UNIQUE CHECK (line_sha256 ~ '^[0-9a-f]{64}$'),
    occurred_at timestamptz NOT NULL,
    host text NOT NULL CHECK (char_length(host) BETWEEN 1 AND 255),
    source text NOT NULL CHECK (char_length(source) BETWEEN 2 AND 45),
    username text NOT NULL CHECK (char_length(username) BETWEEN 1 AND 255),
    outcome text NOT NULL CHECK (outcome IN ('failure', 'success')),
    method text NOT NULL CHECK (method IN ('password', 'publickey')),
    import_id uuid NOT NULL REFERENCES imports (id),
    line_number integer NOT NULL CHECK (line_number >= 1),
    raw_line text NOT NULL CHECK (char_length(raw_line) <= 8192)
);
CREATE INDEX events_time_idx ON events (occurred_at, id);
CREATE INDEX events_source_time_idx ON events (source, occurred_at);
CREATE INDEX events_user_time_idx ON events (source, username, occurred_at);

CREATE TABLE alerts (
    id uuid PRIMARY KEY,
    rule_id text NOT NULL CHECK (rule_id IN ('repeated_failures', 'multiple_users', 'success_after_failures')),
    rule_version integer NOT NULL CHECK (rule_version = 1),
    source text NOT NULL CHECK (char_length(source) BETWEEN 2 AND 45),
    username text CHECK (username IS NULL OR char_length(username) BETWEEN 1 AND 255),
    occurred_at timestamptz NOT NULL,
    anchor_sha char(64) NOT NULL CHECK (anchor_sha ~ '^[0-9a-f]{64}$'),
    title text NOT NULL,
    reason text NOT NULL,
    false_positives jsonb NOT NULL,
    event_count integer NOT NULL CHECK (event_count >= 1)
);
CREATE INDEX alerts_time_idx ON alerts (occurred_at, id);
CREATE INDEX alerts_source_idx ON alerts (source);

-- Investigation rows are created on first save; a missing row means the defaults.
CREATE TABLE investigations (
    alert_id uuid PRIMARY KEY REFERENCES alerts (id) ON DELETE CASCADE,
    status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'closed')),
    classification text NOT NULL DEFAULT 'unclassified'
        CHECK (classification IN ('unclassified', 'benign', 'suspicious', 'confirmed_incident')),
    notes text NOT NULL DEFAULT '' CHECK (char_length(notes) <= 10000),
    updated_at timestamptz NOT NULL DEFAULT now()
);
