'use client';

import { useCallback, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import {
  INVOICE_STATUS,
  OUTSTANDING_INVOICE_STATUSES,
} from '@/lib/constants/status';

/**
 * Read-side composer for the Outstanding Receivables report.
 *
 * Per Phase 4 Session C architectural rules:
 *   - Invoices filtered by `status IN OUTSTANDING_INVOICE_STATUSES`
 *     (sent / partially_paid / overdue). NOT by billing_period — these
 *     are cash-state queries, not period-attribution.
 *   - Outstanding amount = invoice.amount_kes - SUM(payments.amount_kes).
 *     `payments` is the source of truth for amount paid; there is no
 *     paid_kes aggregate on invoices.
 *   - Aging from `invoice_date` (the canonical issue date — `due_date`
 *     is nullable in schema). Days outstanding = todayKE - invoice_date.
 *   - Project + client name resolution via direct `projects` query
 *     (clients aren't a separate table; client_name lives on projects).
 *   - Reminder log / last-contact tracking has NO schema support today.
 *     The mockup shows "Apr 22 · email" rows that we cannot populate.
 *     The hook returns no `lastContact` field; the page renders "—".
 */

const NAIROBI_TZ = 'Africa/Nairobi';
const COLLECTED_WINDOW_DAYS = 7;
const TOP_EXPOSURE_MIN_DAYS = 30;
const TOP_EXPOSURE_LIMIT = 6;

export type AgingBucketKey =
  | '0-30'
  | '31-45'
  | '46-60'
  | '61-90'
  | '90-plus';

export type AgingTone = 'success' | 'neutral' | 'warning' | 'danger';

export type AgingBucket = {
  key: AgingBucketKey;
  label: string;
  shortLabel: string;
  meta: string;
  kes: number;
  count: number;
  sharePct: number;
  tone: AgingTone;
};

export type ExposureStatus =
  | 'auto-reminded'
  | 'cfo-followup'
  | 'legal-notice'
  | 'provisioned'
  | 'on-terms';

export type ExposureRow = {
  id: string;
  invoiceNumber: string;
  clientName: string;
  projectName: string;
  issueDate: string; // ISO date
  amountKes: number; // outstanding (invoice - payments)
  daysOutstanding: number;
  agingBucket: AgingBucketKey;
  agingLabel: string;
  status: ExposureStatus;
};

export type ReceivablesSummary = {
  asOfLabel: string;
  monthLabel: string;
  totalOutstandingKes: number;
  invoiceCount: number;
  /** Count of invoices > 60 days outstanding. */
  escalationCount: number;
  /** Sum of invoices > 60 days. */
  pastDueAtRiskKes: number;
  /** Weighted average days outstanding (weight = outstanding amount). */
  dsoDays: number;
  /** Change in DSO vs the snapshot 30 days ago. Null when insufficient
   *  history. */
  dsoMonthDeltaDays: number | null;
  /** Sum of payments in the last 7 days. */
  collectedThisWeekKes: number;
  /** Distinct invoices fully cleared in the last 7 days. */
  clearedThisWeekCount: number;
};

type InvoiceRow = {
  id: string;
  project_id: string;
  invoice_number: string;
  invoice_date: string;
  due_date: string | null;
  amount_kes: number | string | null;
  status: string;
};

type PaymentRow = {
  invoice_id: string;
  payment_date: string;
  amount_kes: number | string | null;
};

type ProjectRow = {
  id: string;
  name: string | null;
  client_name: string | null;
};

// ---------- helpers ----------

function shortMonth(dateIso: string): string {
  const d = new Date(`${dateIso}T00:00:00`);
  return new Intl.DateTimeFormat('en-KE', {
    timeZone: NAIROBI_TZ,
    month: 'long',
    year: 'numeric',
  }).format(d);
}

function todayInNairobi(): Date {
  // Construct a Nairobi-local "midnight today" so we can subtract from
  // ISO dates without DST/timezone surprises.
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: NAIROBI_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = fmt.format(new Date()); // YYYY-MM-DD in en-CA
  return new Date(`${parts}T00:00:00`);
}

function asOfLabel(d: Date): string {
  return new Intl.DateTimeFormat('en-KE', {
    timeZone: NAIROBI_TZ,
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(d);
}

function daysBetween(later: Date, earlier: Date): number {
  const ms = later.getTime() - earlier.getTime();
  return Math.max(0, Math.floor(ms / (1000 * 60 * 60 * 24)));
}

function bucketize(days: number): {
  key: AgingBucketKey;
  label: string;
  short: string;
} {
  if (days <= 30) return { key: '0-30', label: '0–30 days · current', short: '0–30' };
  if (days <= 45) return { key: '31-45', label: '31–45 days · due', short: '31–45' };
  if (days <= 60) return { key: '46-60', label: '46–60 days · late', short: '46–60' };
  if (days <= 90) return { key: '61-90', label: '61–90 days · escalate', short: '61–90' };
  return { key: '90-plus', label: '90+ days · provision', short: '90+' };
}

function bucketTone(key: AgingBucketKey): AgingTone {
  switch (key) {
    case '0-30':
      return 'success';
    case '31-45':
      return 'neutral';
    case '46-60':
      return 'warning';
    case '61-90':
    case '90-plus':
      return 'danger';
  }
}

function defaultBucketMeta(key: AgingBucketKey, count: number): string {
  if (count === 0) return 'No invoices in this bucket';
  const inv = count === 1 ? 'invoice' : 'invoices';
  switch (key) {
    case '0-30':
      return `${count} ${inv} · all on terms`;
    case '31-45':
      return `${count} ${inv} · auto-reminder window`;
    case '46-60':
      return `${count} ${inv} · CFO follow-up`;
    case '61-90':
      return `${count} ${inv} · legal notice ready`;
    case '90-plus':
      return `${count} ${inv} · provision recommended`;
  }
}

function statusFromBucket(key: AgingBucketKey): ExposureStatus {
  switch (key) {
    case '0-30':
      return 'on-terms';
    case '31-45':
      return 'auto-reminded';
    case '46-60':
      return 'cfo-followup';
    case '61-90':
      return 'legal-notice';
    case '90-plus':
      return 'provisioned';
  }
}

function isoDate(d: Date): string {
  // YYYY-MM-DD in Nairobi calendar.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: NAIROBI_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

// ---------- hook ----------

export function useReceivables() {
  const [summary, setSummary] = useState<ReceivablesSummary>(() => {
    const today = todayInNairobi();
    return {
      asOfLabel: asOfLabel(today),
      monthLabel: shortMonth(isoDate(today)),
      totalOutstandingKes: 0,
      invoiceCount: 0,
      escalationCount: 0,
      pastDueAtRiskKes: 0,
      dsoDays: 0,
      dsoMonthDeltaDays: null,
      collectedThisWeekKes: 0,
      clearedThisWeekCount: 0,
    };
  });
  const [agingBuckets, setAgingBuckets] = useState<AgingBucket[]>([]);
  const [topExposures, setTopExposures] = useState<ExposureRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const supabase = createClient();
    const today = todayInNairobi();
    const weekAgo = new Date(today);
    weekAgo.setDate(weekAgo.getDate() - COLLECTED_WINDOW_DAYS);

    try {
      const [invoicesRes, paymentsRes, projectsRes] = await Promise.all([
        supabase
          .from('invoices')
          .select(
            'id, project_id, invoice_number, invoice_date, due_date, amount_kes, status',
          )
          .in('status', OUTSTANDING_INVOICE_STATUSES as unknown as string[]),
        // All payments — we need both lifetime sums (for outstanding
        // computation) and last-7-days sums (for collectedThisWeek).
        supabase
          .from('payments')
          .select('invoice_id, payment_date, amount_kes'),
        supabase.from('projects').select('id, name, client_name'),
      ]);

      const invoices = (invoicesRes.data ?? []) as InvoiceRow[];
      const payments = (paymentsRes.data ?? []) as PaymentRow[];
      const projects = (projectsRes.data ?? []) as ProjectRow[];

      // ---- name resolvers ----
      const projectNameById = new Map<string, string>();
      const clientNameById = new Map<string, string>();
      for (const p of projects) {
        if (!p.id) continue;
        projectNameById.set(p.id, p.name ?? 'Unnamed project');
        clientNameById.set(p.id, p.client_name ?? 'Unknown client');
      }

      // ---- payments aggregation ----
      const paidByInvoice = new Map<string, number>();
      let collectedThisWeekKes = 0;
      const clearedInvoiceIds = new Set<string>();
      for (const p of payments) {
        if (!p.invoice_id) continue;
        const amt = Number(p.amount_kes ?? 0);
        paidByInvoice.set(
          p.invoice_id,
          (paidByInvoice.get(p.invoice_id) ?? 0) + amt,
        );
        if (p.payment_date) {
          const pd = new Date(`${p.payment_date}T00:00:00`);
          if (pd >= weekAgo && pd <= today) {
            collectedThisWeekKes += amt;
            // We can't authoritatively know if a payment cleared the
            // invoice without the invoice's amount; resolve below.
            clearedInvoiceIds.add(p.invoice_id);
          }
        }
      }

      // ---- per-invoice outstanding ----
      type Working = {
        id: string;
        invoiceNumber: string;
        amountKes: number; // total billed
        paidKes: number;
        outstandingKes: number;
        issueDate: string;
        daysOutstanding: number;
        bucket: ReturnType<typeof bucketize>;
        projectId: string;
        projectName: string;
        clientName: string;
      };
      const working: Working[] = invoices
        .map((inv) => {
          const totalBilled = Number(inv.amount_kes ?? 0);
          const paid = paidByInvoice.get(inv.id) ?? 0;
          const outstanding = Math.max(0, totalBilled - paid);
          const issued = new Date(`${inv.invoice_date}T00:00:00`);
          const days = daysBetween(today, issued);
          return {
            id: inv.id,
            invoiceNumber: inv.invoice_number,
            amountKes: totalBilled,
            paidKes: paid,
            outstandingKes: outstanding,
            issueDate: inv.invoice_date,
            daysOutstanding: days,
            bucket: bucketize(days),
            projectId: inv.project_id,
            projectName: projectNameById.get(inv.project_id) ?? 'Unattributed',
            clientName: clientNameById.get(inv.project_id) ?? 'Unknown client',
          };
        })
        // OUTSTANDING_INVOICE_STATUSES includes 'partially_paid'; if a
        // partial fully covered the bill, drop it.
        .filter((w) => w.outstandingKes > 0);

      // Cleared-this-week count = invoices that received a payment in
      // the last 7 days AND now have zero outstanding (i.e. they are
      // not in our `working` set above, since outstanding === 0).
      const stillOutstandingIds = new Set(working.map((w) => w.id));
      let clearedThisWeekCount = 0;
      for (const id of clearedInvoiceIds) {
        if (!stillOutstandingIds.has(id)) clearedThisWeekCount += 1;
      }

      // ---- aging buckets ----
      const totalOutstandingKes = working.reduce(
        (s, w) => s + w.outstandingKes,
        0,
      );
      const bucketAgg = new Map<
        AgingBucketKey,
        { kes: number; count: number; label: string }
      >();
      const bucketOrder: AgingBucketKey[] = [
        '0-30',
        '31-45',
        '46-60',
        '61-90',
        '90-plus',
      ];
      for (const k of bucketOrder) {
        bucketAgg.set(k, {
          kes: 0,
          count: 0,
          label: bucketize(
            k === '0-30'
              ? 15
              : k === '31-45'
                ? 38
                : k === '46-60'
                  ? 53
                  : k === '61-90'
                    ? 75
                    : 95,
          ).label,
        });
      }
      for (const w of working) {
        const agg = bucketAgg.get(w.bucket.key)!;
        agg.kes += w.outstandingKes;
        agg.count += 1;
      }
      const buckets: AgingBucket[] = bucketOrder.map((k) => {
        const agg = bucketAgg.get(k)!;
        const tone = bucketTone(k);
        const sharePct =
          totalOutstandingKes > 0 ? (agg.kes / totalOutstandingKes) * 100 : 0;
        return {
          key: k,
          label: agg.label,
          shortLabel: bucketize(
            k === '0-30'
              ? 15
              : k === '31-45'
                ? 38
                : k === '46-60'
                  ? 53
                  : k === '61-90'
                    ? 75
                    : 95,
          ).short,
          meta: defaultBucketMeta(k, agg.count),
          kes: agg.kes,
          count: agg.count,
          sharePct,
          tone,
        };
      });

      // ---- DSO (weighted average days outstanding) ----
      const dsoDays =
        totalOutstandingKes > 0
          ? working.reduce(
              (s, w) =>
                s + w.daysOutstanding * (w.outstandingKes / totalOutstandingKes),
              0,
            )
          : 0;

      // DSO 30-day delta needs a snapshot table we don't have; null for
      // now. (Could be backfilled from monthly_financial_snapshots later.)
      const dsoMonthDeltaDays: number | null = null;

      // ---- top exposures (>30 days, sorted by amount desc) ----
      const top = working
        .filter((w) => w.daysOutstanding >= TOP_EXPOSURE_MIN_DAYS)
        .sort((a, b) => b.outstandingKes - a.outstandingKes)
        .slice(0, TOP_EXPOSURE_LIMIT)
        .map<ExposureRow>((w) => ({
          id: w.id,
          invoiceNumber: w.invoiceNumber,
          clientName: w.clientName,
          projectName: w.projectName,
          issueDate: w.issueDate,
          amountKes: w.outstandingKes,
          daysOutstanding: w.daysOutstanding,
          agingBucket: w.bucket.key,
          agingLabel: `${w.daysOutstanding} days · ${w.bucket.short}`,
          status: statusFromBucket(w.bucket.key),
        }));

      // ---- escalations + at-risk ----
      const escalationCount = working.filter(
        (w) => w.daysOutstanding > 60,
      ).length;
      const pastDueAtRiskKes = working
        .filter((w) => w.daysOutstanding > 60)
        .reduce((s, w) => s + w.outstandingKes, 0);

      const newSummary: ReceivablesSummary = {
        asOfLabel: asOfLabel(today),
        monthLabel: shortMonth(isoDate(today)),
        totalOutstandingKes,
        invoiceCount: working.length,
        escalationCount,
        pastDueAtRiskKes,
        dsoDays,
        dsoMonthDeltaDays,
        collectedThisWeekKes,
        clearedThisWeekCount,
      };

      // Reference the constant so tree-shaking doesn't strip it; also
      // helps maintainers read the rule.
      void INVOICE_STATUS;

      setSummary(newSummary);
      setAgingBuckets(buckets);
      setTopExposures(top);
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
    agingBuckets,
    topExposures,
    loading,
    error,
    refresh: load,
  };
}
