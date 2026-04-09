import type { SupabaseClient } from '@supabase/supabase-js';
import type { InvoiceWithPayments } from '@/types/query-results';

const INVOICE_WITH_PAYMENTS_SELECT = 'id, invoice_number, project_id, invoice_date, due_date, billing_period, amount_usd, amount_kes, status, description, projects(name), payments(id, amount_usd, payment_date, payment_method, reference)';

export async function getInvoicesByMonth(supabase: SupabaseClient, yearMonth: string) {
  return supabase
    .from('invoices')
    .select(INVOICE_WITH_PAYMENTS_SELECT)
    .eq('billing_period', yearMonth)
    .order('invoice_date', { ascending: false });
}

export async function getAllInvoices(supabase: SupabaseClient) {
  return supabase
    .from('invoices')
    .select(INVOICE_WITH_PAYMENTS_SELECT)
    .order('invoice_date', { ascending: false });
}

export async function getOutstandingInvoices(supabase: SupabaseClient) {
  return supabase
    .from('invoices')
    .select(INVOICE_WITH_PAYMENTS_SELECT)
    .in('status', ['sent', 'partially_paid', 'overdue'])
    .order('invoice_date', { ascending: true });
}

export function getInvoicePaidTotal(invoice: InvoiceWithPayments): number {
  return (invoice.payments || []).reduce((sum, payment) => sum + Number(payment.amount_usd || 0), 0);
}

export function getInvoiceOutstandingTotal(invoice: InvoiceWithPayments): number {
  return Math.max(0, Number(invoice.amount_usd || 0) - getInvoicePaidTotal(invoice));
}
