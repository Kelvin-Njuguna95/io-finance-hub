'use client';

import { useCallback, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useUser } from '@/hooks/use-user';

// Stage 4 of 5 (PRED-4). Reads both predated_payouts (70% project
// share) and predated_company_share_distributions (30% company pool)
// from migration 00056, resolves user names + project names, and
// returns a single sorted list with a `type` discriminator.
//
// Role-gated to cfo/accountant. Other roles get an empty list without
// triggering the fetch — predated history may carry sensitive amounts.

export type PredatedPayoutType = 'project_share' | 'company_pool';

export type PredatedPayoutRow = {
  id: string;
  type: PredatedPayoutType;
  director_user_id: string;
  director_name: string;
  project_id: string | null;
  project_name: string | null;
  project_is_active: boolean | null;
  year_month: string;
  amount_kes: number;
  payment_method: string;
  notes: string | null;
  recorded_at: string;
  recorded_by: string;
  recorded_by_name: string;
};

type ProjectShareRow = {
  id: string;
  director_user_id: string;
  project_id: string;
  year_month: string;
  amount_kes: number | string;
  payment_method: string;
  notes: string | null;
  recorded_at: string;
  recorded_by: string;
  projects?: { name: string | null; is_active: boolean | null } | null;
};

type CompanyPoolRow = {
  id: string;
  director_user_id: string;
  year_month: string;
  amount_kes: number | string;
  payment_method: string;
  notes: string | null;
  recorded_at: string;
  recorded_by: string;
};

export function usePredatedPayouts() {
  const { user } = useUser();
  const role = user?.role;
  const allowed = role === 'cfo' || role === 'accountant';

  const [rows, setRows] = useState<PredatedPayoutRow[]>([]);
  const [loading, setLoading] = useState<boolean>(allowed);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!allowed) {
      setRows([]);
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const supabase = createClient();
      // Wave 1: fetch both parent tables in parallel. The 70% table
      // joins through to projects via its FK; the 30% table has no
      // project relationship.
      // PRED-8: hide soft-deleted rows. Migration 00058 added
      // deleted_at; the partial active-rows index makes this filter
      // cheap. Restoring a row is a service-role-SQL action — no UI
      // surface for it.
      const [projectShareRes, companyPoolRes] = await Promise.all([
        supabase
          .from('predated_payouts')
          .select(
            'id, director_user_id, project_id, year_month, amount_kes, payment_method, notes, recorded_at, recorded_by, projects(name, is_active)',
          )
          .is('deleted_at', null),
        supabase
          .from('predated_company_share_distributions')
          .select(
            'id, director_user_id, year_month, amount_kes, payment_method, notes, recorded_at, recorded_by',
          )
          .is('deleted_at', null),
      ]);

      if (projectShareRes.error) throw new Error(projectShareRes.error.message);
      if (companyPoolRes.error) throw new Error(companyPoolRes.error.message);

      const projectShareData = (projectShareRes.data ?? []) as ProjectShareRow[];
      const companyPoolData = (companyPoolRes.data ?? []) as CompanyPoolRow[];

      // Wave 2: resolve director_user_id and recorded_by names. Both
      // FK to users(id) and a single users-by-id fetch covers both.
      const userIds = new Set<string>();
      for (const r of projectShareData) {
        userIds.add(r.director_user_id);
        userIds.add(r.recorded_by);
      }
      for (const r of companyPoolData) {
        userIds.add(r.director_user_id);
        userIds.add(r.recorded_by);
      }
      const userMap = new Map<string, string>();
      if (userIds.size > 0) {
        const { data: usersData, error: usersErr } = await supabase
          .from('users')
          .select('id, full_name')
          .in('id', Array.from(userIds));
        if (usersErr) throw new Error(usersErr.message);
        for (const u of usersData ?? []) {
          if (u.id) userMap.set(u.id, u.full_name ?? 'Unknown');
        }
      }

      const projectShareRows: PredatedPayoutRow[] = projectShareData.map((r) => ({
        id: r.id,
        type: 'project_share',
        director_user_id: r.director_user_id,
        director_name: userMap.get(r.director_user_id) ?? 'Unknown',
        project_id: r.project_id,
        project_name: r.projects?.name ?? null,
        project_is_active: r.projects?.is_active ?? null,
        year_month: r.year_month,
        amount_kes: Number(r.amount_kes),
        payment_method: r.payment_method,
        notes: r.notes,
        recorded_at: r.recorded_at,
        recorded_by: r.recorded_by,
        recorded_by_name: userMap.get(r.recorded_by) ?? 'Unknown',
      }));

      const companyPoolRows: PredatedPayoutRow[] = companyPoolData.map((r) => ({
        id: r.id,
        type: 'company_pool',
        director_user_id: r.director_user_id,
        director_name: userMap.get(r.director_user_id) ?? 'Unknown',
        project_id: null,
        project_name: null,
        project_is_active: null,
        year_month: r.year_month,
        amount_kes: Number(r.amount_kes),
        payment_method: r.payment_method,
        notes: r.notes,
        recorded_at: r.recorded_at,
        recorded_by: r.recorded_by,
        recorded_by_name: userMap.get(r.recorded_by) ?? 'Unknown',
      }));

      const combined = [...projectShareRows, ...companyPoolRows].sort((a, b) => {
        if (a.year_month !== b.year_month) {
          return b.year_month.localeCompare(a.year_month);
        }
        return b.recorded_at.localeCompare(a.recorded_at);
      });

      setRows(combined);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load predated payouts');
    } finally {
      setLoading(false);
    }
  }, [allowed]);

  useEffect(() => {
    void load();
  }, [load]);

  return { rows, loading, error, refresh: load };
}
