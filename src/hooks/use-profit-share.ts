'use client';

import { useCallback, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { EXPENSE_STATUS } from '@/lib/constants/status';

/**
 * Read-side composer for the Director Profit Share report.
 *
 * Per Phase 4 Session C:
 *   - Codebase split: 70% directors / 30% company (NOT the mockup's
 *     fictional 5-segment 35/25/20/12/8 model — that's ignored).
 *   - 5 directors, identified by `projects.director_tag`
 *     (kelvin, evans, dan, gidraph, victor).
 *   - Per-project distributable profit is rolled up to the director
 *     who owns the project; each director gets 70% of their projects'
 *     net profit.
 *
 * Two-tier source for the requested month:
 *   1. Materialised `profit_share_records` rows (post-recompute).
 *      Authoritative and matches what /profit-share/payouts uses.
 *   2. Fallback (open / never-recomputed months): compute net profit
 *      client-side from `lagged_revenue_by_project_month` minus
 *      confirmed expenses (project + headcount-allocated overhead),
 *      then × 0.70.
 *
 * History: 8-month series, prefer profit_share_records when populated,
 * fall back to monthly_financial_snapshots.net_profit_kes × 0.70.
 *
 * Project + director-name resolution via direct queries (never embed
 * against views — lesson from profitability hotfix).
 */

const NAIROBI_TZ = 'Africa/Nairobi';
const HISTORY_MONTHS = 8;
const DIRECTOR_SHARE = 0.70;
const COMPANY_SHARE = 0.30;

export type DirectorTag =
  | 'kelvin'
  | 'evans'
  | 'dan'
  | 'gidraph'
  | 'victor';

export const DIRECTOR_TAGS: DirectorTag[] = [
  'kelvin',
  'evans',
  'dan',
  'gidraph',
  'victor',
];

export type ProfitShareStatus =
  | 'pending_review'
  | 'approved'
  | 'disputed'
  | 'draft'; // synthesised when records are missing

export type DirectorShare = {
  directorTag: DirectorTag;
  directorName: string;
  /** Director's portion of net profit, summed across owned projects. */
  shareKes: number;
  /** Share % of the entire 70% director pool, e.g. 22.4 means this
   *  director took 22.4% of the directors' allocation. */
  sharePct: number;
  projectCount: number;
  projectNames: string[];
};

export type ProfitShareSummary = {
  periodLabel: string;
  /** Sum of (revenue - fully-loaded cost) across all projects, before
   *  the 70/30 split. */
  totalNetProfitKes: number;
  /** 70% of net profit — distributed across the 5 directors. */
  totalDistributablePoolKes: number;
  /** 30% of net profit — retained by the company. */
  totalCompanyShareKes: number;
  /** Always 5 (director count) when any director has projects in the
   *  pool; less when no projects/profit. */
  directorCount: number;
  largestShare: { directorName: string; shareKes: number; sharePct: number } | null;
  smallestShare: { directorName: string; shareKes: number; sharePct: number } | null;
  /** Δ in totalDistributablePoolKes vs the prior period, in pct. Null
   *  when prior pool ≤ 0. */
  priorPeriodDeltaPct: number | null;
  /** Aggregate status of the materialised records. 'draft' when no
   *  records exist (computed client-side). */
  distributionStatus: ProfitShareStatus;
  /** True when figures came from profit_share_records (false → fallback). */
  fromMaterialisedTable: boolean;
};

export type ProfitShareHistoryRow = {
  yearMonth: string;
  label: string;
  totalNetProfitKes: number;
  distributableKes: number;
  status: ProfitShareStatus;
  fromMaterialisedTable: boolean;
};

type ProfitShareRecordRow = {
  project_id: string;
  year_month: string;
  director_tag: DirectorTag;
  director_user_id: string;
  distributable_profit_kes: number | string | null;
  director_share_kes: number | string | null;
  company_share_kes: number | string | null;
  status: 'pending_review' | 'approved' | 'disputed';
};

type ProjectRow = {
  id: string;
  name: string | null;
  director_tag: DirectorTag;
  director_user_id: string;
};

type LaggedRow = {
  project_id: string | null;
  expense_month: string;
  lagged_revenue_kes: number | string | null;
};

type ExpenseRow = {
  project_id: string | null;
  amount_kes: number | string | null;
  expense_type: 'project_expense' | 'shared_expense';
};

type AgentCountRow = {
  project_id: string | null;
  agent_count: number | string | null;
};

type SnapshotRow = {
  year_month: string;
  net_profit_kes: number | string | null;
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

function shortMonthLabel(yearMonth: string): string {
  const [y, m] = yearMonth.split('-').map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(m)) return yearMonth;
  return new Intl.DateTimeFormat('en-KE', {
    timeZone: NAIROBI_TZ,
    month: 'short',
    year: '2-digit',
  })
    .format(new Date(y, m - 1, 1))
    .toUpperCase();
}

function prevYearMonth(yearMonth: string): string {
  const [y, m] = yearMonth.split('-').map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(m)) return yearMonth;
  if (m === 1) return `${y - 1}-12`;
  return `${y}-${String(m - 1).padStart(2, '0')}`;
}

function lookbackMonths(yearMonth: string, count: number): string[] {
  const out: string[] = [];
  let cur = yearMonth;
  for (let i = 0; i < count; i++) {
    out.unshift(cur);
    cur = prevYearMonth(cur);
  }
  return out;
}

function aggregateStatus(records: ProfitShareRecordRow[]): ProfitShareStatus {
  if (records.length === 0) return 'draft';
  if (records.some((r) => r.status === 'disputed')) return 'disputed';
  if (records.every((r) => r.status === 'approved')) return 'approved';
  return 'pending_review';
}

function titleCase(tag: DirectorTag): string {
  return tag.charAt(0).toUpperCase() + tag.slice(1);
}

/**
 * Compute net profit per project for a given month — used as the
 * fallback path when profit_share_records has no rows.
 *
 * Mirrors the rule from the redesigned Profitability page:
 *   net profit = revenue (lagged view) - direct expenses (confirmed) -
 *                (totalShared × headcount share).
 */
function computeFallbackProfitByProject(
  projectIds: string[],
  laggedRows: LaggedRow[],
  expenseRows: ExpenseRow[],
  agentRows: AgentCountRow[],
): Map<string, number> {
  const revenueById = new Map<string, number>();
  for (const r of laggedRows) {
    if (!r.project_id) continue;
    revenueById.set(
      r.project_id,
      (revenueById.get(r.project_id) ?? 0) + Number(r.lagged_revenue_kes ?? 0),
    );
  }

  const directById = new Map<string, number>();
  let totalShared = 0;
  for (const e of expenseRows) {
    const amt = Number(e.amount_kes ?? 0);
    if (e.expense_type === 'shared_expense') {
      totalShared += amt;
    } else if (e.project_id) {
      directById.set(
        e.project_id,
        (directById.get(e.project_id) ?? 0) + amt,
      );
    }
  }

  const agentsById = new Map<string, number>();
  let totalAgents = 0;
  for (const a of agentRows) {
    if (!a.project_id) continue;
    const n = Number(a.agent_count ?? 0);
    agentsById.set(a.project_id, n);
    totalAgents += n;
  }

  const out = new Map<string, number>();
  for (const pid of projectIds) {
    const revenue = revenueById.get(pid) ?? 0;
    const direct = directById.get(pid) ?? 0;
    const agents = agentsById.get(pid) ?? 0;
    const overhead =
      totalAgents > 0 && totalShared > 0
        ? totalShared * (agents / totalAgents)
        : 0;
    out.set(pid, revenue - direct - overhead);
  }
  return out;
}

// ---------- hook ----------

export function useProfitShare(yearMonth: string) {
  const [summary, setSummary] = useState<ProfitShareSummary>(() => ({
    periodLabel: shortMonth(yearMonth),
    totalNetProfitKes: 0,
    totalDistributablePoolKes: 0,
    totalCompanyShareKes: 0,
    directorCount: 0,
    largestShare: null,
    smallestShare: null,
    priorPeriodDeltaPct: null,
    distributionStatus: 'draft',
    fromMaterialisedTable: false,
  }));
  const [directors, setDirectors] = useState<DirectorShare[]>([]);
  const [history, setHistory] = useState<ProfitShareHistoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const supabase = createClient();
    const prev = prevYearMonth(yearMonth);
    const window8 = lookbackMonths(yearMonth, HISTORY_MONTHS);

    try {
      const [
        projectsRes,
        usersRes,
        recordsCurrentRes,
        recordsPriorRes,
        recordsWindowRes,
        snapshotsRes,
        laggedCurrentRes,
        expensesCurrentRes,
        agentsCurrentRes,
      ] = await Promise.all([
        supabase
          .from('projects')
          .select('id, name, director_tag, director_user_id')
          .eq('is_active', true),
        supabase.from('users').select('id, full_name'),
        supabase
          .from('profit_share_records')
          .select(
            'project_id, year_month, director_tag, director_user_id, distributable_profit_kes, director_share_kes, company_share_kes, status',
          )
          .eq('year_month', yearMonth),
        supabase
          .from('profit_share_records')
          .select(
            'project_id, year_month, director_tag, director_user_id, distributable_profit_kes, director_share_kes, company_share_kes, status',
          )
          .eq('year_month', prev),
        supabase
          .from('profit_share_records')
          .select(
            'project_id, year_month, director_tag, director_user_id, distributable_profit_kes, director_share_kes, company_share_kes, status',
          )
          .in('year_month', window8),
        supabase
          .from('monthly_financial_snapshots')
          .select('year_month, net_profit_kes')
          .in('year_month', window8),
        supabase
          .from('lagged_revenue_by_project_month')
          .select('project_id, expense_month, lagged_revenue_kes')
          .eq('expense_month', yearMonth),
        supabase
          .from('expenses')
          .select('project_id, amount_kes, expense_type')
          .eq('year_month', yearMonth)
          .eq('lifecycle_status', EXPENSE_STATUS.CONFIRMED),
        supabase
          .from('agent_counts')
          .select('project_id, agent_count')
          .eq('year_month', yearMonth),
      ]);

      const projects = (projectsRes.data ?? []) as ProjectRow[];
      const users = (usersRes.data ?? []) as Array<{
        id: string;
        full_name: string | null;
      }>;
      const recordsCurrent = (recordsCurrentRes.data ?? []) as ProfitShareRecordRow[];
      const recordsPrior = (recordsPriorRes.data ?? []) as ProfitShareRecordRow[];
      const recordsWindow = (recordsWindowRes.data ?? []) as ProfitShareRecordRow[];
      const snapshots = (snapshotsRes.data ?? []) as SnapshotRow[];
      const laggedCurrent = (laggedCurrentRes.data ?? []) as LaggedRow[];
      const expensesCurrent = (expensesCurrentRes.data ?? []) as ExpenseRow[];
      const agentsCurrent = (agentsCurrentRes.data ?? []) as AgentCountRow[];

      // ---- name resolvers ----
      const projectNameById = new Map<string, string>();
      const projectDirectorById = new Map<string, DirectorTag>();
      for (const p of projects) {
        if (!p.id) continue;
        projectNameById.set(p.id, p.name ?? 'Unnamed project');
        projectDirectorById.set(p.id, p.director_tag);
      }
      const userNameById = new Map<string, string>();
      for (const u of users) {
        if (u.id) userNameById.set(u.id, u.full_name ?? 'Unknown director');
      }
      const directorNameByTag = new Map<DirectorTag, string>();
      // Pick the most recent project per director_tag to source the name.
      for (const p of projects) {
        if (!directorNameByTag.has(p.director_tag) && p.director_user_id) {
          directorNameByTag.set(
            p.director_tag,
            userNameById.get(p.director_user_id) ?? titleCase(p.director_tag),
          );
        }
      }
      // Always seed all 5 with at least the title-cased tag so the UI
      // has a label even when no project is owned by them yet.
      for (const tag of DIRECTOR_TAGS) {
        if (!directorNameByTag.has(tag)) {
          directorNameByTag.set(tag, titleCase(tag));
        }
      }

      // ---- per-project profit (current month) ----
      let perProjectDirectorShare = new Map<string, number>();
      let perProjectCompanyShare = new Map<string, number>();
      let perProjectNetProfit = new Map<string, number>();
      let fromMaterialisedTable = false;

      if (recordsCurrent.length > 0) {
        fromMaterialisedTable = true;
        for (const r of recordsCurrent) {
          perProjectDirectorShare.set(
            r.project_id,
            Number(r.director_share_kes ?? 0),
          );
          perProjectCompanyShare.set(
            r.project_id,
            Number(r.company_share_kes ?? 0),
          );
          perProjectNetProfit.set(
            r.project_id,
            Number(r.distributable_profit_kes ?? 0),
          );
        }
      } else {
        const fallback = computeFallbackProfitByProject(
          projects.map((p) => p.id),
          laggedCurrent,
          expensesCurrent,
          agentsCurrent,
        );
        perProjectNetProfit = fallback;
        for (const [pid, np] of fallback) {
          perProjectDirectorShare.set(pid, np * DIRECTOR_SHARE);
          perProjectCompanyShare.set(pid, np * COMPANY_SHARE);
        }
      }

      // ---- roll up to per-director shares ----
      type Agg = {
        shareKes: number;
        projectIds: Set<string>;
      };
      const aggByTag = new Map<DirectorTag, Agg>();
      for (const tag of DIRECTOR_TAGS) {
        aggByTag.set(tag, { shareKes: 0, projectIds: new Set() });
      }
      for (const [pid, share] of perProjectDirectorShare) {
        const tag = projectDirectorById.get(pid);
        if (!tag) continue;
        const agg = aggByTag.get(tag)!;
        agg.shareKes += share;
        if (perProjectNetProfit.get(pid) !== undefined) {
          agg.projectIds.add(pid);
        }
      }

      const totalDistributablePoolKes = Array.from(
        perProjectDirectorShare.values(),
      ).reduce((s, n) => s + n, 0);
      const totalCompanyShareKes = Array.from(
        perProjectCompanyShare.values(),
      ).reduce((s, n) => s + n, 0);
      const totalNetProfitKes = Array.from(perProjectNetProfit.values()).reduce(
        (s, n) => s + n,
        0,
      );

      const directorRows: DirectorShare[] = DIRECTOR_TAGS.map((tag) => {
        const agg = aggByTag.get(tag)!;
        const sharePct =
          totalDistributablePoolKes > 0
            ? (agg.shareKes / totalDistributablePoolKes) * 100
            : 0;
        const projectNames = Array.from(agg.projectIds).map(
          (id) => projectNameById.get(id) ?? 'Unattributed',
        );
        return {
          directorTag: tag,
          directorName: directorNameByTag.get(tag) ?? titleCase(tag),
          shareKes: agg.shareKes,
          sharePct,
          projectCount: agg.projectIds.size,
          projectNames,
        };
      }).sort((a, b) => b.shareKes - a.shareKes);

      const directorsWithShare = directorRows.filter((d) => d.shareKes > 0);
      const largestShare =
        directorsWithShare.length > 0
          ? {
              directorName: directorsWithShare[0].directorName,
              shareKes: directorsWithShare[0].shareKes,
              sharePct: directorsWithShare[0].sharePct,
            }
          : null;
      const smallestShare =
        directorsWithShare.length > 0
          ? {
              directorName: directorsWithShare[directorsWithShare.length - 1]
                .directorName,
              shareKes: directorsWithShare[directorsWithShare.length - 1]
                .shareKes,
              sharePct: directorsWithShare[directorsWithShare.length - 1].sharePct,
            }
          : null;

      // ---- prior-period delta ----
      const priorDistributable = recordsPrior.reduce(
        (s, r) => s + Number(r.director_share_kes ?? 0),
        0,
      );
      const priorPeriodDeltaPct =
        priorDistributable > 0
          ? ((totalDistributablePoolKes - priorDistributable) / priorDistributable) *
            100
          : null;

      // ---- 8-month history ----
      const recordsByMonth = new Map<string, ProfitShareRecordRow[]>();
      for (const r of recordsWindow) {
        const list = recordsByMonth.get(r.year_month) ?? [];
        list.push(r);
        recordsByMonth.set(r.year_month, list);
      }
      const snapshotByMonth = new Map<string, number>();
      for (const s of snapshots) {
        snapshotByMonth.set(s.year_month, Number(s.net_profit_kes ?? 0));
      }
      const historyRows: ProfitShareHistoryRow[] = window8.map((m) => {
        const records = recordsByMonth.get(m) ?? [];
        if (records.length > 0) {
          const distributable = records.reduce(
            (s, r) => s + Number(r.director_share_kes ?? 0),
            0,
          );
          const np = records.reduce(
            (s, r) => s + Number(r.distributable_profit_kes ?? 0),
            0,
          );
          return {
            yearMonth: m,
            label: shortMonthLabel(m),
            totalNetProfitKes: np,
            distributableKes: distributable,
            status: aggregateStatus(records),
            fromMaterialisedTable: true,
          };
        }
        const snapshotNet = snapshotByMonth.get(m) ?? 0;
        return {
          yearMonth: m,
          label: shortMonthLabel(m),
          totalNetProfitKes: snapshotNet,
          distributableKes: snapshotNet * DIRECTOR_SHARE,
          status: 'draft',
          fromMaterialisedTable: false,
        };
      });

      const newSummary: ProfitShareSummary = {
        periodLabel: shortMonth(yearMonth),
        totalNetProfitKes,
        totalDistributablePoolKes,
        totalCompanyShareKes,
        directorCount: directorsWithShare.length,
        largestShare,
        smallestShare,
        priorPeriodDeltaPct,
        distributionStatus: aggregateStatus(recordsCurrent),
        fromMaterialisedTable,
      };

      setSummary(newSummary);
      setDirectors(directorRows);
      setHistory(historyRows);
      setLoading(false);
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
      setLoading(false);
    }
  }, [yearMonth]);

  useEffect(() => {
    load();
  }, [load]);

  return {
    summary,
    directors,
    history,
    periodLabel: summary.periodLabel,
    loading,
    error,
    refresh: load,
  };
}
