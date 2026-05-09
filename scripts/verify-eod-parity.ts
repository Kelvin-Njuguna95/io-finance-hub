// Byte-identical regression check for the EOD Slack mrkdwn renderer.
//
// Compares the OUTPUT of the refactored renderer against a frozen snapshot of
// the legacy inline buildMessage. If the two diverge for any fixture, the
// refactor is wrong (not the fixture). Run via:
//
//   npm run verify:eod-parity
//
// Exits 0 on parity, 1 on divergence.

import {
  buildEodSections,
  type TodayActivity,
} from '../src/lib/eod/sections';
import { renderEodSlackMessage } from '../src/lib/eod/render-slack';

// ─── Frozen snapshot of the legacy buildMessage ────────────────────────────
// Copied verbatim from src/app/api/eod/route.ts as of commit 0ff9e37 (the
// state immediately prior to the renderer refactor). Do not modify.

function legacyFormatKES(amount: number): string {
  return (
    'KES ' +
    new Intl.NumberFormat('en-KE', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount)
  );
}

function legacyFormatUSD(amount: number): string {
  return `USD ${new Intl.NumberFormat('en-KE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount)}`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function legacyBuildMessage(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  expenses: any[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  withdrawals: any[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  cashReceipts: any[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  budgetActions: any[],
  senderName: string,
  dateFormatted: string,
  timeEAT: string,
): string {
  const totalExpenseKes = expenses.reduce(
    (s: number, e: { amount_kes: number | string }) => s + Number(e.amount_kes),
    0,
  );
  const totalCashUsd = cashReceipts.reduce(
    (s: number, p: { amount_usd?: number | string | null }) =>
      s + Number(p.amount_usd || 0),
    0,
  );
  const totalCashKes = cashReceipts.reduce(
    (s: number, p: { amount_kes?: number | string | null }) =>
      s + Number(p.amount_kes || 0),
    0,
  );

  let msg = `*IO Finance — End of Day Report*\n`;
  msg += `${dateFormatted} | Prepared by: ${senderName}\n\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

  msg += `*Expenses Logged*\n`;
  if (expenses.length === 0) {
    msg += `_None logged today_\n`;
  } else {
    for (const e of expenses) {
      const scope = e.projects?.name || 'Shared';
      const cat = e.expense_categories?.name || '—';
      msg += `• ${scope} — ${cat} — ${legacyFormatKES(Number(e.amount_kes))} — ${e.description}\n`;
    }
    msg += `_Total: ${legacyFormatKES(totalExpenseKes)}_\n`;
  }
  msg += `\n`;

  msg += `*Withdrawals Recorded*\n`;
  if (withdrawals.length === 0) {
    msg += `_None recorded today_\n`;
  } else {
    const totalWdUsd = withdrawals.reduce(
      (s: number, w: { amount_usd: number | string }) => s + Number(w.amount_usd),
      0,
    );
    const totalWdKes = withdrawals.reduce(
      (s: number, w: { amount_kes: number | string }) => s + Number(w.amount_kes),
      0,
    );
    for (const w of withdrawals) {
      const dir =
        w.director_tag?.charAt(0).toUpperCase() + w.director_tag?.slice(1);
      msg += `• ${dir} — ${legacyFormatUSD(Number(w.amount_usd))} @ ${new Intl.NumberFormat('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(w.exchange_rate))} = ${legacyFormatKES(Number(w.amount_kes))} — ${w.forex_bureau || '—'}\n`;
    }
    msg += `_Total: ${legacyFormatUSD(totalWdUsd)} (${legacyFormatKES(totalWdKes)})_\n`;
  }
  msg += `\n`;

  msg += `*Cash Received*\n`;
  if (cashReceipts.length === 0) {
    msg += `_None recorded today_\n`;
  } else {
    for (const p of cashReceipts) {
      const invoiceNumber = p.invoices?.invoice_number || 'Unknown invoice';
      const project = p.invoices?.projects?.name || 'Unassigned project';
      msg += `• ${project} — ${invoiceNumber} — ${legacyFormatUSD(Number(p.amount_usd || 0))} (${legacyFormatKES(Number(p.amount_kes || 0))}) — Ref: ${p.reference || '—'}\n`;
    }
    msg += `_Total: ${legacyFormatUSD(totalCashUsd)} (${legacyFormatKES(totalCashKes)})_\n`;
  }
  msg += `\n`;

  msg += `*Budget Actions*\n`;
  if (budgetActions.length === 0) {
    msg += `_None today_\n`;
  } else {
    for (const b of budgetActions) {
      const scope =
        b.budgets?.projects?.name || b.budgets?.departments?.name || '—';
      const status = b.status === 'submitted' ? 'Submitted' : 'Under Review';
      msg += `• ${scope} — ${status}\n`;
    }
  }
  msg += `\n`;

  msg += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `Sent by ${senderName} at ${timeEAT} EAT`;

  return msg;
}

// ─── Fixtures ──────────────────────────────────────────────────────────────

const populated: TodayActivity = {
  expenses: [
    {
      id: 'e1',
      description: 'Office rent — May',
      amount_kes: 250000,
      projects: { name: 'Windward' },
      expense_categories: { name: 'Rent' },
    },
    {
      id: 'e2',
      description: 'Cloud hosting',
      amount_kes: 78250.5,
      projects: null,
      expense_categories: { name: 'Infrastructure' },
    },
    {
      id: 'e3',
      description: 'Misc supplies',
      amount_kes: 4200,
      projects: { name: 'AIFI' },
      expense_categories: null,
    },
  ],
  withdrawals: [
    {
      id: 'w1',
      director_tag: 'kelvin',
      amount_usd: 1000,
      exchange_rate: 130.5,
      amount_kes: 130500,
      forex_bureau: 'Equity Bank',
    },
    {
      id: 'w2',
      director_tag: 'sam',
      amount_usd: 500,
      exchange_rate: 130,
      amount_kes: 65000,
      forex_bureau: null,
    },
  ],
  cashReceipts: [
    {
      id: 'p1',
      amount_usd: 6384,
      amount_kes: 820344,
      reference: 'TRIKE14260837',
      invoices: {
        invoice_number: 'SI - 006 (Mar Inv)',
        projects: { name: 'SEEO' },
      },
    },
    {
      id: 'p2',
      amount_usd: 1200,
      amount_kes: 156000,
      reference: null,
      invoices: { invoice_number: 'SI - 011', projects: null },
    },
  ],
  budgetActions: [
    {
      id: 'b1',
      status: 'submitted',
      budgets: { projects: { name: 'Windward' }, departments: null },
    },
    {
      id: 'b2',
      status: 'under_review',
      budgets: { projects: null, departments: { name: 'Operations' } },
    },
  ],
  // PRED-5: predated sections kept empty in fixtures — the legacy
  // buildMessage doesn't render them (they didn't exist), so a populated
  // predated section would break the parity-equality assertion. New
  // fixtures covering the predated rendering can be added here when the
  // parity script is wired into CI (Phase 1 audit EOD-4 / EOD-5).
  predatedPayouts: [],
  predatedCompanyShares: [],
};

const empty: TodayActivity = {
  expenses: [],
  withdrawals: [],
  cashReceipts: [],
  budgetActions: [],
  predatedPayouts: [],
  predatedCompanyShares: [],
};

const mixed: TodayActivity = {
  expenses: [
    {
      id: 'e1',
      description: 'Domain renewal',
      amount_kes: 2500,
      projects: { name: 'Kemtai' },
      expense_categories: { name: 'Software' },
    },
  ],
  withdrawals: [],
  cashReceipts: [
    {
      id: 'p1',
      amount_usd: 3000,
      amount_kes: 390000,
      reference: 'WT-2026-0045',
      invoices: {
        invoke_number: 'INV-100',
        projects: { name: 'Windward' },
      } as unknown as { invoice_number: string; projects: { name: string } },
    },
  ],
  budgetActions: [],
  predatedPayouts: [],
  predatedCompanyShares: [],
};

const SENDER = 'Kelvin Wachira';
const DATE_FORMATTED = 'Thursday, 7 May 2026';
const TIME_EAT = '21:30';
const REPORT_DATE = '2026-05-07';

function compare(label: string, fixture: TodayActivity): boolean {
  const expected = legacyBuildMessage(
    fixture.expenses,
    fixture.withdrawals,
    fixture.cashReceipts,
    fixture.budgetActions,
    SENDER,
    DATE_FORMATTED,
    TIME_EAT,
  );

  const payload = buildEodSections(fixture, {
    reportDate: REPORT_DATE,
    reportDateFormatted: DATE_FORMATTED,
    preparedBy: SENDER,
  });
  const actual = renderEodSlackMessage(payload, SENDER, TIME_EAT);

  if (actual === expected) {
    console.log(`  ✓ ${label} — byte-identical (${actual.length} chars)`);
    return true;
  }

  console.error(`  ✗ ${label} — DIVERGED`);
  // Find first differing index
  const minLen = Math.min(actual.length, expected.length);
  let i = 0;
  while (i < minLen && actual[i] === expected[i]) i++;
  const ctx = (s: string) =>
    JSON.stringify(s.slice(Math.max(0, i - 20), i + 40));
  console.error(`    first diff at index ${i}`);
  console.error(`    expected ${ctx(expected)}`);
  console.error(`    actual   ${ctx(actual)}`);
  return false;
}

console.log('EOD Slack parity check:');
const results = [
  compare('populated (all four sections, multiple rows)', populated),
  compare('empty (all four sections empty)', empty),
  compare('mixed (some sections populated, some empty)', mixed),
];

if (results.every(Boolean)) {
  console.log('\nAll fixtures byte-identical. ✓');
  process.exit(0);
}
console.error('\nParity check FAILED.');
process.exit(1);
