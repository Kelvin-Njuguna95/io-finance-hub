import { NextResponse } from 'next/server';
import { getAuthUserProfile } from '@/lib/supabase/admin';
import { apiErrorResponse } from '@/lib/api-errors';

export async function POST(request: Request) {
  try {
    const auth = await getAuthUserProfile(request);
    if ('error' in auth) {
      return NextResponse.json(
        { error: auth.error.message, code: 'AUTH_ERROR' },
        { status: auth.error.status },
      );
    }
    const { user, profile, admin } = auth;

    const body = await request.json();
    const { budget_id } = body;
    if (!budget_id) {
      return NextResponse.json({ error: 'budget_id required' }, { status: 400 });
    }

    if (!['team_leader', 'accountant', 'cfo'].includes(profile.role)) {
      return NextResponse.json({ error: 'Only TL, Accountant, or CFO can withdraw budgets' }, { status: 403 });
    }

    // TL withdrawal-rate-limit check (preserved from pre-RPC behaviour)
    if (profile.role === 'team_leader') {
      const { data: budget } = await admin
        .from('budgets')
        .select('year_month, project_id')
        .eq('id', budget_id)
        .single();
      if (!budget) {
        return NextResponse.json({ error: 'Budget not found' }, { status: 404 });
      }

      const { data: limitSetting } = await admin
        .from('system_settings')
        .select('value')
        .eq('key', 'tl_max_budget_withdrawals_per_month')
        .single();
      const maxWithdrawals = parseInt(limitSetting?.value || '3');

      const yearMonth = (budget as { year_month: string }).year_month;
      const { count } = await admin
        .from('budget_withdrawal_log')
        .select('id', { count: 'exact', head: true })
        .eq('withdrawn_by', user.id)
        .eq('year_month', yearMonth);

      if ((count || 0) >= maxWithdrawals) {
        await admin.from('red_flags').insert({
          flag_type: 'expense_spike',
          severity: 'high',
          title: `${profile.full_name} has withdrawn ${count} budgets this month`,
          description: `Team Leader ${profile.full_name} has exceeded the withdrawal limit for ${yearMonth}. Further withdrawals are blocked.`,
          project_id: (budget as { project_id: string }).project_id,
          year_month: yearMonth,
        });
        return NextResponse.json(
          { error: `Withdrawal limit reached (${maxWithdrawals} per month). Contact your CFO.` },
          { status: 400 },
        );
      }
    }

    const { data: newVersion, error: rpcErr } = await admin.rpc('fn_budget_withdraw', {
      p_budget_id: budget_id,
      p_user_id: user.id,
    });

    if (rpcErr) {
      return NextResponse.json({ error: rpcErr.message, code: 'WITHDRAW_FAILED' }, { status: 400 });
    }

    const { data: budgetForLog } = await admin.from('budgets').select('year_month').eq('id', budget_id).single();
    await admin.from('budget_withdrawal_log').insert({
      budget_id,
      withdrawn_by: user.id,
      year_month: (budgetForLog as { year_month: string } | null)?.year_month,
    });

    return NextResponse.json({
      success: true,
      message: 'Budget withdrawn to draft',
      new_version_id: (newVersion as { id: string }).id,
    });
  } catch (error) {
    return apiErrorResponse(error, 'Failed to withdraw budget.', 'BUDGET_WITHDRAW_ERROR');
  }
}
