export function formatKES(amount: number): string {
  return 'KES ' + new Intl.NumberFormat('en-KE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function formatKESCompact(amount: number): string {
  if (amount >= 1_000_000) {
    return `KES ${(amount / 1_000_000).toFixed(1)}M`;
  }
  if (amount >= 1_000) {
    return `KES ${(amount / 1_000).toFixed(0)}k`;
  }
  return formatKES(amount);
}

export function formatKESWithSign(amount: number): string {
  if (amount < 0) {
    return `(${formatKES(Math.abs(amount))})`;
  }
  return formatKES(amount);
}

export function formatUSD(amount: number): string {
  return 'USD ' + new Intl.NumberFormat('en-KE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}
