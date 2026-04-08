// ============================================================
// Formatting utilities for IO Finance Hub
// ============================================================

export function formatCurrency(amount: number, currency: 'USD' | 'KES' = 'KES'): string {
  const decimals = currency === 'USD' ? 4 : 2;
  const symbol = currency === 'USD' ? '$' : 'KES ';
  const absoluteAmount = Math.abs(amount);
  const formatted = `${symbol}${absoluteAmount.toLocaleString('en-US', {
    minimumFractionDigits: decimals > 2 ? 2 : decimals,
    maximumFractionDigits: decimals,
  })}`;

  return amount < 0 ? `(${formatted})` : formatted;
}

export function formatPercent(value: number, decimals = 1): string {
  return `${value.toFixed(decimals)}%`;
}

export function formatYearMonth(ym: string): string {
  const [year, month] = ym.split('-');
  const date = new Date(parseInt(year), parseInt(month) - 1);
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long' });
}

export function getCurrentYearMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

export function formatDate(date: string): string {
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return '—';
  const day = String(parsed.getDate()).padStart(2, '0');
  const month = String(parsed.getMonth() + 1).padStart(2, '0');
  const year = parsed.getFullYear();

  return `${day}/${month}/${year}`;
}

export function formatDateTime(date: string): string {
  return new Date(date).toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1).replace(/_/g, ' ');
}
