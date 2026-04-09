// ============================================================
// Shared utilities for the Financial Reports & Analytics module
// ============================================================

export function formatKesShort(amount: number): string {
  const abs = Math.abs(amount);
  const sign = amount < 0 ? '-' : '';
  if (abs >= 1_000_000) return `${sign}KES ${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}KES ${(abs / 1_000).toFixed(0)}k`;
  return `${sign}KES ${abs.toFixed(0)}`;
}

export function getLaggedMonth(ym: string): string {
  const prevDate = new Date(parseInt(ym.split('-')[0]), parseInt(ym.split('-')[1]) - 2, 1);
  return prevDate.getFullYear() + '-' + String(prevDate.getMonth() + 1).padStart(2, '0');
}

export function getNextMonth(ym: string): string {
  const nextDate = new Date(parseInt(ym.split('-')[0]), parseInt(ym.split('-')[1]), 1);
  return nextDate.getFullYear() + '-' + String(nextDate.getMonth() + 1).padStart(2, '0');
}

export function getUnifiedServicePeriodLabel(paymentMonth: string): string {
  const serviceMonth = getLaggedMonth(paymentMonth);
  const [serviceYear, serviceMon] = serviceMonth.split('-');
  const [paymentYear, paymentMon] = paymentMonth.split('-');
  const serviceText = new Date(parseInt(serviceYear), parseInt(serviceMon) - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const paymentText = new Date(parseInt(paymentYear), parseInt(paymentMon) - 1, 1).toLocaleDateString('en-US', { month: 'long' });
  return `${serviceText} (paid in ${paymentText})`;
}

/**
 * Determine the revenue source month for a given expense month.
 * Historical (seeded) months use direct matching; live months use lagged (prev month).
 * Returns { revenueMonth, isHistorical }.
 */
export async function getRevenueMonth(
  supabase: { from: (table: string) => any },
  ym: string,
): Promise<{ revenueMonth: string; isHistorical: boolean }> {
  const { data: snapshot } = await supabase
    .from('monthly_financial_snapshots')
    .select('data_source')
    .eq('year_month', ym)
    .single();

  const isHistorical = !!(snapshot?.data_source && snapshot.data_source.startsWith('historical_seed'));
  return {
    revenueMonth: isHistorical ? ym : getLaggedMonth(ym),
    isHistorical,
  };
}

export function getMonthRange(months: number, endYm?: string): string[] {
  const result: string[] = [];
  const now = endYm
    ? new Date(parseInt(endYm.split('-')[0]), parseInt(endYm.split('-')[1]) - 1, 1)
    : new Date();
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    result.push(d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'));
  }
  return result;
}

export function shortMonth(ym: string): string {
  const [year, month] = ym.split('-');
  const d = new Date(parseInt(year), parseInt(month) - 1, 1);
  return d.toLocaleDateString('en-US', { month: 'short' }) + ' ' + year.slice(2);
}

// Chart color constants matching IO design system
export const CHART_COLORS = {
  navy: '#0f172a',
  gold: '#F5C518',
  red: '#ef4444',
  amber: '#f59e0b',
  teal: '#0ea5e9',
  emerald: '#22c55e',
  grey: '#6b7280',
  lightGreen: 'rgba(34,197,94,0.1)',
  lightRed: 'rgba(239,68,68,0.1)',
  zeroLine: '#e5e7eb',
};

export const PROJECT_COLORS: Record<string, string> = {
  Windward: '#0f172a',
  AIFI: '#0ea5e9',
  Signafide: '#F5C518',
  SEEO: '#8b5cf6',
  Kemtai: '#ec4899',
  Clickworker: '#14b8a6',
};

export function getProjectColor(name: string): string {
  return PROJECT_COLORS[name] || CHART_COLORS.grey;
}
