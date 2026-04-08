-- ============================================================
-- IO Finance Hub — Appendix P: Notifications & Preferences
-- ============================================================

-- -----------------------------------------------
-- 1. Ensure notifications table exists with all required columns
-- -----------------------------------------------

CREATE TABLE IF NOT EXISTS notifications (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id),
  title       TEXT NOT NULL,
  body        TEXT,
  type        TEXT NOT NULL,
  entity_type TEXT,
  entity_id   UUID,
  project_id  UUID REFERENCES projects(id),
  link        TEXT,
  is_read     BOOLEAN DEFAULT FALSE,
  read_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- Add columns that may be missing if the table already existed
DO $$ BEGIN
  ALTER TABLE notifications ADD COLUMN IF NOT EXISTS body TEXT;
  ALTER TABLE notifications ADD COLUMN IF NOT EXISTS type TEXT;
  ALTER TABLE notifications ADD COLUMN IF NOT EXISTS entity_type TEXT;
  ALTER TABLE notifications ADD COLUMN IF NOT EXISTS entity_id UUID;
  ALTER TABLE notifications ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects(id);
  ALTER TABLE notifications ADD COLUMN IF NOT EXISTS link TEXT;
  ALTER TABLE notifications ADD COLUMN IF NOT EXISTS is_read BOOLEAN DEFAULT FALSE;
  ALTER TABLE notifications ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- If 'message' column exists but 'body' doesn't map them
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'notifications' AND column_name = 'message'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'notifications' AND column_name = 'body'
  ) THEN
    ALTER TABLE notifications RENAME COLUMN message TO body;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
  ON notifications (user_id, is_read, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notifications_user_created
  ON notifications (user_id, created_at DESC);

-- -----------------------------------------------
-- 2. Notification preferences table
-- -----------------------------------------------

CREATE TABLE IF NOT EXISTS notification_preferences (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role       TEXT NOT NULL,
  notif_type TEXT NOT NULL,
  enabled    BOOLEAN DEFAULT TRUE,
  updated_by UUID REFERENCES users(id),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (role, notif_type)
);

-- -----------------------------------------------
-- 3. RLS policies
-- -----------------------------------------------

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;

-- Users can read/update their own notifications
DO $$ BEGIN
  CREATE POLICY "users_own_notifications_select"
    ON notifications FOR SELECT TO authenticated
    USING (user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "users_own_notifications_update"
    ON notifications FOR UPDATE TO authenticated
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Service role can insert for any user
DO $$ BEGIN
  CREATE POLICY "service_insert_notifications"
    ON notifications FOR INSERT
    USING (true)
    WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CFO manages notification preferences
DO $$ BEGIN
  CREATE POLICY "cfo_manage_notification_prefs"
    ON notification_preferences FOR ALL TO authenticated
    USING (
      EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'cfo')
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- All authenticated users can read notification preferences
DO $$ BEGIN
  CREATE POLICY "authenticated_read_notification_prefs"
    ON notification_preferences FOR SELECT TO authenticated
    USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- -----------------------------------------------
-- 4. Update audit_logs RLS — allow Accountant read (filtered)
-- -----------------------------------------------

-- Drop old CFO-only select policy and replace with role-aware one
DROP POLICY IF EXISTS al_select ON audit_logs;

CREATE POLICY "audit_logs_role_select" ON audit_logs FOR SELECT TO authenticated
USING (
  CASE
    WHEN (SELECT role FROM users WHERE id = auth.uid()) = 'cfo' THEN true
    WHEN (SELECT role FROM users WHERE id = auth.uid()) = 'accountant' THEN
      action NOT IN ('cfo_override', 'month_closed', 'month_reopened', 'profit_share_approved')
    ELSE false
  END
);

-- -----------------------------------------------
-- 5. Seed default notification preferences
-- -----------------------------------------------

INSERT INTO notification_preferences (role, notif_type, enabled) VALUES
  ('cfo', 'budget_submitted', true),
  ('cfo', 'budget_approved', true),
  ('cfo', 'budget_rejected', true),
  ('cfo', 'budget_returned', true),
  ('cfo', 'pm_review_complete', true),
  ('cfo', 'misc_report_submitted', true),
  ('cfo', 'misc_draw_created', true),
  ('cfo', 'misc_approved', true),
  ('cfo', 'misc_declined', true),
  ('cfo', 'misc_report_overdue', true),
  ('cfo', 'eod_sent', false),
  ('cfo', 'eod_failed', true),
  ('cfo', 'red_flag_triggered', true),
  ('cfo', 'payment_received', true),
  ('cfo', 'month_closed', true),
  ('accountant', 'budget_submitted', true),
  ('accountant', 'budget_approved', true),
  ('accountant', 'budget_rejected', true),
  ('accountant', 'misc_report_submitted', true),
  ('accountant', 'misc_draw_created', true),
  ('accountant', 'misc_approved', true),
  ('accountant', 'misc_declined', true),
  ('accountant', 'misc_report_overdue', true),
  ('accountant', 'eod_sent', true),
  ('accountant', 'eod_failed', true),
  ('accountant', 'payment_received', true),
  ('accountant', 'month_closed', true),
  ('project_manager', 'budget_approved', true),
  ('project_manager', 'budget_rejected', true),
  ('project_manager', 'budget_returned', true),
  ('project_manager', 'misc_approved', true),
  ('project_manager', 'misc_declined', true),
  ('project_manager', 'misc_report_overdue', true),
  ('team_leader', 'budget_approved', true),
  ('team_leader', 'budget_rejected', true),
  ('team_leader', 'budget_returned', true)
ON CONFLICT (role, notif_type) DO NOTHING;
