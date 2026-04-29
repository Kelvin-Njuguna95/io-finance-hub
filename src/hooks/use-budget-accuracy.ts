'use client';

import { useCallback, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

/**
 * Read-side composer for the Budget Accuracy report.
 *
 * Per Phase 4 Session B D4 + D5:
 *   - Source: materialized `expense_variances` (NOT the
 *     `variance_summary_by_project` view that the legacy page used).
 *   - Owner resolution: `budgets.created_by` matched on
 *     `(project_id|department_id, year_month)` → `users.full_name`.
 *     Falls back to `projects.director_user_id` /
 *     `departments.owner_user_id` when no budget row exists for the
 *     period.
 *   - Grades client-side, not a DB column. Bands:
 *       A  ≤ ±2%      A− ≤ ±5%      B  ≤ ±8%
 *       B− ≤ ±12%     C  ≤ ±18%     D  > ±18%
 *
 * Never embed `projects(name)`/`users(...)`/`departments(...)` against
 * `expense_variances` — lesson banked from the profitability hotfix.
 * Resolve all names via direct table queries → Map<id, name>.
 */

const NAIROBI_TZ = 'Africa/Nairobi';
const SCORECARD_MONTHS = 6;
const HISTORY_MONTHS = 12;
const STREAK_TOLERANCE_PCT = 8; // |variancePct| ≤ 8 (B or better)

export type Grade = 'A' | 'A-' | 'B' | 'B-' | 'C' | 'D';

export type BudgetAccuracyRow = {
  /** Composite key: `proj:${projectId}` or `dept:${departmentId}`. */
  id: string;
  name: string;
  ownerId: string | null;
  ownerName: string;
  planKes: number;
  actualKes: number;
  varianceKes: number;
  variancePct: number;
  grade: Grade;
  gradePoints: number;
  /** Consecutive months ending at the requested month inside ±8% band. */
  streakMonths: number;
  isShared: boolean;
};

export type BudgetAccuracySummary = {
  monthLabel: string;
  /** 100 - weighted-by-plan absolute variance percentage. */
  portfolioAccuracyPct: number;
  portfolioGrade: Grade;
  portfolioPoints: number;
  /** Best-grade row with smallest |variancePct|. */
  mostAccurate: { name: string; variancePct: number; grade: Grade } | null;
  /** Worst row by |variancePct|. */
  largestMiss: { name: string; variancePct: number; grade: Grade } | null;
  /** Months ending at the requested month where the portfolio sat
   *  inside ±8%. */
  streakMonths: number;
  budgetCount: number;
};

export type OwnerMonthlyGrade = {
  month: string;
  label: string;
  grade: Grade | null;
  points: number | null;
};

export type OwnerScorecardRow = {
  ownerId: string;
  ownerName: string;
  /** Comma-separated project/department names this owner is responsible
   *  for in the 6-month window. */
  scope: string;
  monthlyGrades: OwnerMonthlyGrade[];
  averageGrade: Grade;
  averagePoints: number;
};

export type GradeDistribution = Record<Grade, number>;

export type GradeHistoryRow = {
  month: string;
  label: string;
  portfolioGrade: Grade;
  portfolioPoints: number;
  portfolioAccuracyPct: number;
  gradeDistribution: GradeDistribution;
};

type ExpenseVarianceRow = {
  year_month: string;
  project_id: string | null;
  department_id: string | null;
  category: string | null;
  budgeted_total_kes: number | string | null;
  actual_total_kes: number | string | null;
};

type BudgetRow = {
  project_id: string | null;
  department_id: string | null;
  year_month: string;
  created_by: string;
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

/**
 * Map |variancePct| to a grade letter + 0..100 points score.
 *
 * Anchor points (chosen so band edges are stable, low values reward
 * sharply, points decay smoothly through D):
 *   0%=100, 2%=96, 5%=90, 8%=85, 12%=77, 18%=65, 50%=50, 100%=0.
 */
function gradeFor(variancePct: number): { grade: Grade; points: number } {
  const abs = Math.abs(variancePct);
  let grade: Grade;
  if (abs <= 2) grade = 'A';
  else if (abs <= 5) grade = 'A-';
  else if (abs <= 8) grade = 'B';
  else if (abs <= 12) grade = 'B-';
  else if (abs <= 18) grade = 'C';
  else grade = 'D';

  let points: number;
  if (abs <= 2) points = 100 - 4 * (abs / 2);
  else if (abs <= 5) points = 96 - 6 * ((abs - 2) / 3);
  else if (abs <= 8) points = 90 - 5 * ((abs - 5) / 3);
  else if (abs <= 12) points = 85 - 8 * ((abs - 8) / 4);
  else if (abs <= 18) points = 77 - 12 * ((abs - 12) / 6);
  else if (abs <= 50) points = 65 - 15 * ((abs - 18) / 32);
  else if (abs <= 100) points = 50 - 50 * ((abs - 50) / 50);
  else points = 0;

  return { grade, points: Math.max(0, Math.round(points)) };
}

const GRADE_LETTERS: Grade[] = ['A', 'A-', 'B', 'B-', 'C', 'D'];

function emptyDistribution(): GradeDistribution {
  return { A: 0, 'A-': 0, B: 0, 'B-': 0, C: 0, D: 0 };
}

/** Pick a representative grade for a points-derived average. */
function gradeForPoints(points: number): Grade {
  if (points >= 96) return 'A';
  if (points >= 90) return 'A-';
  if (points >= 85) return 'B';
  if (points >= 77) return 'B-';
  if (points >= 65) return 'C';
  return 'D';
}

type RolledRow = {
  id: string;
  isShared: boolean;
  scopeId: string; // project_id or department_id
  planKes: number;
  actualKes: number;
};

/**
 * Roll expense_variances rows for a single month into one entry per
 * (scope, scopeId), summing across category splits.
 */
function rollByScope(rows: ExpenseVarianceRow[]): Map<string, RolledRow> {
  const out = new Map<string, RolledRow>();
  for (const r of rows) {
    let key: string;
    let scopeId: string;
    let isShared: boolean;
    if (r.project_id) {
      key = `proj:${r.project_id}`;
      scopeId = r.project_id;
      isShared = false;
    } else if (r.department_id) {
      key = `dept:${r.department_id}`;
      scopeId = r.department_id;
      isShared = true;
    } else {
      continue;
    }
    const existing = out.get(key) ?? {
      id: key,
      isShared,
      scopeId,
      planKes: 0,
      actualKes: 0,
    };
    existing.planKes += Number(r.budgeted_total_kes ?? 0);
    existing.actualKes += Number(r.actual_total_kes ?? 0);
    out.set(key, existing);
  }
  return out;
}

function variancePctOf(planKes: number, actualKes: number): number {
  if (planKes <= 0) return 0;
  return ((actualKes - planKes) / planKes) * 100;
}

// ---------- hook ----------

export function useBudgetAccuracy(yearMonth: string) {
  const [summary, setSummary] = useState<BudgetAccuracySummary>(() => ({
    monthLabel: shortMonth(yearMonth),
    portfolioAccuracyPct: 0,
    portfolioGrade: 'A',
    portfolioPoints: 0,
    mostAccurate: null,
    largestMiss: null,
    streakMonths: 0,
    budgetCount: 0,
  }));
  const [projects, setProjects] = useState<BudgetAccuracyRow[]>([]);
  const [ownerScorecard, setOwnerScorecard] = useState<OwnerScorecardRow[]>([]);
  const [gradeHistory, setGradeHistory] = useState<GradeHistoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const supabase = createClient();
    const window12 = lookbackMonths(yearMonth, HISTORY_MONTHS);
    const window6 = lookbackMonths(yearMonth, SCORECARD_MONTHS);

    try {
      const [
        variancesRes,
        budgetsRes,
        projectsRes,
        departmentsRes,
        usersRes,
      ] = await Promise.all([
        supabase
          .from('expense_variances')
          .select(
            'year_month, project_id, department_id, category, budgeted_total_kes, actual_total_kes',
          )
          .in('year_month', window12),
        supabase
          .from('budgets')
          .select('project_id, department_id, year_month, created_by')
          .in('year_month', window12),
        supabase
          .from('projects')
          .select('id, name, director_user_id'),
        supabase
          .from('departments')
          .select('id, name, owner_user_id'),
        supabase
          .from('users')
          .select('id, full_name'),
      ]);

      const variances = (variancesRes.data ?? []) as ExpenseVarianceRow[];
      const budgets = (budgetsRes.data ?? []) as BudgetRow[];
      const projectsList = (projectsRes.data ?? []) as Array<{
        id: string;
        name: string | null;
        director_user_id: string | null;
      }>;
      const departmentsList = (departmentsRes.data ?? []) as Array<{
        id: string;
        name: string | null;
        owner_user_id: string | null;
      }>;
      const usersList = (usersRes.data ?? []) as Array<{
        id: string;
        full_name: string | null;
      }>;

      // ---- name + owner resolvers ----
      const projectNameById = new Map<string, string>();
      const projectDirectorById = new Map<string, string>();
      for (const p of projectsList) {
        if (!p.id) continue;
        projectNameById.set(p.id, p.name ?? 'Unnamed project');
        if (p.director_user_id) projectDirectorById.set(p.id, p.director_user_id);
      }
      const departmentNameById = new Map<string, string>();
      const departmentOwnerById = new Map<string, string>();
      for (const d of departmentsList) {
        if (!d.id) continue;
        departmentNameById.set(d.id, d.name ?? 'Unnamed department');
        if (d.owner_user_id) departmentOwnerById.set(d.id, d.owner_user_id);
      }
      const userNameById = new Map<string, string>();
      for (const u of usersList) {
        if (u.id) userNameById.set(u.id, u.full_name ?? 'Unknown owner');
      }

      // budget owner index: key = `${scope}:${scopeId}:${year_month}`.
      const budgetOwnerByKey = new Map<string, string>();
      for (const b of budgets) {
        if (!b.created_by) continue;
        if (b.project_id) {
          budgetOwnerByKey.set(
            `proj:${b.project_id}:${b.year_month}`,
            b.created_by,
          );
        } else if (b.department_id) {
          budgetOwnerByKey.set(
            `dept:${b.department_id}:${b.year_month}`,
            b.created_by,
          );
        }
      }

      const resolveOwnerId = (
        rowId: string,
        scopeId: string,
        isShared: boolean,
        ym: string,
      ): string | null => {
        const explicit = budgetOwnerByKey.get(`${rowId.split(':')[0]}:${scopeId}:${ym}`);
        if (explicit) return explicit;
        if (isShared) return departmentOwnerById.get(scopeId) ?? null;
        return projectDirectorById.get(scopeId) ?? null;
      };

      const resolveScopeName = (
        scopeId: string,
        isShared: boolean,
      ): string => {
        if (isShared) return departmentNameById.get(scopeId) ?? 'Shared';
        return projectNameById.get(scopeId) ?? 'Unattributed';
      };

      // ---- bucket variances by month ----
      const variancesByMonth = new Map<string, ExpenseVarianceRow[]>();
      for (const v of variances) {
        const list = variancesByMonth.get(v.year_month) ?? [];
        list.push(v);
        variancesByMonth.set(v.year_month, list);
      }

      // ---- per-month rolled rows + grade per scope ----
      type ScopeMonthEntry = {
        rolled: RolledRow;
        variancePct: number;
        grade: Grade;
        points: number;
      };
      const monthRolls = new Map<string, Map<string, ScopeMonthEntry>>();
      for (const m of window12) {
        const rolled = rollByScope(variancesByMonth.get(m) ?? []);
        const entry = new Map<string, ScopeMonthEntry>();
        for (const [k, r] of rolled) {
          const variancePct = variancePctOf(r.planKes, r.actualKes);
          const { grade, points } = gradeFor(variancePct);
          entry.set(k, { rolled: r, variancePct, grade, points });
        }
        monthRolls.set(m, entry);
      }

      // ---- streaks per scope (consecutive months ending at yearMonth
      //      with |variancePct| ≤ STREAK_TOLERANCE_PCT) ----
      const allScopeKeys = new Set<string>();
      for (const m of window12) {
        const entry = monthRolls.get(m);
        if (!entry) continue;
        for (const k of entry.keys()) allScopeKeys.add(k);
      }
      const streakByScope = new Map<string, number>();
      for (const k of allScopeKeys) {
        let streak = 0;
        for (let i = window12.length - 1; i >= 0; i--) {
          const e = monthRolls.get(window12[i])?.get(k);
          if (!e) break;
          if (Math.abs(e.variancePct) <= STREAK_TOLERANCE_PCT) streak += 1;
          else break;
        }
        streakByScope.set(k, streak);
      }

      // ---- requested-month per-budget rows (sorted best first) ----
      const currentEntry = monthRolls.get(yearMonth) ?? new Map();
      const projectRowsUnsorted: BudgetAccuracyRow[] = [];
      for (const [k, e] of currentEntry) {
        const ownerId = resolveOwnerId(k, e.rolled.scopeId, e.rolled.isShared, yearMonth);
        const ownerName = ownerId
          ? userNameById.get(ownerId) ?? 'Unknown owner'
          : 'Unassigned';
        projectRowsUnsorted.push({
          id: k,
          name: resolveScopeName(e.rolled.scopeId, e.rolled.isShared),
          ownerId,
          ownerName,
          planKes: e.rolled.planKes,
          actualKes: e.rolled.actualKes,
          varianceKes: e.rolled.actualKes - e.rolled.planKes,
          variancePct: e.variancePct,
          grade: e.grade,
          gradePoints: e.points,
          streakMonths: streakByScope.get(k) ?? 0,
          isShared: e.rolled.isShared,
        });
      }
      const projectRows = projectRowsUnsorted
        .slice()
        .sort((a, b) => Math.abs(a.variancePct) - Math.abs(b.variancePct));

      // ---- portfolio (current month) ----
      const totalPlan = projectRows.reduce((s, r) => s + r.planKes, 0);
      const weightedAbsVariancePct =
        totalPlan > 0
          ? projectRows.reduce(
              (s, r) => s + Math.abs(r.variancePct) * (r.planKes / totalPlan),
              0,
            )
          : 0;
      const portfolioAccuracyPct = Math.max(0, 100 - weightedAbsVariancePct);
      const portfolioGradeInfo = gradeFor(weightedAbsVariancePct);

      // Portfolio streak: consecutive months (ending at yearMonth) where
      // weighted abs variance ≤ STREAK_TOLERANCE_PCT.
      let portfolioStreak = 0;
      for (let i = window12.length - 1; i >= 0; i--) {
        const entry = monthRolls.get(window12[i]);
        if (!entry || entry.size === 0) break;
        const tot = Array.from(entry.values()).reduce((s, e) => s + e.rolled.planKes, 0);
        if (tot <= 0) break;
        const wAbs = Array.from(entry.values()).reduce(
          (s, e) => s + Math.abs(e.variancePct) * (e.rolled.planKes / tot),
          0,
        );
        if (wAbs <= STREAK_TOLERANCE_PCT) portfolioStreak += 1;
        else break;
      }

      // ---- summary KPIs ----
      const sortedByAbs = projectRows.slice();
      const mostAccurate =
        sortedByAbs.length > 0
          ? {
              name: sortedByAbs[0].name,
              variancePct: sortedByAbs[0].variancePct,
              grade: sortedByAbs[0].grade,
            }
          : null;
      const largestMiss =
        sortedByAbs.length > 0
          ? {
              name: sortedByAbs[sortedByAbs.length - 1].name,
              variancePct: sortedByAbs[sortedByAbs.length - 1].variancePct,
              grade: sortedByAbs[sortedByAbs.length - 1].grade,
            }
          : null;

      const newSummary: BudgetAccuracySummary = {
        monthLabel: shortMonth(yearMonth),
        portfolioAccuracyPct,
        portfolioGrade: portfolioGradeInfo.grade,
        portfolioPoints: portfolioGradeInfo.points,
        mostAccurate,
        largestMiss,
        streakMonths: portfolioStreak,
        budgetCount: projectRows.length,
      };

      // ---- owner scorecard (6-month) ----
      // For each owner, collect their grade per month (averaged across
      // any scopes they own when more than one).
      type OwnerMonthAgg = {
        scopes: Set<string>;
        sumPoints: number;
        count: number;
      };
      const ownerByMonth = new Map<string, Map<string, OwnerMonthAgg>>();
      for (const m of window6) {
        const entry = monthRolls.get(m);
        if (!entry) continue;
        const ownerMap = new Map<string, OwnerMonthAgg>();
        for (const [k, e] of entry) {
          const ownerId = resolveOwnerId(k, e.rolled.scopeId, e.rolled.isShared, m);
          if (!ownerId) continue;
          const agg = ownerMap.get(ownerId) ?? {
            scopes: new Set<string>(),
            sumPoints: 0,
            count: 0,
          };
          agg.scopes.add(resolveScopeName(e.rolled.scopeId, e.rolled.isShared));
          agg.sumPoints += e.points;
          agg.count += 1;
          ownerMap.set(ownerId, agg);
        }
        ownerByMonth.set(m, ownerMap);
      }
      const allOwnerIds = new Set<string>();
      const scopesByOwner = new Map<string, Set<string>>();
      for (const ownerMap of ownerByMonth.values()) {
        for (const [oid, agg] of ownerMap) {
          allOwnerIds.add(oid);
          const acc = scopesByOwner.get(oid) ?? new Set<string>();
          for (const s of agg.scopes) acc.add(s);
          scopesByOwner.set(oid, acc);
        }
      }
      const ownerScorecardRows: OwnerScorecardRow[] = Array.from(
        allOwnerIds,
      ).map((ownerId) => {
        const monthlyGrades: OwnerMonthlyGrade[] = window6.map((m) => {
          const agg = ownerByMonth.get(m)?.get(ownerId);
          if (!agg || agg.count === 0) {
            return { month: m, label: shortMonthLabel(m), grade: null, points: null };
          }
          const avgPts = agg.sumPoints / agg.count;
          return {
            month: m,
            label: shortMonthLabel(m),
            grade: gradeForPoints(avgPts),
            points: Math.round(avgPts),
          };
        });
        const present = monthlyGrades.filter((g) => g.points !== null);
        const averagePoints =
          present.length > 0
            ? Math.round(
                present.reduce((s, g) => s + (g.points ?? 0), 0) / present.length,
              )
            : 0;
        return {
          ownerId,
          ownerName: userNameById.get(ownerId) ?? 'Unknown owner',
          scope: Array.from(scopesByOwner.get(ownerId) ?? []).join(' · '),
          monthlyGrades,
          averageGrade: gradeForPoints(averagePoints),
          averagePoints,
        };
      });
      // Best owners first.
      ownerScorecardRows.sort((a, b) => b.averagePoints - a.averagePoints);

      // ---- 12-month grade history ----
      const gradeHistoryRows: GradeHistoryRow[] = window12.map((m) => {
        const entry = monthRolls.get(m);
        const distribution = emptyDistribution();
        if (!entry || entry.size === 0) {
          return {
            month: m,
            label: shortMonthLabel(m),
            portfolioGrade: 'D',
            portfolioPoints: 0,
            portfolioAccuracyPct: 0,
            gradeDistribution: distribution,
          };
        }
        for (const e of entry.values()) {
          distribution[e.grade] += 1;
        }
        const tot = Array.from(entry.values()).reduce(
          (s, e) => s + e.rolled.planKes,
          0,
        );
        const wAbs =
          tot > 0
            ? Array.from(entry.values()).reduce(
                (s, e) =>
                  s + Math.abs(e.variancePct) * (e.rolled.planKes / tot),
                0,
              )
            : 0;
        const portfolio = gradeFor(wAbs);
        return {
          month: m,
          label: shortMonthLabel(m),
          portfolioGrade: portfolio.grade,
          portfolioPoints: portfolio.points,
          portfolioAccuracyPct: Math.max(0, 100 - wAbs),
          gradeDistribution: distribution,
        };
      });

      setSummary(newSummary);
      setProjects(projectRows);
      setOwnerScorecard(ownerScorecardRows);
      setGradeHistory(gradeHistoryRows);
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
    projects,
    ownerScorecard,
    gradeHistory,
    monthLabel: summary.monthLabel,
    loading,
    error,
    refresh: load,
    GRADE_LETTERS,
  };
}
