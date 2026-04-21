/**
 * Dashboard threshold constants — PLACEHOLDER VALUES.
 *
 * See docs/THRESHOLDS_PLACEHOLDER.md for provenance, tuning rationale,
 * and the follow-up process.
 *
 * Every constant is marked `// REVIEW: placeholder` so `git grep`
 * enumerates every tuning decision waiting on product validation.
 *
 * Register: "normal is silent; abnormal tints" per .impeccable.md.
 * Conservative values err on the silent side — an over-firing
 * threshold would panic-tint routine days and erode the signal.
 */

// --- CFO hero — action queues -----------------------------------------

export const CFO_APPROVAL_BACKLOG_WARNING = 3; // REVIEW: placeholder
export const CFO_APPROVAL_BACKLOG_DANGER = 10; // REVIEW: placeholder

export const CFO_PENDING_WITHDRAWALS_WARNING = 2; // REVIEW: placeholder
export const CFO_PENDING_WITHDRAWALS_DANGER = 5; // REVIEW: placeholder

export const CFO_RED_FLAGS_WARNING = 1; // REVIEW: placeholder — any red flag is notable
export const CFO_RED_FLAGS_DANGER = 3; // REVIEW: placeholder

// --- PM hero — project portfolio --------------------------------------

export const PM_AGGREGATE_MARGIN_WARNING_BELOW_PCT = 25; // REVIEW: placeholder
export const PM_AGGREGATE_MARGIN_DANGER_BELOW_PCT = 10; // REVIEW: placeholder

/** A project is "flagged" if margin < this AND/OR budget utilisation > PM_FLAGGED_PROJECT_BUDGET_UTIL_PCT. */
export const PM_FLAGGED_PROJECT_MARGIN_THRESHOLD_PCT = 25; // REVIEW: placeholder
export const PM_FLAGGED_PROJECT_BUDGET_UTIL_PCT = 90; // REVIEW: placeholder

export const PM_AVG_BUDGET_UTIL_WARNING_PCT = 80; // REVIEW: placeholder
export const PM_AVG_BUDGET_UTIL_DANGER_PCT = 95; // REVIEW: placeholder

// --- Accountant — month-end close window ------------------------------

/** Close window begins N calendar days before end-of-month. */
export const CLOSE_WINDOW_DAYS_BEFORE_EOM = 3; // REVIEW: placeholder — calendar days (see THRESHOLDS_PLACEHOLDER.md on business-day precision)

/** Close window ends N calendar days into the following month. */
export const CLOSE_WINDOW_DAYS_AFTER_EOM = 3; // REVIEW: placeholder — calendar days

/**
 * Returns true if `date` is within the month-end close window
 * (last N calendar days of its month, or first N of the next month).
 */
export function isWithinCloseWindow(date: Date = new Date()): boolean {
  const day = date.getDate();
  const year = date.getFullYear();
  const month = date.getMonth();
  const lastDayOfMonth = new Date(year, month + 1, 0).getDate();
  const inEndOfMonth = day >= lastDayOfMonth - (CLOSE_WINDOW_DAYS_BEFORE_EOM - 1);
  const inStartOfMonth = day <= CLOSE_WINDOW_DAYS_AFTER_EOM;
  return inEndOfMonth || inStartOfMonth;
}

/**
 * Calendar-days-until-the-next-close-window-opens.
 * Returns 0 if already inside the window.
 */
export function daysUntilNextClose(date: Date = new Date()): number {
  const year = date.getFullYear();
  const month = date.getMonth();
  const day = date.getDate();
  const lastDayOfMonth = new Date(year, month + 1, 0).getDate();
  const closeWindowStart = lastDayOfMonth - (CLOSE_WINDOW_DAYS_BEFORE_EOM - 1);
  // If we're already past the start of this month's close window, we're IN the window.
  if (day >= closeWindowStart || day <= CLOSE_WINDOW_DAYS_AFTER_EOM) return 0;
  return closeWindowStart - day;
}

// --- TL health bands --------------------------------------------------

/**
 * TL inherits `score_band` from the project_health_scores table:
 * 'healthy' | 'watch' | 'at_risk'. No client-side thresholds; server
 * computes banding. See migration 00016_feature_table_coverage.sql.
 */
