// ============================================================
// Formatting utilities for IO Finance Hub
// ============================================================

import { formatKES, formatUSD } from '@/lib/utils/currency';

const KENYA_LOCALE = 'en-KE';
const NAIROBI_TIMEZONE = 'Africa/Nairobi';

export function formatCurrency(amount: number, currency: 'USD' | 'KES' = 'KES'): string {
  return currency === 'USD' ? formatUSD(amount) : formatKES(amount);
}

/**
 * Compact currency for executive KPI surfaces and rail subtitles. Matches the
 * convention used in _design-system/dashboard.html ("KES 12.40M", "USD 286,419").
 *
 * Rules:
 *   - KES >= 1_000_000 → "KES N.NNM" (always 2 decimals, trailing zeros kept)
 *   - KES 1_000 .. 999_999 → "KES N,NNN" (thousand separators, 0 decimals)
 *   - KES < 1_000 → "KES N" (integer)
 *   - USD any value → "USD N,NNN" (thousand separators, 0 decimals — never abbreviated)
 *   - Negatives → leading minus sign before the prefix ("-KES 1.20M")
 *   - Zero → "KES 0" / "USD 0"
 *
 * Does NOT replace formatCurrency; use that for full-precision call sites.
 */
export function formatCompactCurrency(
  amount: number,
  currency: 'USD' | 'KES' = 'KES',
): string {
  const prefix = currency === 'USD' ? 'USD' : 'KES';
  const sign = amount < 0 ? '-' : '';
  const abs = Math.abs(amount);

  let body: string;
  if (currency === 'KES' && abs >= 1_000_000) {
    body = (abs / 1_000_000).toFixed(2) + 'M';
  } else {
    const locale = currency === 'USD' ? 'en-US' : 'en-KE';
    body = new Intl.NumberFormat(locale, {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(abs);
  }

  return `${sign}${prefix} ${body}`;
}

export function formatCompactKES(amount: number): string {
  return formatCompactCurrency(amount, 'KES');
}

export function formatCompactUSD(amount: number): string {
  return formatCompactCurrency(amount, 'USD');
}

export function formatPercent(value: number, decimals = 1): string {
  return `${value.toFixed(decimals)}%`;
}

export function formatYearMonth(ym: string): string {
  const [year, month] = ym.split('-');
  const parsedYear = Number.parseInt(year ?? '', 10);
  const parsedMonth = Number.parseInt(month ?? '', 10);
  if (!Number.isFinite(parsedYear) || !Number.isFinite(parsedMonth) || parsedMonth < 1 || parsedMonth > 12) {
    return '—';
  }

  const date = new Date(parsedYear, parsedMonth - 1, 1);
  return Number.isNaN(date.getTime()) ? '—' : formatMonth(date);
}

export function getCurrentYearMonth(): string {
  // Use Africa/Nairobi timezone — server-local (UTC on Vercel) shifts the
  // month by up to 3 hours near month boundaries. en-CA locale returns
  // ISO-shaped YYYY-MM-DD, from which we take the first 7 chars.
  const isoDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: NAIROBI_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  return isoDate.slice(0, 7);
}

export function getPrevYearMonth(): string {
  const [y, m] = getCurrentYearMonth().split('-').map(Number);
  if (m === 1) return `${y - 1}-12`;
  return `${y}-${String(m - 1).padStart(2, '0')}`;
}

export function formatDate(date: Date | string): string {
  return new Intl.DateTimeFormat(KENYA_LOCALE, {
    timeZone: NAIROBI_TIMEZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(date));
}

export function formatMonth(date: Date | string): string {
  return new Intl.DateTimeFormat(KENYA_LOCALE, {
    timeZone: NAIROBI_TIMEZONE,
    month: 'long',
    year: 'numeric',
  }).format(new Date(date));
}

export function formatMonthShort(date: Date | string): string {
  return new Intl.DateTimeFormat(KENYA_LOCALE, {
    timeZone: NAIROBI_TIMEZONE,
    month: 'short',
    year: '2-digit',
  }).format(new Date(date));
}

export function formatDateTime(date: string): string {
  return new Intl.DateTimeFormat(KENYA_LOCALE, {
    timeZone: NAIROBI_TIMEZONE,
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(date));
}

export function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1).replace(/_/g, ' ');
}
