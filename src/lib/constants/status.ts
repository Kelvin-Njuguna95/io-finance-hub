export const BUDGET_STATUS = {
  DRAFT: 'draft',
  SUBMITTED: 'submitted',
  UNDER_REVIEW: 'under_review',
  PM_REVIEW: 'pm_review',
  PM_APPROVED: 'pm_approved',
  PM_REJECTED: 'pm_rejected',
  RETURNED_TO_TL: 'returned_to_tl',
  APPROVED: 'approved',
  REJECTED: 'rejected',
} as const;

export const EXPENSE_STATUS = {
  PENDING_AUTH: 'pending_auth',
  CONFIRMED: 'confirmed',
  UNDER_REVIEW: 'under_review',
  MODIFIED: 'modified',
  VOIDED: 'voided',
  CARRIED_FORWARD: 'carried_forward',
} as const;

export const INVOICE_STATUS = {
  DRAFT: 'draft',
  SENT: 'sent',
  PARTIALLY_PAID: 'partially_paid',
  PAID: 'paid',
  OVERDUE: 'overdue',
  CANCELLED: 'cancelled',
} as const;

export const OUTSTANDING_INVOICE_STATUSES = [
  INVOICE_STATUS.SENT,
  INVOICE_STATUS.PARTIALLY_PAID,
  INVOICE_STATUS.OVERDUE,
] as const;

export const MISC_DRAW_STATUS = {
  PENDING_PM_APPROVAL: 'pending_pm_approval',
  APPROVED: 'approved',
  ACCOUNTED: 'accounted',
  DECLINED: 'declined',
  FLAGGED: 'flagged',
  DELETED: 'deleted',
} as const;

export const RED_FLAG_STATUS = {
  RESOLVED: true,
  UNRESOLVED: false,
} as const;
