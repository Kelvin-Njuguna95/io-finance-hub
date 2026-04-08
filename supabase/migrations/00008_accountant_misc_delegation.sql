-- ============================================================
-- Appendix M: Accountant-Raised Misc Requests (PM Delegation)
-- Run this in the Supabase Dashboard SQL Editor
-- ============================================================

-- 1. Add new columns to misc_draws for delegation workflow
ALTER TABLE misc_draws ADD COLUMN IF NOT EXISTS raised_by UUID REFERENCES users(id);
ALTER TABLE misc_draws ADD COLUMN IF NOT EXISTS raised_by_role TEXT;
ALTER TABLE misc_draws ADD COLUMN IF NOT EXISTS pm_approval_status TEXT;
ALTER TABLE misc_draws ADD COLUMN IF NOT EXISTS pm_approved_by UUID REFERENCES users(id);
ALTER TABLE misc_draws ADD COLUMN IF NOT EXISTS pm_actioned_at TIMESTAMPTZ;
ALTER TABLE misc_draws ADD COLUMN IF NOT EXISTS pm_decline_reason TEXT;
ALTER TABLE misc_draws ADD COLUMN IF NOT EXISTS accountant_notes TEXT;
ALTER TABLE misc_draws ADD COLUMN IF NOT EXISTS revision_count INTEGER DEFAULT 0;
ALTER TABLE misc_draws ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES users(id);
ALTER TABLE misc_draws ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE misc_draws ADD COLUMN IF NOT EXISTS deletion_reason TEXT;

-- 2. Drop old status CHECK and add new one with additional statuses
ALTER TABLE misc_draws DROP CONSTRAINT IF EXISTS misc_draws_status_check;
ALTER TABLE misc_draws ADD CONSTRAINT misc_draws_status_check
  CHECK (status IN ('active', 'approved', 'accounted', 'flagged', 'pending_pm_approval', 'declined', 'deleted'));

-- 2b. Ensure requested_by column exists (used in API but not in original DDL)
ALTER TABLE misc_draws ADD COLUMN IF NOT EXISTS requested_by UUID REFERENCES users(id);

-- 2c. Make pm_user_id nullable (accountant-raised draws set it via PM assignment lookup)
ALTER TABLE misc_draws ALTER COLUMN pm_user_id DROP NOT NULL;

-- 3. Backfill raised_by from pm_user_id/requested_by for existing rows
UPDATE misc_draws
SET raised_by = COALESCE(requested_by, pm_user_id), raised_by_role = 'project_manager'
WHERE raised_by IS NULL;

-- 4. Add system setting for PM approval warning threshold
INSERT INTO system_settings (key, value, description)
VALUES ('misc_pm_approval_warning_days', '2', 'Days before a pending PM approval on accountant-raised misc draw triggers a warning red flag')
ON CONFLICT (key) DO NOTHING;

-- 5. Index for quickly finding pending PM approvals
CREATE INDEX IF NOT EXISTS idx_misc_draws_pm_approval
  ON misc_draws (pm_approval_status)
  WHERE pm_approval_status = 'pending';

-- 6. Index for accountant-raised draws
CREATE INDEX IF NOT EXISTS idx_misc_draws_raised_by
  ON misc_draws (raised_by);
