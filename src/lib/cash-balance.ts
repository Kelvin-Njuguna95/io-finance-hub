type PaymentLike = {
  amount_usd?: number | string | null;
};

type InvoiceLike = {
  amount_usd?: number | string | null;
  status?: string | null;
  payments?: PaymentLike[] | null;
};

export function getInvoicePaidUsd(invoice: InvoiceLike): number {
  const paymentTotal = (invoice.payments || []).reduce(
    (sum, payment) => sum + Number(payment.amount_usd || 0),
    0,
  );
  const invoiceAmount = Number(invoice.amount_usd || 0);
  return invoice.status === 'paid'
    ? Math.max(invoiceAmount, paymentTotal)
    : paymentTotal;
}

export function getTotalPaidUsd(invoices: InvoiceLike[]): number {
  return invoices.reduce((sum, invoice) => sum + getInvoicePaidUsd(invoice), 0);
}
