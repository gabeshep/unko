-- Migration 003: Unit Economics — Cost per Ticket
-- Stores per-step AI token usage and per-job CI compute metrics
-- for aggregation into Cost per Ticket reports.

-- Raw AI subagent step telemetry
CREATE TABLE ai_step_telemetry (
  id           SERIAL       PRIMARY KEY,
  recorded_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  ticket_id    TEXT         NOT NULL,
  action_type  TEXT         NOT NULL,
  model_name   TEXT         NOT NULL,
  tokens_used  INTEGER      NOT NULL CHECK (tokens_used >= 0),
  tags         TEXT[]       NOT NULL DEFAULT '{}'
);

CREATE INDEX idx_ai_step_telemetry_ticket_id ON ai_step_telemetry (ticket_id);
CREATE INDEX idx_ai_step_telemetry_recorded_at ON ai_step_telemetry (recorded_at);

-- Raw CI job compute telemetry
CREATE TABLE ci_job_telemetry (
  id               SERIAL       PRIMARY KEY,
  recorded_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  ticket_id        TEXT         NOT NULL,
  workflow_run_id  TEXT         NOT NULL,
  job_name         TEXT         NOT NULL,
  runner_size      TEXT         NOT NULL DEFAULT 'ubuntu-latest',
  compute_minutes  NUMERIC(8,2) NOT NULL CHECK (compute_minutes >= 0),
  outcome          TEXT         NOT NULL,
  tags             TEXT[]       NOT NULL DEFAULT '{}'
);

CREATE INDEX idx_ci_job_telemetry_ticket_id ON ci_job_telemetry (ticket_id);
CREATE INDEX idx_ci_job_telemetry_recorded_at ON ci_job_telemetry (recorded_at);

-- Aggregated cost per ticket (populated by the aggregation worker)
CREATE TABLE ticket_cost_summary (
  id                   SERIAL       PRIMARY KEY,
  aggregated_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  ticket_id            TEXT         NOT NULL,
  period_start         TIMESTAMPTZ  NOT NULL,
  period_end           TIMESTAMPTZ  NOT NULL,
  total_tokens         INTEGER      NOT NULL DEFAULT 0,
  token_cost_usd       NUMERIC(10,6) NOT NULL DEFAULT 0,
  total_compute_min    NUMERIC(8,2) NOT NULL DEFAULT 0,
  compute_cost_usd     NUMERIC(10,6) NOT NULL DEFAULT 0,
  total_cost_usd       NUMERIC(10,6) NOT NULL DEFAULT 0,
  outcome              TEXT         NOT NULL,  -- 'success' | 'failure' | 'unknown'
  excluded_from_baseline BOOLEAN    NOT NULL DEFAULT FALSE,
  UNIQUE (ticket_id, period_start, period_end)
);

CREATE INDEX idx_ticket_cost_summary_ticket_id ON ticket_cost_summary (ticket_id);
CREATE INDEX idx_ticket_cost_summary_aggregated_at ON ticket_cost_summary (aggregated_at);
