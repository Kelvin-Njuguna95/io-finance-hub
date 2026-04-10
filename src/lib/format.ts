// ============================================================
// Formatting utilities for IO Finance Hub
// ============================================================

import { formatKES, formatUSD } from '@/lib/utils/currency';

const KENYA_LOCALE = 'en-KE';
const NAIROBI_TIMEZONE = 'Africa/Nairobi';

export function formatCurrency(amount: number, currency: 'USD' | 'KES' = 'KES'): string {
  return currency === 'USD' ? formatUSD(amount) : formatKES(amount);
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
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
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
