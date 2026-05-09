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

// ─── Numbers parity (EOD-5) ────────────────────────────────────────────────
// Re-verifies that the totals + row counts the dashboard binds against
// (`payload.sections[i].totals.*` and `payload.sections[i].rows.length`)
// are exactly what the Slack renderer emits as `_Total: …_` lines and
// `• ` rows. Catches drift introduced by a future tweak inside
// renderEodSlackMessage that the byte-equality fixtures wouldn't notice
// (e.g. fixtures rotated, new rounding silently introduced, locale
// changed). Pure in-memory; no Supabase, no network.

type SectionKind =
  | 'expenses-kes' // totals: { kes }
  | 'withdrawals-usd-kes' // totals: { usd, kes }
  | 'cash-usd-kes' // totals: { usd, kes }
  | 'budget-no-totals' // totals: null
  | 'predated-kes'; // totals: { kes } AND emits "N record(s), KES X" form

type SectionSpec = {
  // Index into payload.sections (matches sections.ts ordering).
  index: 0 | 1 | 2 | 3 | 4 | 5;
  title: string;
  kind: SectionKind;
  // True when render-slack.ts suppresses the entire block on rows=0
  // (predated sections; the rest emit *Title* + empty-state line).
  suppressEmpty: boolean;
};

const SECTION_SPECS: readonly SectionSpec[] = [
  { index: 0, title: 'Expenses Logged', kind: 'expenses-kes', suppressEmpty: false },
  { index: 1, title: 'Withdrawals Recorded', kind: 'withdrawals-usd-kes', suppressEmpty: false },
  { index: 2, title: 'Cash Received', kind: 'cash-usd-kes', suppressEmpty: false },
  { index: 3, title: 'Budget Actions', kind: 'budget-no-totals', suppressEmpty: false },
  { index: 4, title: 'Predated Payouts (Project Share)', kind: 'predated-kes', suppressEmpty: true },
  { index: 5, title: 'Predated Company-Share Distributions', kind: 'predated-kes', suppressEmpty: true },
] as const;

function parseKes(value: string): number {
  // "KES 1,234.56" → 1234.56
  return Number(value.replace(/^KES\s*/, '').replace(/,/g, ''));
}

function parseUsd(value: string): number {
  // "USD 1,234.56" → 1234.56
  return Number(value.replace(/^USD\s*/, '').replace(/,/g, ''));
}

// Compare at 2dp — that's the precision the renderer commits to via
// Intl.NumberFormat({ min/maxFractionDigits: 2 }). Anything finer is
// outside what the dashboard or Slack actually surfaces, so a strict
// === would be over-tight (and would miss IEEE float artefacts on
// hypothetical fractional fixture values).
function roundCents(n: number): number {
  return Math.round(n * 100) / 100;
}

type ParsedSection = {
  rowCount: number;
  totalLine: string | null;
};

function parseSlackSections(slack: string): Map<string, ParsedSection> {
  const out = new Map<string, ParsedSection>();
  // The renderer separates sections with a literal blank line ("\n\n"),
  // and starts each section block with `*Title*\n`. The document header
  // also opens with `*IO Finance — End of Day Report*` — skip it.
  const blocks = slack.split('\n\n');
  for (const block of blocks) {
    const lines = block.split('\n');
    const titleMatch = lines[0]?.match(/^\*([^*]+)\*$/);
    if (!titleMatch) continue;
    const title = titleMatch[1];
    if (title === 'IO Finance — End of Day Report') continue;
    let rowCount = 0;
    let totalLine: string | null = null;
    for (const line of lines.slice(1)) {
      if (line.startsWith('• ')) rowCount++;
      else if (line.startsWith('_Total:')) totalLine = line;
    }
    out.set(title, { rowCount, totalLine });
  }
  return out;
}

type ParityIssue = {
  fixture: string;
  section: string;
  field: string;
  expected: string;
  actual: string;
};

function pushKesTotalCheck(
  issues: ParityIssue[],
  fixture: string,
  section: string,
  totalLine: string,
  expected: number,
): void {
  const m = totalLine.match(/^_Total: (KES [\d,]+\.\d{2})_$/);
  if (!m) {
    issues.push({
      fixture,
      section,
      field: 'totals.kes (format)',
      expected: '_Total: KES X,XXX.XX_',
      actual: totalLine,
    });
    return;
  }
  const got = roundCents(parseKes(m[1]));
  const want = roundCents(expected);
  if (got !== want) {
    issues.push({ fixture, section, field: 'totals.kes', expected: String(want), actual: String(got) });
  }
}

function pushUsdKesTotalCheck(
  issues: ParityIssue[],
  fixture: string,
  section: string,
  totalLine: string,
  expectedUsd: number,
  expectedKes: number,
): void {
  const m = totalLine.match(/^_Total: (USD [\d,]+\.\d{2}) \((KES [\d,]+\.\d{2})\)_$/);
  if (!m) {
    issues.push({
      fixture,
      section,
      field: 'totals.usd/kes (format)',
      expected: '_Total: USD X,XXX.XX (KES X,XXX.XX)_',
      actual: totalLine,
    });
    return;
  }
  const gotUsd = roundCents(parseUsd(m[1]));
  const wantUsd = roundCents(expectedUsd);
  if (gotUsd !== wantUsd) {
    issues.push({ fixture, section, field: 'totals.usd', expected: String(wantUsd), actual: String(gotUsd) });
  }
  const gotKes = roundCents(parseKes(m[2]));
  const wantKes = roundCents(expectedKes);
  if (gotKes !== wantKes) {
    issues.push({ fixture, section, field: 'totals.kes', expected: String(wantKes), actual: String(gotKes) });
  }
}

function pushPredatedTotalCheck(
  issues: ParityIssue[],
  fixture: string,
  section: string,
  totalLine: string,
  expectedKes: number,
  expectedRows: number,
): void {
  // Predated sections render: `_Total: N record(s), KES X,XXX.XX_`
  const m = totalLine.match(/^_Total: (\d+) records?, (KES [\d,]+\.\d{2})_$/);
  if (!m) {
    issues.push({
      fixture,
      section,
      field: 'totals.kes (format)',
      expected: '_Total: N record(s), KES X,XXX.XX_',
      actual: totalLine,
    });
    return;
  }
  const gotN = Number(m[1]);
  if (gotN !== expectedRows) {
    issues.push({ fixture, section, field: 'totals.recordCount', expected: String(expectedRows), actual: String(gotN) });
  }
  const got = roundCents(parseKes(m[2]));
  const want = roundCents(expectedKes);
  if (got !== want) {
    issues.push({ fixture, section, field: 'totals.kes', expected: String(want), actual: String(got) });
  }
}

function compareNumbers(label: string, fixture: TodayActivity): ParityIssue[] {
  const issues: ParityIssue[] = [];
  const payload = buildEodSections(fixture, {
    reportDate: REPORT_DATE,
    reportDateFormatted: DATE_FORMATTED,
    preparedBy: SENDER,
  });
  const slack = renderEodSlackMessage(payload, SENDER, TIME_EAT);
  const parsed = parseSlackSections(slack);

  for (const spec of SECTION_SPECS) {
    const section = payload.sections[spec.index];
    const ps = parsed.get(spec.title);
    const rows = section.rows.length;

    // Block presence
    if (!ps) {
      if (rows === 0 && spec.suppressEmpty) continue; // expected absence
      issues.push({
        fixture: label,
        section: spec.title,
        field: 'block',
        expected: rows === 0 ? 'present (empty-state line)' : 'present (rows + total)',
        actual: 'missing',
      });
      continue;
    }
    if (rows === 0 && spec.suppressEmpty) {
      issues.push({
        fixture: label,
        section: spec.title,
        field: 'block',
        expected: 'absent (suppressed when empty)',
        actual: 'present',
      });
      continue;
    }

    // Row count
    if (ps.rowCount !== rows) {
      issues.push({
        fixture: label,
        section: spec.title,
        field: 'rows.length',
        expected: String(rows),
        actual: String(ps.rowCount),
      });
    }

    // Total line — present only when rows > 0 (except budget_actions, never)
    if (spec.kind === 'budget-no-totals') {
      if (ps.totalLine !== null) {
        issues.push({
          fixture: label,
          section: spec.title,
          field: 'totalLine',
          expected: 'absent (section has no totals)',
          actual: ps.totalLine,
        });
      }
      continue;
    }

    if (rows === 0) {
      // Renderer suppresses the Total line on empty (non-predated) sections.
      // If a Total line shows up anyway, that's a renderer-spec mismatch
      // — flag rather than paper over.
      if (ps.totalLine !== null) {
        issues.push({
          fixture: label,
          section: spec.title,
          field: 'totalLine',
          expected: 'absent (empty section)',
          actual: ps.totalLine,
        });
      }
      continue;
    }

    if (!ps.totalLine) {
      issues.push({
        fixture: label,
        section: spec.title,
        field: 'totalLine',
        expected: '_Total: …_ line',
        actual: 'missing (section has rows but no rendered total)',
      });
      continue;
    }

    // Parse + compare against payload totals
    if (spec.kind === 'expenses-kes') {
      const totals = (section as { totals: { kes: number } }).totals;
      pushKesTotalCheck(issues, label, spec.title, ps.totalLine, totals.kes);
    } else if (spec.kind === 'withdrawals-usd-kes' || spec.kind === 'cash-usd-kes') {
      const totals = (section as { totals: { usd: number; kes: number } }).totals;
      pushUsdKesTotalCheck(issues, label, spec.title, ps.totalLine, totals.usd, totals.kes);
    } else if (spec.kind === 'predated-kes') {
      const totals = (section as { totals: { kes: number } }).totals;
      pushPredatedTotalCheck(issues, label, spec.title, ps.totalLine, totals.kes, rows);
    }
  }

  return issues;
}

console.log('EOD Slack parity check:');

console.log('\n  Pass 1 — byte-equality (renderer ≡ legacy buildMessage):');
const byteResults = [
  compare('populated (all four sections, multiple rows)', populated),
  compare('empty (all four sections empty)', empty),
  compare('mixed (some sections populated, some empty)', mixed),
];
const allBytePass = byteResults.every(Boolean);

console.log('\n  Pass 2 — numbers parity (Slack totals/counts ≡ payload totals/counts):');
const fixtures: Array<[string, TodayActivity]> = [
  ['populated (all four sections, multiple rows)', populated],
  ['empty (all four sections empty)', empty],
  ['mixed (some sections populated, some empty)', mixed],
];
const allNumberIssues: ParityIssue[] = [];
for (const [label, fixture] of fixtures) {
  const issues = compareNumbers(label, fixture);
  if (issues.length === 0) {
    console.log(`  ✓ ${label} — totals + counts match payload`);
  } else {
    console.error(`  ✗ ${label} — ${issues.length} mismatch${issues.length === 1 ? '' : 'es'}`);
    for (const issue of issues) {
      console.error(
        `      [${issue.section}] ${issue.field}: expected ${issue.expected} · got ${issue.actual}`,
      );
    }
    allNumberIssues.push(...issues);
  }
}
const allNumbersPass = allNumberIssues.length === 0;

if (allBytePass && allNumbersPass) {
  console.log('\nAll passes succeeded ✓');
  process.exit(0);
}
console.error('\nParity check FAILED.');
process.exit(1);
