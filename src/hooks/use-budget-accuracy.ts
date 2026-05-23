'use client';

import { useCallback, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { EXPENSE_STATUS } from '@/lib/constants/status';

/**
 * Read-side composer for the Budget Accuracy report.
 *
 * F-19 pattern (mirrors /reports/pnl, just shipped):
 *   - CLOSED months  → read the materialised `expense_variances` table
 *     (plan = budgeted_total_kes, actual = actual_total_kes).
 *   - OPEN / unclosed months → compute FRESH per (scope, month) from
 *     primary data:
 *       plan   = Σ approved budget (active version's total_amount_kes)
 *                for that project/department + month
 *       actual = Σ confirmed expenses (lifecycle_status='confirmed')
 *                — by project_id for projects, by budget_id→department
 *                for shared/department budgets (expenses carry no
 *                department_id).
 *   `expense_variances` is only ever populated by an on-demand recompute
 *   that aggregates `pending_expenses`; it is empty until that runs, so
 *   fresh figures can differ a few % from a later recompute. Fresh rows
 *   are surfaced as "Live · open month" to convey they are unsigned.
 *
 *   A scope with confirmed expenses but NO approved budget legitimately
 *   has no accuracy grade (plan=0): shown as a "No approved budget" row,
 *   excluded from grading / portfolio / most-accurate / largest-miss.
 *
 *   Open vs closed is decided by `month_closures` (closed/locked) AND the
 *   presence of expense_variances rows; otherwise the month is fresh.
 *
 * Owner resolution: `budgets.created_by` matched on
 * `(project_id|department_id, year_month)` → `users.full_name`, falling
 * back to `projects.director_user_id` / `departments.owner_user_id`.
 * Names resolved via direct table queries → Map<id, name> (never embed).
 *
 * Grades client-side. Bands:
 *   A ≤±2%   A− ≤±5%   B ≤±8%   B− ≤±12%   C ≤±18%   D >±18%
 */

const NAIROBI_TZ = 'Africa/Nairobi';
const SCORECARD_MONTHS = 6;
const HISTORY_MONTHS = 12;
const STREAK_TOLERANCE_PCT = 8; // |variancePct| ≤ 8 (B or better)

export type Grade = 'A' | 'A-' | 'B' | 'B-' | 'C' | 'D';
export type AccuracySource = 'snapshot' | 'fresh';

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
  /** Where this row's figures came from. */
  source: AccuracySource;
  /** False when no approved budget exists (plan=0) — cannot be graded. */
  hasPlan: boolean;
  /** Set when fresh computation failed for this scope; row renders inline. */
  error: string | null;
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
  /** Total rows shown for the month (graded + no-budget). */
  budgetCount: number;
  /** Gradeable rows (have an approved budget) for the current month. */
  measuredCount: number;
  /** Scopes with an approved budget for the current month. */
  approvedBudgetCount: number;
  /** Any confirmed-expense actual present for the current month. */
  hasConfirmedExpenses: boolean;
  /** True when the current month is computed live (open, no snapshot). */
  isLive: boolean;
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

type ClosureRow = {
  year_month: string;
  status: 'open' | 'under_review' | 'closed' | 'locked';
};

type BudgetRow = {
  id: string;
  project_id: string | null;
  department_id: string | null;
  year_month: string;
  created_by: string;
  current_version: number;
};

type BudgetVersionRow = {
  budget_id: string;
  version_number: number;
  status: 'draft' | 'submitted' | 'under_review' | 'approved' | 'rejected';
  total_amount_kes: number | string | null;
};

type ConfirmedExpenseRow = {
  project_id: string | null;
  budget_id: string | null;
  amount_kes: number | string | null;
  year_month: string;
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
  source: AccuracySource;
  hasPlan: boolean;
};

/**
 * Roll expense_variances rows for a single (closed) month into one entry
 * per (scope, scopeId), summing across category splits.
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
      source: 'snapshot' as const,
      hasPlan: false,
    };
    existing.planKes += Number(r.budgeted_total_kes ?? 0);
    existing.actualKes += Number(r.actual_total_kes ?? 0);
    existing.hasPlan = existing.planKes > 0;
    out.set(key, existing);
  }
  return out;
}

/**
 * Build one rolled row per scope for an OPEN month from the pre-grouped
 * plan (approved budgets) and actual (confirmed expenses) maps.
 */
function buildFreshRoll(
  planByScope: Map<string, number>,
  actualByScope: Map<string, number>,
): Map<string, RolledRow> {
  const out = new Map<string, RolledRow>();
  const keys = new Set<string>([
    ...planByScope.keys(),
    ...actualByScope.keys(),
  ]);
  for (const key of keys) {
    const isShared = key.startsWith('dept:');
    const scopeId = key.slice(key.indexOf(':') + 1);
    const planKes = planByScope.get(key) ?? 0;
    const actualKes = actualByScope.get(key) ?? 0;
    if (!Number.isFinite(planKes) || !Number.isFinite(actualKes)) {
      throw new Error('Non-numeric plan/actual in fresh computation');
    }
    out.set(key, {
      id: key,
      isShared,
      scopeId,
      planKes,
      actualKes,
      source: 'fresh',
      hasPlan: planKes > 0,
    });
  }
  return out;
}

function variancePctOf(planKes: number, actualKes: number): number {
  if (planKes <= 0) return 0;
  return ((actualKes - planKes) / planKes) * 100;
}

function addToMonthScope(
  map: Map<string, Map<string, number>>,
  month: string,
  key: string,
  amount: number,
): void {
  const inner = map.get(month) ?? new Map<string, number>();
  inner.set(key, (inner.get(key) ?? 0) + amount);
  map.set(month, inner);
}

type ScopeMonthEntry = {
  rolled: RolledRow;
  variancePct: number;
  grade: Grade;
  points: number;
};

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
    measuredCount: 0,
    approvedBudgetCount: 0,
    hasConfirmedExpenses: false,
    isLive: true,
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
        closuresRes,
        budgetsRes,
        budgetVersionsRes,
        expensesRes,
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
          .from('month_closures')
          .select('year_month, status')
          .in('year_month', window12),
        supabase
          .from('budgets')
          .select(
            'id, project_id, department_id, year_month, created_by, current_version',
          )
          .in('year_month', window12),
        // Active version per budget is matched via current_version below;
        // status='approved' on that version → the budget's plan.
        supabase
          .from('budget_versions')
          .select('budget_id, version_number, status, total_amount_kes'),
        // Actuals: confirmed expenses only (AGENTS.md rule #2).
        supabase
          .from('expenses')
          .select('project_id, budget_id, amount_kes, year_month')
          .eq('lifecycle_status', EXPENSE_STATUS.CONFIRMED)
          .in('year_month', window12),
        supabase.from('projects').select('id, name, director_user_id'),
        supabase.from('departments').select('id, name, owner_user_id'),
        supabase.from('users').select('id, full_name'),
      ]);

      const firstError =
        variancesRes.error ??
        closuresRes.error ??
        budgetsRes.error ??
        budgetVersionsRes.error ??
        expensesRes.error ??
        projectsRes.error ??
        departmentsRes.error ??
        usersRes.error;
      if (firstError) throw firstError;

      const variances = (variancesRes.data ?? []) as ExpenseVarianceRow[];
      const closures = (closuresRes.data ?? []) as ClosureRow[];
      const budgets = (budgetsRes.data ?? []) as BudgetRow[];
      const budgetVersions = (budgetVersionsRes.data ?? []) as BudgetVersionRow[];
      const expenses = (expensesRes.data ?? []) as ConfirmedExpenseRow[];
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

      const closureByMonth = new Map<string, ClosureRow>();
      for (const c of closures) closureByMonth.set(c.year_month, c);

      // budget owner index + scope/year_month + active-version plan.
      const budgetOwnerByKey = new Map<string, string>();
      const budgetById = new Map<
        string,
        { project_id: string | null; department_id: string | null }
      >();
      for (const b of budgets) {
        budgetById.set(b.id, {
          project_id: b.project_id,
          department_id: b.department_id,
        });
        if (!b.created_by) continue;
        if (b.project_id) {
          budgetOwnerByKey.set(`proj:${b.project_id}:${b.year_month}`, b.created_by);
        } else if (b.department_id) {
          budgetOwnerByKey.set(`dept:${b.department_id}:${b.year_month}`, b.created_by);
        }
      }

      // Active version per budget → approved plan total.
      const versionByKey = new Map<string, BudgetVersionRow>();
      for (const v of budgetVersions) {
        versionByKey.set(`${v.budget_id}:${v.version_number}`, v);
      }
      const approvedTotalByBudgetId = new Map<string, number>();
      for (const b of budgets) {
        const v = versionByKey.get(`${b.id}:${b.current_version}`);
        if (v && v.status === 'approved') {
          approvedTotalByBudgetId.set(b.id, Number(v.total_amount_kes ?? 0));
        }
      }

      // ---- fresh-compute inputs grouped by (month, scope) ----
      const planByMonthScope = new Map<string, Map<string, number>>();
      for (const b of budgets) {
        const total = approvedTotalByBudgetId.get(b.id);
        if (total == null) continue; // no approved active version
        const key = b.project_id
          ? `proj:${b.project_id}`
          : b.department_id
            ? `dept:${b.department_id}`
            : null;
        if (!key) continue;
        addToMonthScope(planByMonthScope, b.year_month, key, total);
      }

      const actualByMonthScope = new Map<string, Map<string, number>>();
      for (const e of expenses) {
        const amt = Number(e.amount_kes ?? 0);
        if (!Number.isFinite(amt)) continue;
        let key: string | null = null;
        if (e.project_id) {
          key = `proj:${e.project_id}`;
        } else if (e.budget_id) {
          const b = budgetById.get(e.budget_id);
          if (b?.department_id) key = `dept:${b.department_id}`;
        }
        if (!key) continue;
        addToMonthScope(actualByMonthScope, e.year_month, key, amt);
      }

      // ---- bucket closed-month variances by month ----
      const variancesByMonth = new Map<string, ExpenseVarianceRow[]>();
      for (const v of variances) {
        const list = variancesByMonth.get(v.year_month) ?? [];
        list.push(v);
        variancesByMonth.set(v.year_month, list);
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

      const resolveScopeName = (scopeId: string, isShared: boolean): string => {
        if (isShared) return departmentNameById.get(scopeId) ?? 'Shared';
        return projectNameById.get(scopeId) ?? 'Unattributed';
      };

      // ---- per-month rolled rows (snapshot if closed+materialised, else
      //      fresh) + grade per scope ----
      const isMonthClosed = (m: string): boolean => {
        const c = closureByMonth.get(m);
        return c?.status === 'closed' || c?.status === 'locked';
      };
      const sourceForMonth = (m: string): AccuracySource =>
        isMonthClosed(m) && (variancesByMonth.get(m)?.length ?? 0) > 0
          ? 'snapshot'
          : 'fresh';

      const monthRolls = new Map<string, Map<string, ScopeMonthEntry>>();
      for (const m of window12) {
        let rolled: Map<string, RolledRow>;
        if (sourceForMonth(m) === 'snapshot') {
          rolled = rollByScope(variancesByMonth.get(m) ?? []);
        } else {
          rolled = buildFreshRoll(
            planByMonthScope.get(m) ?? new Map(),
            actualByMonthScope.get(m) ?? new Map(),
          );
        }
        const entry = new Map<string, ScopeMonthEntry>();
        for (const [k, r] of rolled) {
          const variancePct = variancePctOf(r.planKes, r.actualKes);
          const { grade, points } = gradeFor(variancePct);
          entry.set(k, { rolled: r, variancePct, grade, points });
        }
        monthRolls.set(m, entry);
      }

      // ---- streaks per scope (consecutive months ending at yearMonth
      //      with a plan AND |variancePct| ≤ STREAK_TOLERANCE_PCT) ----
      const allScopeKeys = new Set<string>();
      for (const m of window12) {
        for (const k of monthRolls.get(m)?.keys() ?? []) allScopeKeys.add(k);
      }
      const streakByScope = new Map<string, number>();
      for (const k of allScopeKeys) {
        let streak = 0;
        for (let i = window12.length - 1; i >= 0; i--) {
          const e = monthRolls.get(window12[i])?.get(k);
          if (!e || !e.rolled.hasPlan) break;
          if (Math.abs(e.variancePct) <= STREAK_TOLERANCE_PCT) streak += 1;
          else break;
        }
        streakByScope.set(k, streak);
      }

      // ---- requested-month per-scope rows ----
      const currentEntry = monthRolls.get(yearMonth) ?? new Map<string, ScopeMonthEntry>();
      const currentSource = sourceForMonth(yearMonth);
      const projectRowsUnsorted: BudgetAccuracyRow[] = [];
      for (const [k, e] of currentEntry) {
        let row: BudgetAccuracyRow;
        try {
          const ownerId = resolveOwnerId(k, e.rolled.scopeId, e.rolled.isShared, yearMonth);
          const ownerName = ownerId
            ? userNameById.get(ownerId) ?? 'Unknown owner'
            : 'Unassigned';
          row = {
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
            source: e.rolled.source,
            hasPlan: e.rolled.hasPlan,
            error: null,
          };
        } catch (err) {
          row = {
            id: k,
            name: resolveScopeName(e.rolled.scopeId, e.rolled.isShared),
            ownerId: null,
            ownerName: 'Unassigned',
            planKes: 0,
            actualKes: 0,
            varianceKes: 0,
            variancePct: 0,
            grade: 'D',
            gradePoints: 0,
            streakMonths: 0,
            isShared: e.rolled.isShared,
            source: e.rolled.source,
            hasPlan: false,
            error: err instanceof Error ? err.message : 'Computation failed',
          };
        }
        projectRowsUnsorted.push(row);
      }
      // Graded rows (have an approved budget) first, sorted by |variance|;
      // no-budget rows appended, largest actual spend first.
      const projectRows = projectRowsUnsorted.slice().sort((a, b) => {
        if (a.hasPlan !== b.hasPlan) return a.hasPlan ? -1 : 1;
        if (a.hasPlan) return Math.abs(a.variancePct) - Math.abs(b.variancePct);
        return b.actualKes - a.actualKes;
      });
      const gradedRows = projectRows.filter((r) => r.hasPlan && !r.error);

      // ---- portfolio (current month, graded rows only) ----
      const totalPlan = gradedRows.reduce((s, r) => s + r.planKes, 0);
      const weightedAbsVariancePct =
        totalPlan > 0
          ? gradedRows.reduce(
              (s, r) => s + Math.abs(r.variancePct) * (r.planKes / totalPlan),
              0,
            )
          : 0;
      const portfolioAccuracyPct = Math.max(0, 100 - weightedAbsVariancePct);
      const portfolioGradeInfo = gradeFor(weightedAbsVariancePct);

      // Portfolio streak: consecutive months (ending at yearMonth) where
      // weighted abs variance over graded scopes ≤ STREAK_TOLERANCE_PCT.
      let portfolioStreak = 0;
      for (let i = window12.length - 1; i >= 0; i--) {
        const entry = monthRolls.get(window12[i]);
        if (!entry || entry.size === 0) break;
        const graded = Array.from(entry.values()).filter((e) => e.rolled.hasPlan);
        const tot = graded.reduce((s, e) => s + e.rolled.planKes, 0);
        if (tot <= 0) break;
        const wAbs = graded.reduce(
          (s, e) => s + Math.abs(e.variancePct) * (e.rolled.planKes / tot),
          0,
        );
        if (wAbs <= STREAK_TOLERANCE_PCT) portfolioStreak += 1;
        else break;
      }

      // ---- summary KPIs ----
      const mostAccurate =
        gradedRows.length > 0
          ? {
              name: gradedRows[0].name,
              variancePct: gradedRows[0].variancePct,
              grade: gradedRows[0].grade,
            }
          : null;
      const largestMiss =
        gradedRows.length > 0
          ? {
              name: gradedRows[gradedRows.length - 1].name,
              variancePct: gradedRows[gradedRows.length - 1].variancePct,
              grade: gradedRows[gradedRows.length - 1].grade,
            }
          : null;

      const approvedBudgetCount = gradedRows.length;
      const hasConfirmedExpenses = projectRows.some((r) => r.actualKes > 0);

      const newSummary: BudgetAccuracySummary = {
        monthLabel: shortMonth(yearMonth),
        portfolioAccuracyPct,
        portfolioGrade: portfolioGradeInfo.grade,
        portfolioPoints: portfolioGradeInfo.points,
        mostAccurate,
        largestMiss,
        streakMonths: portfolioStreak,
        budgetCount: projectRows.length,
        measuredCount: gradedRows.length,
        approvedBudgetCount,
        hasConfirmedExpenses,
        isLive: currentSource === 'fresh',
      };

      // ---- owner scorecard (6-month, graded scopes only) ----
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
          if (!e.rolled.hasPlan) continue;
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
      ownerScorecardRows.sort((a, b) => b.averagePoints - a.averagePoints);

      // ---- 12-month grade history (graded scopes only) ----
      const gradeHistoryRows: GradeHistoryRow[] = window12.map((m) => {
        const entry = monthRolls.get(m);
        const distribution = emptyDistribution();
        const graded = entry
          ? Array.from(entry.values()).filter((e) => e.rolled.hasPlan)
          : [];
        if (graded.length === 0) {
          return {
            month: m,
            label: shortMonthLabel(m),
            portfolioGrade: 'D',
            portfolioPoints: 0,
            portfolioAccuracyPct: 0,
            gradeDistribution: distribution,
          };
        }
        for (const e of graded) distribution[e.grade] += 1;
        const tot = graded.reduce((s, e) => s + e.rolled.planKes, 0);
        const wAbs =
          tot > 0
            ? graded.reduce(
                (s, e) => s + Math.abs(e.variancePct) * (e.rolled.planKes / tot),
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
