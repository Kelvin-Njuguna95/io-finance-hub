'use client';

import { useCallback, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { EXPENSE_STATUS } from '@/lib/constants/status';

/**
 * Read-side composer for the P&L Reports archive.
 *
 * F-19 pattern (mirrors /profit-share's open/closed split):
 *   - CLOSED months  → row sourced from `monthly_financial_snapshots`
 *     (written only by fn_close_month → fn_generate_monthly_snapshot).
 *   - OPEN / unclosed months → computed FRESH client-side, because the
 *     snapshot table is empty for them. Both the snapshot engine
 *     (00036) and this fresh path read the SAME basis, so an open
 *     month reconciles with its eventual snapshot when it closes:
 *       revenue  = Σ lagged_revenue_by_project_month.lagged_revenue_kes
 *       direct   = Σ confirmed expenses (expense_type='project_expense')
 *       overhead = Σ confirmed expenses (expense_type='shared_expense')
 *       forex    = Σ withdrawals.variance_kes
 *       net      = revenue − direct − overhead + forex
 *
 * We aggregate company-wide (NOT filtered to active projects): the
 * snapshot is company-wide and historical months legitimately include
 * later-deactivated projects (the PS-3 lesson from use-profit-share).
 * We do NOT call fn_calculate_project_profitability /
 * fn_generate_monthly_snapshot — both have INSERT side effects and
 * cannot be used for read-only open-month computation.
 *
 * Status & signed-off metadata sourced from `month_closures` joined by
 * year_month: closed/locked → "signed", under_review → "in review",
 * open or missing → "draft". Closed-by user resolved via a direct
 * `users` query (never embed against snapshots).
 *
 * Aggregations:
 *   - Monthly: every month from the earliest data month through the
 *     current month, newest first; closed→snapshot, else→fresh.
 *   - Quarterly: rolls 3-month groups by calendar quarter.
 *   - Annual: rolls 12-month groups by calendar year. (No fiscal-year
 *     setting exists in system_settings → calendar year.)
 *   - Drafts: rows whose source is `fresh` (i.e. not a signed snapshot).
 */

const NAIROBI_TZ = 'Africa/Nairobi';
/** Guard so a malformed earliest month can never spin an infinite range. */
const MAX_MONTHS = 600;

export type PLStatus = 'signed' | 'in_review' | 'draft';
export type PLSource = 'snapshot' | 'fresh';

export type MonthlyReport = {
  yearMonth: string;
  label: string;
  reportId: string; // "PL · 2026-03"
  revenueKes: number;
  expensesKes: number; // direct + overhead (matches the page's "fully-loaded" framing)
  netProfitKes: number;
  marginPct: number;
  status: PLStatus;
  /** Where the row's figures came from. `fresh` rows are live, unsigned. */
  source: PLSource;
  signedOffByName: string | null;
  signedOffAt: string | null; // ISO timestamp
  isLocked: boolean;
  /** Set when fresh computation failed for this month; row renders an
   *  inline error and the rest of the page still works. */
  error: string | null;
};

export type QuarterlyReport = {
  yearQuarter: string; // "2026-Q1"
  label: string;
  startYearMonth: string;
  endYearMonth: string;
  revenueKes: number;
  expensesKes: number;
  netProfitKes: number;
  marginPct: number;
  /** Aggregate status: signed only when every constituent month is
   *  signed; in_review when any is under review; draft otherwise. */
  status: PLStatus;
  monthCount: number;
};

export type AnnualReport = {
  year: string;
  label: string;
  revenueKes: number;
  expensesKes: number;
  netProfitKes: number;
  marginPct: number;
  status: PLStatus;
  monthCount: number;
};

export type CurrentPeriodSummary = {
  yearMonth: string;
  label: string;
  revenueMtdKes: number;
  netProfitKes: number;
  marginPct: number;
  status: PLStatus;
  /** True when the figures are computed live (open month, no signed
   *  snapshot) rather than read from a signed snapshot. */
  isLive: boolean;
  /** Surfaced when the current month's fresh compute errored. */
  error: string | null;
};

export type PLReportsSummary = {
  /** Total signed (closed/locked) monthly statements — the archive.
   *  Snapshot-scoped only. */
  archivedCount: number;
  /** Signed-off statements within the current calendar year. */
  signedOffThisFiscalCount: number;
  /** Year-to-date net profit summed across signed months in the
   *  current calendar year. */
  ytdNetProfitKes: number;
  current: CurrentPeriodSummary | null;
};

type SnapshotRow = {
  year_month: string;
  total_revenue_kes: number | string | null;
  total_direct_costs_kes: number | string | null;
  total_shared_overhead_kes: number | string | null;
  net_profit_kes: number | string | null;
  is_locked: boolean | null;
};

type ClosureRow = {
  year_month: string;
  status: 'open' | 'under_review' | 'closed' | 'locked';
  closed_by: string | null;
  closed_at: string | null;
};

type LaggedRow = {
  expense_month: string;
  lagged_revenue_kes: number | string | null;
};

type ExpenseRow = {
  year_month: string;
  amount_kes: number | string | null;
  expense_type: 'project_expense' | 'shared_expense';
};

type WithdrawalRow = {
  year_month: string;
  variance_kes: number | string | null;
};

type UserRow = { id: string; full_name: string | null };

// ---------- helpers ----------

function shortMonth(yearMonth: string): string {
  const [y, m] = yearMonth.split('-').map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(m)) return yearMonth;
  return new Intl.DateTimeFormat('en-KE', {
    timeZone: NAIROBI_TZ,
    month: 'long',
    year: 'numeric',
  }).format(new Date(y, m - 1, 1));
}

function quarterOf(yearMonth: string): { yearQuarter: string; label: string } {
  const [y, m] = yearMonth.split('-').map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(m)) {
    return { yearQuarter: yearMonth, label: yearMonth };
  }
  const q = Math.floor((m - 1) / 3) + 1;
  return { yearQuarter: `${y}-Q${q}`, label: `Q${q} ${y}` };
}

function yearOf(yearMonth: string): { year: string; label: string } {
  const [y] = yearMonth.split('-').map(Number);
  if (!Number.isFinite(y)) return { year: yearMonth, label: yearMonth };
  return { year: `${y}`, label: `FY ${y}` };
}

function getCurrentYearMonth(): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: NAIROBI_TZ,
    year: 'numeric',
    month: '2-digit',
  });
  const parts = fmt.formatToParts(new Date());
  const y = parts.find((p) => p.type === 'year')?.value ?? '0000';
  const m = parts.find((p) => p.type === 'month')?.value ?? '01';
  return `${y}-${m}`;
}

function nextYearMonth(yearMonth: string): string {
  const [y, m] = yearMonth.split('-').map(Number);
  if (m === 12) return `${y + 1}-01`;
  return `${y}-${String(m + 1).padStart(2, '0')}`;
}

/** Inclusive contiguous YYYY-MM list, ascending. YYYY-MM sorts lexically. */
function monthRange(start: string, end: string): string[] {
  if (start > end) return [end];
  const out: string[] = [];
  let cur = start;
  let guard = 0;
  while (cur <= end && guard < MAX_MONTHS) {
    out.push(cur);
    cur = nextYearMonth(cur);
    guard += 1;
  }
  return out;
}

function isValidYearMonth(ym: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(ym);
}

function statusFromClosure(row: ClosureRow | undefined): PLStatus {
  if (!row) return 'draft';
  if (row.status === 'closed' || row.status === 'locked') return 'signed';
  if (row.status === 'under_review') return 'in_review';
  return 'draft';
}

function isSignedClosure(row: ClosureRow | undefined): boolean {
  return row?.status === 'closed' || row?.status === 'locked';
}

function aggregateStatus(statuses: PLStatus[]): PLStatus {
  if (statuses.length === 0) return 'draft';
  if (statuses.every((s) => s === 'signed')) return 'signed';
  if (statuses.some((s) => s === 'in_review')) return 'in_review';
  return 'draft';
}

function marginFor(revenueKes: number, netKes: number): number {
  if (revenueKes <= 0) return 0;
  return (netKes / revenueKes) * 100;
}

/** Sum a numeric-or-stringy column into a Map keyed by month. */
function sumByMonth<T>(
  rows: T[],
  monthKey: (r: T) => string,
  valueKey: (r: T) => number | string | null,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of rows) {
    const ym = monthKey(r);
    if (!ym) continue;
    out.set(ym, (out.get(ym) ?? 0) + Number(valueKey(r) ?? 0));
  }
  return out;
}

// ---------- hook ----------

export function usePLReports() {
  const [summary, setSummary] = useState<PLReportsSummary>(() => ({
    archivedCount: 0,
    signedOffThisFiscalCount: 0,
    ytdNetProfitKes: 0,
    current: null,
  }));
  const [monthly, setMonthly] = useState<MonthlyReport[]>([]);
  const [quarterly, setQuarterly] = useState<QuarterlyReport[]>([]);
  const [annual, setAnnual] = useState<AnnualReport[]>([]);
  const [drafts, setDrafts] = useState<MonthlyReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const supabase = createClient();
    const currentYM = getCurrentYearMonth();

    try {
      const [
        snapshotsRes,
        closuresRes,
        usersRes,
        laggedRes,
        expensesRes,
        withdrawalsRes,
      ] = await Promise.all([
        supabase
          .from('monthly_financial_snapshots')
          .select(
            'year_month, total_revenue_kes, total_direct_costs_kes, total_shared_overhead_kes, net_profit_kes, is_locked',
          )
          .order('year_month', { ascending: false }),
        supabase
          .from('month_closures')
          .select('year_month, status, closed_by, closed_at'),
        supabase.from('users').select('id, full_name'),
        // Revenue: lagged view only (AGENTS.md rule #1 — never raw invoices).
        supabase
          .from('lagged_revenue_by_project_month')
          .select('expense_month, lagged_revenue_kes'),
        // Expenses feeding financials must be confirmed (AGENTS.md rule #2).
        supabase
          .from('expenses')
          .select('year_month, amount_kes, expense_type')
          .eq('lifecycle_status', EXPENSE_STATUS.CONFIRMED),
        // Forex G/L component of net profit — matches fn_generate_monthly_snapshot.
        supabase.from('withdrawals').select('year_month, variance_kes'),
      ]);

      const firstError =
        snapshotsRes.error ??
        closuresRes.error ??
        usersRes.error ??
        laggedRes.error ??
        expensesRes.error ??
        withdrawalsRes.error;
      if (firstError) throw firstError;

      const snapshots = (snapshotsRes.data ?? []) as SnapshotRow[];
      const closures = (closuresRes.data ?? []) as ClosureRow[];
      const users = (usersRes.data ?? []) as UserRow[];
      const lagged = (laggedRes.data ?? []) as LaggedRow[];
      const expenses = (expensesRes.data ?? []) as ExpenseRow[];
      const withdrawals = (withdrawalsRes.data ?? []) as WithdrawalRow[];

      const userNameById = new Map<string, string>();
      for (const u of users) {
        if (u.id) userNameById.set(u.id, u.full_name ?? 'Unknown');
      }
      const closureByMonth = new Map<string, ClosureRow>();
      for (const c of closures) closureByMonth.set(c.year_month, c);
      const snapshotByMonth = new Map<string, SnapshotRow>();
      for (const s of snapshots) snapshotByMonth.set(s.year_month, s);

      // ---- grouped fresh-compute inputs (company-wide, by month) ----
      const revenueByMonth = sumByMonth(
        lagged,
        (r) => r.expense_month,
        (r) => r.lagged_revenue_kes,
      );
      const directByMonth = sumByMonth(
        expenses.filter((e) => e.expense_type === 'project_expense'),
        (r) => r.year_month,
        (r) => r.amount_kes,
      );
      const overheadByMonth = sumByMonth(
        expenses.filter((e) => e.expense_type === 'shared_expense'),
        (r) => r.year_month,
        (r) => r.amount_kes,
      );
      const forexByMonth = sumByMonth(
        withdrawals,
        (r) => r.year_month,
        (r) => r.variance_kes,
      );

      // ---- month range: earliest data month → current month ----
      const dataMonths = new Set<string>([currentYM]);
      for (const s of snapshots) if (isValidYearMonth(s.year_month)) dataMonths.add(s.year_month);
      for (const ym of revenueByMonth.keys()) if (isValidYearMonth(ym)) dataMonths.add(ym);
      for (const ym of directByMonth.keys()) if (isValidYearMonth(ym)) dataMonths.add(ym);
      for (const ym of overheadByMonth.keys()) if (isValidYearMonth(ym)) dataMonths.add(ym);
      for (const ym of forexByMonth.keys()) if (isValidYearMonth(ym)) dataMonths.add(ym);
      const sortedMonths = Array.from(dataMonths).sort();
      const earliest = sortedMonths[0];
      const latest = sortedMonths[sortedMonths.length - 1]; // ≥ currentYM
      const allMonths = monthRange(earliest, latest);

      // ---- build one row per month (snapshot if signed, else fresh) ----
      const monthlyRows: MonthlyReport[] = allMonths.map((ym) => {
        const closure = closureByMonth.get(ym);
        const status = statusFromClosure(closure);
        const snapshot = snapshotByMonth.get(ym);
        const base = {
          yearMonth: ym,
          label: shortMonth(ym),
          reportId: `PL · ${ym}`,
          status,
        };

        // CLOSED month with a snapshot → authoritative signed figures.
        if (isSignedClosure(closure) && snapshot) {
          const revenue = Number(snapshot.total_revenue_kes ?? 0);
          const direct = Number(snapshot.total_direct_costs_kes ?? 0);
          const overhead = Number(snapshot.total_shared_overhead_kes ?? 0);
          const net = Number(snapshot.net_profit_kes ?? 0);
          return {
            ...base,
            revenueKes: revenue,
            expensesKes: direct + overhead,
            netProfitKes: net,
            marginPct: marginFor(revenue, net),
            source: 'snapshot',
            signedOffByName: closure?.closed_by
              ? userNameById.get(closure.closed_by) ?? 'Unknown'
              : null,
            signedOffAt: closure?.closed_at ?? null,
            isLocked: Boolean(snapshot.is_locked),
            error: null,
          };
        }

        // OPEN / unclosed month → compute fresh. Wrapped so a single bad
        // month surfaces an inline error without breaking the page.
        try {
          const revenue = revenueByMonth.get(ym) ?? 0;
          const direct = directByMonth.get(ym) ?? 0;
          const overhead = overheadByMonth.get(ym) ?? 0;
          const forex = forexByMonth.get(ym) ?? 0;
          const net = revenue - direct - overhead + forex;
          if (
            ![revenue, direct, overhead, forex, net].every(Number.isFinite)
          ) {
            throw new Error('Non-numeric figure in fresh computation');
          }
          return {
            ...base,
            revenueKes: revenue,
            expensesKes: direct + overhead,
            netProfitKes: net,
            marginPct: marginFor(revenue, net),
            source: 'fresh',
            signedOffByName: null,
            signedOffAt: null,
            isLocked: false,
            error: null,
          };
        } catch (e) {
          return {
            ...base,
            revenueKes: 0,
            expensesKes: 0,
            netProfitKes: 0,
            marginPct: 0,
            source: 'fresh',
            signedOffByName: null,
            signedOffAt: null,
            isLocked: false,
            error: e instanceof Error ? e.message : 'Computation failed',
          };
        }
      });

      // Newest first.
      monthlyRows.sort((a, b) => b.yearMonth.localeCompare(a.yearMonth));

      // ---- quarterly + annual: aggregate the SAME combined list ----
      const quarterAgg = new Map<
        string,
        { yearQuarter: string; label: string; months: MonthlyReport[] }
      >();
      const annualAgg = new Map<
        string,
        { year: string; label: string; months: MonthlyReport[] }
      >();
      for (const m of monthlyRows) {
        const q = quarterOf(m.yearMonth);
        const qa = quarterAgg.get(q.yearQuarter) ?? {
          yearQuarter: q.yearQuarter,
          label: q.label,
          months: [],
        };
        qa.months.push(m);
        quarterAgg.set(q.yearQuarter, qa);

        const y = yearOf(m.yearMonth);
        const ya = annualAgg.get(y.year) ?? {
          year: y.year,
          label: y.label,
          months: [],
        };
        ya.months.push(m);
        annualAgg.set(y.year, ya);
      }

      const quarterlyRows: QuarterlyReport[] = Array.from(quarterAgg.values())
        .map((qa) => {
          const sorted = qa.months
            .slice()
            .sort((a, b) => a.yearMonth.localeCompare(b.yearMonth));
          const revenue = sorted.reduce((s, m) => s + m.revenueKes, 0);
          const expenses_ = sorted.reduce((s, m) => s + m.expensesKes, 0);
          const net = sorted.reduce((s, m) => s + m.netProfitKes, 0);
          return {
            yearQuarter: qa.yearQuarter,
            label: qa.label,
            startYearMonth: sorted[0].yearMonth,
            endYearMonth: sorted[sorted.length - 1].yearMonth,
            revenueKes: revenue,
            expensesKes: expenses_,
            netProfitKes: net,
            marginPct: marginFor(revenue, net),
            status: aggregateStatus(sorted.map((m) => m.status)),
            monthCount: sorted.length,
          };
        })
        .sort((a, b) => b.yearQuarter.localeCompare(a.yearQuarter));

      const annualRows: AnnualReport[] = Array.from(annualAgg.values())
        .map((ya) => {
          const sorted = ya.months
            .slice()
            .sort((a, b) => a.yearMonth.localeCompare(b.yearMonth));
          const revenue = sorted.reduce((s, m) => s + m.revenueKes, 0);
          const expenses_ = sorted.reduce((s, m) => s + m.expensesKes, 0);
          const net = sorted.reduce((s, m) => s + m.netProfitKes, 0);
          return {
            year: ya.year,
            label: ya.label,
            revenueKes: revenue,
            expensesKes: expenses_,
            netProfitKes: net,
            marginPct: marginFor(revenue, net),
            status: aggregateStatus(sorted.map((m) => m.status)),
            monthCount: sorted.length,
          };
        })
        .sort((a, b) => b.year.localeCompare(a.year));

      // Drafts = freshly-computed (unsigned) rows.
      const draftsRows = monthlyRows.filter((m) => m.source === 'fresh');

      // ---- summary: F-cards stay strictly snapshot-scoped ----
      const currentYear = currentYM.split('-')[0];
      const signedSnapshots = snapshots.filter((s) =>
        isSignedClosure(closureByMonth.get(s.year_month)),
      );
      const archivedCount = signedSnapshots.length;
      const signedThisFiscal = signedSnapshots.filter((s) =>
        s.year_month.startsWith(currentYear),
      );
      const ytdNetProfitKes = signedThisFiscal.reduce(
        (s, snap) => s + Number(snap.net_profit_kes ?? 0),
        0,
      );

      const currentRow = monthlyRows.find((m) => m.yearMonth === currentYM);
      const current: CurrentPeriodSummary | null = currentRow
        ? {
            yearMonth: currentRow.yearMonth,
            label: currentRow.label,
            revenueMtdKes: currentRow.revenueKes,
            netProfitKes: currentRow.netProfitKes,
            marginPct: currentRow.marginPct,
            status: currentRow.status,
            isLive: currentRow.source === 'fresh',
            error: currentRow.error,
          }
        : null;

      setSummary({
        archivedCount,
        signedOffThisFiscalCount: signedThisFiscal.length,
        ytdNetProfitKes,
        current,
      });
      setMonthly(monthlyRows);
      setQuarterly(quarterlyRows);
      setAnnual(annualRows);
      setDrafts(draftsRows);
      setLoading(false);
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return {
    summary,
    monthly,
    quarterly,
    annual,
    drafts,
    loading,
    error,
    refresh: load,
  };
}
