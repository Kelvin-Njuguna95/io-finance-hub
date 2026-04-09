-- Optional function update for unified accrual snapshot generation.
-- This does not mutate expense rows and only changes reporting aggregation logic.

CREATE OR REPLACE FUNCTION fn_generate_monthly_snapshot(p_year_month TEXT)
RETURNS VOID AS $$
DECLARE
  v_rev_usd NUMERIC(16,4);
  v_rev_kes NUMERIC(16,2);
  v_direct_usd NUMERIC(16,4);
  v_direct_kes NUMERIC(16,2);
  v_overhead_usd NUMERIC(16,4);
  v_overhead_kes NUMERIC(16,2);
  v_forex_gl NUMERIC(16,2);
  v_agents INTEGER;
  v_payment_month TEXT;
BEGIN
  -- Revenue recognised from service month (p_year_month)
  SELECT COALESCE(SUM(amount_usd), 0), COALESCE(SUM(amount_kes), 0)
  INTO v_rev_usd, v_rev_kes
  FROM invoices WHERE billing_period = p_year_month;

  -- Expenses recognised from payment month (service month + 1)
  v_payment_month := TO_CHAR((TO_DATE(p_year_month || '-01', 'YYYY-MM-DD') + INTERVAL '1 month')::DATE, 'YYYY-MM');

  SELECT COALESCE(SUM(amount_usd), 0), COALESCE(SUM(amount_kes), 0)
  INTO v_direct_usd, v_direct_kes
  FROM expenses WHERE year_month = v_payment_month AND expense_type = 'project_expense';

  SELECT COALESCE(SUM(amount_usd), 0), COALESCE(SUM(amount_kes), 0)
  INTO v_overhead_usd, v_overhead_kes
  FROM expenses WHERE year_month = v_payment_month AND expense_type = 'shared_expense';

  SELECT COALESCE(SUM(variance_kes), 0)
  INTO v_forex_gl
  FROM withdrawals WHERE year_month = p_year_month;

  SELECT COALESCE(SUM(agent_count), 0)
  INTO v_agents
  FROM agent_counts WHERE year_month = p_year_month;

  INSERT INTO monthly_financial_snapshots (
    year_month,
    total_revenue_usd, total_revenue_kes,
    total_direct_costs_usd, total_direct_costs_kes,
    gross_profit_usd, gross_profit_kes,
    total_shared_overhead_usd, total_shared_overhead_kes,
    operating_profit_usd, operating_profit_kes,
    forex_gain_loss_kes,
    net_profit_usd, net_profit_kes,
    total_agents
  )
  VALUES (
    p_year_month,
    v_rev_usd, v_rev_kes,
    v_direct_usd, v_direct_kes,
    v_rev_usd - v_direct_usd, v_rev_kes - v_direct_kes,
    v_overhead_usd, v_overhead_kes,
    v_rev_usd - v_direct_usd - v_overhead_usd, v_rev_kes - v_direct_kes - v_overhead_kes,
    v_forex_gl,
    v_rev_usd - v_direct_usd - v_overhead_usd,
    v_rev_kes - v_direct_kes - v_overhead_kes + v_forex_gl,
    v_agents
  )
  ON CONFLICT (year_month) DO UPDATE SET
    total_revenue_usd = EXCLUDED.total_revenue_usd,
    total_revenue_kes = EXCLUDED.total_revenue_kes,
    total_direct_costs_usd = EXCLUDED.total_direct_costs_usd,
    total_direct_costs_kes = EXCLUDED.total_direct_costs_kes,
    gross_profit_usd = EXCLUDED.gross_profit_usd,
    gross_profit_kes = EXCLUDED.gross_profit_kes,
    total_shared_overhead_usd = EXCLUDED.total_shared_overhead_usd,
    total_shared_overhead_kes = EXCLUDED.total_shared_overhead_kes,
    operating_profit_usd = EXCLUDED.operating_profit_usd,
    operating_profit_kes = EXCLUDED.operating_profit_kes,
    forex_gain_loss_kes = EXCLUDED.forex_gain_loss_kes,
    net_profit_usd = EXCLUDED.net_profit_usd,
    net_profit_kes = EXCLUDED.net_profit_kes,
    total_agents = EXCLUDED.total_agents;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
