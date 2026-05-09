// Pure module — shared between the Slack mrkdwn renderer and the dashboard
// EodPanel. Takes the day's activity and emits a structured payload organised
// into the four canonical sections (Expenses Logged, Withdrawals Recorded,
// Cash Received, Budget Actions). No I/O, no Slack-specific markup.

export type ExpenseInput = {
  id: string;
  description: string | null;
  amount_kes: number | string | null;
  expense_type?: string | null;
  project_id?: string | null;
  projects?: { name: string } | null;
  expense_categories?: { name: string } | null;
};

export type WithdrawalInput = {
  id: string;
  director_tag: string | null;
  amount_usd: number | string | null;
  exchange_rate: number | string | null;
  amount_kes: number | string | null;
  forex_bureau: string | null;
  withdrawal_date?: string;
};

export type CashReceiptInput = {
  id: string;
  amount_usd: number | string | null;
  amount_kes: number | string | null;
  payment_date?: string;
  reference: string | null;
  invoices?: {
    invoice_number: string | null;
    projects?: { name: string } | null;
  } | null;
};

export type BudgetActionInput = {
  id: string;
  status: string;
  budget_id?: string | null;
  budgets?: {
    project_id?: string | null;
    department_id?: string | null;
    projects?: { name: string } | null;
    departments?: { name: string } | null;
  } | null;
};

// PRED-5: predated payouts recorded today (both streams). director_name
// and project_name are resolved upstream by the route — the section
// module receives them already flattened so it doesn't have to know
// about the disambiguation between the two FKs from these tables to
// users (director_user_id, recorded_by).
export type PredatedPayoutInput = {
  id: string;
  director_name: string;
  project_name: string | null;
  year_month: string;
  amount_kes: number | string | null;
  payment_method: string;
};

export type PredatedCompanyShareInput = {
  id: string;
  director_name: string;
  year_month: string;
  amount_kes: number | string | null;
  payment_method: string;
};

export type TodayActivity = {
  expenses: ExpenseInput[];
  withdrawals: WithdrawalInput[];
  cashReceipts: CashReceiptInput[];
  budgetActions: BudgetActionInput[];
  predatedPayouts: PredatedPayoutInput[];
  predatedCompanyShares: PredatedCompanyShareInput[];
};

export type ExpenseRow = {
  id: string;
  project: string;
  category: string;
  description: string;
  amountKes: number;
};

export type WithdrawalRow = {
  id: string;
  director: string;
  amountUsd: number;
  amountKes: number;
  exchangeRate: number;
  forexBureau: string;
};

export type CashReceiptRow = {
  id: string;
  project: string;
  invoiceNumber: string;
  amountUsd: number;
  amountKes: number;
  reference: string;
};

export type BudgetActionRow = {
  id: string;
  scope: string;
  statusLabel: string;
};

export type PredatedPayoutRow = {
  id: string;
  director: string;
  project: string;
  yearMonth: string;
  yearMonthLabel: string;
  amountKes: number;
  paymentMethodLabel: string;
};

export type PredatedCompanyShareRow = {
  id: string;
  director: string;
  yearMonth: string;
  yearMonthLabel: string;
  amountKes: number;
  paymentMethodLabel: string;
};

export type ExpensesSection = {
  key: 'expenses';
  title: 'Expenses Logged';
  rows: ExpenseRow[];
  totals: { kes: number };
  emptyState: 'None logged today';
};

export type WithdrawalsSection = {
  key: 'withdrawals';
  title: 'Withdrawals Recorded';
  rows: WithdrawalRow[];
  totals: { usd: number; kes: number };
  emptyState: 'None recorded today';
};

export type CashReceivedSection = {
  key: 'cash_received';
  title: 'Cash Received';
  rows: CashReceiptRow[];
  totals: { usd: number; kes: number };
  emptyState: 'None recorded today';
};

export type BudgetActionsSection = {
  key: 'budget_actions';
  title: 'Budget Actions';
  rows: BudgetActionRow[];
  totals: null;
  emptyState: 'None today';
};

export type PredatedPayoutsSection = {
  key: 'predated_payouts';
  title: 'Predated Payouts (Project Share)';
  rows: PredatedPayoutRow[];
  totals: { kes: number };
  emptyState: 'None recorded today';
};

export type PredatedCompanySharesSection = {
  key: 'predated_company_shares';
  title: 'Predated Company-Share Distributions';
  rows: PredatedCompanyShareRow[];
  totals: { kes: number };
  emptyState: 'None recorded today';
};

export type EodSection =
  | ExpensesSection
  | WithdrawalsSection
  | CashReceivedSection
  | BudgetActionsSection
  | PredatedPayoutsSection
  | PredatedCompanySharesSection;

export type EodSectionsPayload = {
  header: {
    reportDate: string;
    reportDateFormatted: string;
    preparedBy: string | null;
  };
  sections: [
    ExpensesSection,
    WithdrawalsSection,
    CashReceivedSection,
    BudgetActionsSection,
    PredatedPayoutsSection,
    PredatedCompanySharesSection,
  ];
};

const DASH = '—';

function num(v: number | string | null | undefined): number {
  return Number(v ?? 0);
}

function capitalize(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  bank_transfer: 'Bank Transfer',
  cash: 'Cash',
  mobile_money: 'Mobile Money',
  cheque: 'Cheque',
  other: 'Other',
};

function paymentMethodLabel(value: string): string {
  return PAYMENT_METHOD_LABELS[value] ?? value;
}

/** "2024-10" → "Oct 2024" via Africa/Nairobi en-KE. Falls back to the
 *  raw value if the input doesn't match YYYY-MM. */
function shortYearMonthLabel(ym: string): string {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(ym)) return ym;
  const [yStr, mStr] = ym.split('-');
  const y = Number(yStr);
  const m = Number(mStr);
  return new Intl.DateTimeFormat('en-KE', {
    timeZone: 'Africa/Nairobi',
    month: 'short',
    year: 'numeric',
  }).format(new Date(Date.UTC(y, m - 1, 1)));
}

export function buildEodSections(
  activity: TodayActivity,
  opts: {
    reportDate: string;
    reportDateFormatted: string;
    preparedBy: string | null;
  },
): EodSectionsPayload {
  const expensesRows: ExpenseRow[] = activity.expenses.map((e) => ({
    id: e.id,
    project: e.projects?.name || 'Shared',
    category: e.expense_categories?.name || DASH,
    description: e.description ?? '',
    amountKes: num(e.amount_kes),
  }));

  const withdrawalsRows: WithdrawalRow[] = activity.withdrawals.map((w) => ({
    id: w.id,
    director: capitalize(w.director_tag ?? ''),
    amountUsd: num(w.amount_usd),
    amountKes: num(w.amount_kes),
    exchangeRate: num(w.exchange_rate),
    forexBureau: w.forex_bureau || DASH,
  }));

  const cashRows: CashReceiptRow[] = activity.cashReceipts.map((p) => ({
    id: p.id,
    project: p.invoices?.projects?.name || 'Unassigned project',
    invoiceNumber: p.invoices?.invoice_number || 'Unknown invoice',
    amountUsd: num(p.amount_usd),
    amountKes: num(p.amount_kes),
    reference: p.reference || DASH,
  }));

  const budgetRows: BudgetActionRow[] = activity.budgetActions.map((b) => ({
    id: b.id,
    scope:
      b.budgets?.projects?.name || b.budgets?.departments?.name || DASH,
    statusLabel: b.status === 'submitted' ? 'Submitted' : 'Under Review',
  }));

  const predatedPayoutsRows: PredatedPayoutRow[] = activity.predatedPayouts.map((p) => ({
    id: p.id,
    director: p.director_name || 'Unknown director',
    project: p.project_name || 'Unassigned project',
    yearMonth: p.year_month,
    yearMonthLabel: shortYearMonthLabel(p.year_month),
    amountKes: num(p.amount_kes),
    paymentMethodLabel: paymentMethodLabel(p.payment_method),
  }));

  const predatedCompanyRows: PredatedCompanyShareRow[] =
    activity.predatedCompanyShares.map((d) => ({
      id: d.id,
      director: d.director_name || 'Unknown director',
      yearMonth: d.year_month,
      yearMonthLabel: shortYearMonthLabel(d.year_month),
      amountKes: num(d.amount_kes),
      paymentMethodLabel: paymentMethodLabel(d.payment_method),
    }));

  return {
    header: {
      reportDate: opts.reportDate,
      reportDateFormatted: opts.reportDateFormatted,
      preparedBy: opts.preparedBy,
    },
    sections: [
      {
        key: 'expenses',
        title: 'Expenses Logged',
        rows: expensesRows,
        totals: { kes: expensesRows.reduce((s, r) => s + r.amountKes, 0) },
        emptyState: 'None logged today',
      },
      {
        key: 'withdrawals',
        title: 'Withdrawals Recorded',
        rows: withdrawalsRows,
        totals: {
          usd: withdrawalsRows.reduce((s, r) => s + r.amountUsd, 0),
          kes: withdrawalsRows.reduce((s, r) => s + r.amountKes, 0),
        },
        emptyState: 'None recorded today',
      },
      {
        key: 'cash_received',
        title: 'Cash Received',
        rows: cashRows,
        totals: {
          usd: cashRows.reduce((s, r) => s + r.amountUsd, 0),
          kes: cashRows.reduce((s, r) => s + r.amountKes, 0),
        },
        emptyState: 'None recorded today',
      },
      {
        key: 'budget_actions',
        title: 'Budget Actions',
        rows: budgetRows,
        totals: null,
        emptyState: 'None today',
      },
      {
        key: 'predated_payouts',
        title: 'Predated Payouts (Project Share)',
        rows: predatedPayoutsRows,
        totals: { kes: predatedPayoutsRows.reduce((s, r) => s + r.amountKes, 0) },
        emptyState: 'None recorded today',
      },
      {
        key: 'predated_company_shares',
        title: 'Predated Company-Share Distributions',
        rows: predatedCompanyRows,
        totals: { kes: predatedCompanyRows.reduce((s, r) => s + r.amountKes, 0) },
        emptyState: 'None recorded today',
      },
    ],
  };
}

export function activityFromPersistedPayload(payload: unknown): TodayActivity {
  const p = (payload && typeof payload === 'object' ? payload : {}) as {
    expenses?: ExpenseInput[];
    withdrawals?: WithdrawalInput[];
    cash_receipts?: CashReceiptInput[];
    budget_actions?: BudgetActionInput[];
    predated_payouts?: PredatedPayoutInput[];
    predated_company_shares?: PredatedCompanyShareInput[];
  };
  return {
    expenses: Array.isArray(p.expenses) ? p.expenses : [],
    withdrawals: Array.isArray(p.withdrawals) ? p.withdrawals : [],
    cashReceipts: Array.isArray(p.cash_receipts) ? p.cash_receipts : [],
    budgetActions: Array.isArray(p.budget_actions) ? p.budget_actions : [],
    predatedPayouts: Array.isArray(p.predated_payouts) ? p.predated_payouts : [],
    predatedCompanyShares: Array.isArray(p.predated_company_shares)
      ? p.predated_company_shares
      : [],
  };
}
