import { NextResponse } from 'next/server';
import { getAuthUserProfile, assertRole, assertMonthOpen } from '@/lib/supabase/admin';
import { apiErrorResponse } from '@/lib/api-errors';

type EditInvoicePayload = {
  id?: string;
  expected_updated_at?: string;
  billing_period?: string;
  invoice_date?: string;
  due_date?: string | null;
  description?: string | null;
};

// Tier 1 (A2). Anything outside this set is silently dropped server-side.
const EDITABLE_FIELDS = ['billing_period', 'invoice_date', 'due_date', 'description'] as const;

// Mirrors InvoiceRowData (invoices/page.tsx:27-40) plus updated_at.
const RETURN_COLUMNS =
  'id, invoice_number, project_id, invoice_date, due_date, billing_period, ' +
  'amount_usd, amount_kes, status, description, created_at, updated_at, created_by';

// Explicit row type. Necessary because RETURN_COLUMNS is built via
// runtime string concatenation — supabase-js's literal-type inference
// can't see through it and widens the response to GenericStringError.
// Nullability mirrors the live schema (supabase/migrations/00002_tables.sql:235-251).
type LoadedInvoice = {
  id: string;
  invoice_number: string;
  project_id: string;
  invoice_date: string;        // DATE NOT NULL
  due_date: string | null;      // DATE (nullable)
  billing_period: string;       // TEXT NOT NULL ('YYYY-MM')
  amount_usd: number;           // NUMERIC NOT NULL
  amount_kes: number;           // NUMERIC NOT NULL DEFAULT 0
  status: string;               // invoice_status NOT NULL
  description: string | null;   // TEXT (nullable)
  created_at: string;           // TIMESTAMPTZ NOT NULL
  updated_at: string;           // TIMESTAMPTZ NOT NULL
  created_by: string;           // UUID NOT NULL
};

const BILLING_PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
// <input type="date"> emits YYYY-MM-DD; full-ISO is out of scope (Q6).
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// [BACKDATED] + non-whitespace run; matches invoices/page.tsx:112 regex.
function extractBackdatedPrefix(description: string | null): string | null {
  if (!description) return null;
  const match = description.match(/^\[BACKDATED\]\S*/);
  return match ? match[0] : null;
}

// YYYY-MM + 1 month → YYYY-MM. Null on malformed input (legacy tolerance).
function nextMonth(yearMonth: string | null): string | null {
  if (!yearMonth) return null;
  const m = yearMonth.match(/^(\d{4})-(\d{2})$/);
  if (!m) return null;
  const next = new Date(Number(m[1]), Number(m[2]), 1);
  return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`;
}

export async function PATCH(request: Request) {
  try {
    const auth = await getAuthUserProfile(request);
    if ('error' in auth) {
      return NextResponse.json(
        { error: auth.error.message, code: 'AUTH_ERROR' },
        { status: auth.error.status },
      );
    }
    const { profile, admin } = auth;

    const roleErr = assertRole(profile, ['cfo', 'accountant']);
    if (roleErr) {
      return NextResponse.json({ error: roleErr.message, code: 'FORBIDDEN' }, { status: roleErr.status });
    }

    const body = (await request.json()) as EditInvoicePayload;

    if (!body.id || !body.expected_updated_at) {
      return NextResponse.json(
        { error: 'id and expected_updated_at are required.', code: 'MISSING_REQUIRED_FIELDS' },
        { status: 400 },
      );
    }

    // Load using RETURN_COLUMNS so we can echo it on a no-op short-circuit.
    // `.single<LoadedInvoice>()` pins the row type to the explicit shape
    // declared above; supabase-js's inference can't follow the concatenated
    // SELECT string.
    const { data: loaded, error: loadErr } = await admin
      .from('invoices')
      .select(RETURN_COLUMNS)
      .eq('id', body.id)
      .single<LoadedInvoice>();

    if (loadErr || !loaded) {
      return NextResponse.json({ error: 'Invoice not found.', code: 'INVOICE_NOT_FOUND' }, { status: 404 });
    }

    // A7 optimistic-concurrency precheck (defense-in-depth alongside the .eq below).
    const versionMismatch = () =>
      NextResponse.json(
        { error: 'This invoice was modified by someone else. Please reload and try again.', code: 'INVOICE_VERSION_MISMATCH' },
        { status: 409 },
      );
    if (loaded.updated_at !== body.expected_updated_at) return versionMismatch();

    // Validate only fields actually present in the body.
    const err = (msg: string, code: string) =>
      NextResponse.json({ error: msg, code }, { status: 400 });
    if (body.billing_period !== undefined && !BILLING_PERIOD_RE.test(body.billing_period)) {
      return err('billing_period must match YYYY-MM.', 'INVALID_BILLING_PERIOD');
    }
    if (body.invoice_date !== undefined && body.invoice_date !== null && !ISO_DATE_RE.test(body.invoice_date)) {
      return err('invoice_date must be YYYY-MM-DD.', 'INVALID_DATE');
    }
    if (body.due_date !== undefined && body.due_date !== null && !ISO_DATE_RE.test(body.due_date)) {
      return err('due_date must be YYYY-MM-DD.', 'INVALID_DATE');
    }

    // Backdated guard (A1): if the loaded row has a [BACKDATED]<token>
    // prefix and description is being set, it must start with the exact
    // same prefix. Dialog re-attaches automatically (§2).
    if (body.description !== undefined && body.description !== null) {
      const oldPrefix = extractBackdatedPrefix(loaded.description);
      if (oldPrefix && extractBackdatedPrefix(body.description) !== oldPrefix) {
        return err(
          'Cannot remove or alter the [BACKDATED] marker on a backdated invoice.',
          'BACKDATED_SENTINEL_MUTATED',
        );
      }
    }

    // A5 — block clearing a previously-set description. Fires when an
    // operator explicitly nulls or empties description (after stripping
    // any [BACKDATED] prefix) AND the loaded row had content.
    if (body.description !== undefined && loaded.description) {
      const oldPrefix = extractBackdatedPrefix(loaded.description);
      const incoming = body.description ?? '';
      const visible = oldPrefix ? incoming.slice(oldPrefix.length).trim() : incoming.trim();
      if (visible === '') {
        return err('Description cannot be cleared.', 'DESCRIPTION_CANNOT_BE_CLEARED');
      }
    }

    // A8 — month-closure guard on OLD and NEW recognition months
    // (billing_period + 1 month, per the lagged-revenue model).
    // Mirrors assertMonthOpen precedent (cfo-revert/route.ts).
    const oldRec = nextMonth(loaded.billing_period);
    const newRec = nextMonth(body.billing_period ?? loaded.billing_period);
    for (const rec of new Set([oldRec, newRec].filter(Boolean) as string[])) {
      if (await assertMonthOpen(admin, rec)) {
        return err(
          `Cannot edit this invoice — its revenue recognition month (${rec}) is closed.`,
          'RECOGNITION_MONTH_CLOSED',
        );
      }
    }

    // Patch only what the operator sent (undefined → skip; null → write NULL).
    const patch: Record<string, unknown> = {};
    for (const field of EDITABLE_FIELDS) {
      if (body[field] !== undefined) patch[field] = body[field];
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ success: true, data: loaded });
    }

    // .eq('updated_at', …) makes this only match the still-current row;
    // a concurrent writer between precheck and now → PGRST116 → 409.
    const { data: updated, error: updateErr } = await admin
      .from('invoices')
      .update(patch)
      .eq('id', body.id)
      .eq('updated_at', body.expected_updated_at)
      .select(RETURN_COLUMNS)
      .single<LoadedInvoice>();

    if (updateErr) {
      if (updateErr.code === 'PGRST116') return versionMismatch();
      return NextResponse.json({ error: updateErr.message, code: 'INVOICE_UPDATE_FAILED' }, { status: 422 });
    }

    return NextResponse.json({ success: true, data: updated });
  } catch (error) {
    return apiErrorResponse(error, 'Failed to update invoice.', 'INVOICE_UPDATE_ERROR');
  }
}
