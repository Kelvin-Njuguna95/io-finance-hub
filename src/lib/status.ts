export type StatusTone = 'default' | 'success' | 'warning' | 'danger' | 'info' | 'muted';

const STATUS_CLASS_MAP: Record<StatusTone, string> = {
  default: 'bg-muted text-foreground/90',
  success: 'bg-success-soft text-success-soft-foreground',
  warning: 'bg-warning-soft text-warning-soft-foreground',
  danger: 'bg-danger-soft text-danger-soft-foreground',
  info: 'bg-info-soft text-info-soft-foreground',
  muted: 'bg-muted text-foreground/90',
};

const STATUS_TONE_BY_VALUE: Record<string, StatusTone> = {
  approved: 'success',
  paid: 'success',
  success: 'success',
  settled: 'success',
  active: 'success',

  pending: 'warning',
  pending_auth: 'warning',
  under_review: 'warning',
  watch: 'warning',
  draft: 'warning',
  partially_paid: 'warning',
  returned: 'warning',
  returned_to_tl: 'warning',

  rejected: 'danger',
  declined: 'danger',
  failed: 'danger',
  overdue: 'danger',
  voided: 'danger',
  critical: 'danger',

  submitted: 'info',
  accounted: 'info',
  reported: 'info',
  low: 'info',
  medium: 'warning',

  archived: 'muted',
  closed: 'muted',
};

export function getStatusBadgeClass(status: string, fallback: StatusTone = 'default'): string {
  const normalized = status?.trim().toLowerCase();
  const tone = normalized ? STATUS_TONE_BY_VALUE[normalized] ?? fallback : fallback;
  return STATUS_CLASS_MAP[tone];
}
