-- =====================================================================
-- F-10: Reconcile notifications schema — revert the body/type rename
-- and column adds that 00010 attempted but never landed in production
--
-- BACKGROUND
-- Migration 00010_notifications_and_preferences.sql intended to:
--   (a) ADD COLUMN body, type, entity_type, entity_id, project_id, link,
--       is_read, read_at to the notifications table (lines 26-35), and
--   (b) RENAME COLUMN message TO body when 'message' existed and 'body'
--       did not (lines 38-48).
-- Both blocks were wrapped in `DO $$ ... EXCEPTION WHEN OTHERS THEN NULL`,
-- which silently swallows any failure.
--
-- PRODUCTION VERIFICATION (2026-04-27, F-10 Phase 1)
-- An information_schema.columns query against live production confirmed
-- the notifications table has the legacy `message` column and NO `body`
-- and NO `type` columns. 00010's intent did not materialise; production
-- has been running on the pre-00010 column shape throughout. The 26
-- application-code callsites that insert into notifications all use
-- `{user_id, title, message, link}` — they match production reality and
-- have been working correctly. The disagreement was between disk and
-- production, not between code and schema.
--
-- This is the F-10 finding from AUDIT_1_CORRECTNESS.md (High).
--
-- WHAT THIS MIGRATION DOES
-- 1. DROP COLUMN IF EXISTS body and type. No-op on production (already
--    absent). On a fresh build from disk, 00010 would have added these
--    speculatively; this migration reverses that so the disk-built
--    schema converges with production reality.
-- 2. ADD COLUMN IF NOT EXISTS message TEXT. No-op on production (already
--    present). On a fresh build from disk, 00010's CREATE TABLE
--    declared `body` not `message`; this migration restores the
--    production-canonical column name.
-- 3. Self-verification block that asserts the post-state: `message`
--    present, `body` and `type` absent. Raises if any assertion fails.
--
-- IDEMPOTENT — safe to re-apply. Three plausible starting states all
-- converge to the same end-state:
--   - Production-as-verified: {message, no body, no type} → unchanged.
--   - Fresh-from-disk after 00010: {body, type, no message} → drops
--     body+type, adds message. Matches production.
--   - Partial-apply (body added but rename failed): {message, body,
--     type?} → drops body+type, leaves message. Matches production.
--
-- WHAT THIS MIGRATION DOES NOT DO
-- - Does not migrate any data. No callsite ever wrote to body or type
--   in production (those columns don't exist), so there is no data to
--   preserve. On developer dev DBs that successfully ran 00010 with
--   test data in body/type, that data will be lost on apply — accepted
--   per F-10 Phase 1.5 decision.
-- - Does not delete or revise migration 00010 itself. AGENTS.md is
--   explicit that migrations on disk are the audit record; rewriting
--   00010 would erase the historical narrative of what was attempted
--   and why it didn't apply. The corrective forward migration pattern
--   here mirrors 00037 (F-02), 00038 (F-18), and 00039 (F-33).
-- - Does not introduce a `body`/`type` shape adoption. That is planned
--   downstream work — adopting the richer notification model requires
--   schema decisions (type vocabulary, NOT NULL strategy, backfill of
--   existing rows) that are out of scope for F-10. F-10 closes the
--   schema/code mismatch; downstream adoption is a separate ticket.
-- =====================================================================

ALTER TABLE notifications DROP COLUMN IF EXISTS body;
ALTER TABLE notifications DROP COLUMN IF EXISTS type;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS message TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'notifications' AND column_name = 'message'
  ) THEN
    RAISE EXCEPTION 'F-10: notifications.message column missing after corrective migration. Partial-apply.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'notifications' AND column_name = 'body'
  ) THEN
    RAISE EXCEPTION 'F-10: notifications.body column still present after corrective migration. Partial-apply.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'notifications' AND column_name = 'type'
  ) THEN
    RAISE EXCEPTION 'F-10: notifications.type column still present after corrective migration. Partial-apply.';
  END IF;
END $$;
