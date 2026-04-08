export const STATUS_BADGE_CLASSES: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-700',
  submitted: 'bg-blue-100 text-blue-700',
  approved: 'bg-emerald-100 text-emerald-700',
  rejected: 'bg-red-100 text-red-700',
  pm_review: 'bg-purple-100 text-purple-700',
  pending_auth: 'bg-amber-100 text-amber-700',
  confirmed: 'bg-emerald-100 text-emerald-700',
  carry_forward: 'bg-blue-100 text-blue-700',
  carried_forward: 'bg-blue-100 text-blue-700',
  under_review: 'bg-purple-100 text-purple-700',
  voided: 'bg-red-100 text-red-700',
  modified: 'bg-purple-100 text-purple-700',
};

export const STATUS_LABELS: Record<string, string> = {
  pending_auth: 'Pending Auth',
  under_review: 'Under Review',
  carried_forward: 'Carry Forward',
  carry_forward: 'Carry Forward',
};

export function getStatusBadgeClass(status: string): string {
  return STATUS_BADGE_CLASSES[status] || 'bg-slate-100 text-slate-700';
}

export function getStatusLabel(status: string): string {
  return STATUS_LABELS[status] || status.replace(/_/g, ' ');
}
