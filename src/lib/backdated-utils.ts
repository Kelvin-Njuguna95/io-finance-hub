// ============================================================
// Backdated Invoice Utilities
// ============================================================

export const BACKDATED_MARKER = '[BACKDATED]';

export interface BackdatedMeta {
  reason: string;
  entry_date: string;
  entered_by: string;
}

export function isBackdated(notes: string | null): boolean {
  return (notes || '').includes(BACKDATED_MARKER);
}

export function encodeBackdatedNotes(meta: BackdatedMeta, userNotes?: string): string {
  const tag = `${BACKDATED_MARKER}${JSON.stringify(meta)}`;
  return userNotes ? `${tag} ${userNotes}` : tag;
}

export function parseBackdatedMeta(notes: string | null): BackdatedMeta | null {
  if (!notes || !notes.includes(BACKDATED_MARKER)) return null;
  try {
    const jsonPart = notes.substring(notes.indexOf('{'), notes.indexOf('}') + 1);
    return JSON.parse(jsonPart);
  } catch {
    return null;
  }
}

export function cleanNotes(notes: string | null): string {
  if (!notes) return '';
  return notes.replace(/\[BACKDATED\]\{[^}]*\}\s*/g, '').trim();
}

export function getAgingBucket(invoiceDate: string): { bucket: string; days: number; color: string } {
  const days = Math.floor((Date.now() - new Date(invoiceDate).getTime()) / (1000 * 60 * 60 * 24));
  if (days <= 30) return { bucket: '0-30 days', days, color: 'emerald' };
  if (days <= 60) return { bucket: '31-60 days', days, color: 'blue' };
  if (days <= 90) return { bucket: '61-90 days', days, color: 'amber' };
  return { bucket: '90+ days', days, color: 'red' };
}

export function computePaymentStatus(amountUsd: number, totalPaid: number): 'unpaid' | 'partial' | 'paid' {
  if (totalPaid <= 0) return 'unpaid';
  if (totalPaid >= amountUsd) return 'paid';
  return 'partial';
}
