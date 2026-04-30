'use client';

import { useCallback, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

/**
 * Read-side composer for the P&L Reports archive.
 *
 * Per Phase 4 Session C:
 *   - Source: `monthly_financial_snapshots` (one row per closed
 *     month, with revenue / direct cost / overhead / net_profit_kes).
 *   - Status & signed-off metadata sourced from `month_closures`
 *     joined by year_month: closed/locked → "signed", under_review →
 *     "in review", open or missing → "draft".
 *   - Closed-by user resolution via direct `users` query (never embed
 *     against monthly_financial_snapshots — it's a regular table but
 *     the lesson banked is "always direct queries for cross-table
 *     names" because RLS / FK quirks have bitten us before).
 *
 * Aggregations:
 *   - Quarterly: rolls 3-month groups by calendar quarter.
 *   - Annual: rolls 12-month groups by calendar year.
 *   - Drafts: snapshots whose closure status is 'open' (or no
 *     closure row), or the current month — whichever yields rows.
 *
 * Custom range tab is deferred per session brief (D5 ships 4 of 5).
 */

const NAIROBI_TZ = 'Africa/Nairobi';

export type PLStatus = 'signed' | 'in_review' | 'draft';

export type MonthlyReport = {
  yearMonth: string;
  label: string;
  reportId: string; // "PL · 2026-03"
  revenueKes: number;
  expensesKes: number; // direct + overhead (matches the page's "fully-loaded" framing)
  netProfitKes: number;
  marginPct: number;
  status: PLStatus;
  signedOffByName: string | null;
  signedOffAt: string | null; // ISO timestamp
  isLocked: boolean;
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
};

export type PLReportsSummary = {
  /** Total signed (closed/locked) monthly statements — the archive. */
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

function statusFromClosure(row: ClosureRow | undefined): PLStatus {
  if (!row) return 'draft';
  if (row.status === 'closed' || row.status === 'locked') return 'signed';
  if (row.status === 'under_review') return 'in_review';
  return 'draft';
}

function aggregateStatus(statuses: PLStatus[]): PLStatus {
  if (statuses.length === 0) return 'draft';
  if (statuses.every((s) => s === 'signed')) return 'signed';
  if (statuses.some((s) => s === 'in_review')) return 'in_review';
  return 'draft';
}

function marginPctFor(revenueKes: number, expensesKes: number): number {
  if (revenueKes <= 0) return 0;
  return ((revenueKes - expensesKes) / revenueKes) * 100;
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
      const [snapshotsRes, closuresRes, usersRes] = await Promise.all([
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
      ]);

      const snapshots = (snapshotsRes.data ?? []) as SnapshotRow[];
      const closures = (closuresRes.data ?? []) as ClosureRow[];
      const users = (usersRes.data ?? []) as Array<{
        id: string;
        full_name: string | null;
      }>;

      const userNameById = new Map<string, string>();
      for (const u of users) {
        if (u.id) userNameById.set(u.id, u.full_name ?? 'Unknown');
      }
      const closureByMonth = new Map<string, ClosureRow>();
      for (const c of closures) {
        closureByMonth.set(c.year_month, c);
      }

      // ---- monthly list (all snapshots, newest first) ----
      const monthlyRows: MonthlyReport[] = snapshots.map((s) => {
        const closure = closureByMonth.get(s.year_month);
        const status = statusFromClosure(closure);
        const revenue = Number(s.total_revenue_kes ?? 0);
        const direct = Number(s.total_direct_costs_kes ?? 0);
        const overhead = Number(s.total_shared_overhead_kes ?? 0);
        const expenses = direct + overhead;
        const net = Number(s.net_profit_kes ?? 0);
        const margin =
          revenue > 0 ? (net / revenue) * 100 : marginPctFor(revenue, expenses);
        return {
          yearMonth: s.year_month,
          label: shortMonth(s.year_month),
          reportId: `PL · ${s.year_month}`,
          revenueKes: revenue,
          expensesKes: expenses,
          netProfitKes: net,
          marginPct: margin,
          status,
          signedOffByName: closure?.closed_by
            ? userNameById.get(closure.closed_by) ?? 'Unknown'
            : null,
          signedOffAt: closure?.closed_at ?? null,
          isLocked: Boolean(s.is_locked),
        };
      });

      // ---- quarterly + annual aggregations ----
      const quarterAgg = new Map<
        string,
        {
          yearQuarter: string;
          label: string;
          months: MonthlyReport[];
        }
      >();
      const annualAgg = new Map<
        string,
        {
          year: string;
          label: string;
          months: MonthlyReport[];
        }
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
          const expenses = sorted.reduce((s, m) => s + m.expensesKes, 0);
          const net = sorted.reduce((s, m) => s + m.netProfitKes, 0);
          const margin = revenue > 0 ? (net / revenue) * 100 : 0;
          return {
            yearQuarter: qa.yearQuarter,
            label: qa.label,
            startYearMonth: sorted[0].yearMonth,
            endYearMonth: sorted[sorted.length - 1].yearMonth,
            revenueKes: revenue,
            expensesKes: expenses,
            netProfitKes: net,
            marginPct: margin,
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
          const expenses = sorted.reduce((s, m) => s + m.expensesKes, 0);
          const net = sorted.reduce((s, m) => s + m.netProfitKes, 0);
          const margin = revenue > 0 ? (net / revenue) * 100 : 0;
          return {
            year: ya.year,
            label: ya.label,
            revenueKes: revenue,
            expensesKes: expenses,
            netProfitKes: net,
            marginPct: margin,
            status: aggregateStatus(sorted.map((m) => m.status)),
            monthCount: sorted.length,
          };
        })
        .sort((a, b) => b.year.localeCompare(a.year));

      const draftsRows = monthlyRows.filter((m) => m.status !== 'signed');

      // ---- summary ----
      const archivedCount = monthlyRows.filter(
        (m) => m.status === 'signed',
      ).length;
      const currentYear = currentYM.split('-')[0];
      const signedThisFiscal = monthlyRows.filter(
        (m) => m.status === 'signed' && m.yearMonth.startsWith(currentYear),
      );
      const ytdNetProfitKes = signedThisFiscal.reduce(
        (s, m) => s + m.netProfitKes,
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
          }
        : null;

      const newSummary: PLReportsSummary = {
        archivedCount,
        signedOffThisFiscalCount: signedThisFiscal.length,
        ytdNetProfitKes,
        current,
      };

      setSummary(newSummary);
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
