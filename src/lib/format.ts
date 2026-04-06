// ============================================================
// Formatting utilities for IO Finance Hub
// ============================================================

export function formatCurrency(amount: number, currency: 'USD' | 'KES' = 'KES'): string {
  const decimals = currency === 'USD' ? 4 : 2;
  const symbol = currency === 'USD' ? '$' : 'KES ';
  return `${symbol}${amount.toLocaleString('en-US', {
    minimumFractionDigits: decimals > 2 ? 2 : decimals,
    maximumFractionDigits: decimals,
  })}`;
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
  return new Date(date).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
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
