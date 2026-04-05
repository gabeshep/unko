-- Migration 002: Break-Glass Audit Log
-- Creates an append-only audit table for break-glass CI deployment bypass invocations.
-- Rows are immutable: UPDATE and DELETE are blocked by trigger tg_break_glass_audit_immutable.

CREATE TABLE break_glass_audit_log (
  id                  SERIAL PRIMARY KEY,
  invoked_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  payload_hash        TEXT        NOT NULL,  -- SHA-256 hex of raw deployment payload
  sre_key_id          TEXT        NOT NULL,
  sre_identity        TEXT        NOT NULL,
  release_eng_key_id  TEXT        NOT NULL,
  release_eng_identity TEXT       NOT NULL,
  shadow_mode         BOOLEAN     NOT NULL DEFAULT TRUE
);

-- Immutability enforcement: raise exception on any UPDATE or DELETE
CREATE OR REPLACE FUNCTION fn_break_glass_audit_immutable()
  RETURNS trigger
  LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'break_glass_audit_log is append-only';
END;
$$;

CREATE TRIGGER tg_break_glass_audit_immutable
  BEFORE UPDATE OR DELETE ON break_glass_audit_log
  FOR EACH ROW
  EXECUTE FUNCTION fn_break_glass_audit_immutable();
