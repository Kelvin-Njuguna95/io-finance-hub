// ============================================================
// Shared utilities for the Financial Reports & Analytics module
// ============================================================

export function formatKesShort(amount: number): string {
  const abs = Math.abs(amount);
  const sign = amount < 0 ? '-' : '';
  if (abs >= 1_000_000) return sign + 'KES ' + (abs / 1_000_000).toFixed(1) + 'M';
  if (abs >= 1_000) return sign + 'KES ' + (abs / 1_000).toFixed(0) + 'k';
  return sign + 'KES ' + abs.toFixed(0);
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
  const serviceText = new Intl.DateTimeFormat('en-KE', { month: 'long', year: 'numeric', timeZone: 'Africa/Nairobi' }).format(new Date(parseInt(serviceYear), parseInt(serviceMon) - 1, 1));
  const paymentText = new Intl.DateTimeFormat('en-KE', { month: 'long', timeZone: 'Africa/Nairobi' }).format(new Date(parseInt(paymentYear), parseInt(paymentMon) - 1, 1));
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
  return new Intl.DateTimeFormat('en-KE', { month: 'short', timeZone: 'Africa/Nairobi' }).format(d) + ' ' + year.slice(2);
}

// Chart color constants matching IO design system (oklch-based tokens)
export const CHART_COLORS = {
  navy: 'oklch(0.20 0.05 260)',
  gold: 'oklch(0.84 0.18 88)',
  red: 'oklch(0.63 0.23 25)',
  amber: 'oklch(0.80 0.16 78)',
  teal: 'oklch(0.70 0.11 195)',
  emerald: 'oklch(0.68 0.16 158)',
  grey: 'oklch(0.52 0.015 260)',
  lightGreen: 'oklch(0.68 0.16 158 / 0.10)',
  lightRed: 'oklch(0.63 0.23 25 / 0.10)',
  zeroLine: 'oklch(0.80 0 0 / 0.15)',
};

export const PROJECT_COLORS: Record<string, string> = {
  Windward: 'oklch(0.20 0.05 260)',
  AIFI: 'oklch(0.78 0.18 210)',
  Signafide: 'oklch(0.84 0.18 88)',
  SEEO: 'oklch(0.64 0.19 290)',
  Kemtai: 'oklch(0.70 0.19 350)',
  Clickworker: 'oklch(0.70 0.11 195)',
};

export function getProjectColor(name: string): string {
  return PROJECT_COLORS[name] || CHART_COLORS.grey;
}
